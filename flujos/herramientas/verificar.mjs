#!/usr/bin/env node
// Escalera de verificación de los flujos /implementador, para cualquier proyecto.
//
// Los pasos salen de `<raíz>/.claude/implementador.json` (`"verificar": [{ "nombre", "cmd" }]`,
// en orden). Sin esa clave se detectan:
//   - JS/TS: scripts de package.json, en este orden: typecheck (o type-check / check-types /
//     tsc), lint, build, test; con el gestor del lockfile.
//   - Rust: cargo check --all-targets → cargo test.   Go: go build ./... → go test ./...
//   - Python con pytest configurado: python -m pytest -q.
// Resume la salida para que un agente no gaste contexto en cientos de líneas verdes; cuando
// algo falla, muestra el detalle. Corre con CI=1 (sin modo watch ni prompts).
//
//   node ~/.claude/flujos/verificar.mjs
//
// Termina en `RESULTADO: VERDE` (exit 0), `RESULTADO: ROJO (<pasos>)` (exit 1) o
// `RESULTADO: SIN PASOS` (exit 3: el proyecto no tiene verificación conocida).

import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { RAIZ, configDe } from './guardia.mjs'

const WIN = process.platform === 'win32'
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]/g
const TEST_POR_DEFECTO = /no test specified/i

const cola = (texto, n) => texto.trimEnd().split('\n').slice(-n).join('\n')

function detalleTipos(salida) {
  const errores = salida.split('\n').filter((l) => /error TS\d+|error\[E\d+\]|^\S+:\d+:\d+: error/.test(l))
  if (!errores.length) return cola(salida, 30)
  const extra = errores.length > 40 ? `\n(+${errores.length - 40} errores más)` : ''
  return errores.slice(0, 40).join('\n') + extra
}

function resumenTest(salida) {
  const archivos = /^\s*Test Files\s+(.+)$/m.exec(salida)?.[1]?.trim()
  const tests = /^\s*Tests:?\s+(.+)$/m.exec(salida)?.[1]?.trim()
  const pytest = /^=+ (.*(passed|failed|error).*) =+$/m.exec(salida)?.[1]?.trim()
  const cargo = [...salida.matchAll(/^test result: (.+)$/gm)].map((m) => m[1]).pop()
  return [archivos && `archivos: ${archivos}`, tests && `tests: ${tests}`, pytest, cargo].filter(Boolean).join(' · ')
}

function detalleTest(salida) {
  const lineas = salida.split('\n')
  let desde = lineas.findIndex((l) => /Failed Tests|Failed Suites|^=+ FAILURES =+|^failures:$/.test(l))
  if (desde < 0) desde = lineas.findIndex((l) => /\bFAIL\b/.test(l))
  if (desde < 0) return cola(salida, 40)
  const tramo = lineas.slice(desde, desde + 120).join('\n')
  const resumen = resumenTest(salida)
  return resumen ? `${tramo}\n…\n${resumen}` : tramo
}

function conDetalle(paso) {
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
      pasos: config.verificar.filter((p) => p && p.cmd).map((p) => ({ nombre: String(p.nombre ?? p.cmd), cmd: String(p.cmd) })),
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

function main() {
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
  const resultados = []
  for (const paso of pasos) {
    const t0 = Date.now()
    const r = spawnSync(paso.cmd, {
      cwd: RAIZ,
      shell: true,
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
      env: { ...process.env, CI: '1', NO_COLOR: '1', FORCE_COLOR: '0' },
    })
    const salida = `${r.stdout ?? ''}\n${r.stderr ?? ''}${r.error ? `\n${r.error.message}` : ''}`.replace(ANSI, '')
    resultados.push({ ...paso, ok: r.status === 0, codigo: r.status ?? r.signal ?? 'sin código', segundos: (Date.now() - t0) / 1000, salida })
  }

  for (const r of resultados) {
    const tiempo = `${r.segundos.toFixed(1).replace('.', ',')} s`.padStart(7)
    const extra = r.resumen ? r.resumen(r.salida) : ''
    console.log(`${r.nombre.padEnd(10)} ${r.ok ? 'OK   ' : 'FALLÓ'} ${tiempo}${extra ? `   ${extra}` : ''}`)
  }
  const rojos = resultados.filter((r) => !r.ok)
  console.log(rojos.length ? `RESULTADO: ROJO (${rojos.map((r) => r.nombre).join(', ')})` : 'RESULTADO: VERDE')
  for (const r of rojos) {
    console.log(`\n── ${r.nombre}: falló (exit ${r.codigo}) ──`)
    console.log(r.detalle(r.salida))
  }
  process.exitCode = rojos.length ? 1 : 0
}

function esPrincipal() {
  if (!process.argv[1]) return false
  const a = path.resolve(process.argv[1])
  const b = fileURLToPath(import.meta.url)
  return WIN ? a.toLowerCase() === b.toLowerCase() : a === b
}

if (esPrincipal()) main()
