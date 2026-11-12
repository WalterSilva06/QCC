// Base compartida de estado.mjs: constantes, git y fotos, la carpeta del flujo y su estado.json, límites, la verificación inicial y los transcripts.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync, spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { registroDe, flujoDe, carpetaGlobal, arbolDe, coincide, relativaAlRepo, rutaNativa, RAIZ } from './guardia.mjs'
import { vivo } from './verificar.mjs'
import { leerLimites } from './costos.mjs'

const CLAUDE = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')

export const AGENTES = path.join(CLAUDE, 'agents')

export const WIN = process.platform === 'win32'

export const TOPE_DIFF = 1000

export const TOPE_SUCIOS = 30

export const TOPE_CAMBIOS = 20

const TOPE_GRUPOS = 15

export const TOPE_MAPA = 300

export const TOPE_NOMBRES = 25

export const TOPE_REVERSION = 10

const ABIERTO_MIN = 20

// Con el plan ya guardado, el flujo puede pasar horas esperando la aprobación sin actividad.
const ABIERTO_CON_PLAN_MIN = 6 * 60

// Tope de la espera a la verificación inicial en segundo plano (verificar.mjs espera igual).
const ESPERA_INICIAL_SEG = 570

const VERIFICAR = fileURLToPath(new URL('./verificar.mjs', import.meta.url))

export const EDICIONES = new Set(['Edit', 'Write', 'NotebookEdit', 'MultiEdit'])

// ── Permitidos ──────────────────────────────────────────────────────────────

/**
 * `"a.ts, src/routeTree.gen.ts (generado) ,b/*.ts"` → `['a.ts', 'src/routeTree.gen.ts', 'b/*.ts']`.
 * Solo parte en las comas fuera de paréntesis: `"src/a.ts (nuevo, sin 'use server')"` es una sola ruta, `src/a.ts`.
 * Una ruta absoluta dentro del repo pasa a relativa; una de fuera queda tal cual (y caerá fuera de alcance).
 */
