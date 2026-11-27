// Tests de commitear.mjs: lectura de la respuesta del agente y corridas reales en un repo temporal con remoto bare.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { leerRespuesta, mensajeDe } from './commitear.mjs'

const SCRIPT = fileURLToPath(new URL('./commitear.mjs', import.meta.url))
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
const remotoTiene = (remoto, rama) => spawnSync('git', ['--git-dir', remoto, 'rev-parse', '--verify', '-q', rama], { encoding: 'utf8' }).stdout.trim()
const raices = []
test.after(() => {
  for (const raiz of raices) fs.rmSync(raiz, { recursive: true, force: true })
})
const correr = (dir, modo, respuesta, extra = []) => spawnSync(process.execPath, [SCRIPT, '--modo', modo, ...extra], { cwd: dir, input: respuesta, encoding: 'utf8' })

/** Escribe un archivo del repo, con sus carpetas. */
function escribir(dir, ruta, texto) {
  fs.mkdirSync(path.dirname(path.join(dir, ruta)), { recursive: true })
  fs.writeFileSync(path.join(dir, ruta), texto)
}

/** Repo temporal en `main` con un commit inicial y un remoto bare como origin. */
function repo() {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'qcc-commitear-'))
  raices.push(raiz)
  const dir = path.join(raiz, 'repo')
  const remoto = path.join(raiz, 'remoto.git')
  fs.mkdirSync(dir)
  git(raiz, 'init', '-q', '--bare', remoto)
  git(dir, 'init', '-q', '-b', 'main')
  for (const [clave, valor] of [['user.email', 't@t'], ['user.name', 't'], ['core.autocrlf', 'false'], ['commit.gpgsign', 'false']]) git(dir, 'config', clave, valor)
  git(dir, 'remote', 'add', 'origin', remoto)
  escribir(dir, 'base.txt', 'base\n')
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '-m', 'Base')
  return { dir, remoto }
}

/** Arma una respuesta del agente con sus bloques COMMIT. */
function respuesta({ commits, excluidos = [], rama }) {
  const lineas = [`ALCANCE: todo (${commits.length} grupos)`, ...(rama ? [`RAMA: ${rama}`] : [])]
  commits.forEach(([archivos, resumen, vinetas = []], i) => {
    lineas.push(`COMMIT ${i + 1}`, 'ARCHIVOS:', ...archivos.map((a) => `- ${a}`), `RESUMEN: ${resumen}`, 'DESCRIPCIÓN:', ...(vinetas.length ? vinetas.map((v) => `- ${v}`) : ['ninguna']))
  })
  lineas.push('EXCLUIDOS:', ...(excluidos.length ? excluidos.map((e) => `- ${e}`) : ['ninguno']), 'NOTA: ninguna')
  return lineas.join('\n')
}

test('leerRespuesta lee commits, rama, excluidos y nota, con cercos, CRLF y «ninguna»', () => {
  const texto = ['```', 'ALCANCE: todo (4 archivos)', 'RAMA: feat/x', 'COMMIT 1', 'ARCHIVOS:', '- src/a.js', '- src/a.test.js', 'RESUMEN: Agrega a', 'DESCRIPCIÓN:', '- Primera', '- Segunda', 'COMMIT 2', 'ARCHIVOS:', '- docs/', 'RESUMEN: Documenta a', 'DESCRIPCIÓN: ninguna', 'EXCLUIDOS:', '- .env', 'NOTA: lockfile', 'sin leer', '```'].join('\r\n')
  assert.deepEqual(leerRespuesta(texto), {
    sinCambios: false,
    rama: 'feat/x',
    commits: [{ archivos: ['src/a.js', 'src/a.test.js'], resumen: 'Agrega a', vinetas: ['Primera', 'Segunda'] }, { archivos: ['docs/'], resumen: 'Documenta a', vinetas: [] }],
    excluidos: ['.env'],
    nota: 'lockfile sin leer',
  })
  assert.equal(leerRespuesta('ALCANCE: sin cambios').sinCambios, true)
  assert.deepEqual(leerRespuesta('COMMIT 1\nARCHIVOS:\n- a\nRESUMEN: X\nDESCRIPCIÓN:\nninguna\nEXCLUIDOS:\nninguno\nNOTA: ninguna').commits[0].vinetas, [])
  assert.deepEqual(leerRespuesta('COMMIT 1\nARCHIVOS:\n- a\nRESUMEN: X\nDESCRIPCIÓN:\n- Una viñeta que\n  sigue en otra línea\n- Otra').commits[0].vinetas, ['Una viñeta que sigue en otra línea', 'Otra'])
})

