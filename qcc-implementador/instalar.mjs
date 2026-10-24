#!/usr/bin/env node
// Limpia de ~/.claude las copias de /qcc-implementador y /qcc-commit que instalaba la versión anterior de este archivo.
// Los dos flujos ahora son plugins (`claude plugin install qcc-implementador@qcc`): esas copias duplicarían sus comandos y
// agentes, y los agentes viejos llaman a una guardia que ya no se instala ahí.
//
//   node qcc-implementador/instalar.mjs              lista lo que archivaría, sin tocar nada
//   node qcc-implementador/instalar.mjs --limpiar    mueve las copias a ~/.claude/_archivo-limpieza-<fecha>/
//
// Las copias son las que anota ~/.claude/flujos/.instalado.json. Una que se editó ahí desde la instalación no se toca (se
// avisa: revísala y bórrala a mano). Nada se borra: lo archivado se recupera moviéndolo de vuelta. No toca
// ~/.claude/flujos/registros (el historial y las bitácoras de los flujos). `CLAUDE_CONFIG_DIR` cambia la carpeta.

import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const CLAUDE = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')
const ETIQUETA = process.env.CLAUDE_CONFIG_DIR ? CLAUDE.replaceAll('\\', '/') : '~/.claude'
const MANIFIESTO = path.join(CLAUDE, 'flujos', '.instalado.json')
const ARCHIVO = path.join(CLAUDE, `_archivo-limpieza-${new Date().toISOString().slice(0, 10)}`)
// Carpetas que la instalación creó y que quedan vacías al archivar sus copias.
const CARPETAS = ['skills/qcc-implementador', 'skills/qcc-commit', 'flujos/qcc-commit']

const limpiar = process.argv.includes('--limpiar')

const hashDe = (archivo) => crypto.createHash('sha1').update(fs.readFileSync(archivo)).digest('hex')
const corto = (p) => ETIQUETA + p.slice(CLAUDE.length).replaceAll('\\', '/')

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

function leerManifiesto() {
  try {
    const m = JSON.parse(fs.readFileSync(MANIFIESTO, 'utf8'))
    return m && typeof m === 'object' && !Array.isArray(m) ? m : null
  } catch {
    return null
  }
}

const manifiesto = leerManifiesto()
if (!manifiesto) {
  console.log(`RESULTADO: nada que limpiar (no hay ${corto(MANIFIESTO)})`)
  process.exit(0)
}

let pendientes = 0
let archivados = 0
let editados = 0
for (const [clave, hash] of Object.entries(manifiesto)) {
  const archivo = path.join(CLAUDE, ...clave.split('/'))
  if (!fs.existsSync(archivo)) {
    delete manifiesto[clave]
    continue
  }
  if (hashDe(archivo) !== hash) {
    editados++
    console.log(`  editado  ${corto(archivo)} se editó ahí: no se toca; revísalo y bórralo a mano`)
    continue
  }
  const destino = path.join(ARCHIVO, ...clave.split('/'))
  console.log(`  ${limpiar ? 'archiva ' : 'archivaría'} ${corto(archivo)} → ${corto(destino)}`)
  if (!limpiar) {
    pendientes++
    continue
  }
  if (fs.existsSync(destino)) {
    console.log(`  FRENADO  ${corto(destino)} ya existe: muévelo o bórralo y repite`)
    editados++
    continue
  }
  mover(archivo, destino)
  delete manifiesto[clave]
  archivados++
}

if (limpiar) {
  for (const carpeta of CARPETAS) {
    try {
      fs.rmdirSync(path.join(CLAUDE, ...carpeta.split('/')))
    } catch {
      // No está o no queda vacía.
    }
  }
  if (Object.keys(manifiesto).length) fs.writeFileSync(MANIFIESTO, JSON.stringify(Object.fromEntries(Object.entries(manifiesto).sort()), null, 2) + '\n')
  else mover(MANIFIESTO, path.join(ARCHIVO, 'flujos', '.instalado.json'))
}

const resumen = limpiar ? `${archivados} archivado(s) en ${corto(ARCHIVO)}` : `${pendientes} por archivar (--limpiar lo hace)`
console.log(`RESULTADO: ${resumen}${editados ? ` · ${editados} sin tocar` : ''}`)
process.exit(editados ? 1 : 0)
