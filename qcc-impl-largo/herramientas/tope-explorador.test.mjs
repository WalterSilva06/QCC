import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { decision, esExplorador } from './tope-explorador.mjs'

const SCRIPT = fileURLToPath(new URL('./tope-explorador.mjs', import.meta.url))

/** Un evento de lectura del agente `tipo` cuyo transcript termina con `contexto` tokens. */
function evento(tipo, contexto, herramienta = 'Read') {
  const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'qcc-impl-l-tope-'))
  const subagentes = path.join(carpeta, 's1', 'subagents')
  fs.mkdirSync(subagentes, { recursive: true })
  const usage = { input_tokens: 10, cache_read_input_tokens: contexto - 1_010, cache_creation_input_tokens: 1_000 }
  fs.writeFileSync(path.join(subagentes, 'agent-a1.jsonl'), [
    JSON.stringify({ type: 'assistant', message: { usage: { input_tokens: 5 } } }),
    JSON.stringify({ type: 'user', message: {} }),
    JSON.stringify({ type: 'assistant', message: { usage } }),
    '',
  ].join('\n'))
  return { agent_type: tipo, agent_id: 'a1', transcript_path: path.join(carpeta, 's1.jsonl'), tool_name: herramienta, tool_input: { file_path: 'x.md' } }
}

test('esExplorador acepta el agente con y sin prefijo, y nada más', () => {
  assert.equal(esExplorador('impl-l:qcc-explorador-largo'), true)
  assert.equal(esExplorador('qcc-explorador-largo'), true)
  for (const otro of ['impl-d:qcc-explorador-directo', 'Explore', 'impl-l:qcc-revisor-largo', '', undefined]) assert.equal(esExplorador(otro), false)
})

test('decision niega Read, Glob y Grep del explorador solo sobre 90k', () => {
  for (const h of ['Read', 'Glob', 'Grep']) {
    const r = decision(evento('impl-l:qcc-explorador-largo', 95_400, h))
    assert.equal(r.hookSpecificOutput.permissionDecision, 'deny')
    assert.match(r.hookSpecificOutput.permissionDecisionReason, /contexto del explorador en 95k \(tope 90k\)/)
  }
  assert.equal(decision(evento('impl-l:qcc-explorador-largo', 90_000)), null)
})

test('decision deja pasar a otros agentes, otras herramientas y transcripts ausentes', () => {
  assert.equal(decision(evento('Explore', 150_000)), null)
  assert.equal(decision(evento('impl-d:qcc-explorador-directo', 150_000)), null)
  assert.equal(decision(evento('impl-l:qcc-explorador-largo', 150_000, 'Bash')), null)
  assert.equal(decision({ ...evento('impl-l:qcc-explorador-largo', 150_000), agent_id: 'otro' }), null)
  assert.equal(decision({ agent_type: 'impl-l:qcc-explorador-largo', tool_name: 'Read' }), null)
})

test('el hook imprime el deny por stdout y nada si deja pasar', () => {
  const correr = (e) => spawnSync(process.execPath, [SCRIPT], { input: typeof e === 'string' ? e : JSON.stringify(e), encoding: 'utf8' })
  const negado = correr(evento('impl-l:qcc-explorador-largo', 120_000))
  assert.equal(negado.status, 0)
  assert.equal(JSON.parse(negado.stdout).hookSpecificOutput.permissionDecision, 'deny')
  assert.equal(correr(evento('impl-l:qcc-explorador-largo', 50_000)).stdout, '')
  assert.equal(correr('no es json').stdout, '')
})
