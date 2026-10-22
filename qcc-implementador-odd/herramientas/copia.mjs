// Copia de la BASE y comparación diferencial de /qcc-implementador-odd (nivel usuario).
//
// `copiaBase` extrae el árbol de la BASE en un temporal nuevo (con un índice temporal: no toca el del usuario).
// `diferencial` corre un comando en esa copia y en el repo, y compara salida, errores y código de salida.
// Lo usan `odd.mjs` (`--copia-base`, `--diferencial`) y `verificar.mjs`. No importa de `odd.mjs`.
//
// Solo borra carpetas bajo `os.tmpdir()` cuyo nombre empieza por `qcc-odd-`: nunca el repo.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync, spawn, spawnSync } from 'node:child_process'

const WIN = process.platform === 'win32'
const PREFIJO = 'qcc-odd-'
const TOPE_SEG = 300
const TOPE_LINEAS = 40

function git(args, { raiz, env }) {
  try {
    return execFileSync('git', args, {
      cwd: raiz,
      encoding: 'utf8',
      env: env ?? process.env,
      maxBuffer: 256 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
  } catch (e) {
    throw new Error(`git ${args.join(' ')}: ${String(e.stderr || e.message).trim()}`)
  }
}

/** Borra `carpeta` solo si está bajo el temporal del sistema y su nombre lleva el prefijo `qcc-odd-`. */
function borrarTemporal(carpeta) {
  try {
    const abs = path.resolve(carpeta)
    const tmp = path.resolve(os.tmpdir())
    const cmp = (p) => (WIN ? p.toLowerCase() : p)
    if (cmp(path.dirname(abs)) !== cmp(tmp)) return
    if (!path.basename(abs).startsWith(PREFIJO)) return
    fs.rmSync(abs, { recursive: true, force: true })
  } catch {
    // Un temporal que no se pudo borrar no rompe el resultado.
  }
}

/** Copia el árbol de la BASE en un temporal nuevo (`qcc-odd-base-*`) y devuelve su ruta; error si la BASE no existe. */
export function copiaBase(raiz, base) {
  if (!base || String(base).startsWith('--')) throw new Error('falta la BASE')
  try {
    git(['cat-file', '-e', `${base}^{commit}`], { raiz })
  } catch {
    throw new Error(`BASE desconocida: ${base}`)
  }
  const destino = fs.mkdtempSync(path.join(os.tmpdir(), `${PREFIJO}base-`))
  const indice = path.join(os.tmpdir(), `${PREFIJO}indice-${process.pid}-${Date.now()}`)
  const env = { ...process.env, GIT_INDEX_FILE: indice }
  try {
    git(['read-tree', base], { raiz, env })
    git(['checkout-index', '-a', `--prefix=${destino.replaceAll('\\', '/')}/`], { raiz, env })
  } catch (e) {
    fs.rmSync(destino, { recursive: true, force: true })
    throw e
  } finally {
    fs.rmSync(indice, { force: true })
  }
  return destino
}

/** El shell con el que se corre el comando: bash si hay; null si no (entonces `shell: true`). */
function bashDe() {
  const esBash = (p) => /(^|[\\/])(ba|z|da)?sh(\.exe)?$/i.test(p)
  const candidatos = []
  const sh = process.env.SHELL
  if (sh && esBash(sh)) {
    candidatos.push(sh)
    if (WIN) {
      const unidad = /^\/([a-zA-Z])\/(.*)/.exec(sh)
      const nativa = unidad ? `${unidad[1].toUpperCase()}:/${unidad[2]}` : null
      if (nativa) candidatos.push(nativa, `${nativa}.exe`)
      candidatos.push(`${sh}.exe`)
    }
  }
  for (const c of candidatos) {
    try {
      if (fs.statSync(c).isFile()) return c
    } catch {
      // Siguiente candidato.
    }
  }
  if (!WIN) return 'bash'
  try {
    const r = spawnSync('where', ['bash'], { encoding: 'utf8', windowsHide: true })
    const hallado = String(r.stdout ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    return hallado.find((l) => !/[\\/]system32[\\/]/i.test(l)) ?? null
  } catch {
    return null
  }
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

/** Corre `cmd` en `cwd` con su `ODD_DIF_DIR`: `{ salida, errores, codigo }`; si pasa el tope, corta el árbol y el código es `vencido`. */
function correrEn(cwd, difDir, cmd, topeSeg) {
  return new Promise((resolver) => {
    const opciones = {
      cwd,
      env: { ...process.env, ODD_DIF_DIR: difDir.replaceAll('\\', '/'), CI: '1' },
      detached: !WIN,
      windowsHide: true,
    }
    const bash = bashDe()
    let hijo
    try {
      hijo = bash ? spawn(bash, ['-c', cmd], opciones) : spawn(cmd, { ...opciones, shell: true })
    } catch (e) {
      resolver({ salida: '', errores: `${e.message}
`, codigo: 'error' })
      return
    }
    let salida = ''
    let errores = ''
    let vencio = false
    hijo.stdout.setEncoding('utf8')
    hijo.stderr.setEncoding('utf8')
    hijo.stdout.on('data', (d) => (salida += d))
    hijo.stderr.on('data', (d) => (errores += d))
    const reloj = setTimeout(() => {
      vencio = true
      cortar(hijo)
    }, topeSeg * 1000)
    hijo.on('error', (e) => {
      clearTimeout(reloj)
      resolver({ salida, errores: errores + `${e.message}
`, codigo: 'error' })
    })
    hijo.on('close', (codigo, senal) => {
      clearTimeout(reloj)
      resolver({
        salida,
        errores: errores + (vencio ? `vencido: más de ${topeSeg} s
` : ''),
        codigo: vencio ? 'vencido' : (codigo ?? (senal ? `señal ${senal}` : 'error')),
      })
    })
  })
}

/** Las formas en que una ruta puede aparecer en una salida: nativa, con `/`, con `\` y la de Git Bash. */
function formasDe(ruta) {
  const abs = path.resolve(ruta)
  const formas = new Set([abs, abs.replaceAll('\\', '/'), abs.replaceAll('/', '\\'), abs.replaceAll('\\', '\\\\')])
  const unidad = /^([a-zA-Z]):[\\/](.*)/.exec(abs)
  if (unidad) formas.add(`/${unidad[1].toLowerCase()}/${unidad[2].replaceAll('\\', '/')}`)
  // Git Bash da al temporal del sistema la forma `/tmp/…`.
  if (WIN) {
    const relativa = path.relative(path.resolve(os.tmpdir()), abs)
    if (relativa && !relativa.startsWith('..') && !path.isAbsolute(relativa)) formas.add(`/tmp/${relativa.replaceAll('\\', '/')}`)
  }
  return [...formas]
}

/** Cambia cada ruta de `reemplazos` ([ruta, marca]) por su marca, en todas sus formas. */
function normalizar(texto, reemplazos) {
  const pares = reemplazos.flatMap(([ruta, marca]) => formasDe(ruta).map((f) => [f, marca]))
  pares.sort((a, b) => b[0].length - a[0].length)
  let salida = texto.replace(/\r\n/g, '\n')
  for (const [forma, marca] of pares) {
    salida = salida.replace(new RegExp(forma.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), WIN ? 'gi' : 'g'), marca)
  }
  return salida
}

/** Las líneas de `a` que no están en `b` (con repetidos), en orden. */
function lineasQueFaltan(a, b) {
  const cuenta = new Map()
  for (const l of b) cuenta.set(l, (cuenta.get(l) ?? 0) + 1)
  return a.filter((l) => {
    const n = cuenta.get(l) ?? 0
    if (n > 0) {
      cuenta.set(l, n - 1)
      return false
    }
    return true
  })
}

const partir = (texto) => (texto === '' ? [] : texto.replace(/\n$/, '').split('\n'))

/**
 * Corre `cmd` en la copia de la BASE y en el repo (cada uno con su `ODD_DIF_DIR` y `CI=1`) y los compara.
 * Es asíncrona (corta el árbol de procesos si se vence). Devuelve `{ igual, copia, repo, lineas }`; borra la copia y las carpetas de trabajo.
 */
export async function diferencial(raiz, base, cmd, { topeSeg = TOPE_SEG } = {}) {
  const copia = copiaBase(raiz, base)
  const difCopia = fs.mkdtempSync(path.join(os.tmpdir(), `${PREFIJO}dif-`))
  const difRepo = fs.mkdtempSync(path.join(os.tmpdir(), `${PREFIJO}dif-`))
  try {
    const reemplazos = [[difCopia, '<DIF>'], [difRepo, '<DIF>'], [copia, '<RAIZ>'], [raiz, '<RAIZ>']]
    const limpio = (r) => ({ salida: normalizar(r.salida, reemplazos), errores: normalizar(r.errores, reemplazos), codigo: r.codigo })
    const deCopia = limpio(await correrEn(copia, difCopia, cmd, topeSeg))
    const deRepo = limpio(await correrEn(raiz, difRepo, cmd, topeSeg))
    const igual = deCopia.salida === deRepo.salida && deCopia.errores === deRepo.errores && deCopia.codigo === deRepo.codigo
    if (igual) return { igual, copia: deCopia, repo: deRepo, lineas: [`DIFERENCIAL: ${cmd} → igual`] }
    const cambios = []
    for (const [etiqueta, campo] of [['', 'salida'], ['[stderr] ', 'errores']]) {
      const a = partir(deCopia[campo])
      const b = partir(deRepo[campo])
      for (const l of lineasQueFaltan(a, b)) cambios.push(`- ${etiqueta}${l}`)
      for (const l of lineasQueFaltan(b, a)) cambios.push(`+ ${etiqueta}${l}`)
    }
    const lineas = [`DIFERENCIAL: ${cmd} → DIFIERE`, ...cambios.slice(0, TOPE_LINEAS)]
    if (cambios.length > TOPE_LINEAS) lineas.push(`… ${cambios.length - TOPE_LINEAS} líneas más`)
    lineas.push(`código de salida: copia ${deCopia.codigo} · repo ${deRepo.codigo}`)
    return { igual, copia: deCopia, repo: deRepo, lineas }
  } finally {
    borrarTemporal(copia)
    borrarTemporal(difCopia)
    borrarTemporal(difRepo)
  }
}
