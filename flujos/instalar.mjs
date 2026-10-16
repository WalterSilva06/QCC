#!/usr/bin/env node
// Copia los flujos de este repo a ~/.claude, donde Claude Code los lee.
//
//   skills/<nombre>/SKILL.md  →  ~/.claude/skills/<nombre>/SKILL.md
//   agents/<nombre>.md        →  ~/.claude/agents/<nombre>.md
//   herramientas/<archivo>    →  ~/.claude/flujos/<archivo>
//
//   node flujos/instalar.mjs              copia lo que cambió
//   node flujos/instalar.mjs --revisar    muestra qué cambiaría, sin copiar
//   node flujos/instalar.mjs --traer      al revés: trae a este repo lo editado en ~/.claude
//   node flujos/instalar.mjs --forzar     copia aunque la copia instalada se haya editado ahí
//   node flujos/instalar.mjs --limpiar    borra lo instalado que ya no está en el repo, si nadie lo editó
//
// Cada copia anota su hash en ~/.claude/flujos/.instalado.json: una copia instalada que ya no coincide
// con lo instalado se editó en ~/.claude y no se pisa sin --forzar (se guarda con --traer). Lo que
// todavía no está anotado (instalaciones anteriores) se compara por fecha, como antes.
// Sin --limpiar nunca borra. No toca ~/.claude/flujos/registros (bitácoras locales del flujo).
// `CLAUDE_CONFIG_DIR` cambia la carpeta de destino.

import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.dirname(fileURLToPath(import.meta.url))
const CLAUDE = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')
const ETIQUETA = process.env.CLAUDE_CONFIG_DIR ? CLAUDE.replaceAll('\\', '/') : '~/.claude'
const MANIFIESTO = path.join(CLAUDE, 'flujos', '.instalado.json')
const CARPETAS = [
  ['skills', 'skills'],
  ['agents', 'agents'],
  ['herramientas', 'flujos'],
]
const IGNORAR = new Set(['instalar.mjs', 'README.md', 'registros'])

const args = new Set(process.argv.slice(2))
const revisar = args.has('--revisar')
const traer = args.has('--traer')
const forzar = args.has('--forzar')
const limpiar = args.has('--limpiar')

const hashDe = (archivo) => crypto.createHash('sha1').update(fs.readFileSync(archivo)).digest('hex')
/** Clave del manifiesto: la ruta instalada relativa a ~/.claude, con `/`. */
const claveDe = (instalado) => path.relative(CLAUDE, instalado).split(path.sep).join('/')
const corto = (p) => (p.startsWith(CLAUDE) ? ETIQUETA + p.slice(CLAUDE.length) : path.relative(REPO, p)).replaceAll('\\', '/')

/** Archivos de una carpeta, recursivo, como rutas relativas a ella (sin `registros/` ni lo de IGNORAR). */
function archivosDe(dir) {
  if (!fs.existsSync(dir)) return []
  const salida = []
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORAR.has(e.name)) continue
    if (e.isDirectory()) salida.push(...archivosDe(path.join(dir, e.name)).map((r) => path.join(e.name, r)))
    else salida.push(e.name)
  }
  return salida
}

function leerManifiesto() {
  try {
    const m = JSON.parse(fs.readFileSync(MANIFIESTO, 'utf8'))
    return m && typeof m === 'object' && !Array.isArray(m) ? m : {}
  } catch {
    return {}
  }
}

/** Todo lo que el repo instala, como `{ repo, instalado }`. */
function pares() {
  const lista = []
  for (const [enRepo, enClaude] of CARPETAS) {
    for (const rel of archivosDe(path.join(REPO, enRepo))) {
      lista.push({ repo: path.join(REPO, enRepo, rel), instalado: path.join(CLAUDE, enClaude, rel) })
    }
  }
  return lista
}

/**
 * Qué hacer con un par: `igual`, `nuevo` o `cambia` (se copia), `editado` (se perdería una edición: se frena),
 * `repo más nuevo` (con --traer, no hay nada que traer) o `falta` (no existe el origen).
 */