test('leerRespuesta: valores en la misma línea que su clave y líneas de DESCRIPCIÓN sin «- »', () => {
  const vinetas = (desc) => leerRespuesta(`COMMIT 1\nARCHIVOS:\n- a\nRESUMEN: X\n${desc}`).commits[0].vinetas
  assert.deepEqual(vinetas('DESCRIPCIÓN: - Primera\n- Segunda'), ['Primera', 'Segunda'])
  assert.deepEqual(vinetas('DESCRIPCIÓN: un párrafo\nque sigue'), ['un párrafo que sigue'])
  assert.deepEqual(vinetas('DESCRIPCIÓN:\nUn párrafo sin guion\n- Otra'), ['Un párrafo sin guion', 'Otra'])
  assert.deepEqual(vinetas('DESCRIPCIÓN: ninguna'), [])
  const r = leerRespuesta('COMMIT 1\nARCHIVOS: - a.js\n- b.js\nRESUMEN: X\nCOMMIT 2\nARCHIVOS: c.js\nRESUMEN: Y\nEXCLUIDOS: - .env\n- secretos/')
  assert.deepEqual(r.commits.map((c) => c.archivos), [['a.js', 'b.js'], ['c.js']])
  assert.deepEqual(r.excluidos, ['.env', 'secretos/'])
  assert.deepEqual(leerRespuesta('COMMIT 1\nARCHIVOS: ninguno\nEXCLUIDOS: ninguno').excluidos, [])
})

test('mensajeDe: resumen, línea en blanco y viñetas; solo el resumen sin viñetas', () => {
  assert.equal(mensajeDe({ resumen: 'Agrega a', vinetas: ['Uno', 'Dos'] }), 'Agrega a\n\n- Uno\n- Dos\n')
  assert.equal(mensajeDe({ resumen: 'Agrega a', vinetas: [] }), 'Agrega a\n')
})

test('commit + push: un commit por grupo con su mensaje exacto, sin el stage previo ni secretos, y push', () => {
  const { dir, remoto } = repo()
  escribir(dir, 'base.txt', 'cambiada\n')
  escribir(dir, 'src/a.js', 'a\n')
  escribir(dir, 'docs/guía.md', 'guía\n')
  escribir(dir, '.env', 'CLAVE=1\n')
  escribir(dir, '.env.local', 'CLAVE=2\n')
  escribir(dir, 'secretos/clave.pem', 'x\n')
  git(dir, 'add', '--', 'docs/guía.md')
  const r = correr(dir, 'push', respuesta({
    commits: [[['base.txt', 'src/a.js', '.env.local'], 'Agrega a', ['Primera', 'Segunda']], [['docs/'], 'Documenta la guía']],
    excluidos: ['.env', 'secretos/'],
  }))
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.equal(git(dir, 'log', '-1', '--format=%B', 'HEAD~1'), 'Agrega a\n\n- Primera\n- Segunda')
  assert.equal(git(dir, 'log', '-1', '--format=%B'), 'Documenta la guía')
  assert.equal(git(dir, '-c', 'core.quotePath=false', 'show', '--name-only', '--format=', 'HEAD~1'), 'base.txt\nsrc/a.js')
  assert.equal(git(dir, '-c', 'core.quotePath=false', 'show', '--name-only', '--format=', 'HEAD'), 'docs/guía.md')
  assert.equal(remotoTiene(remoto, 'main'), git(dir, 'rev-parse', 'HEAD'))
  const hash = git(dir, 'rev-parse', '--short', 'HEAD')
  assert.match(r.stdout, new RegExp(`^${hash} Documenta la guía$`, 'm'))
  assert.match(r.stdout, /^- Primera$/m)
  assert.match(r.stdout, /^Rama: main · push: hecho$/m)
  assert.match(r.stdout, /^Sin commit \(posibles secretos\): \.env, \.env\.local, secretos\/clave\.pem$/m)
  assert.doesNotMatch(r.stdout, /Quedó sin commit/)
})

