#!/usr/bin/env node
// El % de la ventana de 5 h y de la semanal que gasta un /impl-d, del snapshot que escribe el panel (ver LIMITES.md).
//
//   node <plugin>/herramientas/limites.mjs --inicio   anota la lectura inicial de la sesión (la skill lo corre al cargar)
//   node <plugin>/herramientas/limites.mjs --fin      imprime `LÍMITES: 5h +7 % · sem +1 %` y borra la lectura inicial
//
// Mismas reglas que /impl (costos.mjs): una lectura sin snapshot, rota o de más de 10 minutos es «sin dato» (`s/d`, nunca
// ceros) y un reinicio de la ventana en medio da la cota mínima, el % de la lectura final (`≥+`). Las copia en vez de
// importar costos.mjs porque cada plugin se instala por separado.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const VENTANAS = [['5h', 'five_hour'], ['sem', 'seven_day']]
/** Más vieja que esto (segundos), la lectura del snapshot es «sin dato». */
export const LIMITES_MAX_SEG = 10 * 60

const configDe = () => process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')
/** El snapshot del panel en la carpeta de la cuenta (`QCC_LIMITES` lo cambia, para los tests). */
const rutaLimites = () => process.env.QCC_LIMITES || path.join(configDe(), 'qcc-limites.json')
/** La lectura inicial de esta sesión, en el temporal del sistema (`QCC_IMPL_D_TMP` lo cambia, para los tests). */
function rutaInicio() {
  const sesion = /^[\w-]+$/.test(process.env.CLAUDE_CODE_SESSION_ID ?? '') ? process.env.CLAUDE_CODE_SESSION_ID : 'sin-sesion'
  return path.join(process.env.QCC_IMPL_D_TMP || path.join(os.tmpdir(), 'qcc-impl-d'), `${sesion}.json`)
}

/**
 * Lectura del snapshot: `{ t, five_hour?: { pct, resetsAt }, seven_day?: … }`; sin snapshot, roto o con más de
 * `LIMITES_MAX_SEG`, `{ t, sinDato: <motivo> }`.
 */
export function leer(archivo = rutaLimites(), ahora = Date.now()) {
  const t = new Date(ahora).toISOString()
  let s
  try {
    s = JSON.parse(fs.readFileSync(archivo, 'utf8'))
  } catch {
    return { t, sinDato: 'sin snapshot del panel' }
  }
  const edad = (ahora - Date.parse(s?.t)) / 1000
  if (!Number.isFinite(edad)) return { t, sinDato: 'snapshot roto' }
  if (edad > LIMITES_MAX_SEG) return { t, sinDato: 'snapshot viejo' }
  const lectura = { t }
  for (const [, k] of VENTANAS) if (Number.isFinite(s[k]?.pct)) lectura[k] = { pct: s[k].pct, resetsAt: s[k].resetsAt }
  return lectura
}

/** «5h +7 % · sem +1,5 %» entre dos lecturas: `≥+<% final>` si la ventana se reinició en medio, `s/d` si falta alguna. */
export function resumen(inicio, fin) {
  return VENTANAS.map(([nombre, k]) => {
    const a = inicio?.[k]
    const b = fin?.[k]
    if (!a || !b) return `${nombre} s/d`
    const ra = Date.parse(a.resetsAt)
    const rb = Date.parse(b.resetsAt)
    // Se reinició si bajó el %, si la lectura final es posterior al reinicio previsto o si cambió la hora de reinicio.
    const reinicio = b.pct < a.pct || (Number.isFinite(ra) && Date.parse(fin.t) >= ra) || (Number.isFinite(ra) && Number.isFinite(rb) && Math.abs(ra - rb) > 60_000)
    const gasto = reinicio ? b.pct : Math.round((b.pct - a.pct) * 10) / 10
    return `${nombre} ${reinicio ? '≥' : ''}+${String(gasto).replace('.', ',')} %`
  }).join(' · ')
}

function main(opcion) {
  const archivo = rutaInicio()
  if (opcion === '--inicio') {
    const lectura = leer()
    fs.mkdirSync(path.dirname(archivo), { recursive: true })
    fs.writeFileSync(archivo, JSON.stringify(lectura))
    console.log(lectura.sinDato ? `s/d (${lectura.sinDato})` : 'anotados')
  } else if (opcion === '--fin') {
    let inicio
    try {
      inicio = JSON.parse(fs.readFileSync(archivo, 'utf8'))
    } catch {}
    fs.rmSync(archivo, { force: true })
    console.log(`LÍMITES: ${resumen(inicio, leer())}${inicio ? '' : ' (sin lectura inicial)'}`)
  } else {
    console.error('uso: limites.mjs --inicio | --fin')
    process.exitCode = 2
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv[2])
