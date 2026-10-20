// Tests de la guardia solo-git: comandos permitidos, negados, rodeos y corrida real por stdin.
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { motivoDe } from './solo-git.mjs'

const RUTA = fileURLToPath(new URL('./solo-git.mjs', import.meta.url))

const PERMITIDOS = [
  'git status --short',
  'git status --short -uall -- src/',
  'git diff --cached --stat',
  'git diff --stat',
  'git diff -U1 -- "a b.txt"',
  'git log -8 --format=%s',
  'git show --stat HEAD',
  '  git status  ',
  'git -c core.quotePath=false status --short',
  'git -c core.quotepath=false status --short -uall -- src/',
  'git -c core.quotePath=false diff -- "diseño.md"',
]

const NEGADOS = [
  ['vacío', ''],
  ['solo espacios', '   '],
  ['git sin subcomando', 'git'],
  ['git push', 'git push'],
  ['git add', 'git add -A'],
  ['git commit', 'git commit -m x'],
  ['otro programa', 'ls'],
  ['gitx', 'gitx status'],
  ['variable antes de git', 'GIT_DIR=x git status'],
  ['-c global', 'git -c core.pager=x log'],
  ['-C global', 'git -C .. status'],
  ['quotePath=true', 'git -c core.quotePath=true status'],
  ['otra clave parecida', 'git -c corexquotePath=false status'],
  ['quotePath entre comillas', 'git -c "core.quotePath=false" status'],
  ['quotePath sin espacio', 'git -ccore.quotePath=false status'],
  ['quotePath sin subcomando', 'git -c core.quotePath=false'],
  ['quotePath con push', 'git -c core.quotePath=false push'],
  ['quotePath y otro -c', 'git -c core.quotePath=false -c core.pager=x log'],
  ['quotePath con --output', 'git -c core.quotePath=false diff --output=f'],
  ['punto y coma', 'git status; rm x'],
  ['&&', 'git status && x'],
  ['pipe', 'git status | x'],
  ['redirección de salida', 'git log > f'],
  ['redirección de entrada', 'git diff < f'],
  ['backtick', 'git log `x`'],
  ['sustitución', 'git log $(x)'],
  ['variable', 'git log $HOME'],
  ['paréntesis', 'git log (x)'],
  ['salto de línea', 'git status\nrm x'],
  ['retorno de carro', 'git status\r'],
  ['--output=', 'git diff --output=f'],
  ['--output separado', 'git diff --output f'],
  ['-o', 'git diff -o f'],
  ['-of', 'git diff -of'],
  ['--ext-diff', 'git diff --ext-diff'],
  ['--exec=', 'git log --exec=x'],
  ['comillas', 'git diff "--output=f"'],
  ['barra invertida', 'git diff --out\\put=f'],
  ['abreviatura --outp', 'git diff --outp=f'],
  ['abreviatura --ext', 'git diff --ext'],
  ['llaves --output', 'git diff --{output=f,}'],
  ['llaves en medio de --output', 'git diff --out{put,}=f'],
  ['llaves --ext-diff', 'git log -p --{ext-diff,}'],
  ['comodín *', 'git diff --out*=f'],
  ['comodín ?', 'git diff --outpu?=f'],
  ['comodín [', 'git diff --outpu[t]=f'],
]

test('motivoDe permite los comandos git simples', () => {
  for (const comando of PERMITIDOS) assert.equal(motivoDe(comando), null, comando)
})

test('motivoDe niega lo demás con un texto', () => {
  for (const [nombre, comando] of NEGADOS) {
    const motivo = motivoDe(comando)
    assert.equal(typeof motivo, 'string', nombre)
    assert.ok(motivo.length > 0, nombre)
  }
})

test('motivoDe niega lo que no es texto', () => {
  for (const valor of [undefined, null, 42, {}, ['git status']]) {
    assert.equal(typeof motivoDe(valor), 'string')
  }
})

/** Corre la guardia como hook real y devuelve el resultado. */
function correr(input) {
  return spawnSync(process.execPath, [RUTA], { input, encoding: 'utf8' })
}

test('hook real: Bash con git push se niega', () => {
  const r = correr(JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git push' } }))
  const salida = JSON.parse(r.stdout)
  assert.equal(salida.hookSpecificOutput.permissionDecision, 'deny')
  assert.equal(salida.hookSpecificOutput.hookEventName, 'PreToolUse')
})

test('hook real: PowerShell con git status --short pasa sin salida', () => {
  const r = correr(JSON.stringify({ tool_name: 'PowerShell', tool_input: { command: 'git status --short' } }))
  assert.equal(r.stdout, '')
})

test('hook real: otra herramienta pasa sin salida', () => {
  const r = correr(JSON.stringify({ tool_name: 'Read', tool_input: { file_path: 'x' } }))
  assert.equal(r.stdout, '')
})

test('hook real: un input que no es JSON no imprime y sale en 0', () => {
  const r = correr('no es json')
  assert.equal(r.stdout, '')
  assert.equal(r.status, 0)
})
