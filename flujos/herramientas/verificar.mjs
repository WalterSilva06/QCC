#!/usr/bin/env node
// Escalera de verificación de los flujos /implementador, para cualquier proyecto.
//
// Los pasos salen de `<raíz>/.claude/implementador.json` (`"verificar": [{ "nombre", "cmd", "timeoutSeg"? }]`,
// en orden). Sin esa clave se detectan:
//   - JS/TS: scripts de package.json, en este orden: typecheck (o type-check / check-types /
//     tsc), lint, build, test; con el gestor del lockfile.
//   - Rust: cargo check --all-targets → cargo test.   Go: go build ./... → go test ./...
//   - Python con pytest configurado: python -m pytest -q.
// Resume la salida para que un agente no gaste contexto en cientos de líneas verdes; cuando
// algo falla, muestra el detalle. Corre con CI=1 (sin modo watch ni prompts). Cada paso tiene un
// tope de `timeoutSeg` segundos (600 por defecto): al vencer se corta con todos sus procesos y sale ROJO.
//
// Caché: si el árbol de trabajo (versionados + nuevos no ignorados) y los pasos son los mismos de una
// corrida VERDE de los últimos 30 min, la repite sin correr nada y lo dice. `--sin-cache` corre igual.
//
//   node ~/.claude/flujos/verificar.mjs [--sin-cache]
//
// Termina en `RESULTADO: VERDE` (exit 0), `RESULTADO: ROJO (<pasos>)` (exit 1) o
// `RESULTADO: SIN PASOS` (exit 3: el proyecto no tiene verificación conocida). Con ROJO la línea va
// antes del detalle y se repite al final, para que una tubería (`| tail`) no la pierda.

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { RAIZ, configDe, registroDe, arbolDe } from './guardia.mjs'

const WIN = process.platform === 'win32'
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]/g
const TEST_POR_DEFECTO = /no test specified/i
const TIMEOUT_SEG = 600
const VIGENCIA_MIN = 30
const TOPE_CACHE = 5

// ── Caché de corridas VERDE ─────────────────────────────────────────────────

/** Archivo de la caché del proyecto, junto a su registro. */
const cacheDe = (raiz) => registroDe(raiz).replace(/\.jsonl$/, '-verificar.json')

/** Clave de una corrida: el árbol de trabajo y los pasos (nombre, comando y tope). */
const claveDe = (arbol, pasos) => crypto.createHash('sha1').update(JSON.stringify([arbol, pasos.map((p) => [p.nombre, p.cmd, p.timeoutSeg ?? null])])).digest('hex')

function leerCache(raiz) {
  try {
    const lista = JSON.parse(fs.readFileSync(cacheDe(raiz), 'utf8'))
    return Array.isArray(lista) ? lista : []
  } catch {
    return []
  }
}

/** La última corrida VERDE del proyecto (la más reciente primero), o null. */
export function ultimaVerde(raiz) {
  return leerCache(raiz)[0] ?? null
}

/** La corrida VERDE con esa clave, si tiene menos de `VIGENCIA_MIN` minutos. */
function verdeVigente(raiz, clave) {
  return leerCache(raiz).find((e) => e.clave === clave && Date.now() - Date.parse(e.t) < VIGENCIA_MIN * 60_000) ?? null
}

function guardarVerde(raiz, entrada) {
  try {
    const lista = [entrada, ...leerCache(raiz).filter((e) => e.clave !== entrada.clave)].slice(0, TOPE_CACHE)
    fs.mkdirSync(path.dirname(cacheDe(raiz)), { recursive: true })
    fs.writeFileSync(cacheDe(raiz), JSON.stringify(lista, null, 2) + '\n')
  } catch {
    // Sin caché, la próxima corrida corre entera.
  }
}

const cola = (texto, n) => texto.trimEnd().split('\n').slice(-n).join('\n')

export function detalleTipos(salida) {
  const errores = salida.split('\n').filter((l) => /error TS\d+|error\[E\d+\]|^\S+:\d+:\d+: error/.test(l))
  if (!errores.length) return cola(salida, 30)
  const extra = errores.length > 40 ? `\n(+${errores.length - 40} errores más)` : ''
  return errores.slice(0, 40).join('\n') + extra
}

