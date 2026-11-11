#!/usr/bin/env node
// Consumo de los flujos /impl, leído de los transcripts de Claude Code, y el % de los límites de uso que gastó cada uno.
//
//   node <plugin>/herramientas/costos.mjs [--ultimos <n>] [--archivo <flujos.jsonl>]
//   node <plugin>/herramientas/costos.mjs --fuga [--ultimos <n>] [--archivo <flujos.jsonl>]
//   node <plugin>/herramientas/costos.mjs --anotar <t> "<texto>" [--archivo <flujos.jsonl>]
//
// Lista los últimos flujos anotados en `registros/flujos.jsonl` (10 por defecto), de la versión 1 y de la 2: minutos,
// tokens, pedidos por rol, el % de la ventana de 5 h y de la semanal que gastó (`5h +7 % · sem +1 %`, `s/d` sin dato),
// Clasificación, subtareas y veredictos (en la 2, además el resultado y los defectos anotados), con el promedio al final.
// Bajo cada flujo con lecturas por fase, una línea `por fase:` con el % de cada fase (`fasesDeLimites`).
// `--fuga` mide, por flujo v2, lo gastado en su sesión después del cierre y hasta el siguiente `/impl`. `--anotar` suma
// un defecto al flujo cuyo `t` empieza con `<t>` (exit 2 si no es uno solo). estado.mjs usa `metricasDelFlujo` en el
// cierre (`--cambios … --paso 7`) para anotar cada flujo (tokens, tiempos por fase, ejecutores, problemas de los
// revisores) y `leerLimites`/`gastoDeLimites` para el % de los límites (ver LIMITES.md). No calcula dólares: el plan de
// suscripción gasta % de ventana, no dinero. Las filas viejas con `usd` se leen igual y el campo se ignora.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { carpetaGlobal, RAIZ } from './guardia.mjs'

const WIN = process.platform === 'win32'

const configDe = () => process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')
const proyectosDe = () => path.join(configDe(), 'projects')
const decimal = (n) => n.toFixed(1).replace('.', ',')
const textoDe = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((x) => (x?.type === 'text' ? x.text : '')).join('') : '')

// ── Límites de uso (% de la ventana de 5 h y de la semanal) ────────────────

/** Ventanas que se anotan por flujo. */
const VENTANAS = ['five_hour', 'seven_day']
/** Más vieja que esto (segundos), la lectura del snapshot es «sin dato». */
export const LIMITES_MAX_SEG = 10 * 60

/** El snapshot que escribe el panel en la carpeta de la cuenta que corre (`QCC_LIMITES` lo cambia, para los tests). */
export const rutaLimites = () => process.env.QCC_LIMITES || path.join(configDe(), 'qcc-limites.json')

/**
 * Lectura del % usado de cada ventana, del snapshot del panel: `{ t, edad, cuenta, five_hour?: { pct, resetsAt }, seven_day?: … }`,
 * con `t` la hora de la lectura, `edad` los segundos del snapshot y `cuenta` la carpeta de configuración. Sin snapshot, roto o
 * con más de `LIMITES_MAX_SEG`, `{ t, cuenta, sinDato: <motivo> }`: nunca rellena con ceros.
 */
export function leerLimites(archivo = rutaLimites(), ahora = Date.now()) {
  const base = { t: new Date(ahora).toISOString(), cuenta: path.basename(configDe()) }
  let s
  try {
    s = JSON.parse(fs.readFileSync(archivo, 'utf8'))
  } catch {
    return { ...base, sinDato: 'sin snapshot del panel' }
  }
  const edad = Math.round((ahora - Date.parse(s?.t)) / 1000)
  if (!Number.isFinite(edad)) return { ...base, sinDato: 'snapshot roto' }
  if (edad > LIMITES_MAX_SEG) return { ...base, edad, sinDato: 'snapshot viejo' }
  const lectura = { ...base, edad }
  for (const k of VENTANAS) if (Number.isFinite(s[k]?.pct)) lectura[k] = { pct: s[k].pct, resetsAt: s[k].resetsAt }
  return lectura
}

/**
 * Lo gastado de la ventana `k` entre dos lecturas: `{ gasto }`; con reinicio en medio, la cota mínima `{ gasto: <% de fin>, cota: true }`
 * (tras el reinicio se gastó al menos lo que marca la lectura final); `null` si falta alguna lectura.
 */
function tramoDeVentana(inicio, fin, k) {
  const a = inicio?.[k]
  const b = fin?.[k]
  if (!a || !b) return null
  const ra = Date.parse(a.resetsAt)
  const rb = Date.parse(b.resetsAt)
  // Se reinició si bajó el %, si la lectura final es posterior al reinicio previsto o si cambió la hora de reinicio.
  if (b.pct < a.pct || (Number.isFinite(ra) && Date.parse(fin.t) >= ra) || (Number.isFinite(ra) && Number.isFinite(rb) && Math.abs(ra - rb) > 60_000)) return { gasto: b.pct, cota: true }
  return { gasto: b.pct - a.pct }
}

/**
 * El gasto de cada ventana en los tramos del flujo (`[{ inicio, fin }]`, uno por sesión): `{ five_hour: { gasto, incompleto? }, seven_day: … }`.
 * `gasto` suma los tramos (a 0,1) y lleva `incompleto: true` si a alguno le faltó dato o se reinició (de un reinicio entra la cota
 * mínima: el % de su lectura final); sin ningún tramo con dato, `{ gasto: null, motivo: 'sin dato' }`.
 */
export function gastoDeLimites(tramos) {
  const gasto = {}
  for (const k of VENTANAS) {
    const partes = (Array.isArray(tramos) ? tramos : []).map((t) => tramoDeVentana(t?.inicio, t?.fin, k))
    const validos = partes.filter(Boolean)
    if (!validos.length) gasto[k] = { gasto: null, motivo: 'sin dato' }
    else gasto[k] = { gasto: Math.round(validos.reduce((s, p) => s + p.gasto, 0) * 10) / 10, ...(validos.length < partes.length || validos.some((p) => p.cota) ? { incompleto: true } : {}) }
  }
  return gasto
}

/** «5h +7 % · sem +1,5 %»: `≥+` si el gasto es una cota mínima (faltó algún tramo o hubo reinicio), `s/d` sin dato; las filas viejas con el motivo `reinicio` siguen diciendo `reinicio`. */
export function resumenDeLimites(limites) {
  return [['5h', 'five_hour'], ['sem', 'seven_day']].map(([nombre, k]) => {
    const v = limites?.[k]
    if (typeof v?.gasto === 'number') return `${nombre} ${v.incompleto ? '≥' : ''}+${String(v.gasto).replace('.', ',')} %`
    return `${nombre} ${v?.motivo === 'reinicio' ? 'reinicio' : 's/d'}`
  }).join(' · ')
}

