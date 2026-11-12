// Despachos ya llenos que imprime estado.mjs para que el orquestador los copie como prompt: los ejecutores del lote que sigue,
// la revisión final y el esqueleto del CIERRE. Salen un paso antes de usarse (el Agent va en el mismo mensaje que su Bash).

import path from 'node:path'
import { configDe, RAIZ } from './guardia.mjs'
import { FLUJO, TERMINADA, leerTexto, avanceDe, listaDe, seccionDe, esperarInicial } from './estado-base.mjs'
import { lotesDe, campoDe, partesDelPlan, criticosDe } from './estado-plan.mjs'
import { reglasDe } from './estado-preflight.mjs'

const subtareasDe = (e) => (Array.isArray(e.subtareas) ? e.subtareas : []).filter((s) => Number.isSafeInteger(Number(s?.n)))

const reglasDelProyecto = () => reglasDe(RAIZ)?.ruta ?? 'ninguna'

/** ¿La subtarea es crítica? Sin `Crítica`, con una que no empieza con «no» o con una ruta crítica fija del proyecto en sus permitidos. */
function esCritica(s, criticos) {
  if (s.critica === null || s.critica === undefined || !/^no\b/i.test(String(s.critica).trim())) return true
  return (Array.isArray(s.permitidos) ? s.permitidos : []).some((r) => criticosDe(String(r), criticos).fijos.length > 0)
}

/** El despacho del ejecutor de la subtarea `s` del lote `lote`, con las subtareas de los lotes anteriores en `previas`. */
function despachoEjecutor(e, s, lote, previas, total, criticos) {
  const ajustes = e.aprobacion?.ajustes ? `${e.aprobacion.ajustes} (del plan aprobado: aplica solo lo que toca a S${s.n})` : 'ninguno'
  return [
    `DESPACHO S${s.n} (Agent: subagent_type "impl:qcc-ejecutor", description "S${s.n}: ${s.objetivo}", ${esCritica(s, criticos) ? 'sin effort' : 'effort "medium"'}):`,
    `SUBTAREA ${s.n}/${total}: ${s.objetivo}`,
    `CONTRATO: ${path.join(FLUJO, `S${s.n}.md`)} (léelo antes de editar: cómo, hecho cuando, tests y riesgos)`,
    `ARCHIVOS PERMITIDOS: ${(Array.isArray(s.permitidos) ? s.permitidos : []).join(', ')}`,
    `AJUSTES: ${ajustes}`,
    'CONTEXTO: en el CONTRATO',
    `YA HECHO: ${previas.length ? previas.map((p) => `S${p.n} · ${p.objetivo}`).join('; ') : 'nada'}`,
    `LOTE: ${lote.length > 1 ? lote.map((n) => `S${n}`).join('+') : 'ninguno'}`,
    `REGLAS: ${reglasDelProyecto()}`,
    `FIN DESPACHO S${s.n}`,
  ]
}

/**
 * Los despachos de los ejecutores del primer lote de `LOTES:` con alguna subtarea sin terminar, solo de las que todavía no
 * tienen avance (sin empezar, o a medias tras un corte). Vacío sin plan aprobado, con todo terminado o si ese lote ya corrió
 * (sus subtareas esperan correcciones, no un despacho nuevo).
 */
export function despachosDelLote(e) {
  const subtareas = subtareasDe(e)
  if (!e.aprobacion || !subtareas.length) return []
  const avance = avanceDe(e)
  const lotes = lotesDe(subtareas)
  const k = lotes.findIndex((l) => l.some((n) => !TERMINADA.has(avance[String(n)]?.estado)))
  if (k < 0) return []
  const porN = (n) => subtareas.find((s) => Number(s.n) === n)
  const previas = lotes.slice(0, k).flat().map(porN)
  const { criticos } = configDe(RAIZ)
  return lotes[k].filter((n) => !avance[String(n)]).flatMap((n) => despachoEjecutor(e, porN(n), lotes[k], previas, subtareas.length, criticos))
}

