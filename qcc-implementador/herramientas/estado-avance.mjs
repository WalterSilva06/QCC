// Avance del flujo: `--estado`, `--reanudar`, `--aprobado`, fotos por subtarea y por lote (`--base --sub`), `--tanda` y los permisos.

import fs from 'node:fs'
import path from 'node:path'
import { regexDePermiso, motivoFijoDe, RAIZ } from './guardia.mjs'
import { ultimaVerde } from './verificar.mjs'
import { pedidoDelFlujo, ejecutoresDelProyecto } from './costos.mjs'
import { listaPermitidos, corto, foto, FLUJO, leerTexto, leerEstado, anotarEstado, basesDe, sesionesDe, sesionActual, tramosDeLimites, tramoNuevo, anotarLimites, avanceDe, listaDe, esperarInicial, loteDe, TOPE_PARALELOS, paralelosDe, cerrarParalelos } from './estado-base.mjs'
import { partesDelPlan, lotesDe, lineasDeDecisiones, aprobacionDe } from './estado-plan.mjs'

/** El tramo de `texto` desde la línea que empieza con `desde` (incluida) hasta la primera que empiece con algo de `hasta`; '' si no está. */
function seccionDe(texto, desde, hasta) {
  const lineas = String(texto ?? '').split('\n')
  const k = lineas.findIndex((l) => l.replace(/^[\s*_]+/, '').startsWith(desde))
  if (k < 0) return ''
  const fin = lineas.findIndex((l, i) => i > k && hasta.some((h) => l.replace(/^[\s*_]+/, '').startsWith(h)))
  return lineas.slice(k, fin < 0 ? undefined : fin).join('\n').trim()
}

export const TERMINADA = new Set(['HECHO', 'OMITIDA'])

/**
 * Dónde sigue el flujo, de lo guardado en su carpeta: `{ sigue, pendientes }`. `sigue` es la línea `SIGUE: paso <n> · …` y
 * `pendientes` las líneas con lo que falta (subtareas sin terminar con su foto, la última revisión con sus PROBLEMAS y CRITERIOS
 * literales, la BASE de su tanda). Sin aprobación sigue en el paso 4; con alguna subtarea sin terminar, en el lote que la tiene;
 * con todas, en la revisión final; con la última APROBADO o los ciclos agotados, en el cierre. `correcciones` (de
 * `ejecutoresDelProyecto`) dice si volvieron los ejecutores de una tanda.
 */
