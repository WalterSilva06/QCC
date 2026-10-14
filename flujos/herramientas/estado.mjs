#!/usr/bin/env node
// Estado git del flujo /implementador (nivel usuario: sirve para
// cualquier proyecto con git). El proyecto es el repo que contiene el directorio actual.
//
//   node ~/.claude/flujos/estado.mjs                       preflight + foto global
//   node ~/.claude/flujos/estado.mjs --base                foto nueva: BASE=<sha> DESDE=<iso>
//   node ~/.claude/flujos/estado.mjs --cambios <BASE> --desde <iso> --permitidos "<a,b>"
//   node ~/.claude/flujos/estado.mjs --diff <BASE> [--permitidos "<a,b>"] [-- <rutas>]
//
// Una "foto" es un commit suelto con todo el árbol (versionados + nuevos no ignorados),
// armado con un índice temporal: no toca el índice ni los archivos del usuario y git lo
// recoge solo. Así el diff de una subtarea sale exacto aunque haya cambios sin commit.
// Los archivos permitidos que viven en rutas ignoradas se fuerzan dentro de la foto; lo que
// el ejecutor escribió en otras rutas ignoradas aparece por el registro de la guardia.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { evaluar, registroDe, configDe, coincide, RAIZ } from './guardia.mjs'
import { pasosDe } from './verificar.mjs'

const AGENTES = path.join(os.homedir(), '.claude', 'agents')
const WIN = process.platform === 'win32'
const TOPE_DIFF = 3000
const TOPE_SUCIOS = 30
const EDICIONES = new Set(['Edit', 'Write', 'NotebookEdit', 'MultiEdit'])

// ── Permitidos ──────────────────────────────────────────────────────────────

