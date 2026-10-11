// Tokens de la semana por modelo y esfuerzo. Puro: sin `$`, para poder probarlo solo.

import type { DiaSemana, FilaSemana, Semana } from '../types'

const HORA = 3_600_000
const DIA = 24 * HORA
const SEMANA = 7 * DIA

/** Lo que se guarda por sesión: hora (ms, inicio de la hora) → `modelo|esfuerzo` → cuatro cuentas. */
export type Registro = Record<string, Record<string, Cuentas>>

/** `[entrada sin caché, salida, leída de caché, escrita en caché]`, como las informa la API. */
export type Cuentas = [number, number, number, number]

export type Uso = {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
}

export type NivelEsfuerzo = 'low' | 'medium' | 'high' | 'xhigh' | 'max' | number | undefined

export const PREFIJO = 'uso:'

/** Lo que tenga más de esto se borra al abrir una sesión. */
export const RETENCION_MS = 15 * DIA

/**
 * `modelo|esfuerzo` para el hilo principal (igual que los datos viejos) y
 * `modelo|esfuerzo|sub` para un subagente.
 */
export function clave(modelo: string, esfuerzo: NivelEsfuerzo, subagente = false): string {
  return `${modelo}|${esfuerzo === undefined ? '' : String(esfuerzo)}${subagente ? '|sub' : ''}`
}

export function inicioDeHora(t: number): number {
  return Math.floor(t / HORA) * HORA
}

/** Suma un uso al registro de la sesión, en la hora de `t`. Devuelve un registro nuevo. */
export function anotar(r: Registro, t: number, k: string, u: Uso): Registro {
  const hora = String(inicioDeHora(t))
  const antes = r[hora]?.[k] ?? [0, 0, 0, 0]
  const despues: Cuentas = [
    antes[0] + u.input_tokens,
    antes[1] + u.output_tokens,
    antes[2] + u.cache_read_input_tokens,
    antes[3] + u.cache_creation_input_tokens,
  ]

  return { ...r, [hora]: { ...r[hora], [k]: despues } }
}

/** Quita las horas anteriores a `desde`; `null` si no queda nada. */
export function podar(r: Registro, desde: number): Registro | null {
  const queda = Object.entries(r).filter(([hora]) => Number(hora) + HORA > desde)

  return queda.length === 0 ? null : Object.fromEntries(queda)
}

/** Lo que vuelve del store es JSON de otro proceso: se acepta solo con la forma esperada. */
export function comoRegistro(x: unknown): Registro {
  if (typeof x !== 'object' || x === null) return {}
  const r: Registro = {}
  for (const [hora, porClave] of Object.entries(x)) {
    if (!Number.isFinite(Number(hora)) || typeof porClave !== 'object' || porClave === null) continue
    const limpio: Record<string, Cuentas> = {}
    for (const [k, c] of Object.entries(porClave)) {
      if (Array.isArray(c) && c.length === 4 && c.every(n => typeof n === 'number' && Number.isFinite(n))) {
        limpio[k] = [c[0], c[1], c[2], c[3]]
      }
    }
    r[hora] = limpio
  }

  return r
}

/**
 * Dónde empieza «esta semana»: la ventana del límite semanal (su reinicio menos 7 días),
 * para que las cifras se lean junto a ese %. Sin ese límite, los últimos 7 días.
 */
export function inicioSemana(limites: readonly { kind: string; resetsAt?: string }[], ahora: number): number {
  const reinicio = Date.parse(limites.find(l => l.kind === 'seven_day')?.resetsAt ?? '')
  if (Number.isFinite(reinicio) && reinicio > ahora) return reinicio - SEMANA

  return ahora - SEMANA
}

/**
 * `claude-opus-5-5` → «Opus 5.5»; `claude-opus-4-20250514` → «Opus 4» (una fecha de 8 dígitos
 * no es versión menor); `claude-3-5-sonnet-20241022` → «Sonnet 3.5». Sin versión reconocible,
 * solo la familia; sin familia, el id tal cual.
 */
