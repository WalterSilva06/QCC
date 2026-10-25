// Caché del prompt y aviso de relleno del contexto: cuánto queda del TTL del caché, qué parte de la entrada se leyó de él y cuándo avisar de un contexto lleno. Puro: sin `$`, para poder probarlo solo.

import type { Cache } from '../types'
import type { Uso } from './semana'

/** Cuánto vive el caché del prompt desde la última respuesta que lo usó: 5 minutos. */
export const TTL_CACHE_MS = 300_000

/** Un campo del uso como cuenta: lo que no es un número finito y no negativo vale 0. */
function cuenta(n: unknown): number {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : 0
}

/**
 * Suma el uso de una respuesta del hilo principal (el que llama no pasa las de subagentes) al caché. `leidos` acumula la caché leída
 * y `entrada` toda la entrada (`input + leídos + escritos`); `t` es la hora de esta respuesta. Un campo que no es un número finito
 * y no negativo cuenta 0. Una respuesta sin entrada devuelve `c` tal cual. Nunca muta `c`.
 */
export function anotarCache(c: Cache | null, uso: Uso, t: number): Cache | null {
  const leidos = cuenta(uso.cache_read_input_tokens)
  const entrada = cuenta(uso.input_tokens) + leidos + cuenta(uso.cache_creation_input_tokens)

  if (entrada <= 0) return c

  return { leidos: (c?.leidos ?? 0) + leidos, entrada: (c?.entrada ?? 0) + entrada, t }
}

/** Ms que le quedan al caché en `ahora`: 0 si venció, `null` sin dato. */
export function restante(c: Cache | null | undefined, ahora: number): number | null {
  if (c === null || c === undefined) return null

  return Math.max(0, c.t + TTL_CACHE_MS - ahora)
}

/** El % de la entrada que salió del caché, de 0 a 100 redondeado; `null` sin entrada. */
export function tasaAciertos(c: Cache | null | undefined): number | null {
  if (c === null || c === undefined || c.entrada <= 0) return null

  return Math.min(100, Math.max(0, Math.round((c.leidos / c.entrada) * 100)))
}

/**
 * Decide el aviso de contexto lleno. `avisado` es el umbral más alto ya avisado (0, 80 o 95). Sin `porcentaje` (o si no es finito)
 * no cambia nada. Desde 95 avisa una vez; desde 80 avisa una vez (no si ya se avisó el 95); bajo 80 rearma `avisado` a 0.
 */
export function decidirAvisoContexto(avisado: 0 | 80 | 95, porcentaje?: number): { aviso: string | null; avisado: 0 | 80 | 95 } {
  if (porcentaje === undefined || !Number.isFinite(porcentaje)) return { aviso: null, avisado }

  if (porcentaje >= 95) {
    if (avisado >= 95) return { aviso: null, avisado }

    return { aviso: 'El contexto pasó del 95 %: compacta o haz /clear antes de seguir.', avisado: 95 }
  }

  if (porcentaje >= 80) {
    if (avisado >= 80) return { aviso: null, avisado }

    return { aviso: 'El contexto pasó del 80 %: conviene compactar pronto.', avisado: 80 }
  }

  return { aviso: null, avisado: 0 }
}
