// Casos de mover.mjs (copiar o mover bloques de líneas entre archivos del repo) y su regla en la guardia.
// Correr: node --test qcc-implementador/herramientas/mover.test.mjs

import { repo, temporales, hook, ev, limpiar } from './pruebas-comun.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { moverLineas, rangosDe } from './mover.mjs'

const MOVER = fileURLToPath(new URL('./mover.mjs', import.meta.url))
const mover = (raiz, ...args) => spawnSync(process.execPath, [MOVER, ...args], { cwd: raiz, encoding: 'utf8' })

test.after(() => limpiar())

test('mover: corta varios bloques al final del destino y conserva el fin de línea', () => {
  const r = moverLineas('a\r\nb\r\nc\r\nd\r\ne\r\n', '4-5,2', 'x', true)
  assert.equal(r.destino, 'x\r\nd\r\ne\r\nb\r\n')
  assert.equal(r.origen, 'a\r\nc\r\n')
  assert.equal(r.lineas, 3)
  const copia = moverLineas('a\nb', '2', '', false)
  assert.deepEqual(copia, { origen: 'a\nb', destino: 'b\n', lineas: 1 })
})

test('mover: rangos inválidos, fuera del archivo o solapados', () => {
  assert.deepEqual(rangosDe('3-5, 9', 10), [[3, 5], [9, 9]])
  assert.throws(() => rangosDe('5-3', 10), /fuera del archivo/)
  assert.throws(() => rangosDe('9-11', 10), /fuera del archivo/)
  assert.throws(() => rangosDe('1-4,4-6', 10), /se solapan/)
  assert.throws(() => rangosDe('a', 10), /no es <desde>-<hasta>/)
})

test('mover: CLI mueve a un archivo nuevo y niega rutas protegidas', () => {
  const raiz = repo('mover', { 'src/a.ts': 'uno\ndos\ntres\n', '.env': 'CLAVE=1\n' })
  temporales.push(raiz)
  const r = mover(raiz, 'src/a.ts', '2-3', 'src/nuevo/b.ts', '--cortar')
  assert.match(r.stdout, /^MOVIDO: 2 líneas de src\/a\.ts:2-3 → final de src\/nuevo\/b\.ts \(nuevo\); quitadas del origen$/m)
  assert.equal(fs.readFileSync(path.join(raiz, 'src/a.ts'), 'utf8'), 'uno\n')
  assert.equal(fs.readFileSync(path.join(raiz, 'src/nuevo/b.ts'), 'utf8'), 'dos\ntres\n')
  const secreto = mover(raiz, '.env', '1', 'src/c.ts')
  assert.match(secreto.stdout, /^ERROR: .*secretos/m)
  assert.equal(secreto.status, 2)
  assert.equal(fs.existsSync(path.join(raiz, 'src/c.ts')), false)
})

test('mover: la guardia lo niega al revisor y lo deja al ejecutor', () => {
  const raiz = repo('mover-guardia', { 'src/a.ts': 'a\n' })
  temporales.push(raiz)
  const cmd = `node "${MOVER}" src/a.ts 1 src/b.ts`
  const decision = (rol) => /"permissionDecision":\s*"(\w+)"/.exec(hook(raiz, rol, ev(raiz, 'Bash', { command: cmd })).stdout)?.[1] ?? 'allow'
  assert.equal(decision('revisor'), 'deny')
  assert.equal(decision('ejecutor'), 'allow')
})
