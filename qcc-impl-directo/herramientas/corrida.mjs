#!/usr/bin/env node
// Lo que /impl-d necesita al empezar y al cerrar una corrida (ver FLUJOS.md#impl-d y LIMITES.md).
//
//   node <plugin>/herramientas/corrida.mjs --inicio                 la skill lo corre al cargar: imprime LÍMITES, BASE,
//                                                                   MAPA, VERIFICAR, REGLAS y MEMORIA y anota la lectura
//   node <plugin>/herramientas/corrida.mjs --arbol                  imprime el árbol git del estado actual (sucios incluidos)
//   node <plugin>/herramientas/corrida.mjs --diff <árbol> [args]    `git diff <árbol> <estado actual> [args]`, con los
//                                                                   archivos sin seguimiento (args: `--stat`, `-- <rutas>`)
//   node <plugin>/herramientas/corrida.mjs --fin [--resultado <r>]  imprime `LÍMITES: 5h +7 % · sem +1 %`, anota la corrida
//                                                                   en `registros/impl-d.jsonl` y borra la lectura inicial
//
// Límites: mismas reglas que /impl (costos.mjs): una lectura sin snapshot, rota o de más de 10 minutos es «sin dato»
// (`s/d`, nunca ceros) y un reinicio de la ventana en medio da la cota mínima, el % de la lectura final (`≥+`). Las
// copia en vez de importar costos.mjs porque cada plugin se instala por separado.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const VENTANAS = [['5h', 'five_hour'], ['sem', 'seven_day']]
/** Más vieja que esto (segundos), la lectura del snapshot es «sin dato». */
export const LIMITES_MAX_SEG = 10 * 60
/** Desde este % de la ventana de 5 h, `--inicio` avisa `MARGEN BAJO`: una corrida mediana gasta 10–20 %. */
export const MARGEN_5H = 85
/** Líneas por explorador con las que se parte el MAPA (el reparto de /impl). */
export const LINEAS_POR_EXPLORADOR = 2000
const TOPE_MAPA = 60
const ARBOL_VACIO = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'
/** Lecturas iniciales más viejas que esto (ms) son de corridas cortadas: `--inicio` las borra. */
const VIDA_INICIO_MS = 24 * 3600 * 1000

const configDe = () => process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')
/** El snapshot del panel en la carpeta de la cuenta (`QCC_LIMITES` lo cambia, para los tests). */
const rutaLimites = () => process.env.QCC_LIMITES || path.join(configDe(), 'qcc-limites.json')
/** Los registros compartidos entre cuentas, los mismos de /impl (`FLUJOS_REGISTROS` lo cambia). */
const rutaRegistros = () => process.env.FLUJOS_REGISTROS || path.join(os.homedir(), '.claude', 'flujos', 'registros')
/** Las lecturas iniciales, en el temporal del sistema (`QCC_IMPL_D_TMP` lo cambia, para los tests). */
const dirInicio = () => process.env.QCC_IMPL_D_TMP || path.join(os.tmpdir(), 'qcc-impl-d')
const sesionId = () => (/^[\w-]+$/.test(process.env.CLAUDE_CODE_SESSION_ID ?? '') ? process.env.CLAUDE_CODE_SESSION_ID : 'sin-sesion')
const rutaInicio = () => path.join(dirInicio(), `${sesionId()}.json`)
/** Carpeta de `projects/` de un directorio: Claude Code la nombra con la ruta, cada carácter no alfanumérico como `-`. */
const carpetaProyecto = (cwd) => path.join(configDe(), 'projects', path.resolve(cwd).replace(/[^a-zA-Z0-9]/g, '-'))

/**
 * Lectura del snapshot: `{ t, five_hour?: { pct, resetsAt }, seven_day?: … }`; sin snapshot, roto o con más de
 * `LIMITES_MAX_SEG`, `{ t, sinDato: <motivo> }`.
 */
export function leer(archivo = rutaLimites(), ahora = Date.now()) {
  const t = new Date(ahora).toISOString()
  let s
  try {
    s = JSON.parse(fs.readFileSync(archivo, 'utf8'))
  } catch {
    return { t, sinDato: 'sin snapshot del panel' }
  }
  const edad = (ahora - Date.parse(s?.t)) / 1000
  if (!Number.isFinite(edad)) return { t, sinDato: 'snapshot roto' }
  if (edad > LIMITES_MAX_SEG) return { t, sinDato: 'snapshot viejo' }
  const lectura = { t }
  for (const [, k] of VENTANAS) if (Number.isFinite(s[k]?.pct)) lectura[k] = { pct: s[k].pct, resetsAt: s[k].resetsAt }
  return lectura
}