export function siguienteDe(e, correcciones = []) {
  const subtareas = Array.isArray(e.subtareas) ? e.subtareas : []
  const avance = avanceDe(e)
  const bases = basesDe(e)
  const pendientes = []
  if (!e.plan) return { sigue: 'SIGUE: paso 1 · el flujo no guardó el plan: empieza de cero (preflight con --forzar)', pendientes }
  if (!e.aprobacion) return { sigue: 'SIGUE: paso 4 · aprobación del plan (no se aprobó todavía)', pendientes }
  const lotes = lotesDe(subtareas)
  const k = lotes.findIndex((l) => l.some((n) => !TERMINADA.has(avance[String(n)]?.estado)))
  if (k >= 0) {
    for (const n of lotes[k]) {
      const a = avance[String(n)]
      if (a && TERMINADA.has(a.estado)) continue
      const f = bases[String(n)]
      const foto = f ? ` · FOTO BASE=${f.base} DESDE=${f.desde}` : ''
      if (a) pendientes.push(`S${n} · ${a.estado} (${a.ciclos ?? 0} correcciones)${foto}`)
      else if (f) pendientes.push(`S${n} · a medias (foto sin --cambios): se despacha de nuevo desde su foto y ese intento no cuenta como ciclo${foto}`)
      else pendientes.push(`S${n} · sin empezar`)
    }
    return { sigue: `SIGUE: paso 5 · lote ${k + 1}/${lotes.length} (${lotes[k].map((n) => `S${n}`).join('+')})`, pendientes }
  }
  const revisiones = listaDe(e, 'revisiones')
  const ultima = revisiones.at(-1)
  if (!ultima) return { sigue: 'SIGUE: paso 6 · revisión ciclo 1', pendientes }
  const maximo = Number(/(\d+)/.exec(e.decisiones?.ciclos ?? '')?.[1] ?? 2)
  const texto = leerTexto(ultima.archivo) ?? ''
  pendientes.push(`REVISIÓN ${ultima.c}: ${ultima.veredicto ?? 'sin VEREDICTO'} → ${ultima.archivo}`)
  if (ultima.veredicto === 'APROBADO') return { sigue: 'SIGUE: paso 7 · cierre (revisión final APROBADO)', pendientes }
  const owner = seccionDe(texto, 'SALIDA DEL OWNER:', [])
  if (owner) pendientes.push(owner)
  if (ultima.veredicto !== 'RECHAZADO') return { sigue: `SIGUE: paso 6 · revisión ciclo ${ultima.c} (volvió sin VEREDICTO: relánzala)`, pendientes }
  const problemas = seccionDe(texto, 'PROBLEMAS:', ['SIN EJECUTAR:', 'OBSERVACIONES:'])
  const criterios = seccionDe(texto, 'CRITERIOS:', ['PROBLEMAS:', 'SIN EJECUTAR:', 'OBSERVACIONES:'])
  pendientes.push('PROBLEMAS ABIERTOS (literales):', problemas || '(no encontré PROBLEMAS en el reporte)', 'CRITERIOS (literales):', criterios || '(no encontré CRITERIOS en el reporte)')
  if (ultima.c >= maximo) return { sigue: `SIGUE: paso 7 · cierre DETENIDO:6 (${maximo} ciclo(s) de la revisión final agotados)`, pendientes }
  const tanda = listaDe(e, 'tandas').find((t) => Date.parse(t.t) > Date.parse(ultima.t))
  if (!tanda) return { sigue: `SIGUE: paso 6 · correcciones del ciclo ${ultima.c} (los PROBLEMAS de abajo)`, pendientes }
  pendientes.push(`TANDA DEL CICLO ${ultima.c}: BASE=${tanda.base} (va como BASE DE LA CORRECCIÓN, también si repites la tanda)`)
  const vueltas = correcciones.filter((c) => Date.parse(c.inicio) >= Date.parse(tanda.t))
  if (vueltas.length < (tanda.n ?? 1) || vueltas.some((c) => !c.estado)) {
    return { sigue: `SIGUE: paso 6 · correcciones del ciclo ${ultima.c} (tanda a medias: ${vueltas.filter((c) => c.estado).length}/${tanda.n ?? 1} volvieron)`, pendientes }
  }
  return { sigue: `SIGUE: paso 6 · revisión ciclo ${ultima.c + 1} (correcciones hechas: --cambios --global, verificar.mjs y la revisión con REVISIÓN ANTERIOR)`, pendientes }
}

