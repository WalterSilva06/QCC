// Costo real de una corrida de /odd, leído de los transcripts de Claude Code.
//
// La sesión es la que recibió `ODD_BASE=<sha>` de `odd.mjs --inicio`; el tramo va desde el `/odd`
// anterior a esa marca (o desde la marca, si no se encuentra) hasta el cierre. Suma el hilo principal (orquestador)
// y cada subagente que empezó en el tramo, por rol (`qcc-odd-` quitado), con el veredicto de su último informe.
//
// También guarda los tokens por rol y, de cada informe del revisor, cuántos PROBLEMAS y OBSERVACIONES trajo. Da además
// el contexto actual del orquestador (`contextoActual`) y el fin real de una corrida, con el reporte (`finDeCorrida`).
//
// Precios por millón de tokens de la página oficial de Anthropic (octubre de 2026): entrada, salida, lectura de
// caché y escritura de caché de 5 min y de 1 h. El hilo principal escribe con 1 h; los subagentes, con 5 min.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const PRECIOS = {
  'claude-opus-5-5': { entrada: 4, salida: 20, lectura: 0.2, escritura5m: 5, escritura1h: 8 },
  'claude-sonnet-5-5': { entrada: 2, salida: 10, lectura: 0.1, escritura5m: 2.5, escritura1h: 4 },
  'claude-haiku-5-5': { entrada: 0.1, salida: 0.5, lectura: 0.01, escritura5m: 0.125, escritura1h: 0.2 },
}
// Haiku 5.5 cobra más con prompts de más de 100.000 tokens.
const HAIKU_LARGO = { entrada: 0.5, salida: 2.5, lectura: 0.05, escritura5m: 0.625, escritura1h: 1 }
const VEREDICTO_POR_ROL = { revisor: 'VEREDICTO', ejecutor: 'ESTADO' }
const COMANDO = /<command-name>\/(?:[\w-]+:)?odd</

export const proyectosDe = () => path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'projects')
export const dolares = (n) => `$${n.toFixed(2).replace('.', ',')}`
export const textoDe = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((x) => (x?.type === 'text' ? x.text : typeof x?.content === 'string' ? x.content : textoDe(x?.content))).join('') : '')

/** Precio por millón del modelo (id con o sin sufijos), según el tamaño del prompt; null si no se conoce. */
export function precioDe(modelo, prompt = 0) {
  const clave = Object.keys(PRECIOS).find((k) => String(modelo ?? '').startsWith(k))
  if (!clave) return null
  return clave === 'claude-haiku-5-5' && prompt > 100_000 ? HAIKU_LARGO : PRECIOS[clave]
}

/** Costo en USD de un pedido según su `usage`; null si el modelo no tiene precio. */
export function costoDePedido(uso, modelo) {
  const u = uso ?? {}
  const prompt = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0)
  const p = precioDe(modelo, prompt)
  if (!p) return null
  const w1h = u.cache_creation?.ephemeral_1h_input_tokens ?? 0
  const w5m = u.cache_creation ? (u.cache_creation.ephemeral_5m_input_tokens ?? 0) : (u.cache_creation_input_tokens ?? 0)
  return ((u.input_tokens ?? 0) * p.entrada + (u.cache_read_input_tokens ?? 0) * p.lectura + w5m * p.escritura5m + w1h * p.escritura1h + (u.output_tokens ?? 0) * p.salida) / 1e6
}

/** Las filas de un transcript `.jsonl`; [] si no se puede leer. Una línea cortada se ignora. */
export function filasDe(archivo) {
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

const sinTokens = () => ({ entrada: 0, leidos: 0, escritos: 0, salida: 0 })

/** Suma los tokens de `b` a `a` y devuelve `a`. */
function sumarTokens(a, b) {
  for (const k of Object.keys(a)) a[k] += b?.[k] ?? 0
  return a
}

/**
 * Pedidos al modelo de esas filas, cada mensaje una vez y con su uso final: `{ pedidos, usd, sinPrecio, tokens }`, con
 * `tokens` como `{ entrada, leidos, escritos, salida }` (leídos y escritos son de caché).
 */
export function usoDe(filas) {
  const porMensaje = new Map()
  for (const f of filas) {
    const m = f?.type === 'assistant' ? f.message : null
    if (!m?.id) continue
    const previo = porMensaje.get(m.id)
    if (!previo || (m.usage?.output_tokens ?? 0) >= (previo.uso?.output_tokens ?? 0)) porMensaje.set(m.id, { uso: m.usage, modelo: m.model })
  }
  let usd = 0
  let sinPrecio = 0
  const tokens = sinTokens()
  for (const { uso, modelo } of porMensaje.values()) {
    const c = costoDePedido(uso, modelo)
    if (c === null) sinPrecio++
    else usd += c
    sumarTokens(tokens, { entrada: uso?.input_tokens, leidos: uso?.cache_read_input_tokens, escritos: uso?.cache_creation_input_tokens, salida: uso?.output_tokens })
  }
  return { pedidos: porMensaje.size, usd, sinPrecio, tokens }
}

/** La sesión de `raiz` que recibió `ODD_BASE=<base>`: `{ archivo, inicio }`, o null. */
export function sesionDe(raiz, base, proyectos = proyectosDe()) {
  const carpeta = path.join(proyectos, path.resolve(raiz).replace(/[^a-zA-Z0-9]/g, '-'))
  let archivos = []
  try {
    archivos = fs.readdirSync(carpeta).filter((a) => a.endsWith('.jsonl')).map((a) => path.join(carpeta, a))
  } catch {
    return null
  }
  const marca = `ODD_BASE=${base}`
  for (const archivo of archivos.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)) {
    let texto = ''
    try {
      texto = fs.readFileSync(archivo, 'utf8')
    } catch {
      continue
    }
    if (!texto.includes(marca)) continue
    const filas = filasDe(archivo)
    const k = filas.findIndex((f) => !f.isSidechain && JSON.stringify(f?.message?.content ?? '').includes(marca))
    if (k < 0) continue
    const comando = filas.slice(0, k).reverse().find((f) => f?.type === 'user' && !f.isSidechain && f.timestamp && COMANDO.test(textoDe(f.message?.content)))
    return { archivo, inicio: comando?.timestamp ?? filas[k].timestamp }
  }
  return null
}

