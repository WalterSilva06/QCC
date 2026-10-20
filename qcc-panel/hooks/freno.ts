// Freno de contexto: decide si `prompt.submit` deja pasar un envío o lo frena una sola vez con un aviso. Puro: sin `$`, para poder probarlo solo.

import type { Freno } from '../types'

/** Tokens de contexto por encima de los cuales se frena (se frena con más de este valor, no con este valor). */
export const UMBRAL_FRENO = 60_000

/** Un freno solo con los campos que tienen valor; `null` si no queda ninguno (nunca `{}`). */
function armar(frenado: boolean, cierreVisto: number | undefined): Freno | null {
  const freno: Freno = {}

  if (frenado) freno.frenado = true
  if (cierreVisto !== undefined) freno.cierreVisto = cierreVisto

  return frenado || cierreVisto !== undefined ? freno : null
}

/**
 * Decide si un envío pasa (`motivo: null`) o se frena con un `motivo`, y el `freno` que queda para el envío siguiente. Reglas, en orden:
 *
 * 1. Con `antes.frenado` el envío pasa (es el reenvío del aviso) y `frenado` se borra. Eso vale para cualquier envío: un `! cmd` o un `/otro` también
 *    gasta el reenvío, y el texto siguiente vuelve a poder frenarse por el caso b). Es aceptable. Si el envío cumple las condiciones de b) anota además
 *    `cierreVisto`.
 * 2. a) `comando` es `qcc-implementador` o termina en `:qcc-implementador` y `tokens` pasa de `UMBRAL_FRENO`: frena con `frenado`.
 * 3. b) Texto libre (`comando` ausente y texto que no empieza con `!` ni `/`, tras `trimStart`) tras un flujo cerrado (`completo` o `detenido`,
 *    con `fin` no nulo) cuyo cierre aún no se vio (`antes.cierreVisto !== fin`): anota `cierreVisto = fin`. Si además `tokens` pasa del umbral, frena.
 *    Un flujo `interrumpido` no cuenta: el mensaje siguiente suele ser para retomarlo.
 * 4. En cualquier otro caso pasa y devuelve `antes` tal cual.
 *
 * Sin `tokens` nunca frena, pero el primer mensaje tras el cierre sí consume `cierreVisto`: así el aviso no aparece en un mensaje posterior,
 * cuando ya haya medida. Con un contexto de hasta el umbral también se consume y pasa. El freno devuelto solo trae campos con valor y nunca es `{}`.
 */
export function decidirFreno(
  envio: { texto: string; comando?: string },
  tokens: number | undefined,
  flujo: { estado: string; fin: number | null } | null,
  antes: Freno | null,
): { motivo: string | null; freno: Freno | null } {
  const grande = tokens !== undefined && tokens > UMBRAL_FRENO
  const k = tokens === undefined ? 0 : Math.round(tokens / 1000)
  const fin = flujo !== null && (flujo.estado === 'completo' || flujo.estado === 'detenido') ? flujo.fin : null
  const cierre =
    envio.comando === undefined && !/^[!/]/.test(envio.texto.trimStart()) && fin !== null && antes?.cierreVisto !== fin ? fin : undefined

  if (antes?.frenado) return { motivo: null, freno: armar(false, cierre ?? antes.cierreVisto) }

  const comando = envio.comando

  if (grande && comando !== undefined && (comando === 'qcc-implementador' || comando.endsWith(':qcc-implementador'))) {
    return {
      motivo: `Contexto de ${k}k: haz /clear antes de /qcc-implementador; el primer pedido reescribe todo en Sonnet. Envíalo de nuevo para seguir igual.`,
      freno: armar(true, antes?.cierreVisto),
    }
  }

  if (cierre !== undefined) {
    if (!grande) return { motivo: null, freno: armar(false, cierre) }

    return {
      motivo: `Flujo cerrado: seguir aquí reescribe ${k}k de caché con el modelo de la sesión. Para «Queda para ti» usa \`! comando\`, o /clear. Envíalo de nuevo para seguir igual.`,
      freno: armar(true, cierre),
    }
  }

  return { motivo: null, freno: antes !== null && (antes.frenado || antes.cierreVisto !== undefined) ? antes : null }
}