function estadoDe({ repo, instalado }, manifiesto) {
  const [origen, destino] = traer ? [instalado, repo] : [repo, instalado]
  if (!fs.existsSync(origen)) return 'falta'
  if (!fs.existsSync(destino)) return 'nuevo'
  if (hashDe(origen) === hashDe(destino)) return 'igual'
  if (forzar) return 'cambia'
  const anotado = manifiesto[claveDe(instalado)]
  if (anotado === undefined) return fs.statSync(destino).mtimeMs > fs.statSync(origen).mtimeMs ? 'editado' : 'cambia'
  const instaladoEditado = hashDe(instalado) !== anotado
  if (!traer) return instaladoEditado ? 'editado' : 'cambia'
  if (!instaladoEditado) return 'repo más nuevo'
  return hashDe(repo) !== anotado ? 'editado' : 'cambia'
}

const manifiesto = leerManifiesto()
const vistos = new Set()
let copiados = 0
let frenados = 0
let huerfanos = 0
for (const par of pares()) {
  const clave = claveDe(par.instalado)
  vistos.add(clave)
  const [origen, destino] = traer ? [par.instalado, par.repo] : [par.repo, par.instalado]
  const estado = estadoDe(par, manifiesto)
  if (estado === 'igual') {
    // Repo e instalado coinciden: eso es lo instalado (así se anotan también las instalaciones anteriores al manifiesto).
    manifiesto[clave] = hashDe(par.instalado)
    continue
  }
  if (estado === 'falta') {
    if (!traer) console.log(`  falta    ${corto(origen)} (está en el repo pero no instalado)`)
    continue
  }
  if (estado === 'repo más nuevo') {
    console.log(`  omitido  ${corto(par.repo)} es más nuevo que ${corto(par.instalado)}: se instala sin --traer`)
    continue
  }
  if (estado === 'editado') {
    frenados++
    const consejo = traer ? 'cambió en el repo y en la copia instalada: revísalo a mano (o --forzar)' : 'se editó ahí desde la última instalación: usa --traer para guardarlo en el repo, o --forzar para pisarlo'
    console.log(`  FRENADO  ${corto(par.instalado)} ${consejo}`)
    continue
  }
  console.log(`  ${estado.padEnd(8)} ${corto(origen)} → ${corto(destino)}`)
  if (revisar) continue
  fs.mkdirSync(path.dirname(destino), { recursive: true })
  fs.copyFileSync(origen, destino)
  manifiesto[clave] = hashDe(par.instalado)
  copiados++
}

for (const clave of Object.keys(manifiesto)) {
  if (vistos.has(clave)) continue
  const archivo = path.join(CLAUDE, ...clave.split('/'))
  if (!fs.existsSync(archivo)) {
    delete manifiesto[clave]
    continue
  }
  const editado = hashDe(archivo) !== manifiesto[clave]
  if (limpiar && !revisar && !editado) {
    fs.rmSync(archivo)
    delete manifiesto[clave]
    console.log(`  borrado  ${corto(archivo)} (ya no está en el repo)`)
    continue
  }
  huerfanos++
  console.log(`  huérfano ${corto(archivo)}: ya no está en el repo${editado ? ' y se editó ahí; bórralo a mano' : ' (--limpiar lo borra)'}`)
}

if (!revisar) {
  fs.mkdirSync(path.dirname(MANIFIESTO), { recursive: true })
  fs.writeFileSync(MANIFIESTO, JSON.stringify(Object.fromEntries(Object.entries(manifiesto).sort()), null, 2) + '\n')
}

const verbo = revisar ? 'sin copiar (--revisar)' : `${copiados} copiado(s)`
console.log(`RESULTADO: ${verbo}${frenados ? ` · ${frenados} frenado(s)` : ''}${huerfanos ? ` · ${huerfanos} huérfano(s)` : ''}`)
process.exit(frenados ? 1 : 0)