/** «5h +7 % · sem +1,5 %» entre dos lecturas: `≥+<% final>` si la ventana se reinició en medio, `s/d` si falta alguna. */
export function resumen(inicio, fin) {
  return VENTANAS.map(([nombre, k]) => {
    const a = inicio?.[k]
    const b = fin?.[k]
    if (!a || !b) return `${nombre} s/d`
    const ra = Date.parse(a.resetsAt)
    const rb = Date.parse(b.resetsAt)
    // Se reinició si bajó el %, si la lectura final es posterior al reinicio previsto o si cambió la hora de reinicio.
    const reinicio = b.pct < a.pct || (Number.isFinite(ra) && Date.parse(fin.t) >= ra) || (Number.isFinite(ra) && Number.isFinite(rb) && Math.abs(ra - rb) > 60_000)
    const gasto = reinicio ? b.pct : Math.round((b.pct - a.pct) * 10) / 10
    return `${nombre} ${reinicio ? '≥' : ''}+${String(gasto).replace('.', ',')} %`
  }).join(' · ')
}

/** «LÍMITES: 5h 62 % · sem 30 %», con `MARGEN BAJO` desde `MARGEN_5H`; `s/d (<motivo>)` sin dato. */
export function lineaLimites(lectura) {
  if (lectura.sinDato) return `LÍMITES: s/d (${lectura.sinDato})`
  const pct = (k) => (Number.isFinite(lectura[k]?.pct) ? `${String(lectura[k].pct).replace('.', ',')} %` : 's/d')
  const bajo = lectura.five_hour?.pct >= MARGEN_5H ? ` · MARGEN BAJO (5h ≥ ${MARGEN_5H} %)` : ''
  return `LÍMITES: ${VENTANAS.map(([n, k]) => `${n} ${pct(k)}`).join(' · ')}${bajo}`
}

const git = (cwd, args, env = process.env) => execFileSync('git', args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 }).trim()

/**
 * Árbol git del estado actual del directorio de trabajo, con los archivos sin seguimiento que `.gitignore` no excluye.
 * Usa una copia del índice en el temporal: el índice real no cambia. `null` fuera de un repo.
 */
export function arbolActual(cwd = process.cwd()) {
  let copia
  try {
    const indice = path.resolve(cwd, git(cwd, ['rev-parse', '--git-path', 'index']))
    copia = path.join(os.tmpdir(), `qcc-impl-d-indice-${process.pid}-${Date.now()}`)
    if (fs.existsSync(indice)) fs.copyFileSync(indice, copia)
    const env = { ...process.env, GIT_INDEX_FILE: copia }
    git(cwd, ['add', '-A'], env)
    return git(cwd, ['write-tree'], env)
  } catch {
    return null
  } finally {
    if (copia) fs.rmSync(copia, { force: true })
  }
}

/**
 * Las líneas del MAPA a partir de `[{ ruta, lineas }]`: una por carpeta de hasta `tope` líneas; las más grandes se
 * parten en sus subcarpetas, con sus archivos sueltos aparte (`carpeta/*`). Una carpeta que pasa de `tope` sin
 * subcarpetas nombra sus archivos de 300 líneas o más.
 */
export function mapa(filas, tope = LINEAS_POR_EXPLORADOR) {
  const nuevo = () => ({ lineas: 0, hijos: new Map(), archivos: [] })
  const raiz = nuevo()
  for (const { ruta, lineas } of filas) {
    if (!(lineas > 0)) continue
    const partes = ruta.split('/')
    let nodo = raiz
    nodo.lineas += lineas
    for (const p of partes.slice(0, -1)) {
      if (!nodo.hijos.has(p)) nodo.hijos.set(p, nuevo())
      nodo = nodo.hijos.get(p)
      nodo.lineas += lineas
    }
    nodo.archivos.push({ nombre: partes.at(-1), lineas })
  }
  const grandes = (archivos) => {
    const g = archivos.filter((a) => a.lineas >= 300).sort((a, b) => b.lineas - a.lineas).slice(0, 5)
    return g.length ? `; ${g.map((a) => `${a.nombre} ${a.lineas}`).join(', ')}` : ''
  }
  const salida = []
  const emitir = (nodo, prefijo) => {
    const nombre = prefijo || './'
    if (nodo.lineas <= tope || nodo.hijos.size === 0) {
      const todos = []
      const juntar = (n) => {
        todos.push(...n.archivos)
        for (const h of n.hijos.values()) juntar(h)
      }
      juntar(nodo)
      salida.push(`- ${nombre} — ${nodo.lineas} (${todos.length} archivos${nodo.lineas > tope ? grandes(todos) : ''})`)
      return
    }
    const sueltos = nodo.archivos.reduce((s, a) => s + a.lineas, 0)
    if (sueltos) salida.push(`- ${nombre}* — ${sueltos} (${nodo.archivos.length} archivos sueltos${sueltos > tope ? grandes(nodo.archivos) : ''})`)
    for (const [n, h] of [...nodo.hijos].sort(([a], [b]) => a.localeCompare(b))) emitir(h, `${prefijo}${n}/`)
  }
  if (raiz.lineas) emitir(raiz, '')
  const cabeza = `MAPA: ${raiz.lineas} líneas de texto (versionadas y sin commit, sin lockfiles), ~${tope} por explorador:`
  if (salida.length > TOPE_MAPA) return [cabeza, ...salida.slice(0, TOPE_MAPA), `- … ${salida.length - TOPE_MAPA} carpetas más`]
  return [cabeza, ...salida]
}

