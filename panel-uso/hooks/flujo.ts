// Flujo `/implementador`, `/implementador-ligero` o `/documentar` en curso. Puro: sin `$`, para poder probarlo solo.

import type { FilaSemana, Flujo, Semana } from '../types'
import { duracion } from './formato'
import { familia, idDeFila, nombreEsfuerzo } from './semana'

/** Lo que una herramienta o un agente hace y que mueve el flujo de paso. */
export type Senal =
  | { tipo: 'estado'; modo: 'preflight' | 'base' | 'cambios' | 'diff' }
  | { tipo: 'verificar' }
  | { tipo: 'pregunta'; plan: boolean }
  | { tipo: 'agente'; nombre: string }
  | { tipo: 'agente-fin'; nombre: string; bien: boolean }
  | { tipo: 'escritura'; destino: 'mapa' | 'reglas' | 'doc' }

/**
 * Un paso del flujo tal como se dibuja: ya pasado, el actual o por venir.
 * `ms` es su tiempo: el de los pasados que se visitaron, el en curso del actual y el total en «Terminado».
 * Falta en los saltados, en los pendientes y cuando no se pasó la hora `t`. Es tiempo de trabajo: no incluye la espera al usuario.
 * `esperaUsuario` es el tiempo que el paso esperó una respuesta del usuario (`AskUserQuestion`); en «Terminado», el de todo el flujo.
 * Falta si es 0, si el nodo está pendiente o cuando no se pasó la hora `t`.
 * `exploradores` solo está en «Exploración»: es el total del flujo; falta si es 0 o si el nodo está pendiente.
 * `veces` son los lanzamientos del agente propio del paso: «Plan» y «Ejecución» en `/implementador`,
 * «Ejecución» y «Revisión» en `/implementador-ligero`. `revisiones` son los revisores lanzados con el flujo
 * en ese paso (solo `/implementador`). Los dos faltan si son menos de 1, si el nodo está pendiente o en `/documentar`.
 */
export type Nodo = { etiqueta: string; estado: 'pasado' | 'actual' | 'pendiente'; ms?: number; exploradores?: number; veces?: number; revisiones?: number; esperaUsuario?: number }

/** Los pasos de cada flujo, en orden. */
export const PASOS: Record<Flujo['nombre'], readonly string[]> = {
  implementador: ['Preflight', 'Exploración', 'Clasificación', 'Plan', 'Aprobación', 'Ejecución', 'Verificación final', 'Cierre'],
  'implementador-ligero': ['Preflight', 'Exploración', 'Escalado', 'Plan breve', 'Aprobación', 'Ejecución', 'Revisión', 'Cierre'],
  documentar: ['Preflight', 'Modo', 'Ficha', 'Lectura', 'Escritura', 'Revisión', 'Cierre'],
}

/** Los pasos de `/documentar` cuando el pedido es auditar. */
export const PASOS_AUDITAR: readonly string[] = ['Preflight', 'Modo', 'Plan de auditoría', 'Lectura', 'Corrección', 'Revisión', 'Cierre']

const SKILLS: readonly string[] = Object.keys(PASOS)

/** Los pasos del flujo `f`, según su nombre y variante. */
export function pasosDe(f: Flujo): readonly string[] {
  return f.nombre === 'documentar' && f.variante === 'auditar' ? PASOS_AUDITAR : PASOS[f.nombre]
}

/**
 * Flujo nuevo si `skill` es una de las tres (con o sin `/` y con o sin prefijo `plugin:`); `null` si no.
 * La variante `auditar` solo existe en `documentar`, cuando el pedido lo dice. `t` es la hora (ms) de inicio.
 * `base` es lo que la sesión ya llevaba gastado (ver `baseDeUso`); sin ella o vacía, el flujo no lleva `usoBase`.
 */
