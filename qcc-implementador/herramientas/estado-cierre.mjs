// Cierre del flujo (`--cambios … --paso 7`) y `--cancelar`: la fila de flujos.jsonl, el historial y los límites gastados.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { nombreDe, carpetaGlobal, RAIZ } from './guardia.mjs'
import { metricasDelFlujo, resumenDeCosto, resumenDeVeredictos, leerLimites, gastoDeLimites, resumenDeLimites, fasesDeLimites, resumenDeFases } from './costos.mjs'
import { enAlcance, git, foto, leerRegistro, FLUJO, leerEstado, anotarEstado, basesDe, sesionesDe, tramosDeLimites, cortadosDe, loteDe } from './estado-base.mjs'
import { esqueletoDelCierre } from './estado-despachos.mjs'

const RE_RESULTADO = /^(COMPLETO|DETENIDO:[0-7])$/

const HISTORIAL_MAX = 30

const RE_CARPETA_HISTORIAL = /^\d{8}T\d{6}-/

/** La `version` de `.claude-plugin/plugin.json` del plugin que contiene este archivo; null si no se puede leer. */
function versionInstalada() {
  try {
    const manifiesto = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.claude-plugin', 'plugin.json')
    const version = JSON.parse(fs.readFileSync(manifiesto, 'utf8')).version
    return typeof version === 'string' && version ? version : null
  } catch {
    return null
  }
}

/** `git diff --numstat` entre dos fotos: `{ archivos, mas, menos }` (un binario cuenta como archivo, sin líneas). Con `permitidos`, solo las rutas que caen en ellos. */
function numstat(desdeFoto, hastaFoto, permitidos = []) {
  let archivos = 0
  let mas = 0
  let menos = 0
  for (const linea of git(['-c', 'core.quotepath=off', 'diff', '--numstat', '--no-renames', desdeFoto, hastaFoto]).split('\n')) {
    const m = /^(\d+|-)\t(\d+|-)\t(.*)$/.exec(linea)
    if (!m || !enAlcance(m[3], permitidos)) continue
    archivos++
    mas += Number(m[1]) || 0
    menos += Number(m[2]) || 0
  }
  return { archivos, mas, menos }
}

/**
 * Lo que cambió cada subtarea: la diferencia entre su foto (`--base --sub`) y la de la siguiente; la última, contra el árbol
 * de ahora. Las fotos van en orden de `desde` (a igual `desde`, por n). Las de un lote (`--base --sub 1,2`) comparten foto: su
 * siguiente es la próxima foto en el tiempo fuera del lote y cada miembro cuenta solo lo que cae en sus propios permitidos.
 * `{ "<n>": { archivos, mas, menos } }`; una subtarea cuya diferencia falla queda fuera.
 */
function cambiosPorSubtarea(estado) {
  const bases = basesDe(estado)
  const tiempo = (n) => Date.parse(bases[String(n)].desde)
  const numeros = Object.keys(bases).map(Number).sort((a, b) => (tiempo(a) - tiempo(b)) || a - b)
  const plan = Array.isArray(estado.subtareas) ? estado.subtareas : []
  const porSubtarea = {}
  let ahora = null
  numeros.forEach((n, i) => {
    try {
      const lote = loteDe(bases[String(n)])
      const proximo = numeros.slice(i + 1).find((m) => !lote?.includes(m))
      const siguiente = bases[String(proximo)]?.base ?? (ahora ??= foto())
      const delPlan = plan.find((s) => Number(s?.n) === n)?.permitidos
      const propios = lote && Array.isArray(delPlan) ? delPlan.map(String) : []
      porSubtarea[n] = numstat(bases[String(n)].base, siguiente, propios)
    } catch {
      // Sin esta diferencia, el cierre sigue.
    }
  })
  return porSubtarea
}

/** El objeto sin las claves nulas o sin definir; undefined si no queda ninguna. */
const sinNulos = (obj) => {
  const entradas = Object.entries(obj).filter(([, v]) => v !== null && v !== undefined)
  return entradas.length ? Object.fromEntries(entradas) : undefined
}