/** Tokens del prompt de un pedido: el tamaño del contexto en ese momento. */
export const contextoDePedido = (uso) => (uso?.input_tokens ?? 0) + (uso?.cache_read_input_tokens ?? 0) + (uso?.cache_creation_input_tokens ?? 0)

/** Contexto del último pedido del orquestador (sin subagentes) en la sesión de `ODD_BASE`; null si no hay datos. */
export function contextoActual(raiz, base, { proyectos = proyectosDe(), sesion = sesionDe(raiz, base, proyectos) } = {}) {
  if (!sesion) return null
  const ultimo = filasDe(sesion.archivo).filter((f) => f?.type === 'assistant' && !f.isSidechain && f.message?.usage).at(-1)
  return ultimo ? contextoDePedido(ultimo.message.usage) : null
}

/**
 * Hasta cuándo va una corrida que cerró en `t`: el último pedido del orquestador antes del siguiente mensaje del
 * usuario, o el último de la sesión. Así el costo incluye el pedido que llamó a `--cierre` y el reporte. `t` si no hay.
 */
export function finDeCorrida(archivo, t) {
  let fin = null
  for (const f of filasDe(archivo)) {
    if (f.isSidechain || !f.timestamp || f.timestamp <= t) continue
    const contenido = f.message?.content
    const delUsuario = f.type === 'user' && !f.isMeta && (typeof contenido === 'string' || (Array.isArray(contenido) && contenido.some((c) => c?.type === 'text')))
    if (delUsuario) break
    if (f.type === 'assistant' && (!fin || f.timestamp > fin)) fin = f.timestamp
  }
  return fin ?? t
}

/** Texto del último informe del agente. */
function ultimoInformeDe(filas) {
  const textos = filas.filter((f) => f?.type === 'assistant').flatMap((f) => (f.message?.content ?? []).filter((c) => c?.type === 'text').map((c) => c.text))
  return textos.at(-1) ?? ''
}

/** Veredicto del último informe del agente (`APROBADO`, `HECHO`…); null si su rol no da uno o no lo trae. */
function veredictoDe(filas, rol) {
  const campo = VEREDICTO_POR_ROL[rol]
  if (!campo) return null
  return new RegExp(`^[\\s*_>\`-]*${campo}:\\s*\\**\\s*([A-ZÁÉÍÓÚ]+)`, 'm').exec(ultimoInformeDe(filas))?.[1] ?? null
}

/**
 * Cuántos PROBLEMAS y OBSERVACIONES trae un informe del revisor: `{ problemas, observaciones }`. Cuenta las líneas no
 * vacías de cada sección, o el texto en la misma línea del campo; «ninguna» y el texto «(solo si…)» no cuentan.
 */
export function hallazgosDe(informe) {
  const cuenta = { problemas: 0, observaciones: 0 }
  let seccion = null
  for (const linea of String(informe).split('\n')) {
    // Un campo va al principio de la línea, no en un ítem «- …», y no es una unidad de Windows (`D:/…`).
    const campo = /^[\s*_>]*([A-ZÁÉÍÓÚ#]{2,}):(?![\\/])\**\s*(.*)$/.exec(linea)
    if (campo) seccion = { PROBLEMAS: 'problemas', OBSERVACIONES: 'observaciones' }[campo[1]] ?? null
    if (!seccion) continue
    const texto = (campo ? campo[2] : linea).replace(/^[\s*\-\d.)]+/, '').trim()
    // Una línea en blanco tras algún ítem cierra la sección: lo que sigue es prosa, no hallazgos.
    if (!texto && !campo && cuenta[seccion]) seccion = null
    else if (texto && !/^(ningun[oa]s?|\(solo si[^)]*\)[^\w]*)\.?$/i.test(texto)) cuenta[seccion]++
  }
  return cuenta
}

