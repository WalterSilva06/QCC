#!/usr/bin/env node
// Verificación lite de /qcc-implementador-odd, para cualquier proyecto.
//
// Los pasos salen de `verificar` en `<raíz>/.claude/qcc-implementador-odd.json` (`[{ "nombre", "cmd", "timeoutSeg"? }]`,
// en orden). Sin esa clave se detectan:
//   - JS/TS: scripts de package.json, en este orden: typecheck (o type-check / check-types / tsc), lint, build,
//     test; con el gestor del lockfile.
//   - Rust: cargo check --all-targets → cargo test.   Go: go build ./... → go test ./...
//   - Python con pytest configurado: python -m pytest -q.
// Corre todos los pasos (aunque uno falle) con CI=1, cada uno con un tope de `timeoutSeg` (600 por defecto); al
// vencer se corta con sus procesos. Salida corta: una línea por paso y, solo de los que fallan, las últimas
// TOPE_DETALLE líneas. Sin caché.
//
//   node ~/.claude/flujos-odd/verificar.mjs
//
// Termina en `RESULTADO: VERDE` (exit 0), `RESULTADO: ROJO (<pasos>)` (exit 1) o `RESULTADO: SIN PASOS` (exit 3).

import fs from 'node:fs'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { raizDe } from './guardia.mjs'

const WIN = process.platform === 'win32'
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]/g
const TIMEOUT_SEG = 600
const TOPE_DETALLE = 60
const CONFIG = '.claude/qcc-implementador-odd.json'

const leerJson = (archivo) => {
  try {
    return JSON.parse(fs.readFileSync(archivo, 'utf8'))
  } catch {
    return null
  }
}

/** Gestor de paquetes según el lockfile. */
export function gestorDe(raiz) {
  if (fs.existsSync(path.join(raiz, 'pnpm-lock.yaml'))) return 'pnpm'
  if (fs.existsSync(path.join(raiz, 'yarn.lock'))) return 'yarn'
  if (fs.existsSync(path.join(raiz, 'bun.lockb')) || fs.existsSync(path.join(raiz, 'bun.lock'))) return 'bun'
  return 'npm'
}