/** Lo que lleva el flujo en curso, para retomar el hilo (por ejemplo, después de una compactación o de un corte). */
export function mostrarEstado() {
  const e = leerEstado()
  if (!e.base_global) {
    console.log('ESTADO: no hay un flujo en curso en este proyecto')
    return
  }
  const avance = avanceDe(e)
  console.log(`FLUJO: ${FLUJO}${e.cierre ? ` · cerrado ${e.cierre}` : ''}`)
  console.log(`BASE_GLOBAL=${e.base_global} DESDE_GLOBAL=${e.desde_global} · rama ${e.rama ?? '?'}`)
  if (e.exploracion) console.log(`EXPLORACIÓN: ${e.exploracion}`)
  if (e.plan) console.log(`PLAN: ${e.plan}${e.aprobacion?.t ? ` · aprobado ${e.aprobacion.t}` : ''}`)
  if (e.aprobacion) console.log(`AJUSTES AL PLAN: ${e.aprobacion.ajustes || 'ninguno'}`)
  if (Array.isArray(e.ampliados) && e.ampliados.length) console.log(`PERMITIDOS AMPLIADOS: ${e.ampliados.join(', ')}`)
  for (const s of Array.isArray(e.subtareas) ? e.subtareas : []) {
    const a = avance[String(s.n)]
    console.log(`  S${s.n} · ${s.objetivo} · permitidos: ${(s.permitidos ?? []).join(', ')}${a ? ` · ${a.estado} (${a.ciclos ?? 0} correcciones)` : ''} → ${path.join(FLUJO, `S${s.n}.md`)}`)
  }
  for (const [id, p] of Object.entries(e.permisos && typeof e.permisos === 'object' ? e.permisos : {})) {
    console.log(`  PERMISO ${id} · ${p.rol}${p.sub ? ` S${p.sub}` : ''} · ${p.comando} (reversible: ${p.reversible ? 'sí' : 'no'})${p.aprobado ? ` · aprobado ${p.aprobado}` : ' · sin aprobar'}`)
  }
  if (Array.isArray(e.en_curso) && e.en_curso.length) console.log(`EN CURSO: ${e.en_curso.map((n) => `S${n}`).join('+')}`)
  const d = e.decisiones
  if (d && typeof d === 'object' && [d.ciclos, d.critico, d.aspectos].every((l) => typeof l === 'string')) {
    console.log('DECISIONES (con los AVISOS resueltos a lo más estricto):')
    for (const l of lineasDeDecisiones(d)) console.log(l)
  }
  const fotos = Array.isArray(e.fotos) ? e.fotos : []
  fotos.forEach((f, i) => console.log(`FOTO ${i + 1} (--base): BASE=${f.base} DESDE=${f.desde}`))
  const bases = basesDe(e)
  for (const n of Object.keys(bases).sort((a, b) => Number(a) - Number(b))) {
    console.log(`FOTO S${n} (--base --sub): BASE=${bases[n].base} DESDE=${bases[n].desde}`)
  }
  const inicial = esperarInicial()
  if (inicial) console.log(inicial)
  const verde = ultimaVerde(RAIZ)
  if (verde) console.log(`ÚLTIMO VERDE: árbol ${corto(verde.arbol)} · ${verde.t}`)
  if (e.cierre) return
  const correcciones = listaDe(e, 'tandas').length ? ejecutoresDelProyecto(RAIZ, e.desde_global).filter((x) => x.n === 'final') : []
  const { sigue, pendientes } = siguienteDe(e, correcciones)
  console.log(sigue)
  if (pendientes.length) console.log(`PENDIENTES:\n${pendientes.map((l) => l.split('\n').map((x) => `  ${x}`).join('\n')).join('\n')}`)
}

/**
 * `--reanudar`: sigue en esta sesión un flujo cortado (por el límite de uso, al cerrar la sesión o al cambiar de cuenta) sin vaciar
 * su carpeta. Anota la sesión nueva en `sesiones` (el cierre suma todas), cierra las fases en paralelo que quedaron abiertas y
 * borra `en_curso`, e imprime el PEDIDO literal del flujo, lo de `--estado` (con `SIGUE:` y lo pendiente) y, sin aprobación, el
 * `PARA APROBAR` del plan guardado. Falla sin flujo, con el flujo cerrado o sin plan guardado (ahí se empieza de cero).
 */
