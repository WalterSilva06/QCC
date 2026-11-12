// `estado.mjs --guardar`: guarda en la carpeta del flujo la exploración, el plan (con su resumen PARA APROBAR) o la revisión final.

import fs from 'node:fs'
import path from 'node:path'
import { configDe, RAIZ } from './guardia.mjs'
import { pedidoDelFlujo, revisoresDelProyecto } from './costos.mjs'
import { leerRegistro, FLUJO, leerTexto, leerEstado, anotarEstado, listaDe, esperarInicial, transcriptDe, textoFinalDe, cortadosDe } from './estado-base.mjs'
import { CAMPOS_SUBTAREA, sinMarcas, campoDe, recortarPie, partesDelPlan, dependeDe, permisosDe, ROLES_DE_PERMISO, avisosDePermisos, bloqueDe, permitidosDeSubtarea, parecenExternas, comandosParaTi, lotesDe, criticosDe, fusionarPlanes, decisionesDelPlan, lineasDeDecisiones, TOPE_LINEAS_RESUMEN, aprobacionDe } from './estado-plan.mjs'
import { hallazgosDe, sinExplorarDe, contextoDe, acopladosSinCubrir, criticasDeExploracion, TOPE_LINEAS_EXPLORADOR, MAX_EXPLORADORES, MAX_REINTENTO, avisosDeLargo, fusionarExploraciones } from './estado-exploracion.mjs'