/** Los pasos de verificación de `raiz`: `{ origen, pasos: [{ nombre, cmd, timeoutSeg }] }`. */
export function pasosDe(raiz) {
  const config = leerJson(path.join(raiz, CONFIG))
  if (Array.isArray(config?.verificar)) {
    const pasos = config.verificar.filter((p) => p && typeof p.cmd === 'string' && p.cmd.trim()).map((p) => ({ nombre: String(p.nombre ?? p.cmd), cmd: p.cmd, timeoutSeg: Number(p.timeoutSeg) > 0 ? Number(p.timeoutSeg) : TIMEOUT_SEG }))
    return { origen: CONFIG, pasos }
  }
  const paso = (nombre, cmd) => ({ nombre, cmd, timeoutSeg: TIMEOUT_SEG })
  const pkg = leerJson(path.join(raiz, 'package.json'))
  if (pkg) {
    const scripts = pkg.scripts ?? {}
    const gestor = gestorDe(raiz)
    const correr = (s) => (gestor === 'npm' ? `npm run ${s}` : `${gestor} run ${s}`)
    const tipos = ['typecheck', 'type-check', 'check-types', 'tsc'].find((s) => scripts[s])
    const pasos = [tipos, 'lint', 'build'].filter((s) => s && scripts[s]).map((s) => paso(s, correr(s)))
    if (scripts.test && !/no test specified/i.test(scripts.test)) pasos.push(paso('test', correr('test')))
    return { origen: 'package.json', pasos }
  }
  if (fs.existsSync(path.join(raiz, 'Cargo.toml'))) return { origen: 'Cargo.toml', pasos: [paso('check', 'cargo check --all-targets'), paso('test', 'cargo test')] }
  if (fs.existsSync(path.join(raiz, 'go.mod'))) return { origen: 'go.mod', pasos: [paso('build', 'go build ./...'), paso('test', 'go test ./...')] }
  const pytest = fs.existsSync(path.join(raiz, 'pytest.ini')) || /\[tool\.pytest/.test(fs.existsSync(path.join(raiz, 'pyproject.toml')) ? fs.readFileSync(path.join(raiz, 'pyproject.toml'), 'utf8') : '')
  if (pytest) return { origen: 'pytest', pasos: [paso('test', 'python -m pytest -q')] }
  return { origen: 'ninguno', pasos: [] }
}

/** Las últimas `tope` líneas no vacías de `texto`, sin colores. */
export function colaDe(texto, tope = TOPE_DETALLE) {
  const lineas = String(texto).replace(ANSI, '').split(/\r?\n/).filter((l) => l.trim())
  return { lineas: lineas.slice(-tope), cortadas: Math.max(0, lineas.length - tope) }
}

/** Corta el proceso `hijo` y sus descendientes. */
function cortar(hijo) {
  try {
    if (WIN) spawnSync('taskkill', ['/T', '/F', '/PID', String(hijo.pid)], { stdio: 'ignore', windowsHide: true })
    else process.kill(-hijo.pid, 'SIGKILL')
  } catch {
    // Ya terminó.
  }
}

/** Corre un paso en `raiz`: `{ codigo, segundos, salida, vencido }`. */
function correrPaso(paso, raiz) {
  return new Promise((resolver) => {
    const inicio = Date.now()
    const hijo = spawn(paso.cmd, { cwd: raiz, shell: true, env: { ...process.env, CI: '1', FORCE_COLOR: '0' }, detached: !WIN, windowsHide: true })
    let salida = ''
    let vencido = false
    hijo.stdout.on('data', (d) => (salida += d))
    hijo.stderr.on('data', (d) => (salida += d))
    const reloj = setTimeout(() => {
      vencido = true
      cortar(hijo)
    }, paso.timeoutSeg * 1000)
    hijo.on('close', (codigo) => {
      clearTimeout(reloj)
      resolver({ codigo: vencido ? 124 : codigo ?? 1, segundos: Math.round((Date.now() - inicio) / 1000), salida, vencido })
    })
    hijo.on('error', (e) => {
      clearTimeout(reloj)
      resolver({ codigo: 127, segundos: 0, salida: String(e.message), vencido: false })
    })
  })
}

async function main() {
  const raiz = raizDe(process.env.CLAUDE_PROJECT_DIR || process.cwd())
  const { origen, pasos } = pasosDe(raiz)
  if (!pasos.length) {
    console.log(`RESULTADO: SIN PASOS (no hay ${CONFIG} con "verificar" ni package.json, Cargo.toml, go.mod o pytest)`)
    process.exitCode = 3
    return
  }
  const fallidos = []
  const detalles = []
  const filas = []
  for (const paso of pasos) {
    const r = await correrPaso(paso, raiz)
    const ok = r.codigo === 0
    filas.push(`${ok ? '✓' : '✗'} ${paso.nombre} · ${r.segundos} s${ok ? '' : r.vencido ? ` · cortado a los ${paso.timeoutSeg} s` : ` · exit ${r.codigo}`}`)
    if (ok) continue
    fallidos.push(paso.nombre)
    const { lineas, cortadas } = colaDe(r.salida)
    detalles.push(`── ${paso.nombre}: ${paso.cmd}${cortadas ? ` (últimas ${lineas.length} líneas de ${lineas.length + cortadas})` : ''}`, ...lineas)
  }
  const resultado = fallidos.length ? `RESULTADO: ROJO (${fallidos.join(', ')})` : 'RESULTADO: VERDE'
  if (fallidos.length) console.log(`${resultado} · pasos de ${origen}`)
  console.log(filas.join('\n'))
  if (detalles.length) console.log(`\n${detalles.join('\n')}\n`)
  console.log(resultado)
  process.exitCode = fallidos.length ? 1 : 0
}

function esPrincipal() {
  if (!process.argv[1]) return false
  const a = path.resolve(process.argv[1])
  const b = fileURLToPath(import.meta.url)
  return WIN ? a.toLowerCase() === b.toLowerCase() : a === b
}

if (esPrincipal()) main()