export function iniciarFlujo(skill: string, texto: string, t = 0, base?: Flujo['usoBase']): Flujo | null {
  const nombre = skill.trim().replace(/^\//, '').split(':').pop() ?? ''

  if (!SKILLS.includes(nombre)) return null

  const auditar = nombre === 'documentar' && /\*\*Pedido:\*\*\s*auditar\b/.test(texto)

  return {
    nombre: nombre as Flujo['nombre'],
    variante: auditar ? 'auditar' : null,
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

const MODOS_ESTADO = { '--base': 'base', '--cambios': 'cambios', '--diff': 'diff' } as const

/** Señal de un comando de Bash: `estado.mjs` (con su modo) o `verificar.mjs`; `null` si es otra cosa. */
function senalDeComando(comando: string): Senal | null {
  const comandos = palabrasPorComando(comando)
  const estado = argumentosDeScript(comandos, 'estado')

  if (estado) {
    const flag = estado.find(p => p in MODOS_ESTADO) as keyof typeof MODOS_ESTADO | undefined

    return { tipo: 'estado', modo: flag ? MODOS_ESTADO[flag] : 'preflight' }
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
    const nombre = texto(args, 'subagent_type').trim()

    return nombre === '' ? null : { tipo: 'agente', nombre }
  }

  if (tool === 'AskUserQuestion') {
    const preguntas = typeof args === 'object' && args !== null ? (args as { questions?: unknown }).questions : undefined
    const plan = Array.isArray(preguntas) && preguntas.some(q => texto(q, 'header').trim().toLowerCase() === 'plan')

    return { tipo: 'pregunta', plan }
  }

  if (tool === 'Edit' || tool === 'Write') {
    const ruta = texto(args, 'file_path').replace(/\\/g, '/')

    if (ruta.endsWith('.claude/documentar/cobertura.md')) return { tipo: 'escritura', destino: 'mapa' }
    if (ruta.endsWith('.claude/documentar.md')) return { tipo: 'escritura', destino: 'reglas' }

    return { tipo: 'escritura', destino: 'doc' }
  }

  return null
}

/** La señal que deja un agente al terminar (`bien`: sin error, por defecto sí); solo el explorador mueve el flujo. */
export function senalAlTerminar(s: Senal, bien = true): Senal | null {
  return s.tipo === 'agente' && s.nombre === 'explorador' ? { tipo: 'agente-fin', nombre: 'explorador', bien } : null
}

type Cambio = Partial<Pick<Flujo, 'paso' | 'ejecuto' | 'exploradores' | 'totalExploradores' | 'exploro' | 'planes' | 'ejecuciones' | 'revisiones'>>

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

/** Qué cambia en `/implementador` (y en `/implementador-ligero`, que difiere en pocos puntos) con la señal `s`. */
function cambioDeImplementacion(f: Flujo, s: Senal): Cambio {
  const p = f.paso
  const ligero = f.nombre === 'implementador-ligero'

  switch (s.tipo) {
    case 'estado':
      if (s.modo === 'preflight') return { paso: 0 }
      if (s.modo === 'base') return { paso: 5 }
      if (s.modo === 'cambios') return { paso: p >= 6 ? 7 : 5 }

      return {}
    case 'verificar':
      if (!f.ejecuto) return { paso: 0 }

      return { paso: ligero || p === 7 ? 7 : 6 }
    case 'pregunta':
      return s.plan ? { paso: 4 } : {}
    case 'agente-fin': {
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

      if (s.nombre === 'planificador') return ligero ? {} : { paso: 3, planes: (f.planes ?? 0) + 1 }
      if (s.nombre === 'ejecutor') return { paso: 5, ejecuto: true, ejecuciones: ejecucionesLanzadas(f) + 1 }

      if (s.nombre === 'revisor') {
        const destino = ligero ? 6 : p >= 6 ? p : 5

        return { paso: destino, revisiones: { ...(f.revisiones ?? {}), [destino]: (f.revisiones?.[destino] ?? 0) + 1 } }
      }

      return {}
    default:
      return {}
  }
}

/** Qué cambia en `/documentar` (con o sin auditar) con la señal `s`. */
function cambioDeDocumentacion(f: Flujo, s: Senal): Cambio {
  const p = f.paso

  switch (s.tipo) {
    case 'pregunta':
      return p < 2 ? { paso: 2 } : {}
    case 'agente':
      if (s.nombre === 'lector') return { paso: 3 }
      if (s.nombre === 'revisor-doc') return { paso: 5 }

      return {}
    case 'escritura':
      if (s.destino === 'doc') return { paso: 4 }
      if (s.destino === 'mapa') return p >= 5 ? { paso: 6 } : {}

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

/**
 * El flujo después de la señal `s`, a la hora `t` (ms; sin ella, la del tramo abierto: no suma tiempo).
 * Si el paso cambia, suma el tramo de trabajo al paso que deja y abre otro; volver a un paso ya visitado acumula.
 * Con una pregunta abierta (`abrirEspera`) el cambio de paso no suma trabajo: la espera va al paso en que cierra.
 * Devuelve un flujo nuevo; si no hay flujo o ya terminó, lo devuelve tal cual (una señal tardía no lo revive).
 */
export function avanzar(actual: Flujo | null, s: Senal, t?: number): Flujo | null {
  if (!actual || actual.estado !== 'en curso') return actual

  const f = completar(actual, t)
  const cambio = f.nombre === 'documentar' ? cambioDeDocumentacion(f, s) : cambioDeImplementacion(f, s)

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
 * Con `answer`, `detenido` si la respuesta trae `CIERRE · … — DETENIDO` y `completo` si no;
 * cualquier otra razón lo deja `interrumpido`. El paso no cambia. Un flujo ya terminado queda igual.
 */
export function terminarFlujo(actual: Flujo | null, razon: string, respuesta?: string, t?: number): Flujo | null {
  if (!actual || actual.estado !== 'en curso') return actual

  const f = completar(actual, t)
  const ahora = t ?? f.desde
  const espera = typeof f.preguntaDesde === 'number' ? cierreDeEspera(f, ahora) : {}
  const cierre = { tiempos: tiemposHasta(f, ahora), desde: ahora, fin: ahora, ...espera }

  if (razon !== 'answer') return { ...f, ...cierre, estado: 'interrumpido' }

  return { ...f, ...cierre, estado: /CIERRE · [^\n]*— DETENIDO/.test(respuesta ?? '') ? 'detenido' : 'completo' }
}

/**
 * Anota el id de una fila de subagente vista con exploradores en vuelo (en el flujo en curso todo
 * subagente que pide al modelo es entonces un explorador). Si no corresponde anotarla o ya estaba,
 * devuelve la misma referencia; nunca muta `filas`.
 */
export function anotarFilaExplorador<T extends readonly string[]>(filas: T, f: Flujo | null, id: string): T | string[] {
  if (f === null || f.estado !== 'en curso' || (f.exploradores ?? 0) <= 0 || filas.includes(id)) return filas

  return [...filas, id]
}

/** Cuántos ■ lleva una fila: uno por explorador en vuelo (de 1 a 3) si es una fila anotada del flujo en curso; si no, 1. */
export function cuadradosDeFila(f: Flujo | null, filas: readonly string[], id: string): number {
  if (f === null || f.estado !== 'en curso' || !filas.includes(id)) return 1

  return Math.min(3, Math.max(1, f.exploradores ?? 0))
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

      return { ...fila, total: Math.max(fila.total - total, 0), salida: Math.max(fila.salida - salida, 0) }
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
 * Los pasos del flujo más un último nodo «Terminado», cada uno pasado, actual o pendiente.
 * Con la hora `t` (ms) cada nodo trae su `ms` (trabajo, sin la espera al usuario) y, si esperó, su `esperaUsuario`;
 * sin ella, ninguno. «Terminado» lleva el trabajo total y la espera total del flujo.
 */
export function nodos(actual: Flujo, t?: number): Nodo[] {
  const f = completar(actual, t)
  const pasos = pasosDe(f)
  const enCurso = f.estado === 'en curso'
  const lanzados = exploradoresLanzados(f)
  const implementacion = f.nombre !== 'documentar'
  const ligero = f.nombre === 'implementador-ligero'
  const lista: Nodo[] = pasos.map((etiqueta, i) => {
    const estado = enCurso ? (i < f.paso ? 'pasado' : i === f.paso ? 'actual' : 'pendiente') : i <= f.paso ? 'pasado' : 'pendiente'
    const nodo: Nodo = etiqueta === 'Exploración' && estado !== 'pendiente' && lanzados >= 1 ? { etiqueta, estado, exploradores: lanzados } : { etiqueta, estado }

    if (implementacion && estado !== 'pendiente') {
      const revisiones = f.revisiones?.[i] ?? 0
      const veces = etiqueta === 'Plan' ? (f.planes ?? 0) : etiqueta === 'Ejecución' ? ejecucionesLanzadas(f) : ligero && etiqueta === 'Revisión' ? revisiones : 0

      if (veces >= 1) nodo.veces = veces
      if (!ligero && revisiones >= 1) nodo.revisiones = revisiones
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

    terminado.ms = Math.max(f.fin - f.inicio - espera, 0)
    if (espera > 0) terminado.esperaUsuario = espera
  }

  lista.push(terminado)

  return lista
}

/**
 * Una línea con el flujo y dónde va: `/implementador · Ejecución`; `sin flujo en esta sesión` si no hay.
 * Con la hora `t` (ms) agrega el tiempo total de trabajo al final, sin la espera al usuario: `/implementador · Ejecución · 3 min 20 s`.
 */
export function resumenFlujo(sinCompletar: Flujo | null, t?: number): string {
  if (!sinCompletar) return 'sin flujo en esta sesión'

  const f = completar(sinCompletar, t)
  const actual = nodos(f, t).find(n => n.estado === 'actual')
  const total = t === undefined ? '' : ` · ${duracion(Math.max((f.fin ?? t) - f.inicio - esperaTotal(f, f.fin === null ? t : undefined), 0))}`

  return `/${f.nombre}${f.variante === 'auditar' ? ' auditar' : ''} · ${actual?.etiqueta ?? ''}${total}`
}
