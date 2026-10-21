#!/usr/bin/env node
// Herramienta de /qcc-implementador-odd (nivel usuario: sirve para cualquier proyecto).
//
//   node ~/.claude/flujos-odd/odd.mjs --inicio
//   node ~/.claude/flujos-odd/odd.mjs --diff <BASE> [-- <rutas>]
//   node ~/.claude/flujos-odd/odd.mjs --cierre --base <BASE> --resultado COMPLETO|DETENIDO --tamano chico|grande
//        --riesgo "<ítem N (motivo) | ninguno>" [--revision APROBADO|RECHAZADO|omitida] [--titulo "<t>"]
//   node ~/.claude/flujos-odd/odd.mjs --ultimos [<n>]
//
// --inicio: toma una foto del árbol (versionados + nuevos no ignorados) como commit suelto, que es la BASE, y la
// imprime como `ODD_BASE=<sha>`: con esa marca costo.mjs encuentra la sesión. Además: rama, sucios previos,
// `criticos` y pasos de `verificar` de `.claude/qcc-implementador-odd.json`, y los `odd/tasks/*.md` con tareas abiertas.
// --diff: el cambio desde la BASE contra una foto nueva (incluye archivos nuevos), con --stat y recortado a TOPE_DIFF líneas.
// --cierre: anota una fila en `registros/odd.jsonl` con el costo real e imprime CAMBIOS y COSTO.
// --ultimos: las últimas corridas anotadas (10 por defecto), con el promedio.
// Sin candado ni estado: lo que el flujo tiene que recordar va en la salida o en `odd/tasks/`.
// `ODD_REGISTROS` cambia la carpeta de registros (los tests la llevan a un temporal).

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { raizDe } from './guardia.mjs'
import { costoDelFlujo, resumenDeCosto, dolares } from './costo.mjs'

const WIN = process.platform === 'win32'
const DIR = path.dirname(fileURLToPath(import.meta.url))
const RAIZ = raizDe(process.env.CLAUDE_PROJECT_DIR || process.cwd())
const TOPE_DIFF = 400
const TOPE_SUCIOS = 10
const CONFIG = '.claude/qcc-implementador-odd.json'
const TAREAS = 'odd/tasks'

const registroDe = () => path.join(process.env.ODD_REGISTROS || path.join(DIR, 'registros'), 'odd.jsonl')

