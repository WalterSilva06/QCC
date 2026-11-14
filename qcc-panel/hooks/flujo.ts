// Flujo `/impl` en curso. Puro: sin `$`, para poder probarlo solo.

import type { FilaSemana, Flujo, Semana } from '../types'
import { duracion } from './formato'
import { familia, idDeFila, nombreEsfuerzo } from './semana'
import type { Uso } from './semana'

/**
 * Lo que una herramienta o un agente hace y que mueve el flujo de paso.
 * `paso` de la señal de estado es el `--paso <n>` de `estado.mjs`: el paso que el flujo dice que lleva. Falta si no vino o no es un entero.
 * `modo` `otro` son `--guardar`, `--estado`, `--reanudar`, `--aprobado` y `--reglas`: por sí solos no mueven el flujo; con `--paso`, fijan ese paso.
 */
export type Senal =
  | { tipo: 'estado'; modo: 'preflight' | 'base' | 'cambios' | 'diff' | 'otro'; paso?: number }
  | { tipo: 'verificar' }
  | { tipo: 'pregunta'; plan: boolean }
  | { tipo: 'agente'; nombre: string }
  | { tipo: 'agente-fin'; nombre: string; bien: boolean }

/**
 * Un paso del flujo tal como se dibuja: ya pasado, el actual o por venir.
 * `ms` es su tiempo: el de los pasados que se visitaron, el en curso del actual y el total en «Terminado».
 * Falta en los saltados, en los pendientes y cuando no se pasó la hora `t`. Es tiempo de trabajo: no incluye la espera al usuario.
 * `esperaUsuario` es el tiempo que el paso esperó una respuesta del usuario (`AskUserQuestion`); en «Terminado», el de todo el flujo.
 * Falta si es 0, si el nodo está pendiente o cuando no se pasó la hora `t`.
 * `exploradores` solo está en «Exploración»: es el total del flujo; falta si es 0 o si el nodo está pendiente.
 * `veces` son los lanzamientos del agente propio del paso: «Plan» y «Ejecución». `revisiones` son los revisores lanzados con el flujo
 * en ese paso. Los dos faltan si son menos de 1 o si el nodo está pendiente.
 * `gasto` son los tokens `[total, salida]` del paso (`Flujo.gasto`); falta si no hubo, si el nodo está pendiente y en «Terminado».
 * `porExplorador` solo está en «Exploración»: un registro por explorador, en orden de lanzamiento. Falta si no se conoce la descripción
 * de todos los lanzados (o el flujo no trae `detalleExploradores`).
 * `configs` son los modelos y esfuerzos observados del paso, por agente (`Flujo.configs`), solo con textos no vacíos; falta si no hay ninguno o si el nodo está pendiente.
 */
export type Nodo = {
  etiqueta: string
  estado: 'pasado' | 'actual' | 'pendiente'
  ms?: number
  exploradores?: number
  veces?: number
  revisiones?: number
  esperaUsuario?: number
  gasto?: [number, number]
  porExplorador?: PorExplorador[]
  configs?: Record<string, string[]>
}

/** Un explorador de la línea de «Exploración»: su descripción, su duración (ms), su gasto total en tokens y los modelos y esfuerzos observados; cada dato falta si no se conoce. */
export type PorExplorador = { descripcion: string; ms?: number; gasto?: number; config?: string[] }

/** Los pasos de cada flujo, en orden. */
export const PASOS: Record<Flujo['nombre'], readonly string[]> = {
  impl: ['Preflight', 'Exploración', 'Plan', 'Revisión del plan', 'Aprobación', 'Ejecución', 'Verificación final', 'Cierre'],
}

const SKILLS: readonly string[] = Object.keys(PASOS)

/**
 * Los pasos del flujo `f`, según su nombre. Un flujo guardado con un nombre que ya no existe no tiene pasos.
 */
export function pasosDe(f: Flujo): readonly string[] {
  return PASOS[f.nombre] ?? []
}

/**
 * El rol corto de un agente: su nombre sin espacios, sin el prefijo de su plugin (`impl:`, `commit:` o uno que empiece por `qcc`) ni `qcc-`
 * (`impl:qcc-explorador` y `qcc-explorador` → `explorador`).
 */
export function rolDeAgente(nombre: string): string {
  return nombre.trim().replace(/^(?:(?:impl|commit|qcc(?:-[a-z]+)*):)?qcc-/, '')
}