export function familia(modelo: string): string {
  const m = /(opus|sonnet|haiku|fable)/i.exec(modelo)
  if (m?.[1] === undefined) return modelo

  const nombre = m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase()
  const despues = /^[-_ ]?(\d{1,2})(?!\d)(?:[-.](\d{1,2})(?!\d))?/.exec(modelo.slice(m.index + m[1].length))
  const antes = /(?:^|[-_ ])(\d{1,2})(?:[-.](\d{1,2}))?[-_ ]$/.exec(modelo.slice(0, m.index))
  const v = despues ?? antes
  if (v?.[1] === undefined) return nombre

  return `${nombre} ${v[1]}${v[2] === undefined ? '' : `.${v[2]}`}`
}

/** `medium` → «medium»; vacío (modelo sin esfuerzo) → «—»; un número sale tal cual. */
export function nombreEsfuerzo(nivel: string): string {
  if (nivel === '') return '—'

  return nivel
}

const DIAS_CORTOS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb']

/** Cuántos días lleva la lista `dias` como máximo. */
const MAX_DIAS = 7

/** `sáb 10`, `mié 7`: nombre corto del día local de `ms` y su número. */
export function etiquetaDia(ms: number): string {
  const f = new Date(ms)

  return `${DIAS_CORTOS[f.getDay()] ?? ''} ${f.getDate()}`
}

/** Comienzo (ms) del día local de `ms`. */
function inicioDeDia(ms: number): number {
  const f = new Date(ms)
  f.setHours(0, 0, 0, 0)

  return f.getTime()
}

/**
 * Los totales por día local, de más viejo a más nuevo y sin huecos (los días sin uso valen 0).
 * Con `ahora` la lista llega hasta su día; son los 7 más recientes. Avanza por calendario,
 * no de 24 h en 24 h, para que un cambio de hora no duplique ni pierda un día.
 */
function porDia(totales: ReadonlyMap<number, number>, ahora?: number): DiaSemana[] {
  if (totales.size === 0) return []

  const claves = [...totales.keys()]
  const primero = Math.min(...claves)
  const ultimo = Math.max(...claves, ahora === undefined ? -Infinity : inicioDeDia(ahora))
  const f = new Date(ultimo)
  const dias: DiaSemana[] = []
  for (let i = 0; i < MAX_DIAS; i++) {
    const inicio = new Date(f.getFullYear(), f.getMonth(), f.getDate() - i).getTime()
    if (inicio < primero) break
    dias.unshift({ inicio, total: totales.get(inicio) ?? 0 })
  }

  return dias
}

/**
 * Suma los registros de todas las sesiones desde `desde`, por familia de modelo y esfuerzo,
 * de mayor a menor, y por día local. Una hora cuenta entera si termina después de `desde`.
 * Con `ahora`, la lista de días llega hasta el día de `ahora`.
 */
export function resumir(registros: readonly Registro[], desde: number, ahora?: number): Semana {
  const filas = new Map<string, FilaSemana>()
  const totales = new Map<number, number>()
  let primera: number | null = null

  for (const r of registros) {
    for (const [hora, porClave] of Object.entries(r)) {
      const h = Number(hora)
      if (primera === null || h < primera) primera = h
      if (h + HORA <= desde) continue
      const dia = inicioDeDia(h)

      for (const [k, c] of Object.entries(porClave)) {
        // `modelo|esfuerzo` (principal, también los datos viejos) o `modelo|esfuerzo|sub`.
        const partes = k.split('|')
        const subagente = partes.length >= 3 && partes[partes.length - 1] === 'sub'
        if (subagente) partes.pop()
        const nivel = partes.length > 1 ? (partes.pop() ?? '') : ''
        const modelo = familia(partes.join('|'))
        const esfuerzo = nombreEsfuerzo(nivel)
        const origen = subagente ? 'subagente' : 'principal'
        const id = `${modelo}|${esfuerzo}|${origen}`
        const fila = filas.get(id) ?? { modelo, esfuerzo, origen, total: 0, salida: 0 }
        fila.total += c[0] + c[1] + c[2] + c[3]
        fila.salida += c[1]
        filas.set(id, fila)
        totales.set(dia, (totales.get(dia) ?? 0) + c[0] + c[1] + c[2] + c[3])
      }
    }
  }

  const lista = [...filas.values()].filter(f => f.total > 0).sort((a, b) => b.total - a.total)

  return {
    desde,
    filas: lista,
    total: lista.reduce((s, f) => s + f.total, 0),
    salida: lista.reduce((s, f) => s + f.salida, 0),
    registroDesde: primera,
    dias: porDia(totales, ahora),
  }
}