/** `[{ ruta, lineas }]` de los archivos de texto del árbol `base`, sin lockfiles. */
function filasDe(cwd, base) {
  return git(cwd, ['diff', '--numstat', ARBOL_VACIO, base, '--', '.', ':!*lock*'])
    .split('\n')
    .map((l) => l.split('\t'))
    .filter((c) => c.length >= 3 && /^\d+$/.test(c[0]))
    .map(([n, , ruta]) => ({ ruta, lineas: Number(n) }))
}

/** Las líneas de VERIFICAR, de `.claude/qcc-implementador.json` (respaldo `.claude/implementador.json`). */
export function verificacionDe(raiz) {
  for (const nombre of ['qcc-implementador.json', 'implementador.json']) {
    const archivo = path.join(raiz, '.claude', nombre)
    if (!fs.existsSync(archivo)) continue
    let pasos
    try {
      pasos = JSON.parse(fs.readFileSync(archivo, 'utf8')).verificar
    } catch (e) {
      return [`VERIFICAR: .claude/${nombre} roto (${e.message}): los del CLAUDE.md o AGENTS.md`]
    }
    if (!Array.isArray(pasos) || !pasos.length) return [`VERIFICAR: .claude/${nombre} sin pasos en «verificar»`]
    return [`VERIFICAR (.claude/${nombre}):`, ...pasos.map((p) => `- ${p.nombre ?? 'paso'}: \`${p.cmd}\`${p.rutas?.length ? ` · solo si toca ${p.rutas.join(', ')}` : ''}${p.paralelo ? ' · paralelo' : ''}`)]
  }
  return ['VERIFICAR: sin .claude/qcc-implementador.json: los del CLAUDE.md o AGENTS.md']
}

/** La línea REGLAS: el archivo único para todos, o los de la carpeta por rol (sesión, explorador, revisor). */
export function reglasDe(raiz) {
  for (const base of ['qcc-implementador', 'implementador']) {
    if (fs.existsSync(path.join(raiz, '.claude', `${base}.md`))) return `REGLAS: .claude/${base}.md (para todos)`
    const carpeta = path.join(raiz, '.claude', base)
    if (!fs.existsSync(carpeta)) continue
    const de = (...nombres) => nombres.filter((n) => fs.existsSync(path.join(carpeta, n))).map((n) => `.claude/${base}/${n}`).join(', ') || 'ninguna'
    return `REGLAS: sesión ${de('planificar.md', 'ejecutor.md')} · explorador ${de('buscar.md')} · revisor ${de('revisor.md')}`
  }
  return 'REGLAS: ninguna'
}

/** El índice de la memoria del proyecto (`projects/<proyecto>/memory/MEMORY.md`), o `null`. */
export function memoriaDe(cwd) {
  const archivo = path.join(carpetaProyecto(cwd), 'memory', 'MEMORY.md')
  return fs.existsSync(archivo) ? archivo : null
}

const leerJsonl = (archivo) => {
  try {
    return fs.readFileSync(archivo, 'utf8').split('\n').filter(Boolean).flatMap((l) => {
      try {
        return [JSON.parse(l)]
      } catch {
        return []
      }
    })
  } catch {
    return []
  }
}

/** El comando que abre la corrida: `/impl-d:n`, el modo esfuerzo `/impl-d:e` o el paralelo `/impl-d:p`. */
const RE_COMANDO = /<command-name>\/(impl-d:[enp])<\/command-name>/

/** El `modo` de la fila según la skill; `/impl-d:n` es `normal`. */
const MODOS = { 'impl-d:e': 'esfuerzo', 'impl-d:p': 'paralelo' }