/** El nombre de la skill sin `/` ni prefijo `plugin:`. */
function nombreDeSkill(skill: string): string {
  return skill.trim().replace(/^\//, '').split(':').pop() ?? ''
}

/**
 * Flujo nuevo si `skill` es `impl` (con o sin `/` y con o sin prefijo `plugin:`); `null` si no.
 * `t` es la hora (ms) de inicio.
 * `base` es lo que la sesión ya llevaba gastado (ver `baseDeUso`); sin ella o vacía, el flujo no lleva `usoBase`.
 */
export function iniciarFlujo(skill: string, texto: string, t = 0, base?: Flujo['usoBase']): Flujo | null {
  const nombre = nombreDeSkill(skill)

  if (!SKILLS.includes(nombre)) return null

  return {
    nombre: nombre as Flujo['nombre'],
    paso: 0,
    ejecuto: false,
    estado: 'en curso',
    inicio: t,
    desde: t,
    tiempos: {},
    fin: null,
    ...(base !== undefined && Object.keys(base).length > 0 ? { usoBase: base } : {}),
  }
}

/** Parte un comando en comandos simples (separados por `|`, `;`, `&` o salto de línea) y estos en palabras. */
function palabrasPorComando(comando: string): string[][] {
  return comando
    .split(/[|;&\n]/)
    .map(c => c.split(/\s+/).map(p => p.replace(/^["']+|["']+$/g, '')).filter(p => p !== ''))
}

/** Palabras que siguen al script `nombre.mjs` cuando un comando simple es `node … nombre.mjs …`; `null` si ninguno. */
function argumentosDeScript(comandos: string[][], nombre: string): string[] | null {
  const fin = new RegExp(`(^|[/\\\\])${nombre}\\.mjs$`)

  for (const palabras of comandos) {
    const nodo = palabras.indexOf('node')
    if (nodo === -1) continue

    const script = palabras.findIndex((p, i) => i > nodo && fin.test(p))
    if (script !== -1) return palabras.slice(script + 1)
  }

  return null
}

const MODOS_ESTADO = { '--base': 'base', '--cambios': 'cambios', '--diff': 'diff', '--guardar': 'otro', '--estado': 'otro', '--reanudar': 'otro', '--aprobado': 'otro', '--cancelar': 'otro', '--reglas': 'otro', '--guia': 'otro' } as const

/**
 * El `--paso <n>` de los argumentos de `estado.mjs`: el entero no negativo que sigue a la marca, mirando solo lo anterior a `--`
 * (después van rutas). `undefined` si falta o el valor no es un entero. El rango lo valida quien lo usa.
 */
function pasoDeEstado(args: string[]): number | undefined {
  const corte = args.indexOf('--')
  const opciones = corte === -1 ? args : args.slice(0, corte)
  const valor = opciones[opciones.indexOf('--paso') + 1]

  return opciones.includes('--paso') && valor !== undefined && /^\d+$/.test(valor) ? Number(valor) : undefined
}

/** Señal de un comando de Bash: `estado.mjs` (con su modo y su `--paso`) o `verificar.mjs`; `null` si es otra cosa. */
function senalDeComando(comando: string): Senal | null {
  const comandos = palabrasPorComando(comando)
  const estado = argumentosDeScript(comandos, 'estado')

  if (estado) {
    const flag = estado.find(p => p in MODOS_ESTADO) as keyof typeof MODOS_ESTADO | undefined
    const paso = pasoDeEstado(estado)

    return { tipo: 'estado', modo: flag ? MODOS_ESTADO[flag] : 'preflight', ...(paso !== undefined ? { paso } : {}) }
  }

  return argumentosDeScript(comandos, 'verificar') ? { tipo: 'verificar' } : null
}

/** Lee un campo de texto de los argumentos de una herramienta; `''` si falta o no es texto. */
function texto(args: unknown, campo: string): string {
  const valor = typeof args === 'object' && args !== null ? (args as Record<string, unknown>)[campo] : undefined

  return typeof valor === 'string' ? valor : ''
}

/** La señal que produce una herramienta del hilo principal; `null` si no mueve el flujo o la llamó un subagente. */
export function senalDeHerramienta(tool: string, args: unknown, agentId?: string | null): Senal | null {
  if (agentId !== undefined && agentId !== null) return null

  if (tool === 'Bash') return senalDeComando(texto(args, 'command'))

  if (tool === 'Agent') {
    const nombre = rolDeAgente(texto(args, 'subagent_type'))

    return nombre === '' ? null : { tipo: 'agente', nombre }
  }

  if (tool === 'AskUserQuestion') {
    const preguntas = typeof args === 'object' && args !== null ? (args as { questions?: unknown }).questions : undefined
    const plan = Array.isArray(preguntas) && preguntas.some(q => texto(q, 'header').trim().toLowerCase() === 'plan')

    return { tipo: 'pregunta', plan }
  }

  return null
}

/** La señal que deja un agente al terminar (`bien`: sin error, por defecto sí); solo el explorador y el revisor dejan una. */
export function senalAlTerminar(s: Senal, bien = true): Senal | null {
  return s.tipo === 'agente' && (s.nombre === 'explorador' || s.nombre === 'revisor') ? { tipo: 'agente-fin', nombre: s.nombre, bien } : null
}

type Cambio = Partial<Pick<Flujo, 'paso' | 'ejecuto' | 'reviso' | 'cierre' | 'exploradores' | 'totalExploradores' | 'exploro' | 'planes' | 'ejecuciones' | 'revisiones' | 'revisores'>>

/**
 * Ejecutores lanzados en todo el flujo, con las correcciones. En un atom 0.9.7 (sin `ejecuciones`)
 * toma `ejecuto` como cota inferior: si ya ejecutó, al menos uno.
 */
export function ejecucionesLanzadas(f: Flujo): number {
  return Math.max(f.ejecuciones ?? 0, f.ejecuto ? 1 : 0)
}

/**
 * Exploradores lanzados en todo el flujo. En un atom 0.9.5 (sin `totalExploradores`)
 * toma los que siguen en vuelo como cota inferior.
 */
export function exploradoresLanzados(f: Flujo): number {
  return Math.max(f.totalExploradores ?? 0, f.exploradores ?? 0)
}

/** Qué cambia en `/impl` con la señal `s`. */
function cambioDeImplementacion(f: Flujo, s: Senal): Cambio {
  const p = f.paso

  switch (s.tipo) {
    case 'estado': {
      const heuristica: Cambio =
        s.modo === 'preflight'
          ? { paso: 0 }
          : s.modo === 'base'
            ? { paso: 5, ...(f.cierre === true ? { cierre: false } : {}) }
            : s.modo === 'cambios'
              ? { paso: p >= 6 ? 7 : 5 }
              : {}

      // La marca `--paso` del flujo manda sobre la heurística; fuera de rango se ignora.
      return s.paso !== undefined && s.paso < pasosDe(f).length ? { ...heuristica, paso: s.paso } : heuristica
    }
    case 'verificar':
      if (!f.ejecuto) return { paso: 0 }

      if (p >= 6) return { paso: p }

      return f.reviso === true ? { paso: 6, cierre: true } : { paso: 5 }
    case 'pregunta':
      return s.plan ? { paso: 4 } : {}
    case 'agente-fin': {
      if (s.nombre === 'revisor') return (f.revisores ?? 0) > 0 ? { revisores: (f.revisores ?? 0) - 1 } : {}

      if (s.nombre !== 'explorador') return {}

      const exploradores = Math.max(0, (f.exploradores ?? 0) - 1)
      const exploro = (f.exploro ?? false) || s.bien

      const totalExploradores = exploradoresLanzados(f)

      return exploradores === 0 && exploro && p === 1 ? { paso: 2, exploradores, totalExploradores, exploro } : { exploradores, totalExploradores, exploro }
    }
    case 'agente':
      if (s.nombre === 'explorador') {
        const totalExploradores = exploradoresLanzados(f) + 1

        return p !== 1 ? { paso: 1, exploradores: 1, totalExploradores, exploro: false } : { exploradores: (f.exploradores ?? 0) + 1, totalExploradores }
      }

      if (s.nombre === 'planificador') return { paso: 2, planes: (f.planes ?? 0) + 1 }
      if (s.nombre === 'ejecutor') {
        const lanzado = {
          paso: 5,
          ejecuto: true,
          ejecuciones: ejecucionesLanzadas(f) + 1,
          ...(f.reviso === true && f.cierre !== true ? { reviso: false } : {}),
        }

        return (f.revisores ?? 0) > 0 ? { ...lanzado, revisores: 0 } : lanzado
      }

      if (s.nombre === 'revisor') {
        const destino = p >= 6 ? p : 5

        return {
          paso: destino,
          revisiones: { ...(f.revisiones ?? {}), [destino]: (f.revisiones?.[destino] ?? 0) + 1 },
          revisores: (f.revisores ?? 0) + 1,
          ...(f.reviso === true ? {} : { reviso: true }),
        }
      }

      return {}
    default:
      return {}
  }
}

/**
 * `f` con los campos de tiempo completos. El atom `flujo` sobrevive a `/reload-plugins`, así que puede traer
 * la forma anterior (0.9.3: sin `inicio`, `desde`, `tiempos` ni `fin`): ahí el flujo empieza en `t` (0 sin ella).
 * Un flujo completo vuelve tal cual.
 */
function completar(f: Flujo, t?: number): Flujo {
  const viejo: Partial<Pick<Flujo, 'inicio' | 'desde' | 'tiempos' | 'fin'>> = f

  if (viejo.inicio !== undefined && viejo.desde !== undefined && viejo.tiempos !== undefined && viejo.fin !== undefined) return f

  const base = viejo.inicio ?? viejo.desde ?? t ?? 0

  return { ...f, inicio: base, desde: viejo.desde ?? base, tiempos: viejo.tiempos ?? {}, fin: viejo.fin ?? null }
}

/** Ms de trabajo del tramo abierto hasta `t`: con una pregunta abierta es 0, porque ese tiempo es espera al usuario. */
function trabajoAbierto(f: Flujo, t: number): number {
  return typeof f.preguntaDesde === 'number' ? 0 : Math.max(t - f.desde, 0)
}

/** Los tiempos de `f` con el tramo abierto hasta `t` sumado al paso actual. */
function tiemposHasta(f: Flujo, t: number): Flujo['tiempos'] {
  return { ...f.tiempos, [f.paso]: (f.tiempos[f.paso] ?? 0) + trabajoAbierto(f, t) }
}

/** Los campos que cierran la espera abierta de `f` a la hora `t`: la suma al paso actual y la deja sin espera abierta. */
function cierreDeEspera(f: Flujo, t: number): Pick<Flujo, 'esperaUsuario' | 'preguntaDesde'> {
  const desde = typeof f.preguntaDesde === 'number' ? f.preguntaDesde : t

  return { esperaUsuario: { ...f.esperaUsuario, [f.paso]: (f.esperaUsuario?.[f.paso] ?? 0) + Math.max(t - desde, 0) }, preguntaDesde: null }
}

/** Ms que el flujo esperó al usuario; con `t`, suma también el tramo de la espera abierta hasta esa hora. */
function esperaTotal(f: Flujo, t?: number): number {
  const cerrada = Object.values(f.esperaUsuario ?? {}).reduce((suma, ms) => suma + ms, 0)
  const abierta = t !== undefined && typeof f.preguntaDesde === 'number' ? Math.max(t - f.preguntaDesde, 0) : 0

  return cerrada + abierta
}

/** Agentes propios del flujo: lanzar uno desde el hilo principal es seguir el flujo. */
const AGENTES_DEL_FLUJO: readonly string[] = ['explorador', 'planificador', 'ejecutor', 'revisor']

/**
 * Si la señal `s` sigue un flujo interrumpido (un turno cortado sin `CIERRE`, p. ej. por el límite de uso), lo vuelve a poner en curso a la hora `t`.
 * Solo lo reanudan `estado.mjs` (salvo el preflight, que es de un flujo nuevo) y el lanzamiento de un agente del flujo; nunca la vuelta de un agente,
 * que puede llegar tarde. El tiempo interrumpido va a `pausa` (no es trabajo ni espera) y el consumo fijado se suelta, para fijarlo en el cierre real.
 * Un flujo completo o detenido no se reanuda. Si no corresponde, devuelve `actual`.
 */
function reanudar(actual: Flujo | null, s: Senal, t?: number): Flujo | null {
  if (!actual || actual.estado !== 'interrumpido' || actual.fin === null) return actual

  const sigue = (s.tipo === 'estado' && s.modo !== 'preflight') || (s.tipo === 'agente' && AGENTES_DEL_FLUJO.includes(s.nombre))
  if (!sigue) return actual

  const ahora = Math.max(t ?? actual.fin, actual.fin)
  const vivo: Flujo = { ...actual, estado: 'en curso', fin: null, desde: ahora, pausa: (actual.pausa ?? 0) + (ahora - actual.fin) }
  delete vivo.consumo

  return vivo
}

/**
 * El flujo después de la señal `s`, a la hora `t` (ms; sin ella, la del tramo abierto: no suma tiempo).
 * Si el paso cambia, suma el tramo de trabajo al paso que deja y abre otro; volver a un paso ya visitado acumula.
 * Con una pregunta abierta (`abrirEspera`) el cambio de paso no suma trabajo: la espera va al paso en que cierra.
 * Devuelve un flujo nuevo; si no hay flujo o ya terminó, lo devuelve tal cual (una señal tardía no lo revive),
 * salvo un flujo interrumpido que el orquestador retoma (ver `reanudar`).
 */
export function avanzar(sinReanudar: Flujo | null, s: Senal, t?: number): Flujo | null {
  const actual = reanudar(sinReanudar, s, t)

  if (!actual || actual.estado !== 'en curso') return actual

  const f = completar(actual, t)
  const cambio = cambioDeImplementacion(f, s)

  if (cambio.paso === undefined || cambio.paso === f.paso) return { ...f, ...cambio }

  const ahora = t ?? f.desde

  return { ...f, ...cambio, tiempos: tiemposHasta(f, ahora), desde: ahora }
}

/**
 * Abre la espera del usuario (una `AskUserQuestion` sin responder) a la hora `t` (ms): cierra el tramo de trabajo
 * del paso actual y, hasta `cerrarEspera`, el tiempo corre como espera y no como trabajo.
 * Sin flujo, terminado o con la espera ya abierta, devuelve `actual` (la misma referencia).
 */
export function abrirEspera(actual: Flujo | null, t: number): Flujo | null {
  if (!actual || actual.estado !== 'en curso' || typeof actual.preguntaDesde === 'number') return actual

  const f = completar(actual, t)

  return { ...f, tiempos: tiemposHasta(f, t), desde: t, preguntaDesde: t }
}

/**
 * Cierra la espera del usuario a la hora `t` (ms): la suma al paso en que está el flujo y el trabajo sigue desde `t`.
 * Sin flujo, terminado o sin espera abierta, devuelve `actual` (la misma referencia).
 */
export function cerrarEspera(actual: Flujo | null, t: number): Flujo | null {
  if (!actual || actual.estado !== 'en curso' || typeof actual.preguntaDesde !== 'number') return actual

  return { ...actual, ...cierreDeEspera(actual, t), desde: t }
}

/**
 * Cierra el flujo a la hora `t` (ms; sin ella, la del tramo abierto) y cierra también el tramo del paso actual
 * y la espera del usuario si seguía abierta.
 * Con `answer` y la respuesta con `CIERRE ·`, `detenido` si trae `CIERRE · … — DETENIDO` y `completo` si no.
 * Una respuesta sin `CIERRE ·` (un turno cortado, p. ej. por el límite de uso) o cualquier otra razón lo deja `interrumpido`,
 * que el orquestador puede retomar (ver `reanudar`). El paso no cambia. Un flujo ya terminado queda igual.
 * Con `enVuelo` (hay subagentes del flujo corriendo) y `answer` sin `CIERRE ·`, el flujo sigue en curso y devuelve `actual`
 * (la misma referencia): el turno acabó pero el trabajo no. Con `CIERRE ·` cierra igual y con otra razón (`abort`, `error`) queda `interrumpido`.
 */
export function terminarFlujo(actual: Flujo | null, razon: string, respuesta?: string, t?: number, enVuelo = false): Flujo | null {
  if (!actual || actual.estado !== 'en curso') return actual
  if (enVuelo && razon === 'answer' && !(respuesta ?? '').includes('CIERRE ·')) return actual

  const f = completar(actual, t)
  const ahora = t ?? f.desde
  const espera = typeof f.preguntaDesde === 'number' ? cierreDeEspera(f, ahora) : {}
  const cierre = { tiempos: tiemposHasta(f, ahora), desde: ahora, fin: ahora, ...espera }

  if (razon !== 'answer' || !(respuesta ?? '').includes('CIERRE ·')) return { ...f, ...cierre, estado: 'interrumpido' }

  return { ...f, ...cierre, estado: /CIERRE · [^\n]*— DETENIDO/.test(respuesta ?? '') ? 'detenido' : 'completo' }
}

/**
 * Lo que la sesión lleva gastado por fila de «Esta sesión» (`[total, salida]`, con el id de `idDeFila`),
 * para restarlo después y quedarse con lo que gastó un flujo. `undefined` si todavía no hay filas.
 */
export function baseDeUso(s: Semana | null): Flujo['usoBase'] {
  if (s === null || s.filas.length === 0) return undefined

  return Object.fromEntries(s.filas.map(f => [idDeFila(f), [f.total, f.salida] as [number, number]]))
}

/**
 * Lo que gastó el flujo `f`: las filas de la sesión `s` menos su `usoBase`, de mayor a menor total.
 * Sale solo lo que subió (nunca negativo); sin sesión, vacío. Cuenta lo que la API informó,
 * con caché, y separa hilo principal y subagentes por la misma fila que «Esta sesión».
 */
export function consumoDeFlujo(f: Flujo, s: Semana | null): FilaSemana[] {
  if (s === null) return []

  return s.filas
    .map(fila => {
      const [total = 0, salida = 0] = f.usoBase?.[idDeFila(fila)] ?? []

      return {
        modelo: fila.modelo,
        esfuerzo: fila.esfuerzo,
        origen: fila.origen,
        total: Math.max(fila.total - total, 0),
        salida: Math.max(fila.salida - salida, 0),
      }
    })
    .filter(fila => fila.total > 0)
    .sort((a, b) => b.total - a.total)
}

/**
 * Deja fijo el consumo de un flujo que acaba de terminar, para que el trabajo posterior de la sesión no lo mueva.
 * Si sigue en curso, ya lo tiene o no gastó nada, devuelve la misma referencia.
 */
export function congelarConsumo(actual: Flujo | null, s: Semana | null): Flujo | null {
  if (actual === null || actual.estado === 'en curso' || actual.consumo !== undefined) return actual

  const consumo = consumoDeFlujo(actual, s)

  return consumo.length === 0 ? actual : { ...actual, consumo }
}

/** «Opus 5.5 high»: el modelo y el esfuerzo de una petición, igual que en las filas de «Esta sesión». */
export function nombreOrquestador(modelo: string, esfuerzo: string | number | undefined): string {
  return `${familia(modelo)} ${nombreEsfuerzo(esfuerzo === undefined ? '' : String(esfuerzo))}`
}

/**
 * Anota con qué modelo y esfuerzo trabaja el hilo principal (el orquestador) mientras el flujo está en curso.
 * Si ya es ese, no hay flujo o terminó, devuelve la misma referencia.
 */
export function marcarOrquestador(actual: Flujo | null, nombre: string): Flujo | null {
  if (actual === null || actual.estado !== 'en curso' || actual.orquestador === nombre) return actual

  return { ...actual, orquestador: nombre }
}

/**
 * Anota el `subagent_type` del último `Agent` que lanzó el hilo principal, para atribuir después las peticiones de los subagentes.
 * Va aparte de `avanzar`. Sin flujo, terminado, con el nombre vacío o si ya era ese, devuelve la misma referencia.
 */
export function marcarAgente(actual: Flujo | null, nombre: string): Flujo | null {
  const agente = typeof nombre === 'string' ? nombre.trim() : ''

  if (actual === null || actual.estado !== 'en curso' || agente === '' || actual.ultimoAgente === agente) return actual

  return { ...actual, ultimoAgente: agente }
}

/** `n` si es un número finito; si no, 0. */
function cuenta(n: unknown): number {
  return typeof n === 'number' && Number.isFinite(n) ? n : 0
}

/**
 * Suma el uso de una petición al gasto del paso en que está el flujo: `[total, salida]`, con el total de los cuatro campos.
 * Un campo que no es un número finito cuenta 0. Sin flujo, terminado, sin uso o con total 0, devuelve la misma referencia.
 * Nunca muta `actual` ni su `gasto`.
 */
export function sumarGasto(actual: Flujo | null, uso: Uso | null | undefined): Flujo | null {
  if (actual === null || actual.estado !== 'en curso' || uso === null || uso === undefined) return actual

  const salida = cuenta(uso.output_tokens)
  const total = cuenta(uso.input_tokens) + salida + cuenta(uso.cache_read_input_tokens) + cuenta(uso.cache_creation_input_tokens)

  if (total <= 0) return actual

  const [antes, antesSalida] = actual.gasto?.[actual.paso] ?? [0, 0]

  return { ...actual, gasto: { ...actual.gasto, [actual.paso]: [antes + total, antesSalida + salida] } }
}

type Explorador = NonNullable<Flujo['detalleExploradores']>[number]

/**
 * Lo que se sabe de un explorador al anotarlo: `hasta` es la hora (ms) en que volvió, para sacar `ms` si hay `desde`;
 * `llamada` es el `tool_use_id` del `Agent` que lo lanzó.
 */
export type DatoExplorador = { descripcion?: string; desde?: number; ms?: number; hasta?: number; llamada?: string }

/** `n` si es un número finito. */
function finito(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n)
}

/** Los registros por explorador de `f`; vacío si el campo falta o no es una lista (atom 0.16.0 o anterior), sin los elementos mal formados. */
function detalleDe(f: Flujo): Explorador[] {
  const lista: unknown = f.detalleExploradores

  if (!Array.isArray(lista)) return []

  return lista.filter((e): e is Explorador => typeof e === 'object' && e !== null && typeof (e as { id?: unknown }).id === 'string')
}

/** `f` con `despues` en lugar de `previo` (o al final si `previo` no existía); el mismo `f` si `despues` no cambia nada. */
function guardarExplorador(f: Flujo, previo: Explorador | undefined, despues: Explorador): Flujo {
  const antes: Explorador = previo ?? { id: despues.id }

  if (!(Object.keys(despues) as (keyof Explorador)[]).some(k => despues[k] !== antes[k])) return f

  const lista = detalleDe(f)

  return { ...f, detalleExploradores: previo === undefined ? [...lista, despues] : lista.map(e => (e === previo ? despues : e)) }
}

/**
 * Anota lo que se sabe del explorador `id` (su `agentId`), fusionándolo con lo que ya había; crea el registro si falta, en orden de aparición.
 * `descripcion` va sin espacios en los bordes y se ignora si queda vacía; `desde` y `llamada` no pisan uno ya anotado (una `llamada` vacía
 * se ignora); `ms` vale si es finito y no negativo. Sin `ms`, con `hasta` y con `desde` ya conocido, `ms` es `hasta − desde` (nunca negativo).
 * Sin flujo, terminado, con `id` vacío o sin nada nuevo que anotar, devuelve la misma referencia. Nunca muta `f`.
 */
export function anotarExplorador(f: Flujo | null, id: string, dato: DatoExplorador): Flujo | null {
  if (f === null || f.estado !== 'en curso' || id === '') return f

  const previo = detalleDe(f).find(e => e.id === id)
  const antes: Explorador = previo ?? { id }
  const descripcion = typeof dato.descripcion === 'string' ? dato.descripcion.trim() : ''
  const desde = antes.desde ?? (finito(dato.desde) ? dato.desde : undefined)
  const llamada = typeof dato.llamada === 'string' && dato.llamada !== '' ? dato.llamada : undefined
  const ms = finito(dato.ms) && dato.ms >= 0 ? dato.ms : desde !== undefined && finito(dato.hasta) ? Math.max(dato.hasta - desde, 0) : undefined

  return guardarExplorador(f, previo, {
    ...antes,
    ...(descripcion !== '' ? { descripcion } : {}),
    ...(antes.desde === undefined && desde !== undefined ? { desde } : {}),
    ...(antes.llamada === undefined && llamada !== undefined ? { llamada } : {}),
    ...(ms !== undefined ? { ms } : {}),
  })
}

/**
 * Fija el tiempo de un explorador cuyo `Agent` terminó sin dar su `agentId` (falló o volvió sin él): el registro de esa `llamada`
 * (`tool_use_id`) recibe `ms = hasta − desde` (nunca negativo), si tiene `desde` y aún no tiene `ms`. Así su cifra no sigue creciendo.
 * Si ningún registro tiene esa `llamada` (o no se pasa), toma el primero abierto sin `llamada` (de un atom anterior) con la `description`
 * de `args`: nunca uno de otra llamada, aunque comparta la descripción.
 * Sin flujo, terminado, sin ese registro o con `hasta` no finito, devuelve la misma referencia. Nunca muta `f`.
 */
export function cerrarExploradorSinId(f: Flujo | null, args: unknown, hasta: number, llamada?: string): Flujo | null {
  if (f === null || f.estado !== 'en curso' || !finito(hasta)) return f

  const lista = detalleDe(f)
  const descripcion = texto(args, 'description').trim()
  const propio = llamada === undefined || llamada === '' ? undefined : lista.find(e => e.llamada === llamada)
  const previo = propio ?? (descripcion === '' ? undefined : lista.find(e => e.llamada === undefined && e.descripcion === descripcion && !finito(e.ms) && finito(e.desde)))

  if (previo === undefined || finito(previo.ms) || !finito(previo.desde)) return f

  return guardarExplorador(f, previo, { ...previo, ms: Math.max(hasta - previo.desde, 0) })
}

/**
 * Suma el uso de una petición de un subagente al gasto de su registro por explorador: el total de los cuatro campos (nunca `totalTokens`).
 * Solo cuenta si `agentId` está definido y hay exploradores en vuelo o ese id ya tiene registro (lo crea si falta).
 * Sin flujo, terminado, sin uso, con total 0 o sin nada que sumar, devuelve la misma referencia. Nunca muta `f`.
 */
export function sumarGastoDeExplorador(f: Flujo | null, agentId: string | null | undefined, uso: Uso | null | undefined): Flujo | null {
  if (f === null || f.estado !== 'en curso' || uso === null || uso === undefined || agentId === null || agentId === undefined || agentId === '') return f

  const total = cuenta(uso.input_tokens) + cuenta(uso.output_tokens) + cuenta(uso.cache_read_input_tokens) + cuenta(uso.cache_creation_input_tokens)

  if (total <= 0) return f

  const previo = detalleDe(f).find(e => e.id === agentId)

  if (previo === undefined && (f.exploradores ?? 0) < 1) return f

  const antes: Explorador = previo ?? { id: agentId }

  return guardarExplorador(f, previo, { ...antes, gasto: (antes.gasto ?? 0) + total })
}

/** `x` si es un objeto (no una lista); vacío si no (atom roto). */
function objetoDe(x: unknown): Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x) ? (x as Record<string, unknown>) : {}
}

/** Los textos no vacíos de `x`; vacío si no es una lista. */
function textosValidos(x: unknown): string[] {
  return Array.isArray(x) ? x.filter((e): e is string => typeof e === 'string' && e.trim() !== '') : []
}

/** `x` si es una lista de solo textos; si no (campo roto), vacía. */
function listaDeTextos(x: unknown): string[] {
  return Array.isArray(x) && x.every(e => typeof e === 'string') ? (x as string[]) : []
}

/** `f` con `config` anotada para `agente` en el paso actual (al final de su lista); el mismo `f` si ya estaba. */
function anotarEnPaso(f: Flujo, agente: string, config: string): Flujo {
  const porPaso = objetoDe(f.configs)
  const delPaso = objetoDe(porPaso[f.paso])
  const lista = listaDeTextos(delPaso[agente])

  if (lista.includes(config)) return f

  return { ...f, configs: { ...porPaso, [f.paso]: { ...delPaso, [agente]: [...lista, config] } } as NonNullable<Flujo['configs']> }
}

/**
 * Anota el modelo y esfuerzo (`nombre`, p. ej. «Sonnet 5.5 high») de una petición del subagente `agentId`, según el rol que tiene en vuelo, en este orden:
 * `explorador` si `agentId` ya tiene registro o hay exploradores en vuelo (en su registro, que crea si falta, y en `configs`); `revisor` si hay revisores
 * en vuelo; el `ultimoAgente` si es `planificador` o `ejecutor`. Va a `configs` del paso actual, sin repetir y en orden de aparición.
 * Sin flujo, terminado, con `agentId` o `nombre` vacíos, sin rol o sin nada nuevo que anotar, devuelve la misma referencia. Nunca muta `f`.
 */
export function anotarConfig(f: Flujo | null, agentId: string | null | undefined, nombre: string): Flujo | null {
  if (f === null || f.estado !== 'en curso' || typeof agentId !== 'string' || agentId === '') return f

  const config = typeof nombre === 'string' ? nombre.trim() : ''

  if (config === '') return f

  const previo = detalleDe(f).find(e => e.id === agentId)

  if (previo !== undefined || (f.exploradores ?? 0) > 0) {
    const propias = listaDeTextos(previo?.config)
    const conRegistro = propias.includes(config) ? f : guardarExplorador(f, previo, { ...(previo ?? { id: agentId }), config: [...propias, config] })

    return anotarEnPaso(conRegistro, 'explorador', config)
  }

  if ((f.revisores ?? 0) > 0) return anotarEnPaso(f, 'revisor', config)

  const agente: unknown = f.ultimoAgente

  return agente === 'planificador' || agente === 'ejecutor' ? anotarEnPaso(f, agente, config) : f
}

/**
 * Del `Agent` que terminó: el `agentId` y la duración (`totalDurationMs`) de su resultado y la `description` de sus argumentos.
 * `null` si el resultado no trae un `agentId` de texto no vacío; no lanza con un resultado de cualquier forma. Cada campo falta si no es válido.
 */
export function datosDeExplorador(args: unknown, resultado: unknown): { id: string; descripcion?: string; ms?: number } | null {
  if (typeof resultado !== 'object' || resultado === null) return null

  const { agentId, totalDurationMs } = resultado as { agentId?: unknown; totalDurationMs?: unknown }

  if (typeof agentId !== 'string' || agentId.trim() === '') return null

  const descripcion = texto(args, 'description').trim()

  return {
    id: agentId,
    ...(descripcion !== '' ? { descripcion } : {}),
    ...(finito(totalDurationMs) && totalDurationMs >= 0 ? { ms: totalDurationMs } : {}),
  }
}

/**
 * Un registro por explorador para «Exploración», en orden de lanzamiento. Solo si todos los lanzados (`lanzados`) tienen descripción;
 * `undefined` si no, o si el flujo no trae `detalleExploradores` o no es una lista. Con la hora `t`, el explorador sin `ms` pero con `desde` lleva su tiempo en curso.
 */
function porExploradorDe(f: Flujo, lanzados: number, t?: number): PorExplorador[] | undefined {
  const descritos = detalleDe(f).filter(e => typeof e.descripcion === 'string' && e.descripcion !== '')

  if (lanzados < 1 || descritos.length < lanzados) return undefined

  return descritos.map(e => {
    const ms = finito(e.ms) && e.ms >= 0 ? e.ms : t !== undefined && finito(e.desde) ? Math.max((f.fin ?? t) - e.desde, 0) : undefined
    const gasto = cuenta(e.gasto)
    const config = textosValidos(e.config)

    return { descripcion: e.descripcion as string, ...(ms !== undefined ? { ms } : {}), ...(gasto > 0 ? { gasto } : {}), ...(config.length > 0 ? { config } : {}) }
  })
}

/**
 * Lo observado en el paso `i` de `f`, por agente, solo con textos no vacíos; `undefined` si no hay nada.
 * Tolera un `configs` o un paso mal formados (atom roto): cuentan como vacíos.
 */
function configsDelPaso(f: Flujo, i: number): Record<string, string[]> | undefined {
  const pares = Object.entries(objetoDe(objetoDe(f.configs)[i])).map(([agente, lista]): [string, string[]] => [agente, textosValidos(lista)])
  const con = pares.filter(([, lista]) => lista.length > 0)

  return con.length === 0 ? undefined : Object.fromEntries(con)
}

/**
 * Los pasos del flujo más un último nodo «Terminado», cada uno pasado, actual o pendiente.
 * Con la hora `t` (ms) cada nodo trae su `ms` (trabajo, sin la espera al usuario) y, si esperó, su `esperaUsuario`;
 * sin ella, ninguno. «Terminado» lleva el trabajo total (sin la espera ni la `pausa`) y la espera total del flujo.
 */
export function nodos(actual: Flujo, t?: number): Nodo[] {
  const f = completar(actual, t)
  const pasos = pasosDe(f)
  const enCurso = f.estado === 'en curso'
  const lanzados = exploradoresLanzados(f)
  const lista: Nodo[] = pasos.map((etiqueta, i) => {
    const estado = enCurso ? (i < f.paso ? 'pasado' : i === f.paso ? 'actual' : 'pendiente') : i <= f.paso ? 'pasado' : 'pendiente'
    const nodo: Nodo = etiqueta === 'Exploración' && estado !== 'pendiente' && lanzados >= 1 ? { etiqueta, estado, exploradores: lanzados } : { etiqueta, estado }

    if (estado !== 'pendiente') {
      const revisiones = f.revisiones?.[i] ?? 0
      const veces = etiqueta === 'Plan' ? (f.planes ?? 0) : etiqueta === 'Ejecución' ? ejecucionesLanzadas(f) : 0

      if (veces >= 1) nodo.veces = veces
      if (revisiones >= 1) nodo.revisiones = revisiones

      const porExplorador = etiqueta === 'Exploración' ? porExploradorDe(f, lanzados, t) : undefined

      if (porExplorador !== undefined) nodo.porExplorador = porExplorador

      const configs = configsDelPaso(f, i)

      if (configs !== undefined) nodo.configs = configs

      const gasto = f.gasto?.[i]

      if (gasto !== undefined && cuenta(gasto[0]) > 0) nodo.gasto = [cuenta(gasto[0]), cuenta(gasto[1])]
    }

    if (t === undefined || estado === 'pendiente') return nodo

    const acumulado = f.tiempos[i]
    const abierta = estado === 'actual' && typeof f.preguntaDesde === 'number' ? Math.max(t - f.preguntaDesde, 0) : 0
    const espera = (f.esperaUsuario?.[i] ?? 0) + abierta

    if (espera > 0) nodo.esperaUsuario = espera

    if (estado === 'actual') return { ...nodo, ms: (acumulado ?? 0) + trabajoAbierto(f, t) }

    return acumulado === undefined ? nodo : { ...nodo, ms: acumulado }
  })
  const final = f.estado === 'detenido' ? 'Terminado · detenido' : f.estado === 'interrumpido' ? 'Terminado · interrumpido' : 'Terminado'
  const terminado: Nodo = { etiqueta: final, estado: enCurso ? 'pendiente' : 'actual' }

  if (t !== undefined && f.fin !== null) {
    const espera = esperaTotal(f)

    terminado.ms = Math.max(f.fin - f.inicio - espera - (f.pausa ?? 0), 0)
    if (espera > 0) terminado.esperaUsuario = espera
  }

  lista.push(terminado)

  return lista
}

/**
 * Una línea con el flujo y dónde va: `/impl · Ejecución`; `sin flujo en esta sesión` si no hay.
 * Con la hora `t` (ms) agrega el tiempo total de trabajo al final, sin la espera al usuario: `/impl · Ejecución · 3 min 20 s`.
 */
export function resumenFlujo(sinCompletar: Flujo | null, t?: number): string {
  if (!sinCompletar) return 'sin flujo en esta sesión'

  const f = completar(sinCompletar, t)
  const actual = nodos(f, t).find(n => n.estado === 'actual')
  const total = t === undefined ? '' : ` · ${duracion(Math.max((f.fin ?? t) - f.inicio - esperaTotal(f, f.fin === null ? t : undefined) - (f.pausa ?? 0), 0))}`

  return `/${f.nombre}${actual ? ` · ${actual.etiqueta}` : ''}${total}`
}