/**
 * Costo de la corrida de `raiz` con BASE `base`, hasta `hasta`: `{ inicio, minutos, usd, tokens, roles, veredictos,
 * hallazgos }`, con `roles` como `{ rol: { pedidos, usd, agentes, tokens } }` y `hallazgos` como `{ revisor: [{ problemas,
 * observaciones }] }`, uno por informe del revisor, en el orden en que empezaron. null si no se encuentra la sesión.
 * `sesion` (`{ archivo, inicio }`) evita buscarla otra vez.
 */
export function costoDelFlujo(raiz, base, { proyectos = proyectosDe(), hasta = new Date().toISOString(), sesion = sesionDe(raiz, base, proyectos) } = {}) {
  if (!sesion) return null
  const enTramo = (t) => t && t >= sesion.inicio && t <= hasta
  const principal = usoDe(filasDe(sesion.archivo).filter((f) => !f.isSidechain && enTramo(f.timestamp)))
  const roles = { orquestador: { pedidos: principal.pedidos, usd: principal.usd, agentes: 0, tokens: principal.tokens } }
  const veredictos = {}
  const hallazgos = {}
  let sinPrecio = principal.sinPrecio
  const carpeta = path.join(path.dirname(sesion.archivo), path.basename(sesion.archivo, '.jsonl'), 'subagents')
  let agentes = []
  try {
    agentes = fs.readdirSync(carpeta).filter((a) => a.endsWith('.jsonl')).map((a) => {
      const filas = filasDe(path.join(carpeta, a))
      return { a, filas, desde: filas.find((f) => f.timestamp)?.timestamp }
    })
  } catch {
    // Sin subagentes.
  }
  // Por la hora de su primer pedido, no por el nombre del archivo: los hallazgos quedan en el orden real.
  agentes.sort((x, y) => String(x.desde ?? '').localeCompare(String(y.desde ?? '')))
  for (const { a, filas, desde } of agentes) {
    if (!enTramo(desde)) continue
    let rol = '?'
    try {
      rol = String(JSON.parse(fs.readFileSync(path.join(carpeta, a.replace(/\.jsonl$/, '.meta.json')), 'utf8')).agentType ?? '?').replace(/^(?:[^:]+:)?qcc-odd-/, '')
    } catch {
      // Sin meta: rol desconocido.
    }
    const u = usoDe(filas)
    roles[rol] ??= { pedidos: 0, usd: 0, agentes: 0, tokens: sinTokens() }
    roles[rol].pedidos += u.pedidos
    roles[rol].usd += u.usd
    roles[rol].agentes++
    sumarTokens(roles[rol].tokens, u.tokens)
    sinPrecio += u.sinPrecio
    const v = veredictoDe(filas, rol)
    if (v) (veredictos[rol] ??= []).push(v)
    if (rol === 'revisor') (hallazgos[rol] ??= []).push(hallazgosDe(ultimoInformeDe(filas)))
  }
  const usd = Object.values(roles).reduce((s, r) => s + r.usd, 0)
  const tokens = Object.values(roles).reduce((s, r) => sumarTokens(s, r.tokens), sinTokens())
  const minutos = Math.max(0, Date.parse(hasta) - Date.parse(sesion.inicio)) / 60_000
  return { inicio: sesion.inicio, minutos, usd, tokens, roles, veredictos, hallazgos, ...(sinPrecio ? { sinPrecio } : {}) }
}

/** «262k» o «1,8k»: tokens en miles. */
export const miles = (n) => (n >= 10_000 ? `${Math.round(n / 1000)}k` : `${(n / 1000).toFixed(1).replace('.', ',')}k`)

/** «262k leídos · 19k escritos · 1,8k salida»; sin la entrada sin caché, que es casi siempre ínfima. */
export const resumenDeTokens = (t) => `${miles(t.leidos)} leídos · ${miles(t.escritos)} escritos · ${miles(t.salida)} salida`

/**
 * «$0,42 · 6,1 min · orquestador $0,30 (12 pedidos) · revisor $0,12». Con `alCierre` (el costo anotado por `--cierre`),
 * `c` es el real: «$0,44 real · $0,42 al cierre · …».
 */
export function resumenDeCosto(c, alCierre = null) {
  const partes = Object.entries(c.roles)
    .filter(([, r]) => r.pedidos > 0)
    .sort((a, b) => b[1].usd - a[1].usd)
    .map(([rol, r]) => `${rol} ${dolares(r.usd)}${rol === 'orquestador' ? ` (${r.pedidos} pedidos)` : r.agentes > 1 ? ` (×${r.agentes})` : ''}`)
  return `${dolares(c.usd)}${alCierre === null ? '' : ` real · ${dolares(alCierre)} al cierre`} · ${c.minutos.toFixed(1).replace('.', ',')} min${partes.length ? ` · ${partes.join(' · ')}` : ''}${c.sinPrecio ? ` · ${c.sinPrecio} pedido(s) sin precio` : ''}`
}
