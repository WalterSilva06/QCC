#!/usr/bin/env node
// Copia o mueve bloques de líneas de un archivo del repo a otro sin pasar el código por el modelo (el ejecutor de /impl,
// para partir archivos grandes: con Edit/Write cada línea movida se paga como salida).
//
//   node <plugin>/herramientas/mover.mjs <origen> <desde-hasta>[,<desde-hasta>…] <destino> [--cortar]
//
// Agrega los bloques al final de <destino> (lo crea si falta), en el orden pedido. Con --cortar los quita de <origen>.
// Las dos rutas pasan por las mismas reglas de la guardia que un Edit (dentro del repo, sin .env*, lockfiles, .git/…);
// el alcance lo mide `estado.mjs --cambios`, igual que con Edit. Termina en `MOVIDO: …` o `ERROR: …` (exit 2).

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { motivoRuta, raizDe } from './guardia.mjs'

/** `"3-5,9"` → `[[3, 5], [9, 9]]`; error si un rango no vale, sale de `total` líneas o se solapa con otro. */
export function rangosDe(texto, total) {
  const rangos = String(texto ?? '').split(',').map((p) => {
    const m = /^\s*(\d+)(?:\s*-\s*(\d+))?\s*$/.exec(p)
    if (!m) throw new Error(`rango «${p}» no es <desde>-<hasta>`)
    const a = Number(m[1])
    const b = Number(m[2] ?? m[1])
    if (a < 1 || b < a || b > total) throw new Error(`rango ${a}-${b} fuera del archivo (1-${total})`)
    return [a, b]
  })
  const ordenados = [...rangos].sort((x, y) => x[0] - y[0])
  for (let i = 1; i < ordenados.length; i++) {
    if (ordenados[i][0] <= ordenados[i - 1][1]) throw new Error(`los rangos ${ordenados[i - 1].join('-')} y ${ordenados[i].join('-')} se solapan`)
  }
  return rangos
}

/**
 * Mueve los `rangos` (texto, `"3-5,9"`) de `origen` al final de `destino` (texto, '' si es nuevo), con el fin de línea de `origen`.
 * → `{ origen, destino, lineas }`: los textos nuevos (`origen` sin los bloques si `cortar`) y cuántas líneas se movieron.
 */
export function moverLineas(origen, rangos, destino, cortar) {
  const eol = origen.includes('\r\n') ? '\r\n' : '\n'
  const lineas = origen.split(/\r?\n/)
  const terminaEnEol = lineas.at(-1) === ''
  if (terminaEnEol) lineas.pop()
  const lista = rangosDe(rangos, lineas.length)
  const bloque = lista.flatMap(([a, b]) => lineas.slice(a - 1, b))
  const previo = destino && !/\r?\n$/.test(destino) ? destino + eol : destino
  const quitar = new Set(lista.flatMap(([a, b]) => Array.from({ length: b - a + 1 }, (_, k) => a + k)))
  const restantes = lineas.filter((_, i) => !quitar.has(i + 1))
  return {
    origen: cortar ? restantes.join(eol) + (terminaEnEol && restantes.length ? eol : '') : origen,
    destino: previo + bloque.join(eol) + eol,
    lineas: bloque.length,
  }
}

function main(args) {
  const cortar = args.includes('--cortar')
  const [origen, rangos, destino, ...sobra] = args.filter((a) => a !== '--cortar')
  if (!origen || !rangos || !destino || sobra.length) throw new Error('uso: mover.mjs <origen> <desde-hasta>[,<desde-hasta>…] <destino> [--cortar]')
  const cwd = process.cwd()
  const raiz = raizDe(cwd)
  // El origen también: copiar de un .env o de fuera del repo metería secretos en el código.
  for (const ruta of [origen, destino]) {
    const motivo = motivoRuta(ruta, { raiz, base: cwd })
    if (motivo) throw new Error(motivo)
  }
  const absOrigen = path.resolve(cwd, origen)
  const absDestino = path.resolve(cwd, destino)
  if (absOrigen === absDestino) throw new Error('origen y destino son el mismo archivo')
  const texto = fs.readFileSync(absOrigen, 'utf8')
  const previo = fs.existsSync(absDestino) ? fs.readFileSync(absDestino, 'utf8') : ''
  const r = moverLineas(texto, rangos, previo, cortar)
  fs.mkdirSync(path.dirname(absDestino), { recursive: true })
  fs.writeFileSync(absDestino, r.destino)
  if (cortar) fs.writeFileSync(absOrigen, r.origen)
  console.log(`MOVIDO: ${r.lineas} líneas de ${origen}:${rangos} → final de ${destino}${previo ? '' : ' (nuevo)'}${cortar ? '; quitadas del origen' : '; el origen queda igual'}`)
}

const esPrincipal = () => {
  if (!process.argv[1]) return false
  const a = path.resolve(process.argv[1])
  const b = fileURLToPath(import.meta.url)
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
}

if (esPrincipal()) {
  try {
    main(process.argv.slice(2))
  } catch (e) {
    console.log(`ERROR: ${e.message}`)
    process.exitCode = 2
  }
}