export function reanudar() {
  const e = leerEstado()
  if (!e.base_global) throw new Error('no hay un flujo en este proyecto para reanudar: corre el preflight')
  if (e.cierre) throw new Error(`el flujo ya cerró (${e.cierre}): no hay nada que reanudar`)
  if (!e.plan || !fs.existsSync(e.plan)) throw new Error('el flujo se cortó antes de guardar el plan: empieza de cero (preflight con --forzar)')
  cerrarParalelos()
  const sesiones = sesionesDe(e)
  const ahora = new Date().toISOString()
  const actual = sesionActual(ahora)
  // Dos ids ausentes nunca cuentan como la misma sesión.
  const misma = Boolean(actual.id) && sesiones[sesiones.length - 1]?.id === actual.id
  // Una sesión nueva abre otro tramo de límites (su % se suma al del anterior), con su primera lectura por fase en el paso
  // que dice SIGUE; la misma sigue con el suyo.
  const tramos = tramosDeLimites(e)
  const pasoQueSigue = Number(/paso (\d)/.exec(siguienteDe(e).sigue)?.[1])
  anotarEstado({ en_curso: undefined, ...(misma ? {} : { sesiones: [...(sesiones.length ? sesiones : [{ desde: e.desde_global }]), actual], limites: [...tramos, tramoNuevo(pasoQueSigue)] }) })
  if (misma) anotarLimites(null)
  const archivoPedido = path.join(FLUJO, 'pedido.md')
  let pedido = leerTexto(archivoPedido)
  if (pedido === null) {
    try {
      pedido = pedidoDelFlujo(RAIZ, e.inicio ?? e.desde_global, { base: e.base_global })
      if (pedido) fs.writeFileSync(archivoPedido, pedido + '\n')
    } catch {
      pedido = null
    }
  }
  console.log(misma ? `REANUDADO: misma sesión del flujo · ${ahora}` : `REANUDADO: sesión ${sesiones.length + (sesiones.length ? 1 : 2)} del flujo · ${ahora}`)
  console.log(pedido ? `PEDIDO (literal, del /impl original):\n${pedido.trim()}\nFIN PEDIDO` : 'PEDIDO: no lo encontré en los transcripts; tómalo del plan (Objetivo)')
  mostrarEstado()
  if (!e.aprobacion) {
    const partes = partesDelPlan(leerTexto(e.plan) ?? '')
    if (partes.subtareas.length) console.log(`PARA APROBAR (cópialo tal cual en tu texto; el plan completo está en ${e.plan}):\n${aprobacionDe(partes)}\nFIN PARA APROBAR`)
  }
}

/** `--aprobado [--ajustes "<texto>"]`: anota que el usuario aprobó el plan guardado, con los AJUSTES AL PLAN (los que el orquestador mostró). */
export function aprobar(ajustes, sumar) {
  const e = leerEstado()
  if (!e.base_global || e.cierre) throw new Error('el flujo no está abierto: no hay dónde anotar la aprobación (corre el preflight)')
  if (!e.plan) throw new Error('no hay plan guardado que aprobar (--guardar <agentId> plan)')
  const texto = String(ajustes ?? '').trim()
  let subtareas = Array.isArray(e.subtareas) ? e.subtareas : []
  // `--sumar "S<n>:<ruta>,<ruta>;S<m>:…"`: se valida todo antes de escribir nada.
  if (sumar !== undefined) {
    const sumas = String(sumar).split(';').map((t) => t.trim()).filter(Boolean).map((t) => /^S?(\d+):(.+)$/i.exec(t))
    if (!sumas.length || sumas.includes(null)) throw new Error('--sumar espera "S<n>:<ruta>,<ruta>;S<m>:<ruta>"')
    const nuevas = sumas.map(([, n, rutas]) => [Number(n), listaPermitidos(rutas)])
    const falta = nuevas.find(([n, rutas]) => !subtareas.some((s) => Number(s?.n) === n) || !rutas.length)
    if (falta) throw new Error(`--sumar: S${falta[0]} no está en el plan o no trae rutas`)
    subtareas = subtareas.map((s) => {
      const suyas = nuevas.filter(([n]) => n === Number(s?.n)).flatMap(([, rutas]) => rutas)
      return suyas.length ? { ...s, permitidos: [...new Set([...(Array.isArray(s.permitidos) ? s.permitidos : []), ...suyas])] } : s
    })
  }
  anotarEstado({ aprobacion: { t: new Date().toISOString(), ajustes: texto }, ...(sumar !== undefined ? { subtareas } : {}) })
  console.log(`APROBADO: plan de ${subtareas.length} subtarea(s) · ajustes: ${texto ? 'anotados' : 'ninguno'}`)
  if (sumar !== undefined) console.log(`LOTES: ${lotesDe(subtareas).map((l) => l.map((n) => `S${n}`).join('+')).join(' | ')}`)
}