test('solo commit: un archivo versionado dentro de una carpeta ignorada entra sin error y no hay push', () => {
  const { dir, remoto } = repo()
  escribir(dir, 'scripts/x.mjs', 'uno\n')
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '-m', 'Scripts')
  escribir(dir, '.gitignore', 'scripts\n')
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '-m', 'Ignora scripts')
  escribir(dir, 'scripts/x.mjs', 'dos\n')
  const r = correr(dir, 'solo', respuesta({ commits: [[['scripts/x.mjs'], 'Cambia x']] }))
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.equal(git(dir, 'show', '--name-only', '--format=', 'HEAD'), 'scripts/x.mjs')
  assert.equal(git(dir, 'status', '--short'), '')
  assert.match(r.stdout, /^Rama: main · push: no$/m)
  assert.equal(remotoTiene(remoto, 'main'), '')
})

test('lo sacado del índice con git rm --cached sale en su commit y queda en disco; un borrado común, también', () => {
  const { dir } = repo()
  for (const f of ['notas.md', 'otra.md', 'borrado.txt']) escribir(dir, f, `${f}\n`)
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '-m', 'Notas')
  escribir(dir, '.gitignore', 'notas.md\n')
  git(dir, 'rm', '-q', '--cached', '--', 'notas.md', 'otra.md')
  git(dir, 'rm', '-q', '--', 'borrado.txt')
  const r = correr(dir, 'solo', respuesta({ commits: [[['.gitignore', 'notas.md', 'otra.md', 'borrado.txt'], 'Deja de versionar las notas']] }))
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.equal(git(dir, 'show', '--no-renames', '--name-status', '--format=', 'HEAD'), 'A\t.gitignore\nD\tborrado.txt\nD\tnotas.md\nD\totra.md')
  assert.equal(git(dir, 'ls-files'), '.gitignore\nbase.txt')
  assert.deepEqual(['notas.md', 'otra.md', 'borrado.txt'].map((f) => fs.existsSync(path.join(dir, f))), [true, true, false])
  assert.doesNotMatch(r.stdout, /Quedó sin commit/)
})

test('corta en el primer fallo: no sigue con los demás commits ni con el push y dice qué quedó en stage', () => {
  const { dir, remoto } = repo()
  escribir(dir, '.git/hooks/pre-commit', '#!/bin/sh\ngit diff --cached --name-only | grep -q b.txt && exit 1\nexit 0\n')
  fs.chmodSync(path.join(dir, '.git/hooks/pre-commit'), 0o755)
  escribir(dir, 'a.txt', 'a\n')
  escribir(dir, 'b.txt', 'b\n')
  escribir(dir, 'c.txt', 'c\n')
  const r = correr(dir, 'push', respuesta({ commits: [[['a.txt'], 'Agrega a'], [['b.txt'], 'Agrega b'], [['c.txt'], 'Agrega c']] }))
  assert.equal(r.status, 1, r.stdout + r.stderr)
  assert.equal(git(dir, 'log', '-1', '--format=%s'), 'Agrega a')
  assert.match(r.stdout, /^Rama: main · push: no$/m)
  assert.match(r.stdout, /^Falló: git commit \(«Agrega b»\)/m)
  assert.match(r.stdout, /^Aviso: quedaron en stage: b\.txt$/m)
  assert.match(r.stdout, /^Quedó sin commit: /m)
  assert.equal(remotoTiene(remoto, 'main'), '')
})

test('una ruta que no está entre los cambios frena antes del primer commit', () => {
  const { dir } = repo()
  escribir(dir, 'a.txt', 'a\n')
  const r = correr(dir, 'push', respuesta({ commits: [[['a.txt'], 'Agrega a'], [['no-existe.txt'], 'Agrega otro']] }))
  assert.equal(r.status, 1)
  assert.equal(git(dir, 'log', '-1', '--format=%s'), 'Base')
  assert.match(r.stdout, /^sin commit$/m)
  assert.match(r.stdout, /^Falló: rutas que no están entre los cambios: no-existe\.txt$/m)
})

