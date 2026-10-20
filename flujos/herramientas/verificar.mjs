#!/usr/bin/env node
// Escalera de verificación de los flujos /implementador, para cualquier proyecto.
//
// Los pasos salen de `<raíz>/.claude/qcc-implementador.json` (o, de respaldo, `.claude/implementador.json`) (`"verificar": [{ "nombre", "cmd", "timeoutSeg"? }]`,
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
// Con git se toma el árbol tras cada paso. Si la corrida VERDE cambió el árbol y todo cambio lo hicieron
// pasos de build (nombre o comando con build/compile/codegen/generate/gen/bundle y sin lint/format/fmt/fix/
// prettier/eslint/--fix/--write), se guarda además la clave del árbol posterior: la siguiente corrida, ya sobre
// la salida generada, sale de la caché. Si un paso que no es de build cambió algo, o el árbol no se pudo
// tomar a mitad de la corrida, no se guarda ninguna clave de esa corrida.
//
// Salidas: si la corrida (VERDE o ROJO) cambió archivos, anota en `<registro>-verificar-salidas.json`
// `{ t, ruta, blob, paso, generado }` por archivo (blob 0…0 si lo borró; `generado` si solo pasos de build lo
// cambiaron), sin lo de más de 24 h y con un tope de 500. `salidasDe(raiz)` lo lee.
//
// Marca de corrida: al empezar a correr anota `{ clave, pid, inicio }` junto al registro del proyecto
// (`-verificar-curso.json`) y al terminar la completa con `{ fin, resultado, salida }`. Otra corrida con
// el mismo árbol y los mismos pasos mientras esa siga viva (la verificación inicial del preflight, por ejemplo)
// no corre nada: la espera hasta 570 s, repite su salida y sale con su código. Una marca de un proceso muerto,
// o de hace más de 30 min, se ignora.
//
//   node ~/.claude/flujos/verificar.mjs [--sin-cache]
//
// Termina en `RESULTADO: VERDE` (exit 0), `RESULTADO: ROJO (<pasos>)` (exit 1),
// `RESULTADO: SIN PASOS` (exit 3: el proyecto no tiene verificación conocida) o
// `RESULTADO: EN CURSO (…)` (exit 4: la corrida que esperaba sigue tras 570 s; se repite). Con ROJO la línea va
// antes del detalle y se repite al final, para que una tubería (`| tail`) no la pierda.
// Salida compacta: con VERDE solo la tabla (una línea por paso) y `RESULTADO: VERDE`; desde la caché, la tabla
// guardada, la línea de la caché y el resultado. La cabecera `verificar (<origen>): …` se imprime solo con ROJO,
// antes de la tabla.

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { RAIZ, configDe, registroDe, arbolDe } from './guardia.mjs'

const WIN = process.platform === 'win32'
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]/g
const TEST_POR_DEFECTO = /no test specified/i
const TIMEOUT_SEG = 600
const VIGENCIA_MIN = 30
const TOPE_CACHE = 5
const ESPERA_SEG = 570
const SONDEO_MS = 500
const VIGENCIA_SALIDAS_H = 24
const TOPE_SALIDAS = 500
const BUILD = /\b(build|compile|codegen|generate|gen|bundle)\b/i
const NO_BUILD = /lint|format|fmt|fix|prettier|eslint|--fix|--write/i

/** ¿Es un paso de build (su salida es código generado)? Por nombre y comando; lint, format y fix no cuentan. */
export const esBuild = (paso) => {
  const n = `${paso.nombre} ${paso.cmd}`
  return BUILD.test(n) && !NO_BUILD.test(n)
}

/**
 * Archivos que difieren entre dos árboles de `arbolDe`: `[{ ruta, blob }]` con el blob que quedó en `b`
 * (40 ceros si lo borró). Lanza si git falla o la salida no tiene la forma esperada.
 */