/** `"a.ts, src/routeTree.gen.ts (generado) ,b/*.ts"` → `['a.ts', 'src/routeTree.gen.ts', 'b/*.ts']`. */
export function listaPermitidos(texto) {
  return String(texto ?? '')
    .split(',')
    .map((s) => s.replace(/\s*\([^)]*\)\s*$/, '').trim().replace(/\\/g, '/').replace(/^\.\//, ''))
    .filter(Boolean)
}

/** ¿La ruta cambiada cae dentro del alcance? Sin lista de permitidos, todo cae. */
export function enAlcance(ruta, permitidos) {
  return !permitidos.length || coincide(ruta, permitidos)
}

// ── Git ─────────────────────────────────────────────────────────────────────

function git(args, { env, opcional = false } = {}) {
  try {
    return execFileSync('git', args, {
      cwd: RAIZ,
      encoding: 'utf8',
      env: env ?? process.env,
      maxBuffer: 256 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (e) {
    if (opcional) return null
    throw new Error(`git ${args.join(' ')}: ${String(e.stderr || e.message).trim()}`)
  }
}

const corto = (sha) => String(sha).slice(0, 9)

/** Foto del árbol actual como commit suelto. `forzar`: rutas permitidas que git ignora. */
function foto(forzar = []) {
  const indiceReal = path.resolve(RAIZ, git(['rev-parse', '--git-path', 'index']).trim())
  const tmp = path.join(os.tmpdir(), `implementador-indice-${process.pid}-${Date.now()}`)
  try {
    fs.copyFileSync(indiceReal, tmp)
  } catch {
    // Repo sin índice todavía: la foto parte vacía.
  }
  const env = {
    ...process.env,
    GIT_INDEX_FILE: tmp,
    GIT_AUTHOR_NAME: 'implementador',
    GIT_AUTHOR_EMAIL: 'implementador@local',
    GIT_COMMITTER_NAME: 'implementador',
    GIT_COMMITTER_EMAIL: 'implementador@local',
  }
  try {
    git(['add', '-A', '--', '.'], { env })
    const extra = forzar.filter((p) => !/[*?]/.test(p) && fs.existsSync(path.join(RAIZ, p)))
    if (extra.length) git(['add', '-f', '--', ...extra], { env })
    const arbol = git(['write-tree'], { env }).trim()
    const head = git(['rev-parse', '--verify', '-q', 'HEAD'], { opcional: true })?.trim()
    return git(['commit-tree', arbol, ...(head ? ['-p', head] : []), '-m', 'implementador: foto del árbol'], { env }).trim()
  } finally {
    fs.rmSync(tmp, { force: true })
  }
}

function exigirBase(base) {
  if (!base || base.startsWith('--')) throw new Error('falta la BASE')
  if (git(['cat-file', '-e', `${base}^{commit}`], { opcional: true }) === null) throw new Error(`BASE desconocida: ${base}`)
  return base
}

function leerRegistro(desde) {
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

// ── Modos ───────────────────────────────────────────────────────────────────

function autoprueba() {
  const avisos = []
  try {
    const casos = [
      [{ tool_name: 'Bash', tool_input: { command: 'git push' } }, 'ejecutor', true],
      [{ tool_name: 'Bash', tool_input: { command: 'git status --short' } }, 'ejecutor', false],
      [{ tool_name: 'Write', tool_input: { file_path: '.claude/settings.json' } }, 'ejecutor', true],
      [{ tool_name: 'Edit', tool_input: { file_path: 'src/x.ts' } }, 'revisor', true],
    ]
    for (const [evento, rol, debeNegar] of casos) {
      if (Boolean(evaluar({ ...evento, cwd: RAIZ }, rol, RAIZ).motivo) !== debeNegar) {
        return `FALLA (${rol} ${evento.tool_name} ${JSON.stringify(evento.tool_input)})`
      }
    }
    for (const agente of ['ejecutor', 'revisor']) {
      const definicion = fs.readFileSync(path.join(AGENTES, `${agente}.md`), 'utf8')
      if (!definicion.includes('guardia.mjs')) return `FALLA (~/.claude/agents/${agente}.md no declara el hook)`
    }
    for (const agente of ['explorador', 'planificador', 'ejecutor', 'revisor']) {
      if (fs.existsSync(path.join(RAIZ, '.claude', 'agents', `${agente}.md`))) {
        avisos.push(`el proyecto redefine ${agente} (.claude/agents/${agente}.md) y manda sobre el global`)
      }
    }
    if (configDe(RAIZ).invalido) avisos.push('.claude/implementador.json no es JSON válido: rigen los valores por defecto')
    return avisos.length ? `OK con avisos: ${avisos.join(' · ')}` : 'OK'
  } catch (e) {
    return `FALLA (${e.message})`
  }
}

function preflight() {
  const desde = new Date().toISOString()
  const rama = git(['rev-parse', '--abbrev-ref', 'HEAD'], { opcional: true })?.trim() ?? '?'
  const head = git(['log', '-1', '--format=%h %s'], { opcional: true })?.trim() || '(sin commits)'
  const sucios = git(['status', '--porcelain=v1', '--untracked-files=all']).split('\n').filter(Boolean)
  const base = foto()
  const config = configDe(RAIZ)
  const reglas = fs.existsSync(path.join(RAIZ, '.claude', 'implementador.md'))
  const { pasos, origen } = pasosDe(RAIZ)
  console.log(`PROYECTO: ${RAIZ}`)
  console.log(`RAMA: ${rama} · HEAD ${head}`)
  if (!sucios.length) console.log('SUCIOS PREVIOS: ninguno')
  else {
    console.log(`SUCIOS PREVIOS (${sucios.length}):`)
    for (const s of sucios.slice(0, TOPE_SUCIOS)) console.log(`  ${s}`)
    if (sucios.length > TOPE_SUCIOS) console.log(`  … y ${sucios.length - TOPE_SUCIOS} más`)
  }
  console.log(`BASE_GLOBAL=${base} DESDE_GLOBAL=${desde}`)
  console.log(`REGLAS DEL PROYECTO: ${reglas ? '.claude/implementador.md' : 'no hay (.claude/implementador.md); rigen CLAUDE.md y las reglas comunes'}`)
  console.log(`CONFIG: ${config.archivo ? '.claude/implementador.json' : 'no hay; guardia con valores por defecto'}${config.pm ? ` · gestor JS: ${config.pm}` : ''}`)
  console.log(`VERIFICACIÓN (${origen}): ${pasos.length ? pasos.map((p) => p.cmd).join(' → ') : 'SIN PASOS'}`)
  console.log(`GUARDIA: ${autoprueba()}`)
}

function cambios(base, desde, permitidos) {
  const ahora = foto(permitidos)
  const mapa = new Map()
  const clave = (r) => (WIN ? r.toLowerCase() : r)
  for (const linea of git(['diff', '--name-status', '--no-renames', base, ahora]).split('\n')) {
    const m = /^([A-Z])\d*\t(.+)$/.exec(linea.trim())
    if (m) mapa.set(clave(m[2]), { estado: m[1], ruta: m[2], soloRegistro: false })
  }
  const filas = desde ? leerRegistro(desde) : []
  for (const f of filas) {
    if (f.rol !== 'ejecutor' || f.decision !== 'permitido' || !EDICIONES.has(f.herramienta) || !f.objetivo) continue
    if (!mapa.has(clave(f.objetivo))) mapa.set(clave(f.objetivo), { estado: '·', ruta: f.objetivo, soloRegistro: true })
  }
  const lista = [...mapa.values()].sort((a, b) => a.ruta.localeCompare(b.ruta))
  let fuera = 0
  console.log(`CAMBIOS desde ${corto(base)} (${lista.length}):`)
  for (const c of lista) {
    const dentro = enAlcance(c.ruta, permitidos)
    if (!dentro) fuera++
    const marca = permitidos.length ? (dentro ? '✓' : '✗') : ' '
    const nota = [
      dentro ? '' : 'FUERA DE ALCANCE',
      c.soloRegistro ? 'solo en el registro: ruta ignorada por git o edición sin efecto' : '',
    ]
      .filter(Boolean)
      .join(' · ')
    console.log(`  ${marca} ${c.estado} ${c.ruta}${nota ? `   ← ${nota}` : ''}`)
  }
  const negados = filas.filter((f) => f.decision === 'negado')
  if (negados.length) {
    console.log(`GUARDIA: ${negados.length} negación(es) desde ${desde}:`)
    for (const f of negados.slice(-5)) console.log(`  - ${f.rol} ${f.herramienta} «${String(f.objetivo ?? '').slice(0, 100)}» → ${f.motivo}`)
  }
  if (!permitidos.length) console.log('ALCANCE: (sin lista de permitidos)')
  else console.log(fuera ? `ALCANCE: FUERA (${fuera})` : 'ALCANCE: OK')
}

function diff(base, permitidos, rutas) {
  const ahora = foto(permitidos)
  const filtro = ['--', ...rutas]
  const stat = git(['diff', '--stat=150', '--no-renames', base, ahora, ...filtro]).trimEnd()
  const cuerpo = git(['diff', '--no-renames', '--no-color', base, ahora, ...filtro]).trimEnd()
  console.log(`DIFF ${corto(base)} → árbol actual${rutas.length ? ` (${rutas.join(', ')})` : ''}`)
  if (!cuerpo) {
    console.log('(sin cambios)')
    return
  }
  console.log(stat)
  console.log('')
  const lineas = cuerpo.split('\n')
  console.log(lineas.slice(0, TOPE_DIFF).join('\n'))
  if (lineas.length > TOPE_DIFF) {
    console.log(`\n… recortado: ${lineas.length - TOPE_DIFF} líneas más. Pide por ruta: --diff ${corto(base)} --permitidos "…" -- <ruta>`)
  }
}

function main() {
  const args = process.argv.slice(2)
  const corte = args.indexOf('--')
  const opciones = corte >= 0 ? args.slice(0, corte) : args
  const rutas = corte >= 0 ? args.slice(corte + 1) : []
  const valor = (nombre) => {
    const k = opciones.indexOf(nombre)
    return k >= 0 ? opciones[k + 1] : undefined
  }
  const permitidos = listaPermitidos(valor('--permitidos'))
  try {
    if (git(['rev-parse', '--is-inside-work-tree'], { opcional: true })?.trim() !== 'true') {
      throw new Error(`${RAIZ} no es un repositorio git: los flujos necesitan git (el usuario puede hacer git init)`)
    }
    if (opciones.includes('--base')) {
      const desde = new Date().toISOString()
      console.log(`BASE=${foto()} DESDE=${desde}`)
    } else if (opciones.includes('--cambios')) cambios(exigirBase(valor('--cambios')), valor('--desde'), permitidos)
    else if (opciones.includes('--diff')) diff(exigirBase(valor('--diff')), permitidos, rutas)
    else preflight()
  } catch (e) {
    console.log(`ERROR: ${e.message}`)
    process.exitCode = 2
  }
}

function esPrincipal() {
  if (!process.argv[1]) return false
  const a = path.resolve(process.argv[1])
  const b = fileURLToPath(import.meta.url)
  return WIN ? a.toLowerCase() === b.toLowerCase() : a === b
}

if (esPrincipal()) main()