/**
 * La fase de /impl de cada `--paso` (pasos.md): el único mapa paso → fase. El 1 no lo lleva ningún comando (la exploración
 * va entre el preflight y el primer `--paso 2`) y el 3 está sin uso; el 7 solo nombra lo que sigue a un `--reanudar` en el cierre.
 */
export const FASES = { 0: 'exploración', 1: 'exploración', 2: 'plan', 3: 'plan', 4: 'aprobación', 5: 'ejecución', 6: 'revisión', 7: 'cierre' }

/**
 * El gasto de cada fase en los tramos del flujo, de las lecturas por fase de cada tramo (`fases: [{ paso, ...lectura }]`,
 * la primera igual a su `inicio`): lo de entre una lectura y la siguiente (o el `fin` del tramo) es de la fase de la primera.
 * Los pasos repetidos y los tramos se suman con `gastoDeLimites`. Una lectura `sinDato` une el tramo que termina en ella con el
 * que empieza (y con los siguientes mientras sigan sin dato): la fase unida se llama `plan+aprobación`, y su gasto es la resta
 * entre las dos lecturas válidas de alrededor, sin repartirla. Un reinicio da la cota mínima (`incompleto`). `[{ fase, five_hour,
 * seven_day }]` en el orden de FASES (una unida, tras la primera de sus fases); `null` si algún tramo no trae lecturas por fase.
 */
export function fasesDeLimites(tramos) {
  const orden = [...new Set(Object.values(FASES))]
  const porFase = new Map()
  for (const t of Array.isArray(tramos) ? tramos : []) {
    const lecturas = (Array.isArray(t?.fases) ? t.fases : []).filter((l) => FASES[l?.paso])
    if (!lecturas.length) return null
    const trozos = []
    lecturas.forEach((l, i) => {
      const previo = trozos.at(-1)
      const fase = FASES[l.paso]
      if (previo && l.sinDato) {
        previo.fin = lecturas[i + 1] ?? t.fin
        if (!previo.fases.includes(fase)) previo.fases.push(fase)
      } else trozos.push({ fases: [fase], inicio: l, fin: lecturas[i + 1] ?? t.fin })
    })
    for (const { fases, inicio, fin } of trozos) {
      const nombre = fases.join('+')
      if (!porFase.has(nombre)) porFase.set(nombre, [])
      porFase.get(nombre).push({ inicio, fin })
    }
  }
  const primera = (nombre) => orden.indexOf(nombre.split('+')[0])
  const fases = [...porFase].sort(([a], [b]) => primera(a) - primera(b) || a.length - b.length).map(([fase, partes]) => ({ fase, ...gastoDeLimites(partes) }))
  return fases.length ? fases : null
}

/** «exploración: 5h +0,5 % · sem +0,1 % | plan: …», con las mismas marcas que `resumenDeLimites`. */
export const resumenDeFases = (fases) => fases.map((f) => `${f.fase}: ${resumenDeLimites(f)}`).join(' | ')

function filasDe(archivo) {
  let texto
  try {
    texto = fs.readFileSync(archivo, 'utf8')
  } catch {
    return []
  }
  const filas = []
  for (const linea of texto.split('\n')) {
    if (!linea.trim()) continue
    try {
      filas.push(JSON.parse(linea))
    } catch {
      // Línea cortada: se ignora.
    }
  }
  return filas
}

/** Cada mensaje del asistente de esas filas una vez y con su uso final, en el orden en que apareció: `Map(id → { uso, modelo })`. */
function mensajesDe(filas) {
  const porMensaje = new Map()
  for (const f of filas) {
    const m = f?.type === 'assistant' ? f.message : null
    if (!m?.id) continue
    const previo = porMensaje.get(m.id)
    if (!previo || (m.usage?.output_tokens ?? 0) >= (previo.uso?.output_tokens ?? 0)) porMensaje.set(m.id, { uso: m.usage, modelo: m.model })
  }
  return porMensaje
}

const tokensVacios = () => ({ entrada: 0, leidos: 0, escritos: 0, salida: 0, thinking: 0 })

/** Pedidos al modelo de esas filas de transcript, cada mensaje una vez y con su uso final: `{ pedidos, tokens }`. */
export function usoDe(filas) {
  const porMensaje = mensajesDe(filas)
  const tokens = tokensVacios()
  for (const { uso } of porMensaje.values()) {
    const u = uso ?? {}
    tokens.entrada += u.input_tokens ?? 0
    tokens.leidos += u.cache_read_input_tokens ?? 0
    tokens.escritos += u.cache_creation_input_tokens ?? 0
    tokens.salida += u.output_tokens ?? 0
    tokens.thinking += u.output_tokens_details?.thinking_tokens ?? u.thinking_tokens ?? 0
  }
  return { pedidos: porMensaje.size, tokens }
}

/** Qué línea de su informe trae el veredicto de cada rol; los demás (explorador, planificador) no dan uno. */
const VEREDICTO_POR_ROL = { revisor: 'VEREDICTO', final: 'VEREDICTO', ejecutor: 'ESTADO' }

/** Texto de cada mensaje del asistente de esas filas, en orden. */
const textosDe = (filas) => filas.filter((f) => f?.type === 'assistant').flatMap((f) => (f.message?.content ?? []).filter((c) => c?.type === 'text').map((c) => c.text))

/** Los informes del agente que traen veredicto (`APROBADO`, `AJUSTAR`, `HECHO`…) en una línea que empieza con él, en orden: `[{ veredicto, texto }]`. Un agente retomado da varios. */
function informesDe(filas, rol) {
  const campo = VEREDICTO_POR_ROL[rol]
  if (!campo) return []
  const regex = new RegExp(`^[\\s*_>\`-]*${campo}(?:\\*\\*)?:\\s*\\**\\s*([A-ZÁÉÍÓÚ]+)`, 'm')
  return textosDe(filas).map((texto) => ({ veredicto: regex.exec(texto)?.[1], texto })).filter((i) => i.veredicto)
}

/** Si la fila es el `/impl` (o `/impl:impl`) que el usuario escribió en el hilo principal. */
const esComando = (f) => f?.type === 'user' && !f.isSidechain && f.timestamp && /<command-name>\/(?:[\w-]+:)?impl</.test(textoDe(f.message?.content))

/** Si la fila es la skill `impl` cargada por el modelo (herramienta Skill): trae `Base directory for this skill: …/skills/impl`, no `skills/implementador`. */
const esSkillImpl = (f) => f?.type === 'user' && !f.isSidechain && f.timestamp && /^Base directory for this skill: .*skills[\\/]impl(?![\w-])/.test(textoDe(f.message?.content))