export function cambiosDe(raiz, a, b) {
  const partes = execFileSync('git', ['diff-tree', '-r', '-z', '--no-renames', '--no-abbrev', a, b], {
    cwd: raiz, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  }).split('\0')
  if (partes.at(-1) === '') partes.pop()
  if (partes.length % 2) throw new Error('git diff-tree: salida inesperada')
  const lista = []
  for (let i = 0; i < partes.length; i += 2) {
    const blob = partes[i].split(' ')[3]
    if (!/^[0-9a-f]{40,64}$/.test(blob ?? '') || !partes[i + 1]) throw new Error('git diff-tree: salida inesperada')
    lista.push({ ruta: partes[i + 1], blob })
  }
  return lista
}

// ── Caché de corridas VERDE ─────────────────────────────────────────────────

/** Archivo de la caché del proyecto, junto a su registro. */
const cacheDe = (raiz) => registroDe(raiz).replace(/\.jsonl$/, '-verificar.json')

/** Clave de una corrida: el árbol de trabajo y los pasos (nombre, comando y tope). */
export const claveDe = (arbol, pasos) => crypto.createHash('sha1').update(JSON.stringify([arbol, pasos.map((p) => [p.nombre, p.cmd, p.timeoutSeg ?? null])])).digest('hex')

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

// ── Salidas: lo que cambió la corrida ───────────────────────────────────────

/** Archivo de las salidas del proyecto, junto a su registro. */
const salidasArchivo = (raiz) => registroDe(raiz).replace(/\.jsonl$/, '-verificar-salidas.json')

/** Lo que cambiaron las corridas de las últimas 24 h, `[{ t, ruta, blob, paso, generado }]` (la más antigua primero). */
export function salidasDe(raiz) {
  try {
    const lista = JSON.parse(fs.readFileSync(salidasArchivo(raiz), 'utf8'))
    if (!Array.isArray(lista)) return []
    return lista.filter((s) => s && typeof s.ruta === 'string' && typeof s.blob === 'string' && Date.now() - Date.parse(s.t) < VIGENCIA_SALIDAS_H * 3_600_000)
  } catch {
    return []
  }
}

function anotarSalidas(raiz, nuevas) {
  try {
    const lista = [...salidasDe(raiz), ...nuevas].slice(-TOPE_SALIDAS)
    fs.mkdirSync(path.dirname(salidasArchivo(raiz)), { recursive: true })
    fs.writeFileSync(salidasArchivo(raiz), JSON.stringify(lista, null, 2) + '\n')
  } catch {
    // Sin registro de salidas, la revisión de alcance se queda sin esa ayuda.
  }
}

/**
 * Seguimiento del árbol durante la corrida: después de cada paso anota qué archivos cambió. `final` es el
 * último árbol; `archivos` guarda por ruta los pasos que la cambiaron y si todos eran de build.
 */
function seguimientoDe(raiz, arbol) {
  const archivos = new Map()
  let final = arbol
  return {
    archivos,
    get final() {
      return final
    },
    /** Toma el árbol tras `paso`. Lanza si no se puede: quien llama descarta el seguimiento entero. */
    despuesDe(paso) {
      const despues = arbolDe(raiz)
      if (despues === final) return
      for (const { ruta } of cambiosDe(raiz, final, despues)) {
        const a = archivos.get(ruta) ?? { pasos: [], build: true }
        if (!a.pasos.includes(paso.nombre)) a.pasos.push(paso.nombre)
        a.build &&= esBuild(paso)
        archivos.set(ruta, a)
      }
      final = despues
    },
  }
}

// ── Marca de corrida en curso ───────────────────────────────────────────────

/** Archivo de la marca de la corrida en curso del proyecto, junto a su registro. */
export const marcaDe = (raiz) => registroDe(raiz).replace(/\.jsonl$/, '-verificar-curso.json')

/** ¿Sigue vivo el proceso `pid`? `EPERM` cuenta como vivo: existe, aunque no sea nuestro. */
export function vivo(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return e.code === 'EPERM'
  }
}