/**
 * La fila v2 de `registros/flujos.jsonl`. `datos`: `t` (hora del cierre), `raiz`, `base`, `version`, `resultado`, `tokens`
 * (de `--tokens`), `estado` (el estado del flujo), `metricas` (de `metricasDelFlujo`), `cambios` (de `cambiosPorSubtarea`)
 * `negados` (cuántas negaciones de la guardia hubo; `negadosContexto`, cuántas fueron cortes por contexto) y `cortados` (ids de los agentes que la guardia cortó por contexto;
 * cada explorador sale con `cortado: true|false`). Omite lo que falte; `uso` suma pedidos y tokens de todos los roles.
 * `sesiones` (de las métricas) es cuántas sesiones sumó el flujo: 1 sin corte, más si se reanudó con `--reanudar`.
 * `limites` (de `gastoDeLimites` más sus `tramos`) es el % de la ventana de 5 h y de la semanal que gastó el flujo.
 */
export function filaDelFlujo({ t, raiz, base, version, resultado, tokens, estado = {}, metricas = null, cambios = {}, negados, negadosContexto, cortados = [], limites } = {}) {
  const m = metricas ?? {}
  const roles = Object.values(m.costo?.roles ?? {})
  const suma = (clave) => roles.reduce((s, r) => s + (r.tokens?.[clave] ?? 0), 0)
  const uso = m.costo ? { pedidos: roles.reduce((s, r) => s + (r.pedidos ?? 0), 0), tokens: { entrada: suma('entrada'), leidos: suma('leidos'), escritos: suma('escritos'), salida: suma('salida'), thinking: suma('thinking') } } : undefined
  const subtareas = Array.isArray(estado.subtareas)
    ? estado.subtareas.map((s) => {
      const ejecutor = m.ejecutores?.[s.n] ?? {}
      const c = cambios[s.n] ?? {}
      return sinNulos({
        n: s.n,
        critica: s.critica === null || s.critica === undefined || !/^no\b/i.test(String(s.critica).trim()),
        esfuerzo: ejecutor.esfuerzo,
        archivos: c.archivos,
        mas: c.mas,
        menos: c.menos,
        segundos: ejecutor.segundos,
        correcciones: ejecutor.correcciones,
        estado: estado.avance?.[String(s.n)]?.estado === 'OMITIDA' ? 'OMITIDA' : ejecutor.estado,
      })
    })
    : undefined
  return sinNulos({
    v: 2,
    t,
    raiz,
    base,
    version,
    sesion: m.sesion,
    sesiones: m.sesiones,
    pedido: m.pedido,
    titulo: estado.titulo,
    resultado,
    clasificacion: estado.clasificacion,
    costo: m.costo,
    uso,
    limites,
    contexto: sinNulos({ primero: m.contexto?.primero }),
    tiempos: m.tiempos,
    subtareas,
    calidad: sinNulos({
      final: m.problemas?.final,
      negados,
      negadosContexto,
      alcanceFuera: m.alcanceFuera,
      inicial: estado.verificacion_inicial?.resultado,
    }),
    explorador: m.explorador && Array.isArray(m.explorador.agentes) ? { ...m.explorador, agentes: m.explorador.agentes.map((a) => ({ ...a, cortado: cortados.includes(a.id) })) } : m.explorador,
    tokens,
  })
}

/** `CONTEXTO: …` del cierre: tokens del último pedido del hilo principal (lo que el próximo pedido vuelve a mandar). */
function lineaDeContexto(metricas) {
  if (!metricas) return 'CONTEXTO: sin datos (no encontré la sesión del flujo en los transcripts)'
  const n = metricas.contexto?.ultimo
  if (typeof n !== 'number') return 'CONTEXTO: sin datos (el hilo principal no tiene pedidos en el tramo del flujo)'
  return `CONTEXTO: ${n} tokens en el último pedido del hilo principal`
}

/**
 * Cierra los tramos de límites del estado con `lectura` (si trae dato; si no, el último tramo sin lectura final queda con
 * ella, que dice el motivo) y da `{ ...gastoDeLimites(tramos), fases?, tramos }`, con `fases` (de `fasesDeLimites`) si
 * todos los tramos traen lecturas por fase. Un flujo viejo sin tramos queda «sin dato».
 */
function limitesDelCierre(e, lectura) {
  const tramos = tramosDeLimites(e)
  if (!tramos.length) tramos.push({})
  const ultimo = tramos.at(-1)
  if (!lectura.sinDato || !ultimo.fin) tramos[tramos.length - 1] = { ...ultimo, fin: lectura }
  const fases = fasesDeLimites(tramos)
  return { ...gastoDeLimites(tramos), ...(fases ? { fases } : {}), tramos }
}