export function resumenTest(salida) {
  const archivos = /^\s*Test Files\s+(.+)$/m.exec(salida)?.[1]?.trim()
  const tests = /^\s*Tests:?\s+(.+)$/m.exec(salida)?.[1]?.trim()
  const pytest = /^=+ (.*(passed|failed|error).*) =+$/m.exec(salida)?.[1]?.trim()
  const cargo = [...salida.matchAll(/^test result: (.+)$/gm)].map((m) => m[1]).pop()
  return [archivos && `archivos: ${archivos}`, tests && `tests: ${tests}`, pytest, cargo].filter(Boolean).join(' · ')
}

export function detalleTest(salida) {
  const lineas = salida.split('\n')
  let desde = lineas.findIndex((l) => /Failed Tests|Failed Suites|^=+ FAILURES =+|^failures:$/.test(l))
  if (desde < 0) desde = lineas.findIndex((l) => /\bFAIL\b/.test(l))
  if (desde < 0) return cola(salida, 40)
  const tramo = lineas.slice(desde, desde + 120).join('\n')
  const resumen = resumenTest(salida)
  return resumen ? `${tramo}\n…\n${resumen}` : tramo
}

export function conDetalle(paso) {
  const n = `${paso.nombre} ${paso.cmd}`.toLowerCase()
  if (/test|spec|pytest/.test(n)) return { ...paso, detalle: detalleTest, resumen: resumenTest }
  if (/type|tsc|check|mypy|pyright/.test(n)) return { ...paso, detalle: detalleTipos }
  return { ...paso, detalle: (s) => cola(s, 40) }
}