/** Las filas que abren un flujo: cada `/impl` escrito, y cada skill `impl` sin un `/impl` escrito en los 5 s anteriores (si lo hay, ese es el comienzo). */
const comienzosDe = (filas) => {
  const comandos = filas.filter(esComando).map((f) => Date.parse(f.timestamp))
  return filas.filter((f) => esComando(f) || (esSkillImpl(f) && !comandos.some((c) => Date.parse(f.timestamp) - c >= 0 && Date.parse(f.timestamp) - c <= 5000)))
}

/** Rol corto de un agente: quita el prefijo `qcc-` (los transcripts viejos no lo tienen). */
const rolCorto = (nombre) => (typeof nombre === 'string' ? nombre.replace(/^(?:[^:]+:)?qcc-/, '') : nombre)

/**
 * El transcript de la sesión del flujo de `raiz` que empezó cerca de `desde` (DESDE_GLOBAL), con la hora de su
 * `/impl`. Con `base` (su BASE_GLOBAL), la sesión es la que la recibió de su preflight: así no se confunde
 * con otro flujo del mismo repo que empezó a la vez. Si no, la del `/impl` más cercano; sin esa fila (la skill
 * se llamó de otro modo), la sesión más reciente desde `desde`. null si no hay.
 */
export function sesionDelFlujo(raiz, desde, proyectos = proyectosDe(), base = null) {
  const carpeta = path.join(proyectos, path.resolve(raiz).replace(/[^a-zA-Z0-9]/g, '-'))
  const limite = Date.parse(desde)
  let archivos = []
  try {
    archivos = fs.readdirSync(carpeta).filter((a) => a.endsWith('.jsonl')).map((a) => path.join(carpeta, a))
  } catch {
    return null
  }
  const recientes = archivos
    .map((archivo) => ({ archivo, mtime: fs.statSync(archivo).mtimeMs }))
    .filter((a) => a.mtime >= limite - 60_000)
    .sort((a, b) => b.mtime - a.mtime)
  if (base) {
    // Un flujo reanudado tiene la marca en varias sesiones: la suya es la que la vio primero (la del preflight).
    const marca = `BASE_GLOBAL=${base}`
    let primera = null
    for (const { archivo } of recientes) {
      let texto = ''
      try {
        texto = fs.readFileSync(archivo, 'utf8')
      } catch {
        continue
      }
      if (!texto.includes(marca)) continue
      const filas = filasDe(archivo)
      const k = filas.findIndex((f) => JSON.stringify(f?.message?.content ?? '').includes(marca))
      const comando = comienzosDe(filas.slice(0, Math.max(k, 0))).at(-1)
      const vista = Date.parse(filas[k]?.timestamp ?? '') || Infinity
      if (!primera || vista < primera.vista) primera = { archivo, inicio: comando?.timestamp ?? filas[k]?.timestamp ?? new Date(limite).toISOString(), vista }
    }
    if (primera) return { archivo: primera.archivo, inicio: primera.inicio }
  }
  let mejor = null
  for (const { archivo } of recientes) {
    for (const f of comienzosDe(filasDe(archivo))) {
      const t = Date.parse(f.timestamp)
      if (t <= limite + 60_000 && t >= limite - 30 * 60_000 && (!mejor || t > Date.parse(mejor.inicio))) mejor = { archivo, inicio: f.timestamp }
    }
  }
  return mejor ?? (recientes.length ? { archivo: recientes[0].archivo, inicio: new Date(limite).toISOString() } : null)
}

/** Carpeta de `projects/` del proyecto `raiz` (Claude Code la nombra con la ruta, cada carácter no alfanumérico como `-`). */
const carpetaDe = (raiz, proyectos) => path.join(proyectos, path.resolve(raiz).replace(/[^a-zA-Z0-9]/g, '-'))

/**
 * El tramo de una sesión reanudada (`{ id?, transcript?, desde }`, de `estado.sesiones`): su transcript (el de `id`, o el
 * más reciente de los que traen `BASE_GLOBAL=<base>` y cambiaron desde `desde`) y su comienzo, el último `/impl` hasta
 * 60 s después de `desde` (o `desde` si no hay). null si no se encuentra.
 */
function tramoReanudado(s, carpeta, base) {
  let archivo = s.transcript && fs.existsSync(s.transcript) ? s.transcript : s.id ? path.join(carpeta, `${s.id}.jsonl`) : null
  if (!archivo || !fs.existsSync(archivo)) {
    archivo = null
    const marca = base ? `BASE_GLOBAL=${base}` : null
    let candidatos = []
    try {
      candidatos = fs.readdirSync(carpeta).filter((a) => a.endsWith('.jsonl')).map((a) => path.join(carpeta, a))
    } catch {
      return null
    }
    const recientes = candidatos.map((a) => ({ a, mtime: fs.statSync(a).mtimeMs })).filter((x) => x.mtime >= Date.parse(s.desde) - 60_000).sort((x, y) => y.mtime - x.mtime)
    archivo = recientes.find((x) => marca && (fs.readFileSync(x.a, 'utf8').includes(marca)))?.a ?? null
  }
  if (!archivo) return null
  const limite = Date.parse(s.desde) + 60_000
  const comando = comienzosDe(filasDe(archivo)).filter((f) => Date.parse(f.timestamp) <= limite).at(-1)
  return { archivo, inicio: comando && Date.parse(comando.timestamp) >= Date.parse(s.desde) - 30 * 60_000 ? comando.timestamp : new Date(Date.parse(s.desde)).toISOString() }
}

/**
 * Lee una sola vez el hilo principal y los subagentes del flujo de `raiz` en su tramo (de `desde` a `hasta`):
 * `{ sesion, ultima, hasta, todas, principal, agentes, tramos }`, con los agentes en orden de llegada y cada uno como
 * `{ rol, tipo, prompt, filas, inicio }`. Con `sesiones` (las de `estado.sesiones`, la del preflight primero), cada sesión
 * reanudada es un tramo más, de su comienzo al de la siguiente: así se suman todas sin contar el hueco entre ellas.
 * `tramos` trae `{ inicio, principal, agentes }` de cada uno; `sesion` es la primera (de ella sale el pedido) y `ultima`, el
 * transcript de la última. null si no se encuentra ninguna sesión.
 */
