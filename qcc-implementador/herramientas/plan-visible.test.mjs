// Tests de plan-visible: la pregunta «Plan» de AskUserQuestion pasa solo si una opción muestra el plan en `preview`.
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { motivoDe } from './plan-visible.mjs'

const RUTA = fileURLToPath(new URL('./plan-visible.mjs', import.meta.url))
const plan = (preview) => ({ question: '¿Apruebas el plan?', header: 'Plan', options: [{ label: 'Aprobar', ...(preview === undefined ? {} : { preview }) }, { label: 'Cancelar' }] })

test('niega la pregunta «Plan» sin preview o sin líneas S<n>', () => {
  assert.ok(motivoDe({ questions: [plan()] }))
  assert.ok(motivoDe({ questions: [plan('PLAN · algo, sin subtareas')] }))
  assert.ok(motivoDe({ questions: [{ header: 'Otra', options: [{ label: 'x', preview: 'S1 · a' }] }, plan()] }))
})

test('deja pasar la pregunta «Plan» con el plan en preview, y las demás preguntas', () => {
  assert.equal(motivoDe({ questions: [plan('PLAN · x\nS1 · Hace algo · Crítica: no\nS2 · Otra')] }), null)
  assert.equal(motivoDe({ questions: [{ header: 'Permisos', options: [{ label: 'P1' }] }] }), null)
  assert.equal(motivoDe({}), null)
})

test('corrida por stdin: deny solo para AskUserQuestion sin plan', () => {
  const correr = (evento) => spawnSync(process.execPath, [RUTA], { input: JSON.stringify(evento), encoding: 'utf8' }).stdout
  const salida = correr({ tool_name: 'AskUserQuestion', tool_input: { questions: [plan()] } })
  assert.equal(JSON.parse(salida).hookSpecificOutput.permissionDecision, 'deny')
  assert.equal(correr({ tool_name: 'AskUserQuestion', tool_input: { questions: [plan('S1 · a')] } }), '')
  assert.equal(correr({ tool_name: 'Bash', tool_input: { command: 'ls' } }), '')
})