export function listaPermitidos(texto) {
  const partes = ['']
  let profundidad = 0
  for (const c of String(texto ?? '')) {
    if (c === '(') profundidad++
    else if (c === ')') profundidad = Math.max(0, profundidad - 1)
    if (c === ',' && profundidad === 0) partes.push('')
    else partes[partes.length - 1] += c
  }
  return partes
    .map((s) => s.replace(/\s*\([^)]*\)\s*$/, '').trim().replace(/\\/g, '/').replace(/^\.\//, ''))
    .filter(Boolean)
    .map((p) => {
      const nativa = rutaNativa(p)
      return path.isAbsolute(nativa) ? (relativaAlRepo(path.resolve(nativa), RAIZ) ?? p) : p
    })
}

/** ¿La ruta cambiada cae dentro del alcance? Sin lista de permitidos, todo cae. */
export function enAlcance(ruta, permitidos) {
  return !permitidos.length || coincide(ruta, permitidos)
}

// ── Git ─────────────────────────────────────────────────────────────────────

export function git(args, { env, opcional = false } = {}) {
  try {
    return execFileSync('git', args, {
      cwd: RAIZ,
      encoding: 'utf8',
      env: env ?? process.env,
      maxBuffer: 256 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
  } catch (e) {
    if (opcional) return null
    throw new Error(`git ${args.join(' ')}: ${String(e.stderr || e.message).trim()}`)
  }
}

export const corto = (sha) => String(sha).slice(0, 9)

/** Foto del árbol actual como commit suelto. `forzar`: rutas permitidas que git ignora. */
export function foto(forzar = []) {
  const arbol = arbolDe(RAIZ, forzar)
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: 'qcc-implementador',
    GIT_AUTHOR_EMAIL: 'qcc-implementador@local',
    GIT_COMMITTER_NAME: 'qcc-implementador',
    GIT_COMMITTER_EMAIL: 'qcc-implementador@local',
  }
  const head = git(['rev-parse', '--verify', '-q', 'HEAD'], { opcional: true })?.trim()
  return git(['commit-tree', arbol, ...(head ? ['-p', head] : []), '-m', 'qcc-implementador: foto del árbol'], { env }).trim()
}

export function exigirBase(base) {
  if (!base || base.startsWith('--')) throw new Error('falta la BASE')
  if (git(['cat-file', '-e', `${base}^{commit}`], { opcional: true }) === null) throw new Error(`BASE desconocida: ${base}`)
  return base
}

export function leerRegistro(desde) {
  const filas = []
  const registro = registroDe(RAIZ)
  for (const archivo of [registro.replace(/\.jsonl$/, '.1.jsonl'), registro]) {
    let texto
    try {
      texto = fs.readFileSync(archivo, 'utf8')
    } catch {
      continue
    }
    for (const linea of texto.split('\n')) {
      if (!linea.trim()) continue
      try {
        const fila = JSON.parse(linea)
        if (fila.t && fila.t >= desde) filas.push(fila)
      } catch {
        // Línea cortada: se ignora.
      }
    }
  }
  return filas
}

// ── Flujo en curso ──────────────────────────────────────────────────────────

export const FLUJO = flujoDe(RAIZ)

const ESTADO = path.join(FLUJO, 'estado.json')

export const leerTexto = (archivo) => {
  try {
    return fs.readFileSync(archivo, 'utf8')
  } catch {
    return null
  }
}

/** Estado del flujo en curso; `{}` si no hay o está roto. */
export function leerEstado() {
  try {
    const e = JSON.parse(fs.readFileSync(ESTADO, 'utf8'))
    return e && typeof e === 'object' && !Array.isArray(e) ? e : {}
  } catch {
    return {}
  }
}

/** Mezcla `cambio` en el estado del flujo. Nunca rompe el comando que lo llama: el estado solo sirve para retomar el hilo. */
export function anotarEstado(cambio) {
  try {
    fs.mkdirSync(FLUJO, { recursive: true })
    fs.writeFileSync(ESTADO, JSON.stringify({ ...leerEstado(), ...cambio }, null, 2) + '\n')
  } catch {
    // Sin estado el flujo sigue igual.
  }
}

/** Las fotos por subtarea (`--base --sub`) del estado: `{ "<n>": { base, desde } }`, sin las entradas rotas. */
export function basesDe(estado) {
  const crudas = estado.bases && typeof estado.bases === 'object' && !Array.isArray(estado.bases) ? estado.bases : {}
  return Object.fromEntries(Object.entries(crudas).filter(([, f]) => f && typeof f.base === 'string' && f.base && typeof f.desde === 'string' && f.desde))
}

/** Las sesiones del flujo (`[{ id?, transcript?, desde }]`): la del preflight y una por cada `--reanudar`; vacía en un flujo viejo. */
export function sesionesDe(estado) {
  return (Array.isArray(estado.sesiones) ? estado.sesiones : []).filter((s) => s && Number.isFinite(Date.parse(s.desde)))
}

/** La sesión de Claude Code que corre este comando (`CLAUDE_CODE_SESSION_ID`), con su transcript si existe: `{ id?, transcript?, desde }`. */
export function sesionActual(desde) {
  const id = /^[\w-]+$/.test(process.env.CLAUDE_CODE_SESSION_ID ?? '') ? process.env.CLAUDE_CODE_SESSION_ID : undefined
  if (!id) return { desde }
  const transcript = path.join(CLAUDE, 'projects', RAIZ.replace(/[^a-zA-Z0-9]/g, '-'), `${id}.jsonl`)
  return { id, ...(fs.existsSync(transcript) ? { transcript } : {}), desde }
}

/** Los tramos de límites del flujo (`[{ inicio, fin? }]`, uno por sesión), sin las entradas rotas; vacía en un flujo viejo. */
export const tramosDeLimites = (estado) => (Array.isArray(estado.limites) ? estado.limites : []).filter((t) => t && typeof t === 'object')

/** Un tramo de límites nuevo (preflight o `--reanudar` en otra sesión): su lectura inicial, que es también la primera por fase, la de `paso`. */
export function tramoNuevo(paso) {
  const inicio = leerLimites()
  return { inicio, fases: [{ paso, ...inicio }] }
}

/**
 * Pone `lectura` como la lectura final del último tramo de límites del flujo abierto, si trae dato y cambió. Así un tramo
 * cortado (sesión cerrada, límite de uso) conserva lo último visto. Si `paso` (0–6) no es el de la última lectura por fase
 * del tramo, la suma a `fases`, también sin dato (deja `s/d` las fases que toca, ver LIMITES.md); el 7 no abre fase: lo
 * cierra el `fin`. Un tramo sin `fases` (flujo de antes de la 0.5.1) no las empieza a mitad. Nunca rompe el comando.
 */
export function anotarLimites(paso, lectura = leerLimites()) {
  const e = leerEstado()
  const tramos = tramosDeLimites(e)
  if (!e.base_global || e.cierre || !tramos.length) return
  const ultimo = tramos.at(-1)
  const fases = Array.isArray(ultimo.fases) ? ultimo.fases : null
  const nueva = Boolean(fases) && paso !== null && paso < 7 && fases.at(-1)?.paso !== paso
  const fin = ultimo.fin
  const igual = Boolean(lectura.sinDato) || (fin && ['five_hour', 'seven_day'].every((k) => fin[k]?.pct === lectura[k]?.pct && fin[k]?.resetsAt === lectura[k]?.resetsAt))
  if (nueva || !igual) anotarEstado({ limites: [...tramos.slice(0, -1), { ...ultimo, ...(igual ? {} : { fin: lectura }), ...(nueva ? { fases: [...fases, { paso, ...lectura }] } : {}) }] })
}

/** Estados de una subtarea que ya no se despacha. */
export const TERMINADA = new Set(['HECHO', 'OMITIDA'])

/** El tramo de `texto` desde la línea que empieza con `desde` (incluida) hasta la primera que empiece con algo de `hasta`; '' si no está. */
export function seccionDe(texto, desde, hasta) {
  const lineas = String(texto ?? '').split('\n')
  const k = lineas.findIndex((l) => l.replace(/^[\s*_]+/, '').startsWith(desde))
  if (k < 0) return ''
  const fin = lineas.findIndex((l, i) => i > k && hasta.some((h) => l.replace(/^[\s*_]+/, '').startsWith(h)))
  return lineas.slice(k, fin < 0 ? undefined : fin).join('\n').trim()
}

/** El avance de la ejecución (`{ "<n>": { estado, ciclos, t, bloqueos? } }`), sin las entradas rotas. */
export function avanceDe(estado) {
  const crudo = estado.avance && typeof estado.avance === 'object' && !Array.isArray(estado.avance) ? estado.avance : {}
  return Object.fromEntries(Object.entries(crudo).filter(([, a]) => a && typeof a.estado === 'string'))
}

/** Lista guardada en el estado (`revisiones`, `tandas`), sin las entradas rotas. */
export const listaDe = (estado, clave) => (Array.isArray(estado[clave]) ? estado[clave] : []).filter((x) => x && typeof x === 'object')

/** Hora (ms) de la última actividad de un flujo en este repo: su estado o el registro de la guardia; 0 si no hay. */
function ultimaActividad() {
  let t = 0
  for (const archivo of [ESTADO, registroDe(RAIZ)]) {
    try {
      t = Math.max(t, fs.statSync(archivo).mtimeMs)
    } catch {
      // No existe todavía.
    }
  }
  return t
}

/**
 * El flujo anterior del repo si sigue abierto: sin cierre y con actividad en los últimos `ABIERTO_MIN` minutos; null si no.
 * Un flujo con plan y sin cierre nunca es null (el plan es trabajo que no se pierde): pasados `ABIERTO_CON_PLAN_MIN`
 * minutos sin actividad vuelve con `cortado: true`, y el preflight no lo vacía sin `--forzar`.
 */
export function flujoAbierto() {
  const previo = leerEstado()
  if (!previo.base_global || previo.cierre) return null
  const minutos = (Date.now() - ultimaActividad()) / 60_000
  if (previo.plan) return { ...previo, minutos, cortado: minutos >= ABIERTO_CON_PLAN_MIN }
  return minutos < ABIERTO_MIN ? { ...previo, minutos } : null
}

/** Vacía la carpeta del flujo y la abre con `estado`: la llama el preflight. */
export function nuevoFlujo(estado) {
  // Solo se borra la carpeta propia del proyecto, nunca otra ruta.
  const padre = path.dirname(FLUJO)
  if (path.basename(FLUJO).endsWith('-flujo') && (path.basename(padre) === 'qcc-impl' || padre === carpetaGlobal()) && padre === path.dirname(registroDe(RAIZ))) {
    fs.rmSync(FLUJO, { recursive: true, force: true })
  }
  fs.mkdirSync(FLUJO, { recursive: true })
  fs.writeFileSync(ESTADO, JSON.stringify(estado, null, 2) + '\n')
}

// ── Verificación inicial en segundo plano ───────────────────────────────────

/**
 * Lanza `verificar.mjs` desacoplado (el preflight termina sin esperarlo) con su salida en `verificacion-inicial.log`
 * de la carpeta del flujo, anota `verificacion_inicial` en el estado y devuelve la línea para el preflight.
 * Sin pasos no hay nada que correr; `FLUJOS_INICIAL=0` la desactiva (los tests, que no pueden dejar procesos sueltos).
 */
export function lanzarInicial(hayPasos) {
  const sinLanzar = (motivo) => {
    anotarEstado({ verificacion_inicial: { motivo } })
    return `no se lanzó (${motivo})`
  }
  if (!hayPasos) {
    anotarEstado({ verificacion_inicial: { resultado: 'SIN PASOS' } })
    return 'SIN PASOS'
  }
  if (process.env.FLUJOS_INICIAL === '0') return sinLanzar('desactivada con FLUJOS_INICIAL=0')
  let fd
  try {
    const log = path.join(FLUJO, 'verificacion-inicial.log')
    fd = fs.openSync(log, 'w')
    const hijo = spawn(process.execPath, [VERIFICAR], { cwd: RAIZ, detached: true, windowsHide: true, stdio: ['ignore', fd, fd] })
    hijo.on('error', () => {})
    hijo.unref()
    if (!hijo.pid) return sinLanzar('el proceso no arrancó')
    anotarEstado({ verificacion_inicial: { pid: hijo.pid, log, inicio: new Date().toISOString() } })
    return `en segundo plano (pid ${hijo.pid}); la espera --guardar … exploracion`
  } catch (e) {
    return sinLanzar(e.message)
  } finally {
    if (fd !== undefined) fs.closeSync(fd)
  }
}

const dormirSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)

/** `VERIFICACIÓN INICIAL: …` a partir de la línea `RESULTADO:` (con o sin ese prefijo) de la corrida. */
function lineaInicial(resultado, log) {
  const r = resultado.replace(/^RESULTADO: /, '')
  const rojo = /^ROJO \((.*)\)$/.exec(r)
  if (r === 'VERDE' || r === 'SIN PASOS') return `VERIFICACIÓN INICIAL: ${r}`
  if (rojo) return `VERIFICACIÓN INICIAL: ROJA (${rojo[1]}) · detalle: ${log}`
  return `VERIFICACIÓN INICIAL: SIN RESULTADO (${r}): corre verificar.mjs, que espera esa corrida`
}

/**
 * Espera (hasta `ESPERA_INICIAL_SEG` s) a la verificación inicial del preflight y devuelve su línea `VERIFICACIÓN INICIAL: …`;
 * null si el flujo no la tiene. El resultado se guarda en el estado: la siguiente llamada no espera. Un fallo
 * sin resultado (murió, o sigue tras el tope) no se guarda y se remite a `verificar.mjs`, que espera la corrida viva.
 */
export function esperarInicial() {
  const v = leerEstado().verificacion_inicial
  if (!v || typeof v !== 'object') return null
  if (typeof v.resultado === 'string') return lineaInicial(v.resultado, v.log)
  const sinResultado = (motivo) => `VERIFICACIÓN INICIAL: SIN RESULTADO (${motivo}): corre verificar.mjs, que espera esa corrida`
  if (typeof v.motivo === 'string') return sinResultado(v.motivo)
  const t0 = Date.now()
  for (;;) {
    const vive = vivo(v.pid)
    const linea = (leerTexto(v.log) ?? '').split('\n').map((l) => l.trim()).filter((l) => l.startsWith('RESULTADO:')).at(-1)
    if (linea && !linea.startsWith('RESULTADO: EN CURSO')) {
      anotarEstado({ verificacion_inicial: { ...v, resultado: linea } })
      return lineaInicial(linea, v.log)
    }
    if (!vive) return sinResultado(linea ? 'otra corrida seguía en curso' : 'terminó sin RESULTADO')
    if (Date.now() - t0 >= ESPERA_INICIAL_SEG * 1000) return sinResultado(`sigue tras ${ESPERA_INICIAL_SEG} s`)
    dormirSync(500)
  }
}

// ── Informes de los agentes ─────────────────────────────────────────────────

/** Transcript del subagente `id`, buscado primero en el proyecto actual; null si no está. */
export function transcriptDe(id, proyectos = path.join(CLAUDE, 'projects')) {
  if (!/^[\w-]+$/.test(String(id ?? ''))) return null
  const nombre = `agent-${id}.jsonl`
  const propio = RAIZ.replace(/[^a-zA-Z0-9]/g, '-')
  let carpetas = []
  try {
    carpetas = fs.readdirSync(proyectos, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)
  } catch {
    return null
  }
  carpetas.sort((a, b) => (a.toLowerCase() === propio.toLowerCase() ? -1 : b.toLowerCase() === propio.toLowerCase() ? 1 : 0))
  for (const carpeta of carpetas) {
    let sesiones = []
    try {
      sesiones = fs.readdirSync(path.join(proyectos, carpeta), { withFileTypes: true }).filter((e) => e.isDirectory())
    } catch {
      continue
    }
    for (const s of sesiones) {
      const archivo = path.join(proyectos, carpeta, s.name, 'subagents', nombre)
      if (fs.existsSync(archivo)) return archivo
    }
  }
  return null
}

/** Texto del último mensaje del agente en su transcript (cada fila trae un bloque); null si no hay. */
export function textoFinalDe(archivo) {
  const texto = leerTexto(archivo)
  if (texto === null) return null
  const porMensaje = new Map()
  let ultimo = null
  for (const linea of texto.split('\n')) {
    if (!linea.trim()) continue
    let fila
    try {
      fila = JSON.parse(linea)
    } catch {
      continue
    }
    const m = fila?.type === 'assistant' ? fila.message : null
    const partes = Array.isArray(m?.content) ? m.content.filter((c) => c?.type === 'text' && c.text).map((c) => c.text) : []
    if (!partes.length) continue
    const id = m.id ?? fila.uuid ?? String(porMensaje.size)
    porMensaje.set(id, [...(porMensaje.get(id) ?? []), ...partes])
    ultimo = id
  }
  return ultimo === null ? null : porMensaje.get(ultimo).join('\n').trim()
}

/** Agentes que la guardia cortó por contexto en esas filas del registro (`negado` con motivo `contexto <N>k`): `Map(id → motivo)`. */
export function cortadosDe(filas) {
  const cortados = new Map()
  for (const f of filas) if (f.agente && f.decision === 'negado' && /^contexto \d+k$/.test(f.motivo ?? '') && !cortados.has(f.agente)) cortados.set(f.agente, f.motivo)
  return cortados
}

/** Agrupa rutas por carpeta, subiendo de nivel hasta que no pasen de `tope` grupos: `[{ carpeta, rutas }]`. */
export function agruparPorCarpeta(rutas, tope = TOPE_GRUPOS) {
  const profundidad = Math.max(1, ...rutas.map((r) => r.split('/').length - 1))
  for (let n = profundidad; ; n--) {
    const grupos = new Map()
    for (const r of rutas) {
      const carpetas = r.split('/').slice(0, -1)
      const carpeta = carpetas.length ? `${carpetas.slice(0, n).join('/')}/` : './'
      if (grupos.has(carpeta)) grupos.get(carpeta).push(r)
      else grupos.set(carpeta, [r])
    }
    if (grupos.size <= tope || n <= 1) return [...grupos].map(([carpeta, lista]) => ({ carpeta, rutas: lista }))
  }
}

/** El lote (`[1, 2]`) con que se tomó una foto (`--base --sub 1,2`); null si es de una sola subtarea. */
export function loteDe(f) {
  const lote = f?.lote
  return Array.isArray(lote) && lote.length > 1 && lote.every((n) => Number.isSafeInteger(n) && n >= 1) ? lote : null
}

export const TOPE_PARALELOS = 20

/**
 * Las fases con agentes en paralelo del estado (`paralelos`): `[{ tipo: 'lote'|'tanda', n, desde, hasta? }]`, sin las entradas rotas.
 * Una fase sin `hasta` sigue abierta. Un flujo viejo no tiene el campo: lista vacía.
 */
export function paralelosDe(estado) {
  const crudas = Array.isArray(estado.paralelos) ? estado.paralelos : []
  return crudas.filter((p) => p && (p.tipo === 'lote' || p.tipo === 'tanda') && Number.isFinite(Date.parse(p.desde)) && (p.hasta === undefined || Number.isFinite(Date.parse(p.hasta))))
}

/** Cierra (`hasta` = ahora) las fases en paralelo abiertas: `--cambios --sub|--global` mide lo que hicieron los agentes. */
export function cerrarParalelos() {
  const lista = paralelosDe(leerEstado())
  if (!lista.some((p) => p.hasta === undefined)) return
  const hasta = new Date().toISOString()
  anotarEstado({ paralelos: lista.map((p) => (p.hasta === undefined ? { ...p, hasta } : p)) })
}