/** `{ pasos, origen }`: los pasos de verificación del proyecto y de dónde salieron. */
export function pasosDe(raiz) {
  const config = configDe(raiz)
  if (config.verificar) {
    return {
      origen: '.claude/implementador.json',
      pasos: config.verificar.filter((p) => p && p.cmd).map((p) => ({
        nombre: String(p.nombre ?? p.cmd),
        cmd: String(p.cmd),
        ...(Number(p.timeoutSeg) > 0 ? { timeoutSeg: Number(p.timeoutSeg) } : {}),
      })),
    }
  }
  const hay = (f) => fs.existsSync(path.join(raiz, f))
  const pasos = []
  if (hay('package.json')) {
    const pm = config.pm ?? 'npm'
    const s = config.scripts
    const tipos = ['typecheck', 'type-check', 'check-types', 'types', 'tsc'].find((k) => s[k])
    for (const nombre of [tipos, 'lint', 'build', 'test']) {
      if (!nombre || !s[nombre]) continue
      if (nombre === 'test' && TEST_POR_DEFECTO.test(s[nombre])) continue
      pasos.push({ nombre: nombre === tipos ? 'typecheck' : nombre, cmd: `${pm} run ${nombre}` })
    }
    if (pasos.length) return { origen: `package.json (${pm})`, pasos }
  }
  if (hay('Cargo.toml')) {
    return { origen: 'Cargo.toml', pasos: [{ nombre: 'check', cmd: 'cargo check --all-targets' }, { nombre: 'test', cmd: 'cargo test' }] }
  }
  if (hay('go.mod')) {
    return { origen: 'go.mod', pasos: [{ nombre: 'build', cmd: 'go build ./...' }, { nombre: 'test', cmd: 'go test ./...' }] }
  }
  let pyproject = ''
  try {
    pyproject = fs.readFileSync(path.join(raiz, 'pyproject.toml'), 'utf8')
  } catch {
    // Sin pyproject.
  }
  if (hay('pytest.ini') || hay('conftest.py') || /\[tool\.pytest/.test(pyproject)) {
    return { origen: 'pytest', pasos: [{ nombre: 'test', cmd: `${WIN ? 'python' : 'python3'} -m pytest -q` }] }
  }
  return { origen: 'ninguno', pasos: [] }
}

/** Mata `pid` con todos sus descendientes: en Windows con `taskkill /T`; en el resto, su grupo de procesos. */
function matarArbol(pid) {
  try {
    if (WIN) spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' })
    else process.kill(-pid, 'SIGKILL')
  } catch {
    // Ya terminó.
  }
}

/** Corre `cmd` con shell desde la raíz: `{ codigo, salida, vencido }`. Si pasa de `segundos`, lo corta con todo su árbol. */
function correr(cmd, segundos) {
  return new Promise((listo) => {
    let stdout = ''
    let stderr = ''
    let error = ''
    let vencido = false
    const hijo = spawn(cmd, {
      cwd: RAIZ,
      shell: true,
      detached: !WIN,
      env: { ...process.env, CI: '1', NO_COLOR: '1', FORCE_COLOR: '0' },
    })
    hijo.stdout.setEncoding('utf8').on('data', (d) => (stdout += d))
    hijo.stderr.setEncoding('utf8').on('data', (d) => (stderr += d))
    const reloj = setTimeout(() => {
      vencido = true
      matarArbol(hijo.pid)
    }, segundos * 1000)
    hijo.on('error', (e) => (error = e.message))
    hijo.on('close', (status, signal) => {
      clearTimeout(reloj)
      listo({ codigo: status ?? signal ?? 'sin código', salida: `${stdout}\n${stderr}${error ? `\n${error}` : ''}`.replace(ANSI, ''), vencido })
    })
  })
}

async function main() {
  const { pasos: todos, origen } = pasosDe(RAIZ)
  const pasos = todos.map(conDetalle)

  if (!pasos.length) {
    console.log(`verificar: sin pasos (origen: ${origen}) en ${RAIZ}`)
    console.log('Define los comandos en .claude/implementador.json → "verificar": [{ "nombre": "test", "cmd": "…" }]')
    console.log('RESULTADO: SIN PASOS')
    process.exitCode = 3
    return
  }

  console.log(`verificar (${origen}): ${pasos.map((p) => p.cmd).join(' → ')}`)
  let arbol = null
  try {
    arbol = arbolDe(RAIZ)
  } catch {
    // Sin git no hay caché.
  }
  const clave = arbol ? claveDe(arbol, todos) : null
  const previa = clave && !process.argv.includes('--sin-cache') ? verdeVigente(RAIZ, clave) : null
  if (previa) {
    for (const l of previa.tabla ?? []) console.log(l)
    const hora = new Date(previa.t).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })
    console.log(`(caché: el árbol ${arbol.slice(0, 9)} ya salió VERDE con estos pasos a las ${hora}; --sin-cache los corre igual)`)
    console.log('RESULTADO: VERDE')
    process.exitCode = 0
    return
  }
  const resultados = []
  for (const paso of pasos) {
    const t0 = Date.now()
    const tope = paso.timeoutSeg ?? TIMEOUT_SEG
    const r = await correr(paso.cmd, tope)
    resultados.push({ ...paso, ok: r.codigo === 0 && !r.vencido, codigo: r.codigo, vencido: r.vencido, tope, segundos: (Date.now() - t0) / 1000, salida: r.salida })
  }

  const tabla = resultados.map((r) => {
    const tiempo = `${r.segundos.toFixed(1).replace('.', ',')} s`.padStart(7)
    const extra = r.resumen ? r.resumen(r.salida) : ''
    return `${r.nombre.padEnd(10)} ${r.ok ? 'OK   ' : 'FALLÓ'} ${tiempo}${extra ? `   ${extra}` : ''}`
  })
  for (const l of tabla) console.log(l)
  const rojos = resultados.filter((r) => !r.ok)
  if (!rojos.length && clave) guardarVerde(RAIZ, { clave, arbol, t: new Date().toISOString(), tabla })
  const resultado = rojos.length ? `RESULTADO: ROJO (${rojos.map((r) => r.nombre).join(', ')})` : 'RESULTADO: VERDE'
  console.log(resultado)
  for (const r of rojos) {
    console.log(`\n── ${r.nombre}: ${r.vencido ? `superó ${r.tope} s (timeoutSeg) y se cortó` : `falló (exit ${r.codigo})`} ──`)
    console.log(r.detalle(r.salida))
  }
  if (rojos.length) console.log(`\n${resultado}`)
  process.exitCode = rojos.length ? 1 : 0
}

function esPrincipal() {
  if (!process.argv[1]) return false
  const a = path.resolve(process.argv[1])
  const b = fileURLToPath(import.meta.url)
  return WIN ? a.toLowerCase() === b.toLowerCase() : a === b
}

if (esPrincipal()) await main()
