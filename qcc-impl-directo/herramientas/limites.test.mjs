import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { leer, resumen } from './limites.mjs'

const SCRIPT = fileURLToPath(new URL('./limites.mjs', import.meta.url))
const RESET_5H = '2026-11-14T05:00:00.000Z'
const RESET_SEM = '2026-11-16T09:00:00.000Z'
const lectura = (t, pct5, pctSem, reset5 = RESET_5H) => ({ t, five_hour: { pct: pct5, resetsAt: reset5 }, seven_day: { pct: pctSem, resetsAt: RESET_SEM } })

test('resumen resta las lecturas y redondea a 0,1', () => {
  assert.equal(resumen(lectura('2026-11-14T01:00:00Z', 40, 10), lectura('2026-11-14T01:20:00Z', 47, 11.5)), '5h +7 % · sem +1,5 %')
})

test('resumen da la cota mínima tras un reinicio y s/d sin dato', () => {
  const inicio = lectura('2026-11-14T04:50:00Z', 90, 10)
  assert.equal(resumen(inicio, lectura('2026-11-14T05:10:00Z', 3, 12, '2026-11-14T10:00:00.000Z')), '5h ≥+3 % · sem +2 %')
  assert.equal(resumen({ t: inicio.t, sinDato: 'snapshot viejo' }, inicio), '5h s/d · sem s/d')
  assert.equal(resumen(undefined, inicio), '5h s/d · sem s/d')
})

test('leer marca sin dato al snapshot ausente, roto o viejo', () => {
  const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'qcc-impl-d-'))
  const archivo = path.join(carpeta, 'qcc-limites.json')
  const ahora = Date.parse('2026-11-14T01:00:00Z')
  assert.equal(leer(archivo, ahora).sinDato, 'sin snapshot del panel')
  fs.writeFileSync(archivo, '{"t":"no es fecha"}')
  assert.equal(leer(archivo, ahora).sinDato, 'snapshot roto')
  fs.writeFileSync(archivo, JSON.stringify(lectura('2026-11-14T00:49:00Z', 40, 10)))
  assert.equal(leer(archivo, ahora).sinDato, 'snapshot viejo')
  fs.writeFileSync(archivo, JSON.stringify(lectura('2026-11-14T00:55:00Z', 40, 10)))
  assert.deepEqual(leer(archivo, ahora).five_hour, { pct: 40, resetsAt: RESET_5H })
})

test('--inicio y --fin imprimen el gasto de la sesión y borran la lectura inicial', () => {
  const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'qcc-impl-d-'))
  const snapshot = path.join(carpeta, 'qcc-limites.json')
  const env = { ...process.env, QCC_LIMITES: snapshot, QCC_IMPL_D_TMP: path.join(carpeta, 'tmp'), CLAUDE_CODE_SESSION_ID: 'sesion-1' }
  const correr = (opcion) => spawnSync(process.execPath, [SCRIPT, opcion], { env, encoding: 'utf8' }).stdout.trim()
  const ahora = new Date().toISOString()
  const reset = new Date(Date.now() + 3_600_000).toISOString()
  fs.writeFileSync(snapshot, JSON.stringify(lectura(ahora, 20, 5, reset)))
  assert.equal(correr('--inicio'), 'anotados')
  fs.writeFileSync(snapshot, JSON.stringify(lectura(ahora, 24, 5, reset)))
  assert.equal(correr('--fin'), 'LÍMITES: 5h +4 % · sem +0 %')
  assert.deepEqual(fs.readdirSync(path.join(carpeta, 'tmp')), [])
  assert.equal(correr('--fin'), 'LÍMITES: 5h s/d · sem s/d (sin lectura inicial)')
})