function git(args, { env, opcional = false } = {}) {
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

const corto = (sha) => String(sha).slice(0, 9)

/** Foto del árbol actual como commit suelto, hijo de HEAD si existe. Usa un índice temporal: no toca el del usuario. */
function foto() {
  const indiceReal = path.resolve(RAIZ, git(['rev-parse', '--git-path', 'index']).trim())
  const tmp = path.join(os.tmpdir(), `qcc-odd-indice-${process.pid}-${Date.now()}`)
  try {
    fs.copyFileSync(indiceReal, tmp)
  } catch {
    // Repo sin índice todavía: el árbol parte vacío.
  }
  const env = {
    ...process.env,
    GIT_INDEX_FILE: tmp,
    GIT_AUTHOR_NAME: 'qcc-implementador-odd',
    GIT_AUTHOR_EMAIL: 'qcc-implementador-odd@local',
    GIT_COMMITTER_NAME: 'qcc-implementador-odd',
    GIT_COMMITTER_EMAIL: 'qcc-implementador-odd@local',
  }
  try {
    git(['add', '-A', '--', '.'], { env })
    const arbol = git(['write-tree'], { env }).trim()
    const head = git(['rev-parse', '--verify', '-q', 'HEAD'], { opcional: true })?.trim()
    return git(['commit-tree', arbol, ...(head ? ['-p', head] : []), '-m', 'qcc-implementador-odd: foto del árbol'], { env }).trim()
  } finally {
    fs.rmSync(tmp, { force: true })
  }
}

function exigirBase(base) {
  if (!base || base.startsWith('--')) throw new Error('falta la BASE')
  if (git(['cat-file', '-e', `${base}^{commit}`], { opcional: true }) === null) throw new Error(`BASE desconocida: ${base}`)
  return base
}

/** La config del proyecto; `{}` si no hay o no se puede leer. */
function configDelProyecto() {
  try {
    const config = JSON.parse(fs.readFileSync(path.join(RAIZ, CONFIG), 'utf8'))
    return config && typeof config === 'object' && !Array.isArray(config) ? config : {}
  } catch {
    return {}
  }
}

// ── Puras ───────────────────────────────────────────────────────────────────

/**
 * Opciones de la línea de comandos: `modo` (inicio | diff | cierre | ultimos), los valores con nombre y las `rutas`
 * que siguen a `--`. Un valor que falta queda `undefined`.
 */
export function opcionesDe(args) {
  const k = args.indexOf('--')
  const propias = k >= 0 ? args.slice(0, k) : args
  const rutas = k >= 0 ? args.slice(k + 1) : []
  const valor = (nombre) => {
    const i = propias.indexOf(nombre)
    const v = i >= 0 ? propias[i + 1] : undefined
    return v === undefined || v.startsWith('--') ? undefined : v
  }
  const modo = ['cierre', 'diff', 'inicio', 'ultimos'].find((m) => propias.includes(`--${m}`)) ?? null
  return {
    modo,
    base: modo === 'diff' ? valor('--diff') : valor('--base'),
    resultado: valor('--resultado'),
    tamano: valor('--tamano'),
    riesgo: valor('--riesgo'),
    revision: valor('--revision'),
    titulo: valor('--titulo'),
    ultimos: Math.max(1, Number(valor('--ultimos') ?? 10) || 10),
    rutas,
  }
}

/** Los `criticos` de la config como líneas legibles: `- <rutas> (excepto …) [si …] · ítem N — <motivo>`. */
export function criticosLegibles(criticos) {
  if (!Array.isArray(criticos)) return []
  return criticos
    .filter((c) => c && Array.isArray(c.rutas) && c.rutas.length)
    .map((c) => {
      const excepto = Array.isArray(c.excepto) && c.excepto.length ? ` (excepto ${c.excepto.join(', ')})` : ''
      const si = c.si ? ` si ${c.si}` : ''
      const items = Array.isArray(c.riesgo) && c.riesgo.length ? ` · ítem ${c.riesgo.join(', ')}` : ''
      return `- ${c.rutas.join(', ')}${excepto}${si}${items}${c.motivo ? ` — ${c.motivo}` : ''}`
    })
}

/** Tareas del documento de una feature: `{ abiertas, total }`, contando los `- [ ]` y `- [x]` de `## Tasks`. */
export function tareasDe(texto) {
  const seccion = /^## Tasks[^\n]*\n([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(String(texto))?.[1] ?? ''
  const abiertas = (seccion.match(/^\s*- \[ \]/gm) ?? []).length
  const hechas = (seccion.match(/^\s*- \[[xX]\]/gm) ?? []).length
  return { abiertas, total: abiertas + hechas }
}

/** `git diff --numstat` sumado: `{ archivos, mas, menos }` (los binarios cuentan como archivo, sin líneas). */
export function sumaNumstat(texto) {
  let archivos = 0
  let mas = 0
  let menos = 0
  for (const linea of String(texto).split('\n')) {
    const m = /^(\d+|-)\t(\d+|-)\t/.exec(linea)
    if (!m) continue
    archivos++
    if (m[1] !== '-') mas += Number(m[1])
    if (m[2] !== '-') menos += Number(m[2])
  }
  return { archivos, mas, menos }
}

/** Las primeras `tope` líneas de `texto` y cuántas sobran. */
export function recortar(texto, tope = TOPE_DIFF) {
  const lineas = String(texto).replace(/\n$/, '').split('\n')
  return { texto: lineas.slice(0, tope).join('\n'), sobran: Math.max(0, lineas.length - tope) }
}

const sinNulos = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== ''))

/** La fila de `odd.jsonl`. `costo` es el de costo.mjs (o null); `cambios`, el de `sumaNumstat`. */
export function filaDeCorrida({ t, raiz, base, resultado, tamano, riesgo, revision, titulo, costo = null, cambios } = {}) {
  return sinNulos({ v: 1, t, raiz, base, titulo, resultado, tamano, riesgo, revision, cambios, costo })
}

/** Una línea del listado `--ultimos`. */
export function lineaDeCorrida(f) {
  const fecha = String(f.t ?? '').slice(0, 16).replace('T', ' ')
  const repo = String(f.raiz ?? '?').split(/[\\/]/).filter(Boolean).pop() ?? '?'
  const datos = [f.tamano, f.riesgo && `Riesgo: ${f.riesgo}`, f.revision && `revisión ${f.revision}`, f.resultado, f.cambios && `+${f.cambios.mas} −${f.cambios.menos}`].filter(Boolean)
  return `${fecha} · ${repo} · ${f.costo ? resumenDeCosto(f.costo) : 'sin costo'}${datos.length ? ` · ${datos.join(' · ')}` : ''}${f.titulo ? ` · ${f.titulo}` : ''}`
}

// ── Modos ───────────────────────────────────────────────────────────────────