/**
 * Copia plan.md, exploracion.md, pedido.md, mapa.md, los S<n>.md, los revision-<c>.md y estado.json del flujo a `<registros>/historial/<AAAAMMDDTHHMMSS>-<proyecto>-<hash>/`
 * y deja las `HISTORIAL_MAX` carpetas más recientes: solo borra subcarpetas directas de `historial/` con nombre `AAAAMMDDTHHMMSS-…`,
 * nunca la recién creada. Nunca rompe el cierre.
 */
export function archivarFlujo(t) {
  try {
    const historial = path.join(carpetaGlobal(), 'historial')
    const destino = path.join(historial, `${t.replace(/[-:]/g, '').slice(0, 15)}-${nombreDe(RAIZ)}`)
    fs.mkdirSync(destino, { recursive: true })
    for (const nombre of fs.readdirSync(FLUJO)) {
      if (/^(plan|exploracion|pedido|mapa|S\d+|revision-\d+)\.md$/.test(nombre) || nombre === 'estado.json') fs.copyFileSync(path.join(FLUJO, nombre), path.join(destino, nombre))
    }
    console.log(`HISTORIAL: ${destino}`)
    const carpetas = fs.readdirSync(historial, { withFileTypes: true }).filter((d) => d.isDirectory() && RE_CARPETA_HISTORIAL.test(d.name)).map((d) => d.name).sort().reverse()
    for (const nombre of carpetas.slice(HISTORIAL_MAX)) {
      const vieja = path.join(historial, nombre)
      if (path.dirname(vieja) === historial && vieja !== destino) fs.rmSync(vieja, { recursive: true, force: true })
    }
  } catch (err) {
    console.log(`AVISO: no se pudo archivar el flujo en el historial: ${err.message}`)
  }
}

/**
 * Cierre: imprime el consumo del flujo, sus veredictos y el CONTEXTO del hilo principal (de los transcripts) y el % de los
 * LÍMITES que gastó (del snapshot del panel), fija
 * `cierre` y `resultado` en el estado, anota la fila v2 en `registros/flujos.jsonl` (`filaDelFlujo`, con los `--tokens` si
 * vinieron) y archiva el flujo en el historial. Cada parte falla sola: nunca rompe el cierre. `cancelado` (solo `--cancelar`)
 * fija el resultado `CANCELADO`, que `--resultado` no acepta.
 */
export function cerrarFlujo(base, desde, tokens, resultado, cancelado = false) {
  const e = leerEstado()
  const t = new Date().toISOString()
  let metricas = null
  try {
    metricas = metricasDelFlujo(RAIZ, e.inicio ?? desde ?? t, { hasta: t, base: e.base_global ?? null, sesiones: sesionesDe(e) })
  } catch {
    // Sin métricas, el cierre sigue.
  }
  const costo = metricas?.costo ?? null
  if (costo) {
    console.log(`CONSUMO: ${resumenDeCosto(costo)} (sin el mensaje de cierre)`)
    console.log(`VEREDICTOS: ${resumenDeVeredictos(costo)}`)
  } else console.log('CONSUMO: no encontré la sesión del flujo en los transcripts; el gasto está en «Flujo» del panel')
  console.log(lineaDeContexto(metricas))
  let limites
  try {
    const lectura = leerLimites()
    limites = limitesDelCierre(e, lectura)
    console.log(`LÍMITES: ${resumenDeLimites(limites)}${lectura.sinDato ? ` (lectura del cierre: ${lectura.sinDato})` : ''}`)
    console.log(`LÍMITES POR FASE: ${limites.fases ? resumenDeFases(limites.fases) : 's/d (el flujo empezó sin lecturas por fase)'}`)
  } catch {
    // Sin límites, la fila sigue.
  }
  let porRol = null
  if (tokens !== undefined) {
    porRol = tokensDe(tokens)
    if (!porRol) console.log(`AVISO: --tokens ${tokens} no es rol=n,…; el flujo se anota sin ellos`)
  }
  let valido
  if (cancelado) valido = 'CANCELADO'
  else if (resultado !== undefined) {
    if (RE_RESULTADO.test(resultado)) valido = resultado
    else console.log(`AVISO: --resultado ${resultado || '(vacío)'} no es COMPLETO ni DETENIDO:<0-7>; el flujo se anota sin él`)
  }
  anotarEstado({ cierre: t, resultado: valido, ...(limites ? { limites: limites.tramos } : {}) })
  if (valido === 'COMPLETO' && metricas) {
    // `subtareas` [{ n, estado }] si la métrica lo trae; si no, los ejecutores por subtarea (`1`, `2`…; `final` y `?` no cuentan).
    const lista = Array.isArray(metricas.subtareas) ? metricas.subtareas : Object.entries(metricas.ejecutores ?? {}).filter(([n]) => /^\d+$/.test(n)).map(([n, g]) => ({ n, estado: g?.estado }))
    for (const s of lista) if (s?.estado && s.estado !== 'HECHO' && s.estado !== 'OMITIDA') console.log(`AVISO: S${s.n} terminó ${s.estado} y el cierre es COMPLETO: dilo en Riesgos pendientes`)
  }
  let cambiosDeSubtareas = {}
  try {
    cambiosDeSubtareas = cambiosPorSubtarea(e)
  } catch {
    // Sin las diferencias por subtarea, la fila sigue.
  }
  let negados
  let negadosContexto
  let cortados
  try {
    const filas = leerRegistro(e.desde_global ?? desde ?? e.inicio ?? t)
    negados = filas.filter((f) => f.decision === 'negado').length
    negadosContexto = filas.filter((f) => f.decision === 'negado' && /^contexto \d+k$/.test(f.motivo ?? '')).length
    cortados = [...cortadosDe(filas).keys()]
  } catch {
    // Sin el registro, la fila sigue.
  }
  try {
    anotarFlujo(path.join(carpetaGlobal(), 'flujos.jsonl'), filaDelFlujo({ t, raiz: RAIZ, base, version: versionInstalada(), resultado: valido, tokens: porRol ?? undefined, estado: e, metricas, cambios: cambiosDeSubtareas, negados, negadosContexto, cortados, limites }))
  } catch (err) {
    console.log(`AVISO: no se pudo anotar el flujo: ${err.message}`)
  }
  archivarFlujo(t)
  if (!cancelado) for (const l of esqueletoDelCierre(e, valido)) console.log(l)
}