/**
 * Lo que sigue a un `--cambios --sub`: los despachos del lote siguiente o, con todas las subtareas terminadas y sin revisión
 * final todavía, el de la revisión final (va en el mismo mensaje que el `--cambios --global` del paso 6, así que sale antes).
 */
export function despachosTrasLote(e) {
  const lote = despachosDelLote(e)
  if (lote.length) return lote
  const avance = avanceDe(e)
  const terminadas = subtareasDe(e).every((s) => TERMINADA.has(avance[String(s.n)]?.estado))
  return terminadas && !listaDe(e, 'revisiones').length ? despachoRevision(e) : []
}

/** Línea de `EJECUTORES` de la subtarea `s`: su estado, sus correcciones y los BLOQUEOS literales de su último ejecutor. */
function lineaDeEjecutor(s, avance) {
  const a = avance[String(s.n)]
  if (a?.estado === 'OMITIDA') return `S${s.n}: OMITIDA · nota: <motivo de «seguir sin ella»>`
  return `S${s.n}: ${a?.estado ?? 'sin avance'} (${a?.ciclos ?? 0} correcciones) · nota: ${a?.bloqueos ?? 'ninguna'}`
}

/**
 * El despacho de la revisión final que toca: el del ciclo 1 si todavía no hubo ninguna, o el del ciclo siguiente (con
 * `REVISIÓN ANTERIOR` y sin `DIFF`) si la última fue RECHAZADO y ya se abrió su tanda. Vacío en otro caso.
 */
export function despachoRevision(e) {
  const subtareas = subtareasDe(e)
  if (!subtareas.length) return []
  const ultima = listaDe(e, 'revisiones').at(-1)
  const tanda = ultima ? listaDe(e, 'tandas').find((t) => Date.parse(t.t) > Date.parse(ultima.t)) : null
  if (ultima && !(ultima.veredicto === 'RECHAZADO' && tanda)) return []
  const avance = avanceDe(e)
  const permitidos = [...new Set([...subtareas.flatMap((s) => (Array.isArray(s.permitidos) ? s.permitidos : [])), ...(Array.isArray(e.ampliados) ? e.ampliados : [])])]
  const pedido = leerTexto(path.join(FLUJO, 'pedido.md'))?.trim() || '<el PEDIDO literal del usuario>'
  const objetivo = campoDe(partesDelPlan(leerTexto(e.plan) ?? '').cabecera, 'Objetivo') ?? '<el Objetivo del plan, 1–2 líneas>'
  const sucios = Array.isArray(e.sucios) && e.sucios.length ? `${e.sucios.join(', ')}${(e.sucios_total ?? 0) > e.sucios.length ? `, … y ${e.sucios_total - e.sucios.length} más` : ''}` : 'ninguno'
  const inicial = (esperarInicial() ?? 'VERIFICACIÓN INICIAL: SIN PASOS').replace(/^VERIFICACIÓN INICIAL: /, '')
  const d = e.decisiones && typeof e.decisiones === 'object' ? e.decisiones : {}
  const anterior = ultima ? leerTexto(ultima.archivo) ?? '' : ''
  return [
    `DESPACHO REVISIÓN FINAL (Agent: subagent_type "impl:qcc-revisor", description "Revisión final ${e.titulo ?? '<tema>'}", sin model ni effort):`,
    `QUÉ REVISAR: cambio completo (${subtareas.length} subtarea(s))`,
    `OBJETIVO DEL PLAN: ${objetivo}`,
    `PEDIDO: ${pedido}`,
    'IMÁGENES: <ruta absoluta del .png> — <qué muestra> | ninguna',
    `PLAN: ${e.plan} (léelo entero: es el contrato)`,
    `AJUSTES AL PLAN: ${e.aprobacion?.ajustes || 'ninguno'}`,
    `BASE: ${e.base_global}`,
    `PERMITIDOS: "${permitidos.join(', ')}"`,
    ...(ultima ? [] : [`DIFF: ${path.join(FLUJO, 'diff.txt')}`]),
    `SUCIOS PREVIOS (no son del flujo): ${sucios}`,
    `REGLAS: ${reglasDelProyecto()}`,
    `VERIFICACIÓN INICIAL: ${inicial} (lo que ya fallaba no cuenta)`,
    'VERIFICACIÓN FINAL: <la línea RESULTADO de tu último verificar.mjs>',
    'NO corras verificar.mjs.',
    typeof d.critico === 'string' ? d.critico : 'CRÍTICO: <recalcúlalo: criterios #n de la Clasificación y por qué | ninguno>',
    typeof d.aspectos === 'string' ? d.aspectos : 'ASPECTOS: <recalcúlalos con la tabla de comun.md §5>',
    'EJECUTORES:',
    ...subtareas.map((s) => lineaDeEjecutor(s, avance)),
    ...(ultima ? [
      'REVISIÓN ANTERIOR:',
      seccionDe(anterior, 'PROBLEMAS:', ['OBSERVACIONES:']) || 'PROBLEMAS: <los PROBLEMAS literales de la vuelta previa>',
      seccionDe(anterior, 'CRITERIOS:', ['PROBLEMAS:', 'OBSERVACIONES:']) || 'CRITERIOS: <las líneas CRITERIOS literales de esa vuelta>',
      `BASE DE LA CORRECCIÓN: ${tanda.base}`,
      'Confirma esos puntos y que la corrección no rompió nada; no repitas lo ya aprobado.',
    ] : []),
    'FIN DESPACHO REVISIÓN FINAL',
  ]
}