const dormir = (ms) => new Promise((listo) => setTimeout(listo, ms))

/** La marca del proyecto, o null si no hay o está a medio escribir. */
function leerMarca(raiz) {
  try {
    const m = JSON.parse(fs.readFileSync(marcaDe(raiz), 'utf8'))
    return m && typeof m === 'object' && !Array.isArray(m) ? m : null
  } catch {
    return null
  }
}

/** ¿La marca es de una corrida con esta clave que sigue viva (y de hace menos de `VIGENCIA_MIN` min)? */
const enCurso = (m, clave) => Boolean(m) && m.clave === clave && !m.fin && vivo(m.pid) && Date.now() - Date.parse(m.inicio) < VIGENCIA_MIN * 60_000

/** Crea la marca solo si no existe (`wx`): de dos corridas simultáneas gana una. Un fallo distinto de «ya existe» no frena la corrida. */
function reclamar(raiz, marca) {
  try {
    fs.mkdirSync(path.dirname(marcaDe(raiz)), { recursive: true })
    fs.writeFileSync(marcaDe(raiz), JSON.stringify(marca) + '\n', { flag: 'wx' })
    return true
  } catch (e) {
    return e.code !== 'EEXIST'
  }
}

/** Completa la marca propia con `datos`, solo si sigue siendo de este proceso. Se escribe aparte y se renombra: nadie lee a medias. */
function completarMarca(raiz, propia, datos) {
  const tmp = `${marcaDe(raiz)}.${process.pid}.tmp`
  try {
    const m = leerMarca(raiz)
    if (!m || m.pid !== propia.pid || m.inicio !== propia.inicio) return
    fs.writeFileSync(tmp, JSON.stringify({ ...m, ...datos }) + '\n')
    fs.renameSync(tmp, marcaDe(raiz))
  } catch {
    fs.rmSync(tmp, { force: true })
  }
}

/**
 * Espera a que termine la corrida de `previa`, hasta `ESPERA_SEG` s desde `t0`. Devuelve su marca ya completa,
 * `'vencido'` si se acabó el tiempo, o null si el proceso murió sin completarla (o otra corrida tomó su lugar).
 */