/**
 * `--cancelar`: cierra el flujo abierto que no llegó a ejecutar nada (candado libre para el siguiente preflight).
 * No hace nada si no hay flujo, si ya está cerrado o si tiene fotos de subtareas (hay trabajo hecho: se cierra con `--cambios`).
 * Cierra con `cerrarFlujo` (fila v2 con `resultado: 'CANCELADO'` e historial); no necesita git.
 */
export function cancelar() {
  const e = leerEstado()
  if (!e.base_global) {
    console.log('CANCELAR: no hay un flujo en curso')
    return
  }
  if (e.cierre) {
    console.log(`CANCELAR: el flujo ya estaba cerrado (${e.cierre})`)
    return
  }
  const numeros = Object.keys(basesDe(e)).sort((a, b) => Number(a) - Number(b))
  if (numeros.length) {
    console.log(`AVISO: el flujo ya empezó a ejecutar subtareas (${numeros.map((n) => `S${n}`).join(', ')}): --cancelar no lo cierra para no perder su rastro; ciérralo con --cambios --global --resultado DETENIDO:<paso> --paso 7`)
    return
  }
  cerrarFlujo(e.base_global, e.desde_global, undefined, undefined, true)
  console.log('CANCELADO: flujo cerrado sin plan aprobado; el candado queda libre')
}

const ROLES = ['explorador', 'planificador', 'ejecutor', 'revisor', 'final']

/**
 * `"ejecutor=52000,ejecutor=48000,final=61000"` → `{ ejecutor: [52000, 48000], final: [61000] }`.
 * Un rol puede repetirse (un valor por llamada, en orden). `null` si falta, está vacío o algún par es inválido.
 */
export function tokensDe(texto) {
  if (typeof texto !== 'string' || !texto) return null
  const porRol = {}
  for (const par of texto.split(',')) {
    const m = /^([a-z-]+)=(\d+)$/.exec(par)
    if (!m || !ROLES.includes(m[1])) return null
    porRol[m[1]] ??= []
    porRol[m[1]].push(Number(m[2]))
  }
  return porRol
}

/** Agrega `fila` como una línea JSON a `archivo`, creando la carpeta si falta. */
export function anotarFlujo(archivo, fila) {
  fs.mkdirSync(path.dirname(archivo), { recursive: true })
  fs.appendFileSync(archivo, JSON.stringify(fila) + '\n')
}
