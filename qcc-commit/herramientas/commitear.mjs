#!/usr/bin/env node
// Hace los commits de /commit a partir de la respuesta del agente qcc-generador-commit.
// Uso: node commitear.mjs --modo <push|solo|rama> [--archivo <ruta>]   (sin --archivo, la respuesta va por stdin)
// Crea la rama (modo rama), saca todo de stage, agrega y commitea cada grupo con su mensaje exacto, corta en el primer
// fallo, revisa lo que quedó sin commit, hace el push (salvo modo solo) e imprime el cierre. Nunca agrega rutas de
// EXCLUIDOS ni .env*, ni atribuciones. Sale con 0 si todo salió bien, 1 si falló un paso de git y 2 si el uso o la
// respuesta no sirven (en ese caso no toca git).
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const WIN = process.platform === 'win32'
const MODOS = ['push', 'solo', 'rama']
const USO = 'Uso: node commitear.mjs --modo <push|solo|rama> [--archivo <ruta>] (sin --archivo, la respuesta va por stdin)'
const TOPE_VINETA = 72
const ATRIBUCION = /co-authored-by|generated with \[?claude|claude\.ai\/code|claude-session/i
const RAMA_VALIDA = /^\w[\w./-]*$/
const NINGUNA = /^ningun[ao]\.?$/i

/**
 * Lee la respuesta del agente: si no hay cambios, la rama, los commits, los excluidos y la nota.
 * Tolera cercos de código, CRLF y «ninguna»/«ninguno» en la misma línea o en la siguiente, el primer valor de una
 * lista en la misma línea que su clave y, en DESCRIPCIÓN, líneas sin «- ».
 * @param {string} texto
 * @returns {{ sinCambios: boolean, rama: string | null, commits: { archivos: string[], resumen: string, vinetas: string[] }[], excluidos: string[], nota: string | null }}
 */
export function leerRespuesta(texto) {
  const r = { sinCambios: false, rama: null, commits: [], excluidos: [], nota: null }
  let lista = null
  let clave = ''
  for (const crudo of texto.split(/\r?\n/)) {
    const linea = crudo.trim()
    if (linea === '' || linea.startsWith('```')) continue
    const m = linea.match(/^(ALCANCE|RAMA|COMMIT|ARCHIVOS|RESUMEN|DESCRIPCI[ÓO]N|EXCLUIDOS|NOTA)\b:?\s*(.*)$/)
    if (!m) {
      if (clave === 'NOTA') r.nota += ` ${linea}`
      else if (lista && linea.startsWith('- ')) lista.push(linea.slice(2).trim())
      // Una viñeta partida en dos líneas: la continuación se une a la anterior.
      // Sin viñeta previa, la línea abre una (el agente no puso «- »).
      else if (lista && clave.startsWith('DESCRIPCI') && !NINGUNA.test(linea)) {
        if (lista.length) lista[lista.length - 1] += ` ${linea}`
        else lista.push(linea)
      }
      continue
    }
    clave = m[1]
    const resto = m[2].trim()
    const actual = r.commits.at(-1)
    lista = null
    if (clave === 'ALCANCE') r.sinCambios = /sin cambios/i.test(resto)
    else if (clave === 'RAMA') r.rama = resto.split(/\s+/)[0] || null
    else if (clave === 'COMMIT') r.commits.push({ archivos: [], resumen: '', vinetas: [] })
    else if (clave === 'ARCHIVOS') lista = actual?.archivos ?? null
    else if (clave === 'RESUMEN' && actual) actual.resumen = resto
    else if (clave === 'EXCLUIDOS') lista = r.excluidos
    else if (clave === 'NOTA') r.nota = resto
    else if (clave.startsWith('DESCRIPCI')) lista = actual?.vinetas ?? null
    // El primer valor en la misma línea que su clave: `DESCRIPCIÓN: - Primera`, `ARCHIVOS: a.js`.
    if (lista && resto && !NINGUNA.test(resto)) lista.push(resto.replace(/^- +/, ''))
  }
  return r
}

/**
 * El mensaje de un commit: resumen y, si hay viñetas, una línea en blanco y las viñetas.
 * @param {{ resumen: string, vinetas: string[] }} commit
 * @returns {string}
 */
export function mensajeDe(commit) {
  if (!commit.vinetas.length) return `${commit.resumen}\n`
  return `${commit.resumen}\n\n${commit.vinetas.map((v) => `- ${v}`).join('\n')}\n`
}

/** Si la ruta es un `.env*` (por su nombre, en cualquier carpeta). */
const esEnv = (ruta) => path.posix.basename(ruta.replace(/\/+$/, '')).startsWith('.env')

/** Si la ruta está en `excluidos`, tal cual o dentro de una carpeta excluida (`dir/`). */
const estaExcluida = (ruta, excluidos) => excluidos.some((e) => ruta === e || (e.endsWith('/') && ruta.startsWith(e)))

/**
 * Corre git sin shell.
 * @param {string[]} args
 * @param {string} [input]
 * @returns {{ ok: boolean, stdout: string, salida: string }}
 */
function git(args, input) {
  const r = spawnSync('git', args, { encoding: 'utf8', input })
  const salida = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim() || (r.error?.message ?? '')
  return { ok: r.status === 0, stdout: r.stdout ?? '', salida }
}

/** Las rutas de `git ls-files -z` (versionadas o, con `-o`, nuevas no ignoradas) que caen en `rutas`. */
function listar(rutas, nuevos) {
  const extra = nuevos ? ['-o', '--exclude-standard'] : []
  const r = git(['--literal-pathspecs', 'ls-files', '-z', ...extra, '--', ...rutas])
  if (!r.ok) throw new Error(r.salida)
  return r.stdout.split('\0').filter(Boolean)
}

/**
 * Abre las rutas de un grupo en archivos versionados y nuevos, sin los excluidos ni los `.env*`.
 * @param {string[]} archivos
 * @param {string[]} excluidos
 * @returns {{ versionados: string[], nuevos: string[], sacados: string[], faltan: string[] }}
 */
function abrir(archivos, excluidos) {
  const sacados = archivos.filter((a) => esEnv(a) || estaExcluida(a, excluidos))
  const pedidas = archivos.filter((a) => !sacados.includes(a))
  if (!pedidas.length) return { versionados: [], nuevos: [], sacados, faltan: [] }
  const todos = { versionados: listar(pedidas, false), nuevos: listar(pedidas, true) }
  const cae = (f, a) => f === a || (a.endsWith('/') && f.startsWith(a))
  const faltan = pedidas.filter((a) => !todos.versionados.some((f) => cae(f, a)) && !todos.nuevos.some((f) => cae(f, a)))
  const fuera = (f) => esEnv(f) || estaExcluida(f, excluidos)
  for (const f of [...todos.versionados, ...todos.nuevos]) if (fuera(f) && !sacados.includes(f)) sacados.push(f)
  return { versionados: todos.versionados.filter((f) => !fuera(f)), nuevos: todos.nuevos.filter((f) => !fuera(f)), sacados, faltan }
}

/** Las rutas de `git status --short -uall`, sin el código de estado ni comillas (de un renombre, la nueva). */
function pendientes() {
  const r = git(['-c', 'core.quotePath=false', 'status', '--short', '-uall'])
  return r.stdout.split('\n').filter(Boolean).map((l) => l.slice(3).split(' -> ').at(-1).replace(/^"(.*)"$/, '$1'))
}

/**
 * Hace los commits de la respuesta y arma el cierre.
 * @param {ReturnType<typeof leerRespuesta>} respuesta
 * @param {string} modo
 * @returns {{ texto: string, codigo: number }}
 */
export function commitear(respuesta, modo) {
  if (respuesta.sinCambios) return { texto: 'sin cambios', codigo: 0 }
  const lineas = []
  const avisos = []
  const excluidos = [...respuesta.excluidos]
  const nota = respuesta.nota && !NINGUNA.test(respuesta.nota) ? `Nota: ${respuesta.nota}` : null
  if (!respuesta.commits.length && !excluidos.length) return { texto: 'Respuesta del agente vacía o sin bloques COMMIT ni EXCLUIDOS: sin commit', codigo: 2 }
  if (!respuesta.commits.length) return { texto: [`Sin commit (posibles secretos): ${excluidos.join(', ')}`, 'sin commit', ...(nota ? [nota] : [])].join('\n'), codigo: 0 }
  const malos = respuesta.commits.findIndex((c) => !c.resumen || !c.archivos.length)
  if (malos >= 0) return { texto: `Respuesta del agente sin ARCHIVOS o sin RESUMEN en el COMMIT ${malos + 1}: sin commit`, codigo: 2 }
  if (modo === 'rama' && !RAMA_VALIDA.test(respuesta.rama ?? '')) return { texto: `Respuesta del agente sin una RAMA válida (${respuesta.rama ?? 'ninguna'}): sin commit`, codigo: 2 }
  for (const c of respuesta.commits) {
    const atribuciones = c.vinetas.filter((v) => ATRIBUCION.test(v))
    if (atribuciones.length) avisos.push(`quité de «${c.resumen}» ${atribuciones.length} viñeta(s) con atribución`)
    c.vinetas = c.vinetas.filter((v) => !ATRIBUCION.test(v))
    for (const v of c.vinetas) if ([...`- ${v}`].length > TOPE_VINETA) avisos.push(`viñeta de ${[...`- ${v}`].length} caracteres (tope ${TOPE_VINETA}) en «${c.resumen}»`)
  }

  const hechos = []
  let error = null
  let push = 'no'
  const fallo = (paso, salida) => {
    error = `${paso}: ${salida}`
    return false
  }
  const correr = () => {
    const reset = git(['reset', '-q'])
    if (!reset.ok) return fallo('git reset -q', reset.salida)
    // Después del reset: un archivo nuevo que estaba en stage ya no figura como versionado.
    let grupos
    try {
      grupos = respuesta.commits.map((c) => ({ ...c, ...abrir(c.archivos, excluidos) }))
    } catch (e) {
      return fallo('git ls-files', e.message)
    }
    const faltan = grupos.flatMap((g) => g.faltan)
    if (faltan.length) return fallo('rutas que no están entre los cambios', faltan.join(', '))
    if (modo === 'rama') {
      const primero = git(['switch', '-c', respuesta.rama])
      if (!primero.ok && !git(['switch', '-c', `${respuesta.rama}-2`]).ok) return fallo(`git switch -c ${respuesta.rama}`, primero.salida)
    }
    for (const g of grupos) {
      for (const s of g.sacados) if (!excluidos.includes(s)) excluidos.push(s)
      if (g.versionados.length) {
        const r = git(['--literal-pathspecs', 'add', '-u', '--', ...g.versionados])
        if (!r.ok) return fallo(`git add -u («${g.resumen}»)`, r.salida)
      }
      if (g.nuevos.length) {
        const r = git(['--literal-pathspecs', 'add', '-A', '--', ...g.nuevos])
        if (!r.ok) return fallo(`git add -A («${g.resumen}»)`, r.salida)
      }
      if (git(['diff', '--cached', '--quiet']).ok) {
        avisos.push(`«${g.resumen}» no tenía nada que commitear: lo salté`)
        continue
      }
      const r = git(['commit', '-q', '-F', '-'], mensajeDe(g))
      if (!r.ok) return fallo(`git commit («${g.resumen}»)`, r.salida)
      hechos.push({ hash: git(['rev-parse', '--short', 'HEAD']).stdout.trim(), resumen: g.resumen, vinetas: g.vinetas })
    }
    return true
  }

  const bien = correr()
  if (!bien) {
    const enStage = git(['-c', 'core.quotePath=false', 'diff', '--cached', '--name-only']).stdout.trim().split('\n').filter(Boolean)
    if (enStage.length) avisos.push(`quedaron en stage: ${enStage.join(', ')}`)
  } else if (hechos.length && modo !== 'solo') {
    const r = git(['push', '-u', 'origin', 'HEAD'])
    push = r.ok ? 'hecho' : 'falló'
    if (!r.ok) error = `git push -u origin HEAD: ${r.salida}`
  }

  const resto = pendientes()
  const secretos = resto.filter((f) => esEnv(f) || estaExcluida(f, excluidos))
  const noDebia = resto.filter((f) => !secretos.includes(f))
  if (hechos.length) {
    lineas.push('```')
    hechos.forEach((h, i) => lineas.push(...(i ? [''] : []), `${h.hash} ${h.resumen}`, ...h.vinetas.map((v) => `- ${v}`)))
    lineas.push('```', `Rama: ${git(['branch', '--show-current']).stdout.trim() || '(sin rama)'} · push: ${push}`)
  } else lineas.push('sin commit')
  if (error) lineas.push(`Falló: ${error}`)
  if (secretos.length) lineas.push(`Sin commit (posibles secretos): ${secretos.join(', ')}`)
  if (noDebia.length && error) lineas.push(`Quedó sin commit: ${noDebia.join(', ')}`)
  else if (noDebia.length) lineas.push(`Quedó sin commit (no debía): ${noDebia.join(', ')}. Corre /commit de nuevo.`)
  for (const a of avisos) lineas.push(`Aviso: ${a}`)
  if (nota) lineas.push(nota)
  return { texto: lineas.join('\n'), codigo: error ? 1 : 0 }
}

async function main() {
  const args = process.argv.slice(2)
  const valor = (nombre) => {
    const i = args.indexOf(nombre)
    return i >= 0 ? args[i + 1] : undefined
  }
  const modo = valor('--modo')
  const archivo = valor('--archivo')
  if (!MODOS.includes(modo) || (args.includes('--archivo') && !archivo) || (!archivo && process.stdin.isTTY)) {
    process.stderr.write(`${USO}\n`)
    process.exitCode = 2
    return
  }
  let texto = ''
  if (archivo) {
    try {
      texto = fs.readFileSync(archivo, 'utf8')
    } catch (e) {
      process.stderr.write(`No pude leer ${archivo}: ${e.message}\n${USO}\n`)
      process.exitCode = 2
      return
    }
  } else for await (const trozo of process.stdin) texto += trozo
  const { texto: cierre, codigo } = commitear(leerRespuesta(texto), modo)
  process.stdout.write(`${cierre}\n`)
  process.exitCode = codigo
}

function esPrincipal() {
  if (!process.argv[1]) return false
  const a = path.resolve(process.argv[1])
  const b = fileURLToPath(import.meta.url)
  return WIN ? a.toLowerCase() === b.toLowerCase() : a === b
}

if (esPrincipal()) await main()