/**
 * Anota en `avance` el estado de las subtareas `miembros` tras su `--cambios --sub`: el `ESTADO:` del último ejecutor de cada una
 * (de los transcripts del proyecto desde `desde`) y cuántas correcciones tuvo; `omitida` las marca OMITIDA («seguir sin ella»).
 * Una subtarea sin ejecutor encontrado queda como `MEDIDA`. Nunca rompe el `--cambios`.
 */
export function anotarAvance(miembros, desde, omitida) {
  try {
    const ejecutores = omitida ? [] : ejecutoresDelProyecto(RAIZ, desde)
    const avance = avanceDe(leerEstado())
    const t = new Date().toISOString()
    for (const n of miembros) {
      const suyos = ejecutores.filter((x) => x.n === String(n))
      const estado = omitida ? 'OMITIDA' : suyos.at(-1)?.estado ?? 'MEDIDA'
      avance[String(n)] = { estado, ciclos: suyos.filter((x) => x.correccion).length, t }
    }
    anotarEstado({ avance })
    console.log(`AVANCE: ${miembros.map((n) => `S${n} ${avance[String(n)].estado}`).join(' · ')}`)
  } catch {
    // Sin avance, el flujo sigue: --reanudar lo verá como «a medias».
  }
}

/**
 * `--base --sub <n>`: guarda la foto de la subtarea `n` en `bases` del estado del flujo e imprime `BASE=… DESDE=…`.
 * Si ya había una, conserva la primera (un reintento no esconde lo que el ejecutor ya editó).
 * También anota en `en_curso` (lista de números) la subtarea o el lote que corre ahora: la guardia deja pasar los comandos de los permisos
 * aprobados (`permisos`) solo de esas. `--cambios --sub` y `--cambios --global` la borran.
 */
export function fotoDeSubtarea(n) {
  if (n === null) throw new Error('--sub necesita el número de la subtarea (un entero ≥ 1)')
  if (Array.isArray(n)) return fotoDeLote(n)
  const bases = basesDe(leerEstado())
  const previa = bases[String(n)]
  if (previa) console.log(`AVISO: S${n} ya tenía foto; se conserva la primera (la de antes de su ejecutor)`)
  const vigente = previa ?? { base: foto(), desde: new Date().toISOString() }
  // Una sola subtarea no corre en paralelo: la fase abierta de un lote anterior ya terminó.
  cerrarParalelos()
  anotarEstado({ ...(previa ? {} : { bases: { ...bases, [String(n)]: vigente } }), en_curso: [n] })
  console.log(`BASE=${vigente.base} DESDE=${vigente.desde}`)
}

/**
 * `--base --sub 1,2`: una sola foto para el lote, guardada en cada n como `{ base, desde, lote }`. Nunca reemplaza una foto previa:
 * si alguna subtarea ya tenía, el lote usa esa (con el aviso de siempre) y, si las previas son de fotos distintas o alguna es una
 * foto suelta (sin `lote`), es un error y no se guarda nada.
 */
function fotoDeLote(numeros) {
  const bases = basesDe(leerEstado())
  const previas = numeros.filter((n) => bases[String(n)])
  const primera = bases[String(previas[0])]
  const suelta = previas.find((n) => !loteDe(bases[String(n)]))
  if (suelta !== undefined) throw new Error(`S${suelta} ya tiene una foto suelta, sin lote; no entra en un lote`)
  if (previas.some((n) => bases[String(n)].base !== primera.base || bases[String(n)].desde !== primera.desde)) {
    throw new Error(`${previas.map((n) => `S${n}`).join(', ')} ya tienen fotos distintas: no se pueden juntar en el lote ${numeros.join(',')}`)
  }
  for (const n of previas) console.log(`AVISO: S${n} ya tenía foto; se conserva la primera (la de antes de su ejecutor)`)
  const vigente = primera ? { base: primera.base, desde: primera.desde } : { base: foto(), desde: new Date().toISOString() }
  const nuevas = numeros.filter((n) => !bases[String(n)])
  anotarEstado({
    ...(nuevas.length ? { bases: { ...bases, ...Object.fromEntries(nuevas.map((n) => [String(n), { ...vigente, lote: numeros }])) } } : {}),
    en_curso: numeros,
    paralelos: [...paralelosDe(leerEstado()), { tipo: 'lote', n: numeros.length, desde: new Date().toISOString() }].slice(-TOPE_PARALELOS),
  })
  console.log(`BASE=${vigente.base} DESDE=${vigente.desde}`)
  console.log(`LOTE=${numeros.map((n) => `S${n}`).join('+')}`)
}

