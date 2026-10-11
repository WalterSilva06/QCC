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
//   node flujos/instalar.mjs --forzar     copia aunque la copia instalada sea más nueva
//
// Nunca borra: un archivo quitado del repo queda instalado hasta que lo borres a mano.
// No toca ~/.claude/flujos/registros (bitácoras locales del flujo).

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.dirname(fileURLToPath(import.meta.url))
const CLAUDE = path.join(os.homedir(), '.claude')
const CARPETAS = [
  ['skills', 'skills'],
  ['agents', 'agents'],
  ['herramientas', 'flujos'],
]
const IGNORAR = new Set(['instalar.mjs', 'README.md'])

const args = new Set(process.argv.slice(2))
const revisar = args.has('--revisar')
const traer = args.has('--traer')
const forzar = args.has('--forzar')

/** Archivos de una carpeta, recursivo, como rutas relativas a ella. */
function archivosDe(dir) {
  if (!fs.existsSync(dir)) return []
  const salida = []
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) salida.push(...archivosDe(path.join(dir, e.name)).map((r) => path.join(e.name, r)))
    else if (!IGNORAR.has(e.name)) salida.push(e.name)
  }

  return salida
}

/** Pares [origen, destino] según el sentido de la copia. */
function pares() {
  const lista = []
  for (const [enRepo, enClaude] of CARPETAS) {
    for (const rel of archivosDe(path.join(REPO, enRepo))) {
      const a = path.join(REPO, enRepo, rel)
      const b = path.join(CLAUDE, enClaude, rel)
      lista.push(traer ? [b, a] : [a, b])
    }
  }

  return lista
}

/** Estado de un par: igual, nuevo, cambia, o más nuevo en el destino (se perdería). */
function estadoDe(origen, destino) {
  if (!fs.existsSync(origen)) return 'falta'
  if (!fs.existsSync(destino)) return 'nuevo'
  if (fs.readFileSync(origen).equals(fs.readFileSync(destino))) return 'igual'
  if (!forzar && fs.statSync(destino).mtimeMs > fs.statSync(origen).mtimeMs) return 'destino más nuevo'

  return 'cambia'
}

const corto = (p) => (p.startsWith(CLAUDE) ? '~/.claude' + p.slice(CLAUDE.length) : path.relative(REPO, p)).replaceAll('\\', '/')

let copiados = 0
let frenados = 0
for (const [origen, destino] of pares()) {
  const estado = estadoDe(origen, destino)
  if (estado === 'igual') continue
  if (estado === 'falta') {
    console.log(`  falta    ${corto(origen)} (está en el repo pero no instalado)`)
    continue
  }
  if (estado === 'destino más nuevo') {
    frenados++
    console.log(`  FRENADO  ${corto(destino)} es más nuevo que ${corto(origen)}: ${traer ? 'revisa antes de traer' : 'usa --traer para guardarlo en el repo, o --forzar para pisarlo'}`)
    continue
  }
  console.log(`  ${estado.padEnd(8)} ${corto(origen)} → ${corto(destino)}`)
  if (revisar) continue
  fs.mkdirSync(path.dirname(destino), { recursive: true })
  fs.copyFileSync(origen, destino)
  copiados++
}

const verbo = revisar ? 'sin copiar (--revisar)' : `${copiados} copiado(s)`
console.log(`RESULTADO: ${verbo}${frenados ? ` · ${frenados} frenado(s)` : ''}`)
process.exit(frenados ? 1 : 0)
