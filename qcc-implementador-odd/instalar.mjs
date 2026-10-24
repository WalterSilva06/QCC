#!/usr/bin/env node
// Limpia de ~/.claude la copia de /qcc-implementador-odd que instalaba la versión anterior de este archivo. El flujo ahora
// es un plugin (`claude plugin install qcc-implementador-odd@qcc`): esa copia duplicaría su comando y sus agentes, y los
// agentes viejos llaman a una guardia que ya no se instala ahí. Aparte del instalador de qcc-implementador/.
//
//   node qcc-implementador-odd/instalar.mjs              lista lo que archivaría, sin tocar nada
//   node qcc-implementador-odd/instalar.mjs --limpiar    mueve la copia a ~/.claude/_archivo-limpieza-<fecha>/
//
// La copia son los archivos de skills/, agents/ y herramientas/ de este plugin que existan con el mismo nombre en
// ~/.claude/skills, ~/.claude/agents y ~/.claude/flujos-odd (la instalación no dejaba manifiesto, así que no se distingue una
// edición hecha ahí: por eso se archiva y no se borra, y se recupera moviéndola de vuelta). No toca ~/.claude/flujos-odd/registros
// (el historial de corridas). `CLAUDE_CONFIG_DIR` cambia la carpeta.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.dirname(fileURLToPath(import.meta.url))
const CLAUDE = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')
const ETIQUETA = process.env.CLAUDE_CONFIG_DIR ? CLAUDE.replaceAll('\\', '/') : '~/.claude'
const ARCHIVO = path.join(CLAUDE, `_archivo-limpieza-${new Date().toISOString().slice(0, 10)}`)
// [carpeta en el plugin, carpeta donde la dejaba la instalación en ~/.claude]
const CARPETAS = [
  ['skills', 'skills'],
  ['agents', 'agents'],
  ['herramientas', 'flujos-odd'],
]
const IGNORAR = new Set(['registros'])

const limpiar = process.argv.includes('--limpiar')

const corto = (p) => ETIQUETA + p.slice(CLAUDE.length).replaceAll('\\', '/')

/** Archivos de una carpeta, recursivo, como rutas relativas a ella (sin `registros/`). */
function archivosDe(dir) {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (IGNORAR.has(e.name)) return []
    return e.isDirectory() ? archivosDe(path.join(dir, e.name)).map((r) => path.join(e.name, r)) : [e.name]
  })
}

/** Mueve `origen` a `destino` creando las carpetas; si están en discos distintos, copia y borra. */
function mover(origen, destino) {
  fs.mkdirSync(path.dirname(destino), { recursive: true })
  try {
    fs.renameSync(origen, destino)
  } catch {
    fs.copyFileSync(origen, destino)
    fs.rmSync(origen)
  }
}

let pendientes = 0
let archivados = 0
let frenados = 0
for (const [enRepo, enClaude] of CARPETAS) {
  for (const rel of archivosDe(path.join(REPO, enRepo))) {
    const copia = path.join(CLAUDE, enClaude, rel)
    if (!fs.existsSync(copia)) continue
    const destino = path.join(ARCHIVO, enClaude, rel)
    console.log(`  ${limpiar ? 'archiva ' : 'archivaría'} ${corto(copia)} → ${corto(destino)}`)
    if (!limpiar) {
      pendientes++
      continue
    }
    if (fs.existsSync(destino)) {
      frenados++
      console.log(`  FRENADO  ${corto(destino)} ya existe: muévelo o bórralo y repite`)
      continue
    }
    mover(copia, destino)
    archivados++
  }
}

if (limpiar) {
  try {
    fs.rmdirSync(path.join(CLAUDE, 'skills', 'qcc-implementador-odd'))
  } catch {
    // No está o no queda vacía.
  }
}

const resumen = limpiar ? `${archivados} archivado(s) en ${corto(ARCHIVO)}` : `${pendientes} por archivar (--limpiar lo hace)`
console.log(`RESULTADO: ${resumen}${frenados ? ` · ${frenados} frenado(s)` : ''}`)
process.exit(frenados ? 1 : 0)