/**
 * `--tanda <n>`: abre la fase en paralelo de una tanda de `n` ejecutores de correcciones (sin fotos por subtarea, así que no pasa por
 * `--base --sub`) e imprime `TANDA=<n> DESDE=<iso>`. Con `n` = 1 solo avisa: un ejecutor solo no corre en paralelo. Falla sin un flujo abierto.
 * Siempre imprime además `BASE=<sha>`, la foto previa a las correcciones: el siguiente ciclo de la revisión final mira solo el diff desde ahí.
 * `--sub <lista>` anota en `en_curso` las subtareas cuyos ejecutores corrigen (como `--base --sub`): la guardia deja pasar los permisos
 * aprobados solo de esas. Sin `--sub`, `en_curso` queda vacío y ningún permiso vale.
 */
export function abrirTanda(n, sub) {
  if (n === null) throw new Error('--tanda necesita cuántos ejecutores tiene la tanda (un entero ≥ 1)')
  if (sub === null) throw new Error('--sub necesita el número de la subtarea o una lista (un entero ≥ 1, o 1,3)')
  const e = leerEstado()
  if (!e.base_global || e.cierre) throw new Error('el flujo no está abierto: no hay dónde anotar la tanda (corre el preflight)')
  const base = foto((Array.isArray(e.subtareas) ? e.subtareas : []).flatMap((s) => (Array.isArray(s?.permitidos) ? s.permitidos : [])))
  const desde = new Date().toISOString()
  // La BASE de cada tanda queda en el estado: `--reanudar` la da como BASE DE LA CORRECCIÓN.
  const tandas = [...listaDe(e, 'tandas'), { n, base, t: desde, ciclo: listaDe(e, 'revisiones').length }].slice(-TOPE_PARALELOS)
  const en_curso = sub === undefined ? undefined : [].concat(sub)
  if (n < 2) {
    cerrarParalelos()
    anotarEstado({ tandas, en_curso })
    console.log(`AVISO: una tanda de ${n} no corre en paralelo; no se anota la fase en paralelo`)
    console.log(`BASE=${base}`)
    return
  }
  anotarEstado({ tandas, en_curso, paralelos: [...paralelosDe(e), { tipo: 'tanda', n, desde }].slice(-TOPE_PARALELOS) })
  console.log(`TANDA=${n} DESDE=${desde}`)
  console.log(`BASE=${base}`)
}

/**
 * `--permiso <Pn|Nn[,Pm…]> aprobado`: deja `aprobado: <iso>` (la hora de la aprobación del usuario) en cada permiso `id` de `permisos`
 * del estado e imprime una línea `PERMISO: <id> aprobado` por id. La guardia deja pasar su comando solo al ejecutor y mientras su
 * `sub` esté en `en_curso`. Falla (sin anotar ninguno) si el flujo no está abierto o si algún `id` no está en los permisos del plan.
 */
export function aprobarPermiso(ids, accion) {
  if (ids === null) throw new Error('--permiso necesita el id del permiso (P<n> o N<n>, varios con coma) y «aprobado»: --permiso <id> aprobado')
  if (accion !== 'aprobado') throw new Error(`--permiso ${ids}: solo vale «aprobado» (vino «${accion}»)`)
  const e = leerEstado()
  if (!e.base_global || e.cierre) throw new Error('el flujo no está abierto: no hay dónde anotar la aprobación (corre el preflight)')
  const previas = e.permisos && typeof e.permisos === 'object' && !Array.isArray(e.permisos) ? e.permisos : {}
  const lista = [...new Set(ids.split(','))]
  for (const id of lista) if (!previas[id]) throw new Error(`${id} no está en los permisos del plan guardado`)
  const ahora = new Date().toISOString()
  anotarEstado({ permisos: { ...previas, ...Object.fromEntries(lista.map((id) => [id, { ...previas[id], aprobado: ahora }])) } })
  for (const id of lista) console.log(`PERMISO: ${id} aprobado`)
}