function inicio() {
  const base = foto()
  const rama = git(['rev-parse', '--abbrev-ref', 'HEAD'], { opcional: true })?.trim() || '(sin commits)'
  const head = git(['rev-parse', '--short', 'HEAD'], { opcional: true })?.trim() || '-'
  const sucios = git(['status', '--porcelain', '-uall', '-z']).split('\0').filter(Boolean).map((l) => l.slice(3))
  const config = configDelProyecto()
  const criticos = criticosLegibles(config.criticos)
  const pasos = Array.isArray(config.verificar) ? config.verificar.map((p) => p?.nombre ?? p?.cmd).filter(Boolean) : []
  const abiertas = []
  try {
    for (const a of fs.readdirSync(path.join(RAIZ, TAREAS)).filter((a) => a.endsWith('.md')).sort()) {
      const { abiertas: n, total } = tareasDe(fs.readFileSync(path.join(RAIZ, TAREAS, a), 'utf8'))
      if (n) abiertas.push(`${TAREAS}/${a} (${n} de ${total} abiertas)`)
    }
  } catch {
    // Sin odd/tasks/.
  }
  const lista = sucios.slice(0, TOPE_SUCIOS).join(', ') + (sucios.length > TOPE_SUCIOS ? `, … ${sucios.length - TOPE_SUCIOS} más` : '')
  console.log(`ODD_BASE=${base}`)
  console.log(`RAMA: ${rama}@${head} · sucios previos: ${sucios.length ? `${sucios.length} (${lista})` : 'ninguno'}`)
  console.log(`CRÍTICOS DEL PROYECTO: ${criticos.length ? `\n${criticos.join('\n')}` : 'ninguno'}`)
  console.log(`VERIFICAR: ${pasos.length ? pasos.join(' → ') : 'detección automática de verificar.mjs'}`)
  console.log(`TAREAS ABIERTAS: ${abiertas.length ? abiertas.join(' · ') : 'ninguna'}`)
}

function diff(base, rutas) {
  exigirBase(base)
  const ahora = foto()
  const filtro = rutas.length ? ['--', ...rutas] : []
  const stat = git(['diff', '--stat', base, ahora, ...filtro]).trim()
  if (!stat) {
    console.log(`DIFF: sin cambios desde ${corto(base)}${rutas.length ? ` en ${rutas.join(', ')}` : ''}`)
    return
  }
  const { texto, sobran } = recortar(git(['diff', base, ahora, ...filtro]))
  console.log(stat)
  console.log('')
  console.log(texto)
  if (sobran) console.log(`\n… recortado: ${sobran} líneas más. Pide por ruta: --diff ${corto(base)} -- <ruta>`)
}

function cierre({ base, resultado, tamano, riesgo, revision, titulo }) {
  exigirBase(base)
  if (!/^(COMPLETO|DETENIDO)\b/.test(resultado ?? '')) throw new Error('--resultado tiene que ser COMPLETO o DETENIDO')
  const t = new Date().toISOString()
  const cambios = sumaNumstat(git(['diff', '--numstat', base, foto()]))
  let costo = null
  try {
    costo = costoDelFlujo(RAIZ, base, { hasta: t })
  } catch {
    // Sin transcripts legibles: la fila va sin costo.
  }
  const archivo = registroDe()
  fs.mkdirSync(path.dirname(archivo), { recursive: true })
  fs.appendFileSync(archivo, JSON.stringify(filaDeCorrida({ t, raiz: RAIZ, base, resultado, tamano, riesgo, revision, titulo, costo, cambios })) + '\n')
  console.log(`CAMBIOS: ${cambios.archivos} archivo(s) · +${cambios.mas} −${cambios.menos}`)
  console.log(`COSTO: ${costo ? resumenDeCosto(costo) : 'sin datos (no encontré la sesión en los transcripts)'}`)
}

function ultimos(n) {
  let filas = []
  try {
    filas = fs.readFileSync(registroDe(), 'utf8').split('\n').filter((l) => l.trim()).flatMap((l) => {
      try {
        return [JSON.parse(l)]
      } catch {
        return []
      }
    })
  } catch {
    // Sin registro todavía.
  }
  if (!filas.length) {
    console.log(`CORRIDAS: ninguna anotada en ${registroDe()}`)
    return
  }
  const elegidas = filas.slice(-n)
  console.log(`CORRIDAS (últimas ${elegidas.length} de ${filas.length}):`)
  for (const f of elegidas) console.log(`  ${lineaDeCorrida(f)}`)
  const conCosto = elegidas.filter((f) => f.costo)
  if (conCosto.length) {
    const usd = conCosto.reduce((s, f) => s + f.costo.usd, 0) / conCosto.length
    const minutos = conCosto.reduce((s, f) => s + f.costo.minutos, 0) / conCosto.length
    console.log(`PROMEDIO: ${dolares(usd)} · ${minutos.toFixed(1).replace('.', ',')} min (${conCosto.length} con costo)`)
  }
}

function main() {
  const o = opcionesDe(process.argv.slice(2))
  try {
    if (o.modo === 'inicio') inicio()
    else if (o.modo === 'diff') diff(o.base, o.rutas)
    else if (o.modo === 'cierre') cierre(o)
    else if (o.modo === 'ultimos') ultimos(o.ultimos)
    else throw new Error('uso: odd.mjs --inicio | --diff <BASE> [-- <rutas>] | --cierre --base <BASE> --resultado … | --ultimos [<n>]')
  } catch (e) {
    console.log(`ERROR: ${e.message}`)
    process.exitCode = 1
  }
}

function esPrincipal() {
  if (!process.argv[1]) return false
  const a = path.resolve(process.argv[1])
  const b = fileURLToPath(import.meta.url)
  return WIN ? a.toLowerCase() === b.toLowerCase() : a === b
}

if (esPrincipal()) main()