function leerFlujo(raiz, desde, proyectos, hasta, base, sesiones = []) {
  const carpeta = carpetaDe(raiz, proyectos)
  let primera = sesionDelFlujo(raiz, desde, proyectos, base)
  // Cierre desde otra cuenta: la búsqueda en esta carpeta da otra sesión (o ninguna); manda el transcript anotado de la primera.
  const anotada = Array.isArray(sesiones) ? sesiones[0]?.transcript : null
  if (anotada && fs.existsSync(anotada) && (!primera || path.resolve(primera.archivo) !== path.resolve(anotada))) primera = tramoReanudado(sesiones[0], carpeta, base) ?? primera
  const reanudadas = (Array.isArray(sesiones) ? sesiones.slice(1) : []).map((s) => tramoReanudado(s, carpeta, base)).filter(Boolean)
  const comienzos = [...(primera ? [primera] : []), ...reanudadas].sort((a, b) => Date.parse(a.inicio) - Date.parse(b.inicio))
  if (!comienzos.length) return null
  const lecturas = comienzos.map((s, i) => leerTramo(s, comienzos[i + 1]?.inicio ?? hasta))
  if (lecturas.length === 1) return { ...lecturas[0], ultima: lecturas[0].sesion.archivo, tramos: [{ inicio: lecturas[0].sesion.inicio, principal: lecturas[0].principal, agentes: lecturas[0].agentes }] }
  return {
    sesion: lecturas[0].sesion,
    ultima: lecturas.at(-1).sesion.archivo,
    hasta,
    todas: lecturas[0].todas,
    principal: lecturas.flatMap((l) => l.principal),
    agentes: lecturas.flatMap((l) => l.agentes).sort((a, b) => Date.parse(a.inicio) - Date.parse(b.inicio)),
    tramos: lecturas.map((l) => ({ inicio: l.sesion.inicio, principal: l.principal, agentes: l.agentes })),
  }
}

/** Segundos entre el fin de cada tramo (su última fila del hilo principal) y el comienzo del siguiente: el corte. 0 con un solo tramo. */
function corteDe(tramos) {
  let ms = 0
  for (let i = 1; i < tramos.length; i++) {
    const previo = tramos[i - 1]
    const fin = Math.max(Date.parse(previo.inicio), ...previo.principal.map((f) => Date.parse(f.timestamp)).filter(Number.isFinite))
    ms += Math.max(0, Date.parse(tramos[i].inicio) - fin)
  }
  return Math.round(ms / 1000)
}

/** Lo mismo que `leerFlujo` para una sesión ya conocida (`{ archivo, inicio }`): el tramo de `inicio` a `hasta`. */
function leerTramo(sesion, hasta) {
  const enTramo = (t) => t && t >= sesion.inicio && t <= hasta
  const todas = filasDe(sesion.archivo)
  const principal = todas.filter((f) => !f.isSidechain && enTramo(f.timestamp))
  const carpeta = path.join(path.dirname(sesion.archivo), path.basename(sesion.archivo, '.jsonl'), 'subagents')
  let nombres = []
  try {
    nombres = fs.readdirSync(carpeta).filter((a) => a.endsWith('.jsonl')).sort()
  } catch {
    // Sin subagentes.
  }
  const agentes = []
  for (const a of nombres) {
    const filas = filasDe(path.join(carpeta, a))
    const inicio = filas.find((f) => f.timestamp)?.timestamp
    if (!enTramo(inicio)) continue
    let tipo = '?'
    try {
      tipo = rolCorto(JSON.parse(fs.readFileSync(path.join(carpeta, a.replace(/\.jsonl$/, '.meta.json')), 'utf8')).agentType ?? '?')
    } catch {
      // Sin meta: rol desconocido.
    }
    const prompt = textoDe(filas.find((f) => f.type === 'user')?.message?.content)
    const rol = tipo === 'revisor' ? 'final' : tipo
    agentes.push({ id: a.replace(/^agent-/, '').replace(/\.jsonl$/, ''), rol, tipo, prompt, filas, inicio })
  }
  agentes.sort((a, b) => Date.parse(a.inicio) - Date.parse(b.inicio))
  return { sesion, hasta, todas, principal, agentes }
}

/**
 * El consumo del flujo ya leído: `{ inicio, minutos, roles, veredictos }`, con cada rol como `{ pedidos, agentes, tokens }`.
 * Los minutos no cuentan el corte entre sesiones. Va en el campo `costo` de la fila (nombre histórico: ya no trae dólares).
 */
function costoDe({ sesion, hasta, principal, agentes, tramos = [] }) {
  const roles = { orquestador: { ...usoDe(principal), agentes: 0 } }
  const veredictos = {}
  for (const { rol, filas } of agentes) {
    const u = usoDe(filas)
    roles[rol] ??= { pedidos: 0, agentes: 0, tokens: tokensVacios() }
    roles[rol].pedidos += u.pedidos
    for (const k of Object.keys(u.tokens)) roles[rol].tokens[k] += u.tokens[k]
    roles[rol].agentes++
    const vs = informesDe(filas, rol).map((i) => i.veredicto)
    if (vs.length) (veredictos[rol] ??= []).push(...vs)
  }
  return { inicio: sesion.inicio, minutos: Math.max(0, Date.parse(hasta) - Date.parse(sesion.inicio) - corteDe(tramos) * 1000) / 60_000, roles, veredictos }
}

/**
 * Consumo del flujo de `raiz` que empezó en `desde` (con `base`, su BASE_GLOBAL), hasta `hasta`: el hilo principal
 * (orquestador) y cada subagente lanzado en ese tramo, por rol (`final` es la revisión final), con sus veredictos y
 * sus `tokens` (`entrada`, `leidos`, `escritos`, `salida`, `thinking`). null si no se encuentra la sesión.
 */
export function costoDelFlujo(raiz, desde, { proyectos = proyectosDe(), hasta = new Date().toISOString(), base = null, sesiones = [] } = {}) {
  const lectura = leerFlujo(raiz, desde, proyectos, hasta, base, sesiones)
  return lectura ? costoDe(lectura) : null
}

/**
 * Lo gastado en la sesión `archivo` después de `cierre` (la hora del cierre del flujo): el hilo principal y los
 * subagentes desde ahí hasta el siguiente `/impl` de la sesión, o hasta el final. `{ pedidos, tokens }`; null si no se puede leer.
 */
export function fugaDe(archivo, cierre) {
  if (!archivo || !fs.existsSync(archivo)) return null
  const siguiente = comienzosDe(filasDe(archivo)).find((f) => f.timestamp > cierre)?.timestamp
  const { principal, agentes } = leerTramo({ archivo, inicio: cierre }, siguiente ?? '9999-12-31T23:59:59.999Z')
  const usos = [usoDe(principal), ...agentes.map((a) => usoDe(a.filas))]
  const tokens = usos.reduce((s, u) => s + u.tokens.entrada + u.tokens.leidos + u.tokens.escritos + u.tokens.salida, 0)
  return { pedidos: usos.reduce((s, u) => s + u.pedidos, 0), tokens }
}

