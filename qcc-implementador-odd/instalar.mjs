#!/usr/bin/env node
// Copia /qcc-implementador-odd de este repo a ~/.claude, donde Claude Code lo lee. Aparte del instalador de qcc-implementador/.
//
//   skills/<nombre>/SKILL.md  →  ~/.claude/skills/<nombre>/SKILL.md
//   agents/<nombre>.md        →  ~/.claude/agents/<nombre>.md
//   herramientas/<archivo>    →  ~/.claude/flujos-odd/<archivo>
//
//   node qcc-implementador-odd/instalar.mjs              copia lo que cambió
//   node qcc-implementador-odd/instalar.mjs --revisar    muestra qué cambiaría, sin copiar
//   node qcc-implementador-odd/instalar.mjs --traer      al revés: trae a este repo lo editado en ~/.claude
//   node qcc-implementador-odd/instalar.mjs --forzar     copia aunque la copia instalada sea más nueva
//
// Una copia instalada distinta y más nueva que la del repo se editó en ~/.claude: no se pisa sin --forzar (se
// guarda con --traer). Nunca borra y no toca ~/.claude/flujos-odd/registros. `CLAUDE_CONFIG_DIR` cambia el destino.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.dirname(fileURLToPath(import.meta.url))
const CLAUDE = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')
const CARPETAS = [
  ['skills', 'skills'],
  ['agents', 'agents'],
  ['herramientas', 'flujos-odd'],
]
const IGNORAR = new Set(['registros'])

const args = new Set(process.argv.slice(2))
const revisar = args.has('--revisar')
const traer = args.has('--traer')
const forzar = args.has('--forzar')

const corto = (p) => (p.startsWith(CLAUDE) ? '~/.claude' + p.slice(CLAUDE.length) : path.relative(REPO, p)).replaceAll('\\', '/')
const iguales = (a, b) => fs.readFileSync(a).equals(fs.readFileSync(b))

/** Archivos de una carpeta, recursivo, como rutas relativas a ella (sin `registros/`). */
function archivosDe(dir) {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (IGNORAR.has(e.name)) return []
    return e.isDirectory() ? archivosDe(path.join(dir, e.name)).map((r) => path.join(e.name, r)) : [e.name]
  })
}

let copiados = 0
let frenados = 0
for (const [enRepo, enClaude] of CARPETAS) {
  for (const rel of archivosDe(path.join(REPO, enRepo))) {
    const repo = path.join(REPO, enRepo, rel)
    const instalado = path.join(CLAUDE, enClaude, rel)
    const existe = fs.existsSync(instalado)
    if (existe && iguales(repo, instalado)) continue
    if (traer && !existe) continue
    const editado = existe && fs.statSync(instalado).mtimeMs > fs.statSync(repo).mtimeMs
    if (!traer && editado && !forzar) {
      frenados++
      console.log(`  FRENADO  ${corto(instalado)} se editó ahí: --traer lo guarda en el repo, --forzar lo pisa`)
      continue
    }
    if (traer && !editado) continue
    const [origen, destino] = traer ? [instalado, repo] : [repo, instalado]
    console.log(`  ${existe ? 'cambia' : 'nuevo '}   ${corto(origen)} → ${corto(destino)}`)
    if (revisar) continue
    fs.mkdirSync(path.dirname(destino), { recursive: true })
    fs.copyFileSync(origen, destino)
    copiados++
  }
}

console.log(`RESULTADO: ${revisar ? 'sin copiar (--revisar)' : `${copiados} copiado(s)`}${frenados ? ` · ${frenados} frenado(s)` : ''}`)
process.exit(frenados ? 1 : 0)