/** Escribe un `S<n>.md` por subtarea, revisa campos y rutas críticas, anota el plan en el estado e imprime el resumen. */
function resumirPlan(texto, destino) {
  const partes = partesDelPlan(texto)
  const { cabecera, subtareas } = partes
  const hallazgos = hallazgosDe(leerTexto(path.join(FLUJO, 'exploracion.md')) ?? '')
  const { criticos } = configDe(RAIZ)
  for (const f of fs.readdirSync(FLUJO)) if (/^S\d+\.md$/.test(f)) fs.rmSync(path.join(FLUJO, f), { force: true })
  const encabezado = cabecera.filter((l) => /^\s*(?:#{1,6}\s+)?(?:\*\*)?(PLAN ·|Objetivo|Fuera de alcance)/i.test(l))
  const titulo = cabecera.map((l) => /^\s*(?:#{1,6}\s+)?(?:\*\*)?PLAN ·\s*(.*?)(?:\*\*)?\s*$/i.exec(l)?.[1]).find(Boolean)
  const clasificacion = campoDe(cabecera, 'Clasificación')
  const avisos = []
  if (clasificacion === null) avisos.push('falta «Clasificación»')
  if (campoDe(cabecera, 'Objetivo') === null) avisos.push('falta «Objetivo»')
  const permisosPlan = permisosDe(partes.pie)
  const porCriterio = new Map()
  const resumen = []
  const paraDecidir = []
  console.log(`GUARDADO: plan → ${destino}`)
  console.log(`PLAN: ${subtareas.length} subtarea(s) · Clasificación: ${clasificacion ?? '(falta)'}`)
  const compacto = subtareas.length > TOPE_LINEAS_RESUMEN
  if (compacto) console.log(`SUBTAREAS: ${subtareas.length} → ${path.join(FLUJO, 'S<n>.md')} (con más de ${TOPE_LINEAS_RESUMEN}, su resumen va solo en PARA APROBAR)`)
  for (const s of subtareas) {
    const archivo = path.join(FLUJO, `S${s.n}.md`)
    for (const c of CAMPOS_SUBTAREA) if (campoDe(s.lineas, c) === null) avisos.push(`S${s.n} · falta «${c}»`)
    const { permitidos, avisos: avisosPermitidos } = permitidosDeSubtarea(s.lineas, s.n)
    const contexto = contextoDe(hallazgos, permitidos)
    const conContexto = contexto.length ? ['', 'CONTEXTO (hallazgos de la exploración sobre tus permitidos):', ...contexto] : []
    const suyos = permisosPlan.filter((p) => p.rol === 'ejecutor' && p.sub === s.n && p.comando)
    const conPermisos = ['', ...(suyos.length ? ['Permisos (los únicos comandos externos que puedes correr, una vez aprobados):', ...suyos.map((p) => `- ${p.id} · \`${p.comando}\` · ${p.servicio} · reversible: ${p.reversible ? 'sí' : 'no'} · Qué hace: ${p.queHace} · Para qué: ${p.paraQue}`)] : ['Permisos: ninguno'])]
    fs.writeFileSync(archivo, [...encabezado, '', ...s.lineas, ...conPermisos, ...conContexto].join('\n').trim() + '\n')
    avisos.push(...avisosPermitidos)
    const critica = campoDe(s.lineas, 'Crítica')
    const { depende, aviso } = dependeDe(campoDe(s.lineas, 'Depende de'), s.n, subtareas.map((x) => x.n))
    if (aviso) avisos.push(aviso)
    const parece = suyos.length ? null : parecenExternas(s.lineas)
    if (parece) avisos.push(`S${s.n} parece externa y no tiene permiso (menciona «${parece}»): propón el comando en «PERMISOS A APROBAR:» o déjala en «Queda para ti»`)
    const fijos = new Set()
    for (const ruta of permitidos) {
      const { fijos: f, condicionales } = criticosDe(ruta, criticos)
      for (const n of f) {
        fijos.add(n)
        if (!porCriterio.has(n)) porCriterio.set(n, ruta)
      }
      for (const c of condicionales) avisos.push(`S${s.n} · ${ruta}: crítica (#${c.ns.join(', #')}) si ${c.si}`)
    }
    if (fijos.size && critica !== null && /^no\b/i.test(critica)) {
      avisos.push(`S${s.n} · Crítica: no, pero sus rutas críticas piden #${[...fijos].sort((a, b) => a - b).join(', #')}: debe ser sí`)
    }
    resumen.push({ n: s.n, objetivo: s.objetivo, critica, permitidos, ...(depende ? { depende } : {}), ...(suyos.some((p) => !p.reversible) ? { sola: true } : {}) })
    paraDecidir.push({ n: s.n, critica, permitidos, fijos: [...fijos] })
    if (!compacto) console.log(`S${s.n} · ${s.objetivo} · Crítica: ${critica ?? '(falta)'} · permitidos: ${permitidos.join(', ') || '(faltan)'}${contexto.length ? ` · contexto: ${contexto.length}` : ''} → ${archivo}`)
  }
  const pedidos = [...porCriterio.keys()].sort((a, b) => a - b)
  if (!criticos.length) console.log(`RUTAS CRÍTICAS: el proyecto no declara «criticos» en ${configDe(RAIZ).nombre}`)
  else console.log(`RUTAS CRÍTICAS: ${pedidos.length ? pedidos.map((n) => `#${n} (${porCriterio.get(n)})`).join(', ') : 'ninguna'}`)
  if (pedidos.length && clasificacion !== null) {
    const citados = new Set([...clasificacion.matchAll(/#(\d+)/g)].map((m) => Number(m[1])))
    const faltan = pedidos.filter((n) => !citados.has(n))
    if (/sin criterios/i.test(clasificacion)) avisos.push(`Clasificación: dice «sin criterios», pero las rutas críticas piden #${pedidos.join(', #')}`)
    else if (faltan.length) avisos.push(`Clasificación: no cita ${faltan.map((n) => `#${n} (${porCriterio.get(n)})`).join(', ')}`)
  }
  if (!subtareas.length) avisos.push('no encontré subtareas «S<n> · …»: despacha copiando los campos del plan')
  for (const r of acopladosSinCubrir(hallazgos, resumen.flatMap((s) => s.permitidos), bloqueDe(cabecera, 'Fuera de alcance'))) {
    avisos.push(`acoplado «${r}» (ACOPLAMIENTOS de la exploración) no está en ningún permitido ni en «Fuera de alcance»`)
  }
  avisos.push(...avisosDePermisos(permisosPlan, bloqueDe(partes.pie, 'PERMISOS A APROBAR'), subtareas.map((x) => x.n), resumen.flatMap((s) => s.permitidos)))
  const paraTi = comandosParaTi(partes.pie)
  if (paraTi.length) avisos.push(`«Queda para ti» trae comandos (${paraTi.map((c) => `\`${c}\``).join(', ')}): los que un agente puede correr aprobados van en «PERMISOS A APROBAR:», aunque las reglas del proyecto digan otra cosa; re-planifica una vez con ese ajuste antes de la aprobación`)
  console.log(avisos.length ? `AVISOS:\n${avisos.map((a) => `  - ${a}`).join('\n')}` : 'AVISOS: ninguno')
  if (resumen.length) console.log(`LOTES: ${lotesDe(resumen).map((l) => l.map((n) => `S${n}`).join('+')).join(' | ')}`)
  const decisiones = decisionesDelPlan({ clasificacion, subtareas: paraDecidir, pedidos: pedidos.map((n) => ({ n, ruta: porCriterio.get(n) })) })
  console.log('DECISIONES (con los AVISOS resueltos a lo más estricto):')
  for (const l of lineasDeDecisiones(decisiones)) console.log(l)
  const dudas = hallazgos.filter((h) => h.seccion === 'DUDAS')
  if (dudas.length) console.log(`DUDAS DE LA EXPLORACIÓN (el plan no debe contradecirlas):\n${dudas.map((h) => `  - ${h.linea}`).join('\n')}`)
  if (subtareas.length) console.log(`PARA APROBAR (cópialo tal cual en tu texto; el plan completo está en ${destino}):\n${aprobacionDe(partes)}\nFIN PARA APROBAR`)
  // Un permiso conserva su aprobación solo si quién y comando son idénticos (aunque cambie su número); si no, se aprueba de nuevo con --permiso.
  // Los «nuevo» (agregados a mitad de corrida) siguen mientras su subtarea esté en el plan.
  const previas = Object.entries(leerEstado().permisos ?? {}).filter(([, p]) => p && typeof p === 'object')
  const permisos = {
    ...Object.fromEntries(previas.filter(([, p]) => p.nuevo && resumen.some((s) => s.n === p.sub))),
    ...Object.fromEntries(permisosPlan
      .filter((p) => p.comando && (ROLES_DE_PERMISO.includes(p.rol) || (p.rol === 'ejecutor' && resumen.some((s) => s.n === p.sub))))
      .map(({ id, sinReversible, ...p }) => {
        const aprobado = previas.find(([, a]) => !a.nuevo && a.rol === p.rol && a.sub === p.sub && a.comando === p.comando && a.aprobado)?.[1].aprobado
        return [id, { ...p, ...(aprobado ? { aprobado } : {}) }]
      })),
  }
  // Un plan nuevo o re-planificado se vuelve a aprobar: la aprobación previa ya no vale.
  anotarEstado({ plan: destino, subtareas: resumen, decisiones, aprobacion: undefined, permisos,...(clasificacion !== null ? { clasificacion } : {}), ...(titulo ? { titulo: sinMarcas(titulo) } : {}) })
}

/** Líneas `CORTADO:` de los exploradores `ids` que la guardia dejó sin leer por contexto (desde el inicio del flujo). */
function avisosDeCortado(ids) {
  const e = leerEstado()
  const desde = e.desde_global ?? e.inicio
  if (!desde) return []
  let cortados
  try {
    cortados = cortadosDe(leerRegistro(desde))
  } catch {
    return []
  }
  return ids.filter((id) => cortados.has(id)).map((id) => `CORTADO: agente ${id} por contexto (${cortados.get(id).slice('contexto '.length)})`)
}

/** Ids de `--guardar` separados por coma: recortados y sin repetir (si no queda ninguno, el valor tal cual). */
function idsDe(id) {
  const lista = [...new Set(String(id ?? '').split(',').map((s) => s.trim()).filter(Boolean))]
  return lista.length ? lista : [id]
}

/**
 * Guarda en la carpeta del flujo el informe del agente `id`: `plan` (con su resumen) o `exploracion`
 * (`id` puede ser una lista separada por comas de exploradores).
 * La exploración cierra con el resultado de la verificación inicial, aunque no se haya encontrado el informe.
 */
export function guardar(id, tipo, ajuste) {
  guardarInforme(id, tipo, ajuste)
  if (tipo !== 'exploracion') return
  const inicial = esperarInicial()
  if (inicial) console.log(inicial)
}

function guardarInforme(id, tipo, ajuste) {
  if (tipo === 'revision') return guardarRevision(id)
  if (tipo !== 'plan' && tipo !== 'exploracion') {
    console.log(`AVISO: --guardar <agentId> plan|exploracion|revision: tipo desconocido «${tipo ?? ''}»; no se guardó nada`)
    return
  }
  const pedidos = tipo === 'exploracion' ? idsDe(id) : [id]
  const informes = []
  for (const uno of pedidos) {
    const archivo = transcriptDe(uno)
    const texto = archivo ? textoFinalDe(archivo) : null
    if (texto) informes.push({ id: uno, texto })
    else console.log(`AVISO: no encontré el informe del agente ${uno ?? '(sin id)'}: despacha copiando su texto, como antes`)
  }
  if (!informes.length) return
  fs.mkdirSync(FLUJO, { recursive: true })
  const destino = path.join(FLUJO, `${tipo}.md`)
  if (tipo === 'exploracion') {
    const texto = pedidos.length === 1 ? informes[0].texto : fusionarExploraciones(informes).texto
    fs.writeFileSync(destino, texto + '\n')
    // El pedido literal queda en la carpeta del flujo, para que reanudar no dependa de los transcripts.
    const archivoPedido = path.join(FLUJO, 'pedido.md')
    if (!fs.existsSync(archivoPedido)) {
      try {
        const e = leerEstado()
        const pedido = pedidoDelFlujo(RAIZ, e.inicio ?? e.desde_global, { base: e.base_global })
        if (pedido) fs.writeFileSync(archivoPedido, pedido + '\n')
      } catch {
        // Sin el pedido, reanudar lo busca de nuevo.
      }
    }
    const previo = leerEstado()
    const repetida = Boolean(previo.exploracion)
    // Los informes ya guardados avisaron en su corrida: repetirlo confunde al orquestador, que ya no puede reintentar.
    const vistos = new Set(Array.isArray(previo.exploradores_vistos) ? previo.exploradores_vistos : [])
    const nuevos = fusionarExploraciones(informes.filter((i) => !vistos.has(i.id)))
    anotarEstado({ exploracion: destino, exploradores_vistos: [...new Set([...vistos, ...informes.map((i) => i.id)])] })
    console.log(`GUARDADO: exploración → ${destino}`)
    for (const { id: agente, faltan } of nuevos.incompletos) {
      console.log(`INCOMPLETO: agente ${agente} sin ${faltan.join(', ')}: relanza solo esa parte`)
    }
    if (!repetida) for (const aviso of avisosDeLargo(informes, TOPE_LINEAS_EXPLORADOR)) console.log(aviso)
    for (const aviso of avisosDeCortado(pedidos.filter((p) => !vistos.has(p)))) console.log(aviso)
    for (const aviso of sinExplorarDe(hallazgosDe(nuevos.texto))) console.log(aviso)
    if (!repetida) console.log(`REINTENTO: caben ${Math.max(0, Math.min(MAX_REINTENTO, MAX_EXPLORADORES - pedidos.length))}`)
    console.log(`RUTAS CRÍTICAS EN LA EXPLORACIÓN: ${criticasDeExploracion(texto)}`)
    return
  }
  const texto = informes[0].texto
  const previo = ajuste ? leerTexto(destino) : null
  const plan = previo ? fusionarPlanes(previo, texto) : recortarPie(texto).trim()
  fs.writeFileSync(destino, plan + '\n')
  resumirPlan(plan, destino)
}

const RE_VEREDICTO = /^[\s*_>`-]*VEREDICTO(?:\*\*)?:\s*\**\s*([A-ZÁÉÍÓÚ]+)/m

/**
 * Guarda el reporte de la revisión final del agente `id` en `revision-<c>.md` y la anota en `revisiones` del estado. Cada agente
 * nuevo es un ciclo más; volver a guardar el mismo agente (un reintento) reemplaza su ciclo.
 */
function guardarRevision(id) {
  const archivo = transcriptDe(id)
  const texto = archivo ? textoFinalDe(archivo) : null
  if (!texto) {
    console.log(`AVISO: no encontré el informe del agente ${id ?? '(sin id)'}: sigue con su texto, como antes`)
    return
  }
  const revisiones = listaDe(leerEstado(), 'revisiones')
  const previa = revisiones.findIndex((r) => r.agente === id)
  const c = previa >= 0 ? revisiones[previa].c : revisiones.length + 1
  const veredicto = RE_VEREDICTO.exec(texto)?.[1] ?? null
  fs.mkdirSync(FLUJO, { recursive: true })
  const destino = path.join(FLUJO, `revision-${c}.md`)
  fs.writeFileSync(destino, texto.trim() + '\n')
  const entrada = { c, agente: id, veredicto, archivo: destino, t: new Date().toISOString() }
  anotarEstado({ revisiones: previa >= 0 ? revisiones.map((r, i) => (i === previa ? entrada : r)) : [...revisiones, entrada] })
  console.log(`GUARDADO: revisión ciclo ${c} (${veredicto ?? 'sin VEREDICTO'}) → ${destino}`)
}

/**
 * Guarda, en orden, las revisiones finales del flujo abierto que volvieron con informe y todavía no están en `revisiones`
 * (las busca en los transcripts del proyecto desde `DESDE_GLOBAL`): así el orquestador no corre `--guardar … revision`.
 * Nunca rompe el comando que la llama.
 */
export function guardarRevisionesNuevas() {
  try {
    const e = leerEstado()
    if (!e.base_global || e.cierre) return
    const guardadas = new Set(listaDe(e, 'revisiones').map((r) => r.agente))
    for (const { id } of revisoresDelProyecto(RAIZ, e.desde_global)) {
      if (guardadas.has(id)) continue
      const archivo = transcriptDe(id)
      if (archivo && textoFinalDe(archivo)) guardarRevision(id)
    }
  } catch {
    // Sin las revisiones guardadas, --reanudar repite la revisión.
  }
}