async function esperarCorrida(raiz, previa, t0) {
  while (Date.now() - t0 < ESPERA_SEG * 1000) {
    await dormir(SONDEO_MS)
    const vive = vivo(previa.pid)
    const m = leerMarca(raiz)
    if (m && m.pid === previa.pid && m.inicio === previa.inicio && m.fin) return m
    if (!vive) return null
  }
  return 'vencido'
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
      origen: config.nombre,
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
    if (WIN) spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
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
      windowsHide: true,
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
    console.log('Define los comandos en .claude/qcc-implementador.json →"verificar": [{ "nombre": "test", "cmd": "…" }]')
    console.log('RESULTADO: SIN PASOS')
    process.exitCode = 3
    return
  }

  const cabecera = `verificar (${origen}): ${pasos.map((p) => p.cmd).join(' → ')}`
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

  // ¿Hay otra corrida viva con esta clave? Se espera y se repite su salida. Si no, se reclama la marca y se corre.
  let propia = null
  if (clave) {
    const t0 = Date.now()
    for (let intento = 0; intento < 20; intento++) {
      const previa = leerMarca(RAIZ)
      if (enCurso(previa, clave)) {
        const fin = await esperarCorrida(RAIZ, previa, t0)
        if (fin === 'vencido') {
          console.log(`RESULTADO: EN CURSO (otra corrida con este árbol sigue tras ${ESPERA_SEG} s; repite verificar.mjs)`)
          process.exitCode = 4
          return
        }
        if (fin) {
          const hora = new Date(fin.inicio).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })
          console.log(`(esperó la corrida en curso de las ${hora})`)
          for (const l of Array.isArray(fin.salida) ? fin.salida : []) console.log(l)
          process.exitCode = fin.resultado === 'RESULTADO: VERDE' ? 0 : 1
          return
        }
        continue
      }
      // Una marca vieja (de un proceso muerto, ya terminada o de otro árbol) se quita antes de reclamar la propia.
      if (previa) fs.rmSync(marcaDe(RAIZ), { force: true })
      const marca = { clave, pid: process.pid, inicio: new Date().toISOString() }
      if (reclamar(RAIZ, marca)) {
        propia = marca
        break
      }
      await dormir(100)
    }
  }

  // Todo lo que se imprime desde aquí queda también en la marca, para quien espere esta corrida.
  const salida = []
  const imprimir = (linea) => {
    salida.push(linea)
    console.log(linea)
  }
  const resultados = []
  let seg = clave ? seguimientoDe(RAIZ, arbol) : null
  for (const paso of pasos) {
    const t0 = Date.now()
    const tope = paso.timeoutSeg ?? TIMEOUT_SEG
    const r = await correr(paso.cmd, tope)
    resultados.push({ ...paso, ok: r.codigo === 0 && !r.vencido, codigo: r.codigo, vencido: r.vencido, tope, segundos: (Date.now() - t0) / 1000, salida: r.salida })
    if (seg) {
      try {
        seg.despuesDe(paso)
      } catch {
        // Sin el árbol de este paso no se sabe qué cambió: ni claves nuevas ni registro de salidas.
        seg = null
      }
    }
  }

  const tabla = resultados.map((r) => {
    const tiempo = `${r.segundos.toFixed(1).replace('.', ',')} s`.padStart(7)
    const extra = r.resumen ? r.resumen(r.salida) : ''
    return `${r.nombre.padEnd(10)} ${r.ok ? 'OK   ' : 'FALLÓ'} ${tiempo}${extra ? `   ${extra}` : ''}`
  })
  const rojos = resultados.filter((r) => !r.ok)
  if (rojos.length) imprimir(cabecera)
  for (const l of tabla) imprimir(l)
  if (seg) {
    try {
      if (seg.final !== arbol) {
        const cambiados = cambiosDe(RAIZ, arbol, seg.final)
        const t = new Date().toISOString()
        anotarSalidas(RAIZ, cambiados.map(({ ruta, blob }) => {
          const a = seg.archivos.get(ruta)
          return { t, ruta, blob, paso: a ? a.pasos.join(', ') : '', generado: Boolean(a?.build) }
        }))
      }
    } catch {
      seg = null
    }
  }
  if (!rojos.length && clave) {
    const entrada = (k, a) => ({ clave: k, arbol: a, t: new Date().toISOString(), tabla })
    if (seg && seg.final === arbol) {
      guardarVerde(RAIZ, entrada(clave, arbol))
    } else if (seg && [...seg.archivos.values()].every((a) => a.build)) {
      // Solo pasos de build cambiaron el árbol: la próxima corrida ya parte de su salida y puede salir de la caché.
      guardarVerde(RAIZ, entrada(clave, arbol))
      guardarVerde(RAIZ, entrada(claveDe(seg.final, todos), seg.final))
    }
  }
  const resultado = rojos.length ? `RESULTADO: ROJO (${rojos.map((r) => r.nombre).join(', ')})` : 'RESULTADO: VERDE'
  imprimir(resultado)
  for (const r of rojos) {
    imprimir(`\n── ${r.nombre}: ${r.vencido ? `superó ${r.tope} s (timeoutSeg) y se cortó` : `falló (exit ${r.codigo})`} ──`)
    imprimir(r.detalle(r.salida))
  }
  if (rojos.length) imprimir(`\n${resultado}`)
  if (propia) completarMarca(RAIZ, propia, { fin: new Date().toISOString(), resultado, salida })
  process.exitCode = rojos.length ? 1 : 0
}

function esPrincipal() {
  if (!process.argv[1]) return false
  const a = path.resolve(process.argv[1])
  const b = fileURLToPath(import.meta.url)
  return WIN ? a.toLowerCase() === b.toLowerCase() : a === b
}

if (esPrincipal()) await main()
