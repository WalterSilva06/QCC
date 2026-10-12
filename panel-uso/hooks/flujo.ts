// Flujo `/implementador`, `/implementador-ligero` o `/documentar` en curso. Puro: sin `$`, para poder probarlo solo.

import type { Flujo } from '../types'
import { duracion } from './formato'

/** Lo que una herramienta o un agente hace y que mueve el flujo de paso. */
export type Senal =
  | { tipo: 'estado'; modo: 'preflight' | 'base' | 'cambios' | 'diff' }
  | { tipo: 'verificar' }
  | { tipo: 'pregunta'; plan: boolean }
  | { tipo: 'agente'; nombre: string }
  | { tipo: 'agente-fin'; nombre: string }
  | { tipo: 'escritura'; destino: 'mapa' | 'reglas' | 'doc' }

/**
 * Un paso del flujo tal como se dibuja: ya pasado, el actual o por venir.
 * `ms` es su tiempo: el de los pasados que se visitaron, el en curso del actual y el total en «Terminado».
 * Falta en los saltados, en los pendientes y cuando no se pasó la hora `t`.
 */
export type Nodo = { etiqueta: string; estado: 'pasado' | 'actual' | 'pendiente'; ms?: number }

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
 */
export function iniciarFlujo(skill: string, texto: string, t = 0): Flujo | null {
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

/** La señal que deja un agente al terminar; solo el explorador mueve el flujo. */
export function senalAlTerminar(s: Senal): Senal | null {
  return s.tipo === 'agente' && s.nombre === 'explorador' ? { tipo: 'agente-fin', nombre: 'explorador' } : null
}

type Cambio = Partial<Pick<Flujo, 'paso' | 'ejecuto'>>

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
    case 'agente-fin':
      return s.nombre === 'explorador' && p === 1 ? { paso: 2 } : {}
    case 'agente':
      if (s.nombre === 'explorador') return { paso: 1 }
      if (s.nombre === 'planificador') return ligero ? {} : { paso: 3 }
      if (s.nombre === 'ejecutor') return { paso: 5, ejecuto: true }
      if (s.nombre === 'revisor') return ligero ? { paso: 6 } : p >= 6 ? {} : { paso: 5 }

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

/** Los tiempos de `f` con el tramo abierto hasta `t` sumado al paso actual. */
function tiemposHasta(f: Flujo, t: number): Flujo['tiempos'] {
  return { ...f.tiempos, [f.paso]: (f.tiempos[f.paso] ?? 0) + Math.max(t - f.desde, 0) }
}

/**
 * El flujo después de la señal `s`, a la hora `t` (ms; sin ella, la del tramo abierto: no suma tiempo).
 * Si el paso cambia, suma el tramo al paso que deja y abre otro; volver a un paso ya visitado acumula.
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
 * Cierra el flujo a la hora `t` (ms; sin ella, la del tramo abierto) y cierra también el tramo del paso actual.
 * Con `answer`, `detenido` si la respuesta trae `CIERRE · … — DETENIDO` y `completo` si no;
 * cualquier otra razón lo deja `interrumpido`. El paso no cambia. Un flujo ya terminado queda igual.
 */
export function terminarFlujo(actual: Flujo | null, razon: string, respuesta?: string, t?: number): Flujo | null {
  if (!actual || actual.estado !== 'en curso') return actual

  const f = completar(actual, t)
  const ahora = t ?? f.desde
  const cierre = { tiempos: tiemposHasta(f, ahora), desde: ahora, fin: ahora }

  if (razon !== 'answer') return { ...f, ...cierre, estado: 'interrumpido' }

  return { ...f, ...cierre, estado: /CIERRE · [^\n]*— DETENIDO/.test(respuesta ?? '') ? 'detenido' : 'completo' }
}

/**
 * Los pasos del flujo más un último nodo «Terminado», cada uno pasado, actual o pendiente.
 * Con la hora `t` (ms) cada nodo trae su `ms`; sin ella, ninguno.
 */
export function nodos(actual: Flujo, t?: number): Nodo[] {
  const f = completar(actual, t)
  const pasos = pasosDe(f)
  const enCurso = f.estado === 'en curso'
  const lista: Nodo[] = pasos.map((etiqueta, i) => {
    const estado = enCurso ? (i < f.paso ? 'pasado' : i === f.paso ? 'actual' : 'pendiente') : i <= f.paso ? 'pasado' : 'pendiente'
    const nodo: Nodo = { etiqueta, estado }

    if (t === undefined || estado === 'pendiente') return nodo

    const acumulado = f.tiempos[i]

    if (estado === 'actual') return { ...nodo, ms: (acumulado ?? 0) + Math.max(t - f.desde, 0) }

    return acumulado === undefined ? nodo : { ...nodo, ms: acumulado }
  })
  const final = f.estado === 'detenido' ? 'Terminado · detenido' : f.estado === 'interrumpido' ? 'Terminado · interrumpido' : 'Terminado'
  const terminado: Nodo = { etiqueta: final, estado: enCurso ? 'pendiente' : 'actual' }

  lista.push(t === undefined || f.fin === null ? terminado : { ...terminado, ms: Math.max(f.fin - f.inicio, 0) })

  return lista
}

/**
 * Una línea con el flujo y dónde va: `/implementador · Ejecución`; `sin flujo en esta sesión` si no hay.
 * Con la hora `t` (ms) agrega el tiempo total al final: `/implementador · Ejecución · 3 min 20 s`.
 */
export function resumenFlujo(sinCompletar: Flujo | null, t?: number): string {
  if (!sinCompletar) return 'sin flujo en esta sesión'

  const f = completar(sinCompletar, t)
  const actual = nodos(f, t).find(n => n.estado === 'actual')
  const total = t === undefined ? '' : ` · ${duracion((f.fin ?? t) - f.inicio)}`

  return `/${f.nombre}${f.variante === 'auditar' ? ' auditar' : ''} · ${actual?.etiqueta ?? ''}${total}`
}