const RE_PERMISO_NUEVO = /^(.+?)\s+·\s+(.+?)\s+·\s+reversible\s*:\s*(sí|si|no)\s+·\s+Qué hace\s*:\s*(.+?)\s+·\s+Para qué\s*:\s*(.+)$/is

/**
 * `--permiso-nuevo "<comando> · <servicio> · reversible: sí|no · Qué hace: … · Para qué: …" --sub <n>`: agrega a `permisos` del estado un
 * permiso `N<k>` (el siguiente libre) del ejecutor de la subtarea `n`, ya aprobado (el usuario lo aprobó en el chat) y marcado `nuevo`
 * para que un re-plan lo conserve mientras `n` siga en el plan. Imprime `PERMISO: N<k> aprobado`. Falla si falta algún campo, si el
 * comando no es simple o su comodín no se puede levantar (`regexDePermiso`), o si se niega aun aprobado (`motivoFijoDe`).
 */
export function permisoNuevo(texto, sub) {
  if (!texto || /^--/.test(texto)) throw new Error('--permiso-nuevo necesita "<comando> · <servicio> · reversible: sí|no · Qué hace: … · Para qué: …"')
  if (!Number.isSafeInteger(sub)) throw new Error('--permiso-nuevo necesita --sub <n> (una sola subtarea)')
  const m = RE_PERMISO_NUEVO.exec(texto.trim())
  if (!m) throw new Error('--permiso-nuevo: el texto debe ser "<comando> · <servicio> · reversible: sí|no · Qué hace: … · Para qué: …" (separado por « · »)')
  const [, crudo, servicio, reversible, queHace, paraQue] = m
  const comando = crudo.trim().replace(/^(`+)(.+)\1$/, '$2').trim()
  const e = leerEstado()
  if (!e.base_global || e.cierre) throw new Error('el flujo no está abierto: no hay dónde anotar el permiso (corre el preflight)')
  if (!(Array.isArray(e.subtareas) ? e.subtareas : []).some((s) => s?.n === sub)) throw new Error(`S${sub} no está en el plan guardado`)
  if (!regexDePermiso(comando)) throw new Error(`«${comando}» no se puede aprobar: no es un comando simple o el comodín «*» cae antes de la parte literal`)
  const fijo = motivoFijoDe(comando)
  if (fijo) throw new Error(`«${comando}» se niega aun aprobado (${fijo})`)
  const previas = e.permisos && typeof e.permisos === 'object' && !Array.isArray(e.permisos) ? e.permisos : {}
  const id = `N${Math.max(0, ...Object.keys(previas).map((k) => Number(/^N(\d+)$/.exec(k)?.[1] ?? 0))) + 1}`
  const permiso = { rol: 'ejecutor', sub, comando, servicio: servicio.trim(), reversible: /^s/i.test(reversible), queHace: queHace.trim(), paraQue: paraQue.trim(), nuevo: true, aprobado: new Date().toISOString() }
  anotarEstado({ permisos: { ...previas, [id]: permiso } })
  console.log(`PERMISO: ${id} aprobado`)
}

/**
 * `--cambios --sub <n>`, `--cambios --sub 1,2` (un lote) o `--cambios --global`: BASE, DESDE y permitidos salen de la carpeta del flujo.
 * Los permitidos son los del plan (los de la subtarea, los del lote o los de todas) más los `--permitidos` explícitos (los ampliados).
 * Un número que es de un lote de varios mide el lote entero y lo avisa.
 * Devuelve `{ base, desde, permitidos }` e imprime la línea `FOTO`; lanza un error si falta algo.
 */
export function contextoDelFlujo({ base, desde, permitidos, sub, global }) {
  if (sub === null) throw new Error('--sub necesita el número de la subtarea (un entero ≥ 1)')
  if (sub !== undefined && global) throw new Error('--sub y --global no van juntos')
  if (base !== undefined || desde !== undefined) {
    throw new Error('--sub y --global toman la BASE y el DESDE de la carpeta del flujo: quita <BASE> y --desde, o usa la forma explícita')
  }
  const e = leerEstado()
  const subtareas = Array.isArray(e.subtareas) ? e.subtareas : []
  const delPlan = (s) => (Array.isArray(s?.permitidos) ? s.permitidos.map(String) : [])
  let etiqueta
  let inicio
  let previstos
  let posteriores = []
  let etiquetaPosteriores = ''
  if (global) {
    if (!e.base_global) throw new Error('sin BASE_GLOBAL en la carpeta del flujo: usa --cambios <BASE> --desde <DESDE> --permitidos "…"')
    etiqueta = 'GLOBAL'
    inicio = { base: e.base_global, desde: e.desde_global }
    previstos = [...new Set(subtareas.flatMap(delPlan))]
  } else {
    const bases = basesDe(e)
    const fotoDe = (n) => {
      const f = bases[String(n)]
      if (!f) throw new Error(`sin foto de S${n} en la carpeta del flujo: usa --cambios <BASE> --desde <DESDE> --permitidos "…"`)
      return f
    }
    let miembros = [sub]
    if (Array.isArray(sub)) {
      const lotes = sub.map((n) => loteDe(fotoDe(n)))
      if (lotes.some((l) => !l || l.join() !== lotes[0].join())) {
        throw new Error(`${sub.map((n) => `S${n}`).join(' y ')} no son del mismo lote: toma su foto con --base --sub ${sub.join(',')}`)
      }
      miembros = lotes[0]
    } else {
      const lote = loteDe(fotoDe(sub))
      if (lote) {
        miembros = lote
        console.log(`AVISO: S${sub} es del lote ${lote.map((n) => `S${n}`).join('+')}: mide el lote entero (--cambios --sub ${lote.join(',')})`)
      }
    }
    etiqueta = miembros.map((n) => `S${n}`).join('+')
    inicio = fotoDe(miembros[0])
    previstos = [...new Set(miembros.flatMap((n) => delPlan(subtareas.find((s) => Number(s?.n) === n))))]
    // Las subtareas con foto posterior a la de la medición ya midieron lo suyo: una corrección vieja no las marca FUERA.
    const delante = Object.keys(bases).map(Number).filter((n) => !miembros.includes(n) && Date.parse(bases[String(n)].desde) > Date.parse(inicio.desde)).sort((a, b) => a - b)
    posteriores = delante.flatMap((n) => delPlan(subtareas.find((s) => Number(s?.n) === n))).filter((p) => !previstos.includes(p))
    posteriores = [...new Set(posteriores)]
    if (posteriores.length) etiquetaPosteriores = `${posteriores.length} de subtareas posteriores (${delante.map((n) => `S${n}`).join(', ')})`
  }
  const ampliados = [...new Set(permitidos)].filter((p) => !previstos.includes(p))
  const unidos = [...new Set([...previstos, ...ampliados, ...posteriores])]
  if (!unidos.length) throw new Error('sin plan guardado ni --permitidos: usa la forma explícita (--cambios <BASE> --desde <DESDE> --permitidos "…")')
  console.log(`FOTO ${etiqueta}: BASE=${corto(inicio.base)} DESDE=${inicio.desde} · permitidos: ${previstos.length} del plan + ${ampliados.length} ampliados${etiquetaPosteriores ? ` + ${etiquetaPosteriores}` : ''}`)
  // Los ampliados (respuestas «Aceptar» del usuario) quedan en el estado: `--reanudar` los devuelve.
  if (ampliados.length) anotarEstado({ ampliados: [...new Set([...(Array.isArray(e.ampliados) ? e.ampliados : []), ...ampliados])] })
  return { base: inicio.base, desde: inicio.desde, permitidos: unidos, miembros: global ? null : etiqueta.split('+').map((s) => Number(s.slice(1))) }
}