/** El esqueleto del CIERRE (comun.md §7) con lo que el estado ya sabe: título, resultado, revisión, ejecutores y OBSERVACIONES. */
export function esqueletoDelCierre(e, resultado) {
  const revisiones = listaDe(e, 'revisiones')
  const ultima = revisiones.at(-1)
  const avance = avanceDe(e)
  const detenido = /^DETENIDO:(\d)$/.exec(resultado ?? '')
  const fin = resultado === 'COMPLETO' ? 'COMPLETO' : detenido ? `DETENIDO en ${detenido[1]}` : 'COMPLETO | DETENIDO en <paso>'
  const ejecutores = subtareasDe(e).map((s) => `S${s.n} (${avance[String(s.n)]?.estado === 'OMITIDA' ? 'OMITIDA' : `${avance[String(s.n)]?.ciclos ?? 0} correcciones`})`).join(' · ')
  const observaciones = ultima ? seccionDe(leerTexto(ultima.archivo) ?? '', 'OBSERVACIONES:', []).replace(/^[\s*_]*OBSERVACIONES:\s*/, '').split('\n').map((l) => l.trim()).filter(Boolean).join(' / ') : ''
  return [
    'PARA EL CIERRE (cópialo en tu texto y completa los <…>):',
    `CIERRE · ${e.titulo ?? '<título>'} — ${fin}`,
    'Cambios: <archivo — qué, una línea c/u: los archivos de CAMBIOS de arriba; el qué, del plan>',
    'Verificación final: <tabla y RESULTADO, copiados de tu última corrida de verificar.mjs>',
    `Revisión: ${ultima ? `final ${ultima.veredicto ?? 'sin VEREDICTO'} (${revisiones.length} ciclo(s))` : 'final sin revisión'}${ejecutores ? ` · ejecutores: ${ejecutores}` : ''}`,
    `Riesgos pendientes: ${observaciones && !/^ningun[oa]s?\.?$/i.test(observaciones) ? `${observaciones} · ` : ''}<BLOQUEOS que siguen abiertos y los AVISOS de arriba | ninguno>`,
    'Queda para ti: <… | nada>',
    'Reversión: <solo si DETENIDO o con riesgos: la línea REVERSIÓN de arriba, copiada; no la corres sin OK>',
    'Consumo: <la línea CONSUMO de arriba, copiada>',
    'Límites: <la línea LÍMITES, copiada>',
    'Límites por fase: <la línea LÍMITES POR FASE, copiada>',
    'Veredictos: <la línea VEREDICTOS, copiada>',
    'Contexto: <la línea CONTEXTO, copiada>',
    'Antes de otro /impl o de /commit en esta sesión conviene /clear: el contexto heredado se paga en cada pedido.',
    'FIN PARA EL CIERRE',
  ]
}