/**
 * Las aperturas de la corrida en el transcript, `[{ t, skill, args }]`: el comando escrito al principio del mensaje o,
 * si va en medio, la herramienta Skill con la que la sesión lo lanza.
 */
function invocacionesDe(eventos) {
  return eventos.flatMap((e) => {
    const c = e.message?.content
    if (e.type === 'user' && typeof c === 'string') {
      const m = c.match(RE_COMANDO)
      return m ? [{ t: e.timestamp, skill: m[1], args: c.match(/<command-args>([\s\S]*?)<\/command-args>/)?.[1] ?? '' }] : []
    }
    if (e.type !== 'assistant' || !Array.isArray(c)) return []
    return c
      .filter((b) => b.type === 'tool_use' && b.name === 'Skill' && /^\/?impl-d:[enp]$/.test(b.input?.skill ?? ''))
      .map((b) => ({ t: e.timestamp, skill: b.input.skill.replace(/^\//, ''), args: b.input.args ?? '' }))
  })
}

/** Tokens y pedidos de los mensajes del asistente entre `desde` y `hasta` (ISO), sin repetir id ni contar `<synthetic>`. */
function tokensDe(eventos, desde, hasta) {
  const vistos = new Set()
  const r = { pedidos: 0, tokens: { entrada: 0, leidos: 0, escritos: 0, salida: 0 } }
  for (const e of eventos) {
    const m = e.message
    if (e.type !== 'assistant' || !m?.usage || m.model === '<synthetic>' || vistos.has(m.id)) continue
    if (!(e.timestamp >= desde && e.timestamp <= hasta)) continue
    vistos.add(m.id)
    r.pedidos++
    r.tokens.entrada += m.usage.input_tokens ?? 0
    r.tokens.leidos += m.usage.cache_read_input_tokens ?? 0
    r.tokens.escritos += m.usage.cache_creation_input_tokens ?? 0
    r.tokens.salida += m.usage.output_tokens ?? 0
  }
  return r
}

/**
 * Consumo de la corrida en el transcript `sesion` y sus subagentes, entre `desde` y `hasta`: `roles` (sesión,
 * explorador, asesor, trabajador, revisor, otros, cada uno con agentes, pedidos y tokens), los `veredictos` del revisor en orden y el `pedido`
 * (los argumentos del último `/impl-d:n`, `/impl-d:e` o `/impl-d:p`, escrito o lanzado con Skill, hasta un minuto después de `desde`) y su `modo`
 * (`normal`, `esfuerzo` con `/impl-d:e`, `paralelo` con `/impl-d:p`, `s/d` sin comando).
 */
export function consumoDe(sesion, desde, hasta) {
  const principal = leerJsonl(sesion)
  const roles = { sesion: { agentes: 0, ...tokensDe(principal, desde, hasta) } }
  const veredictos = []
  const carpeta = path.join(sesion.replace(/\.jsonl$/, ''), 'subagents')
  const agentes = []
  try {
    for (const f of fs.readdirSync(carpeta).filter((x) => x.endsWith('.jsonl'))) {
      const eventos = leerJsonl(path.join(carpeta, f))
      const t0 = eventos.find((e) => e.timestamp)?.timestamp
      if (!(t0 >= desde && t0 <= hasta)) continue
      let tipo = ''
      try {
        tipo = JSON.parse(fs.readFileSync(path.join(carpeta, f.replace(/\.jsonl$/, '.meta.json')), 'utf8')).agentType ?? ''
      } catch {}
      agentes.push({ t0, tipo, eventos })
    }
  } catch {}
  agentes.sort((a, b) => (a.t0 < b.t0 ? -1 : 1))
  for (const { tipo, eventos } of agentes) {
    const rol = /explorador/.test(tipo) ? 'explorador' : /revisor/.test(tipo) ? 'revisor' : /asesor/.test(tipo) ? 'asesor' : /trabajador/.test(tipo) ? 'trabajador' : 'otros'
    const t = tokensDe(eventos, desde, hasta)
    const acc = (roles[rol] ??= { agentes: 0, pedidos: 0, tokens: { entrada: 0, leidos: 0, escritos: 0, salida: 0 } })
    acc.agentes++
    acc.pedidos += t.pedidos
    for (const k of Object.keys(acc.tokens)) acc.tokens[k] += t.tokens[k]
    if (rol === 'revisor') {
      const textos = eventos.filter((e) => e.type === 'assistant').flatMap((e) => (Array.isArray(e.message?.content) ? e.message.content : [])).filter((b) => b.type === 'text')
      veredictos.push(textos.at(-1)?.text.match(/VEREDICTO:\s*(APROBADO|RECHAZADO)/)?.[1] ?? 'sin veredicto')
    }
  }
  const tope = new Date(Date.parse(desde) + 60_000).toISOString()
  const comando = invocacionesDe(principal).filter((i) => i.t <= tope).at(-1)
  const pedido = comando?.args.trim() ?? ''
  const modo = comando ? (MODOS[comando.skill] ?? 'normal') : 's/d'
  return { roles, veredictos, pedido, modo }
}

function version() {
  try {
    return JSON.parse(fs.readFileSync(fileURLToPath(new URL('../.claude-plugin/plugin.json', import.meta.url)), 'utf8')).version
  } catch {
    return 's/d'
  }
}

/** Borra las lecturas iniciales de corridas cortadas (más de `VIDA_INICIO_MS`). */
function limpiarViejas(dir, ahora = Date.now()) {
  try {
    for (const f of fs.readdirSync(dir)) {
      const archivo = path.join(dir, f)
      if (ahora - fs.statSync(archivo).mtimeMs > VIDA_INICIO_MS) fs.rmSync(archivo, { force: true })
    }
  } catch {}
}

function inicio() {
  const cwd = process.cwd()
  let raiz = cwd
  try {
    raiz = git(cwd, ['rev-parse', '--show-toplevel'])
  } catch {}
  const lectura = leer()
  const base = arbolActual(cwd)
  limpiarViejas(dirInicio())
  fs.mkdirSync(dirInicio(), { recursive: true })
  fs.writeFileSync(rutaInicio(), JSON.stringify({ t: lectura.t, lectura, base, cwd, raiz }))
  let lineasMapa = ['MAPA: s/d (sin git)']
  if (base) {
    try {
      lineasMapa = mapa(filasDe(cwd, base))
    } catch {}
  }
  const memoria = memoriaDe(cwd)
  console.log([
    lineaLimites(lectura),
    `BASE: ${base ?? 's/d (no es un repo git)'}`,
    ...lineasMapa,
    ...verificacionDe(raiz),
    reglasDe(raiz),
    `MEMORIA: ${memoria ?? 'ninguna'}`,
  ].join('\n'))
}

function fin(argv) {
  const i = argv.indexOf('--resultado')
  const resultado = i >= 0 && argv[i + 1] ? argv[i + 1] : 's/d'
  const archivo = rutaInicio()
  let ini
  try {
    ini = JSON.parse(fs.readFileSync(archivo, 'utf8'))
  } catch {}
  fs.rmSync(archivo, { force: true })
  const lectura = leer()
  const limites = resumen(ini?.lectura, lectura)
  console.log(`LÍMITES: ${limites}${ini ? '' : ' (sin lectura inicial)'}`)
  if (!ini) return
  try {
    const sesion = path.join(carpetaProyecto(ini.cwd), `${sesionId()}.jsonl`)
    const { roles, veredictos, pedido, modo } = consumoDe(sesion, ini.t, lectura.t)
    const fila = {
      v: 1,
      t: lectura.t,
      inicio: ini.t,
      minutos: Math.round((Date.parse(lectura.t) - Date.parse(ini.t)) / 600) / 100,
      raiz: ini.raiz,
      version: version(),
      sesion,
      pedido,
      modo,
      resultado,
      limites,
      roles,
      veredictos,
    }
    fs.mkdirSync(rutaRegistros(), { recursive: true })
    fs.appendFileSync(path.join(rutaRegistros(), 'impl-d.jsonl'), JSON.stringify(fila) + '\n')
  } catch (e) {
    console.log(`REGISTRO: no (${e.message})`)
  }
}

function main(argv) {
  const opcion = argv[0]
  if (opcion === '--inicio') inicio()
  else if (opcion === '--fin') fin(argv.slice(1))
  else if (opcion === '--arbol') console.log(arbolActual() ?? 's/d (no es un repo git)')
  else if (opcion === '--diff' && /^[0-9a-f]{7,64}$/.test(argv[1] ?? '')) {
    const ahora = arbolActual()
    if (!ahora) {
      console.error('no es un repo git')
      process.exitCode = 1
      return
    }
    process.stdout.write(execFileSync('git', ['diff', argv[1], ahora, ...argv.slice(2)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 }))
  } else {
    console.error('uso: corrida.mjs --inicio | --arbol | --diff <árbol> [--stat] [-- <rutas>] | --fin [--resultado <r>]')
    process.exitCode = 2
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2))