/** Texto de cada bloque de la fila que sea de ese `tipo`, en orden. */
const bloquesDe = (f, tipo) => (Array.isArray(f?.message?.content) ? f.message.content.filter((c) => c?.type === tipo) : [])

/** Texto del último mensaje del asistente de esas filas (su informe); '' si no hay. */
const ultimoTexto = (filas) => textosDe(filas).at(-1) ?? ''

/**
 * Los ítems entre `PROBLEMAS:` y `OBSERVACIONES:` (o el final) de un informe, de a ≤ 200 caracteres. Cuentan los numerados
 * (`1.` o `1)`); si no hay ninguno, las viñetas (`-`, `*`, `•`) y las líneas `ruta:línea — texto` (con `-`, `–` o `—`).
 * Con numerados presentes solo cuentan esos, para no contar dos veces sus sub-viñetas.
 */
export function problemasDe(texto) {
  const desdeProblemas = /PROBLEMAS:([\s\S]*)/.exec(texto)?.[1] ?? ''
  const cuerpo = desdeProblemas.split(/^[\s*_>`-]*OBSERVACIONES:/m)[0]
  const items = (patron) => [...cuerpo.matchAll(patron)].map((m) => m[1].trim().slice(0, 200)).filter(Boolean)
  const numerados = items(/^\s*\d+[.)]\s*(.+)$/gm)
  if (numerados.length) return numerados
  return items(/^\s*(?:[-*•]\s+|(?=\S+:\d+\S*(?:\s+\+\s+\S+:\d+\S*)*\s+[-–—]\s))(.+)$/gm).filter((t) => !/^ninguno\.?$/i.test(t))
}

/** Prompt de las llamadas al `Agent` (o `Task`) del hilo principal: `[{ prompt, tipo, effort, t }]`. */
function lanzamientosDe(principal) {
  const lanzamientos = []
  for (const f of principal) {
    for (const c of bloquesDe(f, 'tool_use')) {
      if (c.name === 'Agent' || c.name === 'Task') lanzamientos.push({ prompt: String(c.input?.prompt ?? ''), tipo: rolCorto(c.input?.subagent_type), effort: c.input?.effort, t: f.timestamp })
    }
  }
  return lanzamientos
}

/** Si la fila user es un mensaje del humano: no meta, sin resultados de herramienta y sin las notificaciones del sistema. */
const esHumano = (f) => f.type === 'user' && !f.isMeta && !bloquesDe(f, 'tool_result').length && !/^<(?:bash-stdout|bash-stderr|local-command-caveat|task-notification|system-reminder)>/.test(textoDe(f.message?.content).trim())

/**
 * Las esperas por el límite de 5 h de un transcript (`[[desde, hasta]]` en ms): del aviso (una entrada que no sea `user`, para que
 * ni un mensaje del humano ni un resultado de herramienta que lo citen abran una espera, y cuyo texto trae «You've hit your» y
 * «limit») a la primera entrada posterior con «limit has reset». Sin ese reinicio cierra el siguiente mensaje del humano: en el hilo
 * principal, o con `humanos` (sus instantes, en ms) en un subagente, que si no tiene ninguno cierra en su última entrada; sin cierre
 * en el hilo principal, hasta `fin`. Supuesto: el formato real del aviso no está confirmado (LIMITES.md).
 */
function esperasDeLimite(filas, fin, humanos = null) {
  const esperas = []
  let abre = null
  let ultimo = null
  for (const f of filas) {
    const t = Date.parse(f.timestamp)
    if (!Number.isFinite(t)) continue
    ultimo = t
    const texto = textoDe(f.message?.content)
    if (abre !== null && (/limit has reset/i.test(texto) || (humanos === null && esHumano(f)))) {
      esperas.push([abre, t])
      abre = null
    }
    if (abre === null && f.type !== 'user' && /You['’]ve hit your/.test(texto) && /limit/.test(texto)) abre = t
  }
  if (abre !== null) esperas.push([abre, humanos === null ? fin : (humanos.find((h) => h > abre) ?? ultimo)])
  return esperas
}

/**
 * Tiempos del hilo principal en segundos: `fases` (pared de cada paso menos la espera que cae en él), `espera` (lo que
 * tardó el usuario en cada `AskUserQuestion` y en responder tras un turno que el asistente cerró con texto, y lo que duró
 * el límite de 5 h en el hilo o en un subagente, sin contar dos veces lo que se solapa) y `activo` (el total menos la espera).
 * Las marcas de fase son `estado.mjs … --paso n`, el explorador (1) y el AskUserQuestion «Plan» (4).
 */
function tiemposDe(principal, inicio, agentes = []) {
  const t0 = Date.parse(inicio)
  const marcas = []
  const preguntas = new Map()
  const resultados = new Map()
  const esperasTurno = []
  let finTurno = null
  let fin = t0
  for (const f of principal) {
    const t = Date.parse(f.timestamp)
    if (t > fin) fin = t
    if (f.type === 'assistant') {
      if (bloquesDe(f, 'tool_use').length) finTurno = null
      else if (bloquesDe(f, 'text').length) finTurno = t
    } else if (finTurno !== null && esHumano(f)) {
      esperasTurno.push([finTurno, t])
      finTurno = null
    }
    for (const c of bloquesDe(f, 'tool_use')) {
      const paso = c.name === 'Bash' ? /estado\.mjs\b[^\n]*?--paso\s+(\d+)/.exec(String(c.input?.command ?? ''))?.[1] : null
      if (paso) marcas.push({ t, n: paso })
      else if (c.name === 'Agent' || c.name === 'Task') {
        const n = { explorador: '1' }[rolCorto(c.input?.subagent_type)]
        if (n) marcas.push({ t, n })
      } else if (c.name === 'AskUserQuestion') {
        preguntas.set(c.id, t)
        if ((c.input?.questions ?? []).some((q) => q?.header === 'Plan')) marcas.push({ t, n: '4' })
      }
    }
    for (const c of bloquesDe(f, 'tool_result')) resultados.set(c.tool_use_id, t)
  }
  const humanos = principal.filter(esHumano).map((f) => Date.parse(f.timestamp)).filter(Number.isFinite)
  const limite = [...esperasDeLimite(principal, fin), ...agentes.flatMap((a) => esperasDeLimite(a.filas, fin, humanos))].map(([a, b]) => [Math.max(a, t0), Math.min(b, fin)])
  const crudas = [...[...preguntas].map(([id, a]) => [a, Math.min(resultados.get(id) ?? fin, fin)]), ...esperasTurno, ...limite].filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0])
  // Unión de intervalos: el aviso del límite suele cerrar un turno con texto, que `esperasTurno` ya cuenta.
  const esperas = []
  for (const [a, b] of crudas) {
    const u = esperas.at(-1)
    if (u && a <= u[1]) u[1] = Math.max(u[1], b)
    else esperas.push([a, b])
  }
  const tramos = [{ t: t0, n: '0' }, ...marcas.sort((a, b) => a.t - b.t)]
  const fases = {}
  tramos.forEach(({ t, n }, i) => {
    const hasta = tramos[i + 1]?.t ?? fin
    const solape = esperas.reduce((s, [a, b]) => s + Math.max(0, Math.min(b, hasta) - Math.max(a, t)), 0)
    fases[n] = (fases[n] ?? 0) + Math.max(0, hasta - t - solape)
  })
  const espera = esperas.reduce((s, [a, b]) => s + (b - a), 0)
  return {
    fases: Object.fromEntries(Object.entries(fases).map(([n, ms]) => [n, Math.round(ms / 1000)])),
    activo: Math.round((fin - t0 - espera) / 1000),
    espera: Math.round(espera / 1000),
  }
}

/** Subtarea de un despacho de ejecutor: su `SUBTAREA <n>/`, `final` (correcciones de la revisión final) o `?`. */
const claveDe = (prompt) => /^\s*SUBTAREA (\d+)\//m.exec(prompt)?.[1] ?? (/^\s*SUBTAREA:\s*correcciones de la revisión final/mi.test(prompt) ? 'final' : '?')

/** Suma los `tiemposDe` de cada tramo: fases, activo y espera; con más de un tramo agrega `corte` (segundos entre sesiones). */
function tiemposDeTramos(tramos) {
  const partes = tramos.map((t) => tiemposDe(t.principal, t.inicio, t.agentes))
  if (partes.length === 1) return partes[0]
  const fases = {}
  for (const p of partes) for (const [n, s] of Object.entries(p.fases)) fases[n] = (fases[n] ?? 0) + s
  return { fases, activo: partes.reduce((s, p) => s + p.activo, 0), espera: partes.reduce((s, p) => s + p.espera, 0), corte: corteDe(tramos) }
}

/**
 * Los ejecutores del proyecto `raiz` lanzados desde `desde`, de los transcripts de todas sus sesiones, en orden de llegada:
 * `[{ n, estado, correccion, inicio }]` (`n` es la clave de `claveDe`; `estado`, el último `ESTADO:` de su informe o null si no
 * terminó). `estado.mjs` anota así el avance de cada subtarea sin que el orquestador se lo pase.
 */
export function ejecutoresDelProyecto(raiz, desde, proyectos = proyectosDe()) {
  const limite = Date.parse(desde) - 60_000
  const carpeta = carpetaDe(raiz, proyectos)
  let sesiones = []
  try {
    sesiones = fs.readdirSync(carpeta, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => path.join(carpeta, e.name, 'subagents'))
  } catch {
    return []
  }
  const ejecutores = []
  for (const sub of sesiones) {
    let nombres = []
    try {
      nombres = fs.readdirSync(sub).filter((a) => a.endsWith('.jsonl') && fs.statSync(path.join(sub, a)).mtimeMs >= limite)
    } catch {
      continue
    }
    for (const a of nombres) {
      const filas = filasDe(path.join(sub, a))
      const inicio = filas.find((f) => f.timestamp)?.timestamp
      const prompt = textoDe(filas.find((f) => f.type === 'user')?.message?.content)
      if (!inicio || Date.parse(inicio) < Date.parse(desde) || !/^\s*SUBTAREA[ :]/m.test(prompt)) continue
      ejecutores.push({ n: claveDe(prompt), estado: informesDe(filas, 'ejecutor').at(-1)?.veredicto ?? null, correccion: prompt.includes('CORRECCIÓN'), inicio })
    }
  }
  return ejecutores.sort((a, b) => Date.parse(a.inicio) - Date.parse(b.inicio))
}

/** Los ejecutores agrupados por subtarea (`1`, `2`… o `final`): `{ segundos, correcciones, estado, esfuerzo }`. */
function ejecutoresDe(agentes, lanzamientos) {
  const grupos = {}
  for (const a of agentes.filter((x) => x.rol === 'ejecutor')) {
    const g = (grupos[claveDe(a.prompt)] ??= { segundos: 0, correcciones: 0, estado: null, esfuerzo: null, base: null })
    const tiempos = a.filas.map((f) => Date.parse(f.timestamp)).filter(Number.isFinite)
    g.segundos += tiempos.length ? (Math.max(...tiempos) - Math.min(...tiempos)) / 1000 : 0
    if (a.prompt.includes('CORRECCIÓN')) g.correcciones++
    else g.base ??= a.prompt
    g.estado = informesDe(a.filas, 'ejecutor').at(-1)?.veredicto ?? null
  }
  for (const g of Object.values(grupos)) {
    const inicio = g.base?.trim().slice(0, 60)
    const l = inicio ? lanzamientos.find((x) => !x.prompt.includes('CORRECCIÓN') && x.prompt.trim().startsWith(inicio)) : null
    g.esfuerzo = l ? (l.effort ?? 'high') : null
    g.segundos = Math.round(g.segundos)
    delete g.base
  }
  return grupos
}

/** El texto que se escribió tras el `/impl` que abre el flujo en `inicio` (de la skill, la línea `**Pedido:** …`), entero; null si no está. */
function pedidoDe(todas, inicio) {
  const comando = comienzosDe(todas).find((f) => f.timestamp === inicio)
  if (!comando) return null
  const crudo = textoDe(comando.message?.content)
  return esComando(comando) ? (/<command-args>([\s\S]*?)<\/command-args>/.exec(crudo)?.[1] ?? crudo.replace(/<[^>]*>/g, ' ')) : (/\*\*Pedido:\*\*[ \t]*(.*)/.exec(crudo)?.[1] ?? null)
}

/** El pedido literal del flujo de `raiz` que empezó en `desde` (con `base`, su BASE_GLOBAL), leído de su primera sesión; null si no se encuentra. */
export function pedidoDelFlujo(raiz, desde, { proyectos = proyectosDe(), base = null } = {}) {
  const sesion = sesionDelFlujo(raiz, desde, proyectos, base)
  const texto = sesion ? pedidoDe(filasDe(sesion.archivo), sesion.inicio) : null
  return texto?.trim() || null
}

/**
 * Métricas del flujo de `raiz` que empezó en `desde` leídas de sus transcripts: `{ costo, sesion, sesiones, pedido, contexto,
 * tiempos, ejecutores, problemas, alcanceFuera, explorador }`, con el consumo de `costoDelFlujo` y lo demás como lo
 * describen `tiemposDe`, `ejecutoresDe` y `problemasDe`. `pedido` es el texto que se escribió tras `/impl`
 * (≤ 120 caracteres), `contexto` los tokens del primer y del último pedido del hilo principal, `alcanceFuera` las
 * líneas `ALCANCE: FUERA` que vio el orquestador, `explorador.mapa` si algún prompt trajo un `MAPA:` útil y
 * `explorador.agentes` (`[{ id, contexto, lineas }]`: contexto máximo y líneas leídas con Read y Grep de cada uno).
 * null si no se encuentra la sesión.
 */
export function metricasDelFlujo(raiz, desde, { proyectos = proyectosDe(), hasta = new Date().toISOString(), base = null, sesiones = [] } = {}) {
  const lectura = leerFlujo(raiz, desde, proyectos, hasta, base, sesiones)
  if (!lectura) return null
  const { sesion, todas, principal, agentes, tramos, ultima } = lectura
  const bruto = pedidoDe(todas, sesion.inicio)
  const pedido = bruto === null ? null : bruto.replace(/\s+/g, ' ').trim().slice(0, 120) || null
  const mensajes = [...mensajesDe(principal).values()]
  const contextoDe = (m) => (m ? (m.uso?.input_tokens ?? 0) + (m.uso?.cache_read_input_tokens ?? 0) + (m.uso?.cache_creation_input_tokens ?? 0) : null)
  // Una entrada por informe con veredicto; sin ninguno, la única de siempre.
  const informes = (a) => {
    const is = informesDe(a.filas, a.rol)
    return is.length ? is.map((i) => ({ veredicto: i.veredicto, items: problemasDe(i.texto) })) : [{ veredicto: null, items: problemasDe(ultimoTexto(a.filas)) }]
  }
  const exploradores = agentes.filter((a) => a.rol === 'explorador')
  // El transcript puede repetir un mismo bloque en varias filas: cada tool_use y cada tool_result cuentan una vez.
  const herramientasDe = (nombre) => exploradores.reduce((s, a) => s + new Set(a.filas.flatMap((f) => bloquesDe(f, 'tool_use')).filter((c) => c.name === nombre).map((c) => c.id)).size, 0)
  // Líneas de los resultados de Read y Grep, sin los `<system-reminder>` que el harness pega al final.
  const lineasLeidas = (filas) => {
    const lectores = new Set(filas.flatMap((f) => bloquesDe(f, 'tool_use')).filter((c) => c.name === 'Read' || c.name === 'Grep').map((c) => c.id))
    let n = 0
    for (const f of filas) {
      for (const c of bloquesDe(f, 'tool_result')) {
        if (!lectores.delete(c.tool_use_id)) continue
        const t = textoDe(c.content).replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim()
        if (t) n += t.split('\n').length
      }
    }
    return n
  }
  const alcanceFuera = []
  for (const f of principal) {
    for (const c of bloquesDe(f, 'tool_result')) alcanceFuera.push(...(textoDe(c.content).match(/^ALCANCE: FUERA[^\n]*/gm) ?? []))
  }
  return {
    costo: costoDe(lectura),
    // La última sesión: `--fuga` mide lo gastado en ella después del cierre.
    sesion: ultima,
    sesiones: tramos.length,
    pedido,
    contexto: { primero: contextoDe(mensajes[0]), ultimo: contextoDe(mensajes.at(-1)) },
    tiempos: tiemposDeTramos(tramos),
    ejecutores: ejecutoresDe(agentes, lanzamientosDe(principal)),
    problemas: { final: agentes.filter((a) => a.rol === 'final').flatMap(informes) },
    alcanceFuera,
    explorador: {
      pedidos: exploradores.reduce((s, a) => s + usoDe(a.filas).pedidos, 0),
      glob: herramientasDe('Glob'),
      read: herramientasDe('Read'),
      mapa: exploradores.some((a) => /^MAPA:[ \t]*(?!ninguno)\S/im.test(a.prompt)),
      agentes: exploradores.map((a) => ({ id: a.id, contexto: Math.max(0, ...[...mensajesDe(a.filas).values()].map(contextoDe)), lineas: lineasLeidas(a.filas) })),
    },
  }
}

/** Cifra de tokens abreviada: «950», «844k», «12,4M». */
const abreviar = (n) => (n < 1000 ? String(n) : n < 999_500 ? `${Math.round(n / 1000)}k` : `${decimal(n / 1e6)}M`)

/** Total de un `tokens` (entrada, leídos, escritos y salida; el thinking ya va dentro de la salida). */
const totalDe = (t) => (t?.entrada ?? 0) + (t?.leidos ?? 0) + (t?.escritos ?? 0) + (t?.salida ?? 0)

/**
 * «12,4M tokens (91 % caché) · sal 844k» con los tokens de todos los roles, o '' si no hay (los flujos viejos no los
 * anotaban). La caché es lo leído sobre todo el prompt (entrada + leídos + escritos); `sal` es la salida, que ya
 * incluye el thinking (`output_tokens` lo cuenta).
 */
function tokensDeCosto(roles) {
  const t = { entrada: 0, leidos: 0, escritos: 0, salida: 0 }
  for (const r of Object.values(roles)) for (const k of Object.keys(t)) t[k] += r.tokens?.[k] ?? 0
  const prompt = t.entrada + t.leidos + t.escritos
  const total = prompt + t.salida
  if (!total) return ''
  return `${abreviar(total)} tokens${prompt ? ` (${Math.round((t.leidos / prompt) * 100)} % caché)` : ''} · sal ${abreviar(t.salida)}`
}

/** «9,6 min · 12,4M tokens (91 % caché) · sal 844k · ejecutor 8,1M tok (×2, 20 pedidos) · orquestador 4,3M tok (10 pedidos) · …», con los roles de más a menos tokens. */
export function resumenDeCosto(c) {
  const partes = Object.entries(c.roles)
    .filter(([, r]) => r.pedidos > 0)
    .sort((a, b) => totalDe(b[1].tokens) - totalDe(a[1].tokens))
    .map(([rol, r]) => `${rol}${totalDe(r.tokens) ? ` ${abreviar(totalDe(r.tokens))} tok` : ''} (${r.agentes > 1 ? `×${r.agentes}, ` : ''}${r.pedidos} ${r.pedidos === 1 ? 'pedido' : 'pedidos'})`)
  const tokens = tokensDeCosto(c.roles)
  return `${decimal(c.minutos)} min${tokens ? ` · ${tokens}` : ''}${partes.length ? ` · ${partes.join(' · ')}` : ' · sin pedidos'}`
}

/** «ejecutor HECHO, HECHO · final RECHAZADO, APROBADO», o «ninguno». */
export function resumenDeVeredictos(c) {
  const partes = Object.entries(c.veredictos).map(([rol, vs]) => `${rol} ${vs.join(', ')}`)
  return partes.length ? partes.join(' · ') : 'ninguno'
}

/** «CRÍTICO (#1, #5)» o «sin criterios», sin la explicación que sigue. */
const clasificacionCorta = (texto) => /^(CRÍTICO(?:\s*\([^)]*\))?|sin criterios)/i.exec(String(texto ?? '').trim())?.[1] ?? String(texto ?? '').slice(0, 30)

/** Cuántas subtareas anotó el flujo: un número (v1) o el largo de la lista (v2). */
const subtareasDe = (f) => (Array.isArray(f.subtareas) ? f.subtareas.length : f.subtareas)

const fechaDe = (f) => String(f.t).slice(0, 16).replace('T', ' ')

/** `--anotar <t> "<texto>"`: agrega un defecto al flujo cuyo `t` empieza con `<t>` (con espacio o `T`); exit 2 si no es uno solo. */
function anotarDefecto(archivo, prefijo, texto) {
  const buscado = String(prefijo ?? '').trim().replace(' ', 'T')
  const textoLimpio = String(texto ?? '').trim()
  if (!buscado || !textoLimpio) {
    console.log('ERROR: uso: costos.mjs --anotar <t> "<texto>" (t es el comienzo de la fecha de un flujo, p. ej. 2026-10-18T09:30)')
    process.exitCode = 2
    return
  }
  const coinciden = filasDe(archivo).filter((f) => f && !f.tipo && f.t && String(f.t).startsWith(buscado))
  if (coinciden.length !== 1) {
    console.log(coinciden.length ? `ERROR: «${prefijo}» coincide con ${coinciden.length} flujos (${coinciden.map(fechaDe).join(', ')}); da más dígitos` : `ERROR: ningún flujo de ${archivo} empieza con «${prefijo}»`)
    process.exitCode = 2
    return
  }
  const fila = { v: 2, tipo: 'defecto', flujo: coinciden[0].t, texto: textoLimpio, t: new Date().toISOString() }
  fs.mkdirSync(path.dirname(archivo), { recursive: true })
  fs.appendFileSync(archivo, JSON.stringify(fila) + '\n')
  console.log(`ANOTADO: defecto en el flujo ${fechaDe(coinciden[0])}: ${textoLimpio}`)
}

/** `--fuga`: lo que se gastó en la sesión de cada flujo v2 después de su cierre, hasta el siguiente `/impl`. */
function fuga(flujos, n) {
  const conSesion = flujos.filter((f) => f.v === 2 && f.sesion && f.t).slice(-n)
  if (!conSesion.length) {
    console.log('FUGA: no hay flujos v2 con sesión anotada')
    return
  }
  for (const f of conSesion) {
    const gasto = fugaDe(f.sesion, f.t)
    const proyecto = path.basename(String(f.raiz ?? '?'))
    console.log(gasto ? `FUGA: ${fechaDe(f)} · ${proyecto} · ${gasto.pedidos} pedidos · ${abreviar(gasto.tokens)} tokens después del cierre` : `FUGA: ${fechaDe(f)} · ${proyecto} · no se pudo leer la sesión ${f.sesion}`)
  }
}

function main() {
  const args = process.argv.slice(2)
  const valor = (nombre) => {
    const k = args.indexOf(nombre)
    return k >= 0 ? args[k + 1] : undefined
  }
  const n = Math.max(1, Number(valor('--ultimos') ?? 10) || 10)
  const archivo = valor('--archivo') ?? path.join(carpetaGlobal(), 'flujos.jsonl')
  if (args.includes('--anotar')) {
    const texto = args[args.indexOf('--anotar') + 2]
    anotarDefecto(archivo, valor('--anotar'), ['--archivo', '--ultimos'].includes(texto) ? undefined : texto)
    return
  }
  const todas = filasDe(archivo)
  if (args.includes('--fuga')) {
    fuga(todas.filter((f) => f && !f.tipo), n)
    return
  }
  const flujos = todas.filter((f) => f?.costo && !f.tipo)
  if (!flujos.length) {
    console.log(`FLUJOS: no hay flujos con consumo en ${archivo}`)
    return
  }
  const ultimos = flujos.slice(-n)
  console.log(`FLUJOS (últimos ${ultimos.length} de ${flujos.length}):`)
  for (const f of ultimos) {
    const datos = [f.clasificacion && clasificacionCorta(f.clasificacion), subtareasDe(f) && `${subtareasDe(f)} subtarea(s)`].filter(Boolean).join(' · ')
    const defectos = f.v === 2 ? todas.filter((d) => d?.tipo === 'defecto' && d.flujo === f.t).length : 0
    const v2 = f.v === 2 ? `${f.resultado ? ` · ${f.resultado}` : ''}${defectos ? ` · defectos: ${defectos}` : ''}` : ''
    console.log(`  ${fechaDe(f)} · ${path.basename(String(f.raiz ?? '?'))} · ${resumenDeCosto(f.costo)} · ${resumenDeLimites(f.limites)}${datos ? ` · ${datos}` : ''} · ${resumenDeVeredictos(f.costo)}${v2}`)
    // Las filas sin lecturas por fase (las de antes de la 0.5.1) no imprimen nada más.
    const fases = Array.isArray(f.limites?.fases) ? f.limites.fases.filter((x) => typeof x?.fase === 'string') : []
    if (fases.length) console.log(`    por fase: ${resumenDeFases(fases)}`)
  }
  const promedio = (valorDe) => ultimos.reduce((s, f) => s + valorDe(f), 0) / ultimos.length
  // El promedio de cada ventana, solo de los flujos con su gasto completo.
  const medias = [['5h', 'five_hour'], ['sem', 'seven_day']].map(([nombre, k]) => {
    const conDato = ultimos.map((f) => f.limites?.[k]).filter((v) => typeof v?.gasto === 'number' && !v.incompleto)
    return `${nombre} ${conDato.length ? `+${decimal(conDato.reduce((s, v) => s + v.gasto, 0) / conDato.length)} % (${conDato.length})` : 's/d'}`
  })
  console.log(`PROMEDIO: ${decimal(promedio((f) => f.costo.minutos))} min · orquestador ${decimal(promedio((f) => f.costo.roles.orquestador?.pedidos ?? 0))} pedidos · ${medias.join(' · ')}`)
}

function esPrincipal() {
  if (!process.argv[1]) return false
  const a = path.resolve(process.argv[1])
  const b = fileURLToPath(import.meta.url)
  return WIN ? a.toLowerCase() === b.toLowerCase() : a === b
}

if (esPrincipal()) main()