test('rama nueva: si el nombre existe usa -2, y sube la rama', () => {
  const { dir, remoto } = repo()
  git(dir, 'branch', 'feat/agrega-a')
  escribir(dir, 'a.txt', 'a\n')
  const r = correr(dir, 'rama', respuesta({ rama: 'feat/agrega-a', commits: [[['a.txt'], 'Agrega a']] }))
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.equal(git(dir, 'branch', '--show-current'), 'feat/agrega-a-2')
  assert.match(r.stdout, /^Rama: feat\/agrega-a-2 · push: hecho$/m)
  assert.equal(remotoTiene(remoto, 'feat/agrega-a-2'), git(dir, 'rev-parse', 'HEAD'))
})

test('una respuesta inválida sale con 2 sin tocar git, ni el stage', () => {
  const { dir } = repo()
  escribir(dir, 'a.txt', 'a\n')
  git(dir, 'add', '--', 'a.txt')
  for (const texto of [respuesta({ rama: '-mala', commits: [[['a.txt'], 'Agrega a']] }), 'COMMIT 1\nARCHIVOS:\n- a.txt\nRESUMEN:']) {
    const r = correr(dir, 'rama', texto)
    assert.equal(r.status, 2, r.stdout)
    assert.equal(git(dir, 'diff', '--cached', '--name-only'), 'a.txt')
    assert.equal(git(dir, 'branch', '--show-current'), 'main')
  }
})

test('con --archivo: avisa lo que quedó sin commit, las viñetas largas y quita las atribuciones', () => {
  const { dir } = repo()
  escribir(dir, 'a.txt', 'a\n')
  escribir(dir, 'olvidado.txt', 'o\n')
  const archivo = path.join(dir, '..', 'respuesta.txt')
  const larga = 'Una viñeta que pasa holgadamente de los setenta y dos caracteres del tope'
  fs.writeFileSync(archivo, respuesta({ commits: [[['a.txt'], 'Agrega a', [larga, 'Co-Authored-By: Claude <noreply@anthropic.com>']]] }))
  const r = spawnSync(process.execPath, [SCRIPT, '--modo', 'solo', '--archivo', archivo], { cwd: dir, encoding: 'utf8' })
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.equal(git(dir, 'log', '-1', '--format=%B'), `Agrega a\n\n- ${larga}`)
  assert.match(r.stdout, /^Quedó sin commit \(no debía\): olvidado\.txt\. Corre \/commit de nuevo\.$/m)
  assert.match(r.stdout, /^Aviso: viñeta de \d+ caracteres \(tope 72\) en «Agrega a»$/m)
  assert.match(r.stdout, /^Aviso: quité de «Agrega a» 1 viñeta\(s\) con atribución$/m)
})

test('sin cambios, sin bloques COMMIT y sin --modo', () => {
  const { dir } = repo()
  assert.equal(correr(dir, 'push', 'ALCANCE: sin cambios').stdout.trim(), 'sin cambios')
  const soloExcluidos = correr(dir, 'push', 'ALCANCE: todo (1 archivos)\nEXCLUIDOS:\n- .env\nNOTA: ninguna')
  assert.equal(soloExcluidos.stdout.trim(), 'Sin commit (posibles secretos): .env\nsin commit')
  const sinModo = spawnSync(process.execPath, [SCRIPT], { cwd: dir, input: 'x', encoding: 'utf8' })
  assert.equal(sinModo.status, 2)
  assert.match(sinModo.stderr, /^Uso: /)
  for (const texto of ['', 'algo que no es la respuesta del agente']) {
    const vacia = correr(dir, 'push', texto)
    assert.equal(vacia.status, 2, texto)
    assert.match(vacia.stdout, /^Respuesta del agente vacía/)
  }
  const sinArchivo = spawnSync(process.execPath, [SCRIPT, '--modo', 'push', '--archivo', path.join(dir, 'no-existe.txt')], { cwd: dir, encoding: 'utf8' })
  assert.equal(sinArchivo.status, 2)
  assert.match(sinArchivo.stderr, /^No pude leer /)
})
