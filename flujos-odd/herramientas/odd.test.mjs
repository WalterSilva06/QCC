// Casos de las herramientas de /qcc-implementador-odd: guardia, verificar, odd, costo e instalar.
// Correr: node --test ~/.claude/flujos-odd/odd.test.mjs
//
// Los repos de prueba, los registros y la config de Claude Code van al temporal: no tocan el historial real.
// La guardia se prueba con la raíz de este repo, fuera del temporal (dentro de él, todo sería escribible).

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { evaluar, motivoComando, tramosDe, raizDe } from './guardia.mjs'
import { pasosDe, colaDe } from './verificar.mjs'
import { opcionesDe, criticosLegibles, tareasDe, sumaNumstat, recortar, filaDeCorrida, lineaDeCorrida } from './odd.mjs'
import { costoDelFlujo, costoDePedido } from './costo.mjs'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const ODD = path.join(DIR, 'odd.mjs')
const VERIFICAR = path.join(DIR, 'verificar.mjs')
const GUARDIA = path.join(DIR, 'guardia.mjs')
const RAIZ = raizDe(DIR)
const PRUEBAS = fs.mkdtempSync(path.join(os.tmpdir(), 'odd-pruebas-'))
const GIT_ENV = { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' }
const TMP = path.join(os.tmpdir(), 'odd-x').replaceAll('\\', '/')

test.after(() => fs.rmSync(PRUEBAS, { recursive: true, force: true }))

/** Repo de prueba con un commit; `archivos` es `{ ruta: contenido }`. */
function repo(nombre, archivos) {
  const raiz = path.join(PRUEBAS, nombre)
  fs.mkdirSync(raiz, { recursive: true })
  for (const [ruta, texto] of Object.entries(archivos)) {
    fs.mkdirSync(path.dirname(path.join(raiz, ruta)), { recursive: true })
    fs.writeFileSync(path.join(raiz, ruta), texto)
  }
  const git = (...args) => execFileSync('git', args, { cwd: raiz, env: { ...process.env, ...GIT_ENV }, stdio: 'pipe' })
  git('init', '-q')
  git('add', '-A')
  git('commit', '-qm', 'inicio')
  return raiz
}

function correr(script, raiz, ...args) {
  const r = spawnSync(process.execPath, [script, ...args], {
    cwd: raiz,
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: raiz, ODD_REGISTROS: path.join(PRUEBAS, 'registros'), CLAUDE_CONFIG_DIR: path.join(PRUEBAS, 'claude') },
  })
  return { salida: r.stdout, codigo: r.status }
}

const linea = (salida, prefijo) => salida.split('\n').find((l) => l.startsWith(prefijo))?.slice(prefijo.length)

// ── guardia ─────────────────────────────────────────────────────────────────

const PASAN = {
  ejecutor: [
    'git status --short',
    'git -c core.quotePath=false diff -- a.js',
    'git log -5 --format=%s | head -3',
    'node --test flujos-odd/herramientas/odd.test.mjs 2>&1 | tail -20',
    'npm test -- --reporter=dot',
    'pnpm run typecheck',
    'npx tsc --noEmit',
    'rm flujos-odd/viejo.txt',
    'Remove-Item -Force flujos-odd/viejo.txt',
    `mkdir -p ${TMP}/a && cp flujos-odd/x.js ${TMP}/a/`,
    'echo "process.env.FOO" > flujos-odd/nota.txt',
    'cat .env.example',
    'cargo test',
  ],
  revisor: [
    'node ~/.claude/flujos-odd/odd.mjs --diff abc123',
    `mkdir -p ${TMP}/base && git archive abc123 | tar -x -C ${TMP}/base`,
    `T=${TMP}; mkdir -p "$T/base" && git archive abc123 | tar -x -C "$T/base"`,
    `node script.js > ${TMP}/salida.txt 2>&1`,
    'node --test flujos-odd/herramientas/odd.test.mjs',
    'git diff abc123 -- flujos-odd/',
  ],
}

const NIEGAN = {
  ejecutor: [
    ['git commit -m x', /git commit/],
    ['git status && git push', /git push/],
    ['git stash', /git stash/],
    ['npm install lodash', /dependencias/],
    ['pnpm add -D vitest', /dependencias/],
    ['pip install requests', /dependencias/],
    ['npx -y cowsay', /dependencias/],
    ['curl https://x.dev', /red/],
    ['Invoke-WebRequest https://x.dev', /red/],
    ['echo $(curl -s https://x.dev)', /red/],
    ['rm -rf dist', /recursivo/],
    ['Remove-Item -Recurse -Force dist', /recursivo/],
    ['cat .env', /secretos/],
    ['cp config .env.local', /secretos/],
    ['npm run dev', /no termina/],
    ['vitest --watch', /watch/],
    ['echo x > ../fuera.txt', /fuera del repo/],
    ['echo x > pnpm-lock.yaml', /lockfile/],
  ],
  revisor: [
    ['echo x > flujos-odd/nota.txt', /solo escribe en el temporal/],
    ['sed -i s/a/b/ flujos-odd/x.js', /solo escribe en el temporal/],
    [`T=$(mktemp -d) && git archive abc | tar -x -C "$T"`, /no se ve a dónde escribe/],
    ['git archive abc | tar -x', /tar -x sin -C/],
    ['cp a.js b.js', /solo escribe en el temporal/],
    ['git checkout -- a.js', /git checkout/],
  ],
}

for (const [rol, comandos] of Object.entries(PASAN)) {
  test(`guardia: ${rol} pasa lo habitual`, () => {
    for (const cmd of comandos) assert.equal(motivoComando(cmd, { rol, raiz: RAIZ }), null, cmd)
  })
}

for (const [rol, casos] of Object.entries(NIEGAN)) {
  test(`guardia: ${rol} niega lo prohibido`, () => {
    for (const [cmd, motivo] of casos) assert.match(motivoComando(cmd, { rol, raiz: RAIZ }) ?? 'pasó', motivo, cmd)
  })
}

test('guardia: Edit y Write', () => {
  const editar = (rol, ruta) => evaluar({ tool_name: 'Edit', tool_input: { file_path: ruta } }, rol, RAIZ)
  assert.equal(editar('ejecutor', path.join(RAIZ, 'flujos-odd', 'x.js')), null)
  assert.equal(editar('ejecutor', path.join(os.tmpdir(), 'x.js')), null)
  assert.match(editar('ejecutor', path.join(RAIZ, '.env')), /secretos/)
  assert.match(editar('ejecutor', path.join(RAIZ, '.claude', 'settings.json')), /configuración/)
  assert.match(editar('ejecutor', path.join(RAIZ, '.git', 'config')), /\.git/)
  assert.match(editar('ejecutor', path.join(path.dirname(RAIZ), 'otro.js')), /fuera del repo/)
  assert.match(editar('revisor', path.join(RAIZ, 'flujos-odd', 'x.js')), /no edita/)
  assert.equal(evaluar({ tool_name: 'Read', tool_input: { file_path: '.env' } }, 'ejecutor', RAIZ), null)
})

test('guardia: tramos con comillas y sustituciones', () => {
  assert.deepEqual(tramosDe('a && b | c; d'), ['a', 'b', 'c', 'd'])
  assert.deepEqual(tramosDe('echo "a && b"'), ['echo "a && b"'])
  assert.deepEqual(tramosDe('echo $(git push)'), ['echo  __SUST__', 'git push'])
})

test('guardia: el hook imprime deny solo cuando niega', () => {
  const hook = (rol, evento) => spawnSync(process.execPath, [GUARDIA, rol], { input: JSON.stringify(evento), encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: RAIZ } }).stdout
  const negado = JSON.parse(hook('ejecutor', { tool_name: 'Bash', tool_input: { command: 'git push' } }))
  assert.equal(negado.hookSpecificOutput.permissionDecision, 'deny')
  assert.match(negado.hookSpecificOutput.permissionDecisionReason, /Guardia \/qcc-implementador-odd: git push/)
  assert.equal(hook('ejecutor', { tool_name: 'Bash', tool_input: { command: 'git status' } }), '')
  assert.equal(spawnSync(process.execPath, [GUARDIA, 'ejecutor'], { input: 'no es json', encoding: 'utf8' }).stdout, '')
})

// ── verificar ───────────────────────────────────────────────────────────────

test('verificar: pasos de la config, detectados o ninguno', () => {
  const conConfig = repo('v-config', { '.claude/qcc-implementador-odd.json': JSON.stringify({ verificar: [{ nombre: 'a', cmd: 'x', timeoutSeg: 5 }, { cmd: '' }] }) })
  assert.deepEqual(pasosDe(conConfig).pasos, [{ nombre: 'a', cmd: 'x', timeoutSeg: 5 }])
  const js = repo('v-js', { 'package.json': JSON.stringify({ scripts: { test: 'vitest run', lint: 'eslint .', tsc: 'tsc', dev: 'vite' } }), 'pnpm-lock.yaml': '' })
  assert.deepEqual(pasosDe(js).pasos.map((p) => p.cmd), ['pnpm run tsc', 'pnpm run lint', 'pnpm run test'])
  const sinTest = repo('v-sin-test', { 'package.json': JSON.stringify({ scripts: { test: 'echo "Error: no test specified" && exit 1' } }) })
  assert.deepEqual(pasosDe(sinTest).pasos, [])
  assert.deepEqual(pasosDe(repo('v-go', { 'go.mod': 'module x' })).pasos.map((p) => p.nombre), ['build', 'test'])
  assert.equal(pasosDe(repo('v-nada', { 'a.txt': '' })).origen, 'ninguno')
})

test('verificar: colaDe quita colores y corta', () => {
  assert.deepEqual(colaDe('\x1b[31ma\x1b[0m\n\nb\nc\n', 2), { lineas: ['b', 'c'], cortadas: 1 })
})

test('verificar: corre todos los pasos y resume', () => {
  const raiz = repo('v-corre', {
    '.claude/qcc-implementador-odd.json': JSON.stringify({
      verificar: [
        { nombre: 'bien', cmd: 'node -e "console.log(\'ok\')"' },
        { nombre: 'mal', cmd: 'node -e "console.error(\'falla clave\'); process.exit(2)"' },
        { nombre: 'despues', cmd: 'node -e "0"' },
      ],
    }),
  })
  const r = correr(VERIFICAR, raiz)
  assert.equal(r.codigo, 1)
  assert.match(r.salida, /^RESULTADO: ROJO \(mal\)/)
  assert.match(r.salida, /✓ bien/)
  assert.match(r.salida, /✗ mal · \d+ s · exit 2/)
  assert.match(r.salida, /✓ despues/)
  assert.match(r.salida, /falla clave/)
  assert.doesNotMatch(r.salida, /^ok$/m)
  const verde = repo('v-verde', { '.claude/qcc-implementador-odd.json': JSON.stringify({ verificar: [{ nombre: 'bien', cmd: 'node -e "0"' }] }) })
  assert.match(correr(VERIFICAR, verde).salida, /RESULTADO: VERDE/)
  const nada = correr(VERIFICAR, repo('v-sin-pasos', { 'a.txt': '' }))
  assert.equal(nada.codigo, 3)
  assert.match(nada.salida, /RESULTADO: SIN PASOS/)
})

test('verificar: corta un paso que pasa su tope', () => {
  const raiz = repo('v-tope', { '.claude/qcc-implementador-odd.json': JSON.stringify({ verificar: [{ nombre: 'lento', cmd: 'node -e "setTimeout(() => {}, 60000)"', timeoutSeg: 1 }] }) })
  const r = correr(VERIFICAR, raiz)
  assert.equal(r.codigo, 1)
  assert.match(r.salida, /✗ lento · \d+ s · cortado a los 1 s/)
})

// ── odd ─────────────────────────────────────────────────────────────────────

test('odd: opcionesDe', () => {
  assert.deepEqual(opcionesDe(['--diff', 'abc', '--', 'a.js', 'b.js']).rutas, ['a.js', 'b.js'])
  assert.equal(opcionesDe(['--diff', 'abc']).base, 'abc')
  const o = opcionesDe(['--cierre', '--base', 'abc', '--resultado', 'COMPLETO', '--riesgo', 'ítem 3 (parser compartido)'])
  assert.equal(o.modo, 'cierre')
  assert.equal(o.riesgo, 'ítem 3 (parser compartido)')
  assert.equal(opcionesDe(['--cierre', '--base', '--resultado', 'x']).base, undefined)
  assert.equal(opcionesDe(['--ultimos', '3']).ultimos, 3)
  assert.equal(opcionesDe(['--ultimos']).ultimos, 10)
  assert.equal(opcionesDe([]).modo, null)
})

test('odd: criticosLegibles, tareasDe, sumaNumstat y recortar', () => {
  assert.deepEqual(
    criticosLegibles([{ rutas: ['src/auth/'], excepto: ['src/auth/textos.ts'], riesgo: [2], motivo: 'auth' }, { rutas: ['a/*.md'], si: 'cambia su frontmatter' }, { rutas: [] }, null]),
    ['- src/auth/ (excepto src/auth/textos.ts) · ítem 2 — auth', '- a/*.md si cambia su frontmatter'],
  )
  assert.deepEqual(tareasDe('# X\n## Specs\n- [ ] no\n## Tasks\n- [x] T1\n- [ ] T2\n  - [ ] T3\n## Log\n- [ ] no\n'), { abiertas: 2, total: 3 })
  assert.deepEqual(tareasDe('sin tareas'), { abiertas: 0, total: 0 })
  assert.deepEqual(sumaNumstat('3\t1\ta.js\n-\t-\timg.png\n10\t0\tb.md\n'), { archivos: 3, mas: 13, menos: 1 })
  assert.deepEqual(recortar('a\nb\nc\n', 2), { texto: 'a\nb', sobran: 1 })
})

test('odd: fila y línea del listado', () => {
  const fila = filaDeCorrida({ t: '2026-10-20T10:00:00.000Z', raiz: '/x/repo', base: 'B', resultado: 'COMPLETO', tamano: 'chico', riesgo: 'ninguno', revision: 'omitida', cambios: { archivos: 1, mas: 2, menos: 0 } })
  assert.deepEqual(fila, { v: 1, t: '2026-10-20T10:00:00.000Z', raiz: '/x/repo', base: 'B', resultado: 'COMPLETO', tamano: 'chico', riesgo: 'ninguno', revision: 'omitida', cambios: { archivos: 1, mas: 2, menos: 0 } })
  assert.equal(lineaDeCorrida(fila), '2026-10-20 10:00 · repo · sin costo · chico · Riesgo: ninguno · revisión omitida · COMPLETO · +2 −0')
})

test('odd: --inicio, --diff, --cierre y --ultimos sobre un repo real', () => {
  const raiz = repo('modos', {
    'a.txt': 'uno\n',
    '.claude/qcc-implementador-odd.json': JSON.stringify({ verificar: [{ nombre: 'test', cmd: 'x' }], criticos: [{ rutas: ['src/auth/'], riesgo: [2], motivo: 'auth' }] }),
    'odd/tasks/f.md': '# F\n## Tasks\n- [x] T1\n- [ ] T2\n## Log\n',
  })
  fs.writeFileSync(path.join(raiz, 'sucio.txt'), 'previo\n')

  const ini = correr(ODD, raiz, '--inicio')
  assert.equal(ini.codigo, 0, ini.salida)
  const base = linea(ini.salida, 'ODD_BASE=')
  assert.match(base, /^[0-9a-f]{40}$/)
  assert.match(ini.salida, /sucios previos: 1 \(sucio\.txt\)/)
  assert.match(ini.salida, /- src\/auth\/ · ítem 2 — auth/)
  assert.match(ini.salida, /VERIFICAR: test/)
  assert.match(ini.salida, /TAREAS ABIERTAS: odd\/tasks\/f\.md \(1 de 2 abiertas\)/)

  // El sucio previo está en la BASE: el diff muestra solo lo nuevo, archivos sin versionar incluidos.
  assert.match(correr(ODD, raiz, '--diff', base).salida, /DIFF: sin cambios/)
  fs.writeFileSync(path.join(raiz, 'a.txt'), 'uno\ndos\n')
  fs.writeFileSync(path.join(raiz, 'nuevo.txt'), 'hola\n')
  const d = correr(ODD, raiz, '--diff', base)
  assert.match(d.salida, /a\.txt/)
  assert.match(d.salida, /nuevo\.txt/)
  assert.doesNotMatch(d.salida, /sucio\.txt/)
  assert.doesNotMatch(correr(ODD, raiz, '--diff', base, '--', 'a.txt').salida, /nuevo\.txt/)

  const c = correr(ODD, raiz, '--cierre', '--base', base, '--resultado', 'COMPLETO', '--tamano', 'chico', '--riesgo', 'ninguno', '--revision', 'omitida', '--titulo', 'Prueba')
  assert.equal(c.codigo, 0, c.salida)
  assert.match(c.salida, /CAMBIOS: 2 archivo\(s\) · \+2 −0/)
  assert.match(c.salida, /COSTO: sin datos/)
  const fila = JSON.parse(fs.readFileSync(path.join(PRUEBAS, 'registros', 'odd.jsonl'), 'utf8').trim().split('\n').at(-1))
  assert.equal(fila.titulo, 'Prueba')
  assert.equal(fila.tamano, 'chico')
  assert.deepEqual(fila.cambios, { archivos: 2, mas: 2, menos: 0 })
  assert.match(correr(ODD, raiz, '--ultimos', '5').salida, /CORRIDAS \(últimas \d+ de \d+\):\n {2}.* · modos · sin costo · chico · Riesgo: ninguno · revisión omitida · COMPLETO · \+2 −0 · Prueba/)
  // La foto no toca el índice: nada quedó preparado.
  assert.equal(execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: raiz, encoding: 'utf8' }).trim(), '')
})

test('odd: errores', () => {
  const raiz = repo('errores', { 'a.txt': 'x\n' })
  const sinBase = correr(ODD, raiz, '--diff', 'deadbeef')
  assert.equal(sinBase.codigo, 1)
  assert.match(sinBase.salida, /ERROR: BASE desconocida/)
  const base = linea(correr(ODD, raiz, '--inicio').salida, 'ODD_BASE=')
  assert.match(correr(ODD, raiz, '--cierre', '--base', base, '--resultado', 'TAL').salida, /ERROR: --resultado/)
  assert.match(correr(ODD, raiz, '--cierre', '--resultado', 'COMPLETO').salida, /ERROR: falta la BASE/)
  assert.match(correr(ODD, raiz).salida, /ERROR: uso:/)
})

// ── costo ───────────────────────────────────────────────────────────────────

test('costo: precio por pedido con caché de 1 h y de 5 min', () => {
  const uso = { input_tokens: 1e6, cache_read_input_tokens: 0, cache_creation_input_tokens: 2e6, output_tokens: 1e6, cache_creation: { ephemeral_5m_input_tokens: 1e6, ephemeral_1h_input_tokens: 1e6 } }
  assert.equal(costoDePedido(uso, 'claude-sonnet-5-5'), 2 + 2.5 + 4 + 10)
  assert.equal(costoDePedido(uso, 'otro-modelo'), null)
})

test('costo: encuentra la sesión por ODD_BASE y suma por rol', () => {
  const raiz = path.join(os.tmpdir(), 'repo-odd-costo')
  const proyectos = path.join(PRUEBAS, 'claude-costo', 'projects')
  const sesion = path.join(proyectos, path.resolve(raiz).replace(/[^a-zA-Z0-9]/g, '-'))
  const subagentes = path.join(sesion, 's1', 'subagents')
  fs.mkdirSync(subagentes, { recursive: true })
  const inicio = Date.now() - 600_000
  const en = (s) => new Date(inicio + s * 1000).toISOString()
  const jsonl = (filas) => filas.map((f) => JSON.stringify(f)).join('\n') + '\n'
  const uso = { input_tokens: 10, cache_read_input_tokens: 1000, cache_creation_input_tokens: 500, output_tokens: 100 }
  const turno = (id, s, texto) => ({ type: 'assistant', timestamp: en(s), message: { id, model: 'claude-sonnet-5-5', usage: uso, content: [{ type: 'text', text: texto }] } })
  fs.writeFileSync(path.join(sesion, 's1.jsonl'), jsonl([
    turno('antes', -50, 'de otra corrida'),
    { type: 'user', timestamp: en(0), message: { role: 'user', content: '<command-name>/qcc-implementador-odd</command-name>\n<command-args> x </command-args>' } },
    { type: 'user', timestamp: en(5), message: { role: 'user', content: [{ type: 'tool_result', content: 'ODD_BASE=b0de\nRAMA: …' }] } },
    turno('o1', 10, 'sigo'),
    turno('o1', 11, 'sigo'),
  ]))
  const agente = (nombre, tipo, desde, texto) => {
    fs.writeFileSync(path.join(subagentes, `${nombre}.meta.json`), JSON.stringify({ agentType: tipo }))
    fs.writeFileSync(path.join(subagentes, `${nombre}.jsonl`), jsonl([{ type: 'user', timestamp: en(desde), message: { role: 'user', content: 'DOC: x' } }, turno(`${nombre}-1`, desde + 30, texto)]))
  }
  agente('agent-x', 'qcc-odd-ejecutor', 20, 'ESTADO: HECHO')
  agente('agent-r', 'qcc-odd-revisor', 100, 'VEREDICTO: APROBADO')
  agente('agent-viejo', 'qcc-odd-revisor', -40, 'VEREDICTO: RECHAZADO')

  const c = costoDelFlujo(raiz, 'b0de', { proyectos, hasta: en(300) })
  assert.equal(c.inicio, en(0))
  assert.deepEqual(Object.keys(c.roles).sort(), ['ejecutor', 'orquestador', 'revisor'])
  assert.equal(c.roles.orquestador.pedidos, 1)
  assert.deepEqual(c.veredictos, { ejecutor: ['HECHO'], revisor: ['APROBADO'] })
  assert.equal(costoDelFlujo(raiz, 'otra', { proyectos }), null)
})

// ── instalar ────────────────────────────────────────────────────────────────

test('instalar: copia, no pisa lo editado en ~/.claude y --traer no corre sin edición', () => {
  const claude = path.join(PRUEBAS, 'claude-instalar')
  const instalar = (...args) => spawnSync(process.execPath, [path.join(RAIZ, 'flujos-odd', 'instalar.mjs'), ...args], { encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: claude } })
  const revisar = instalar('--revisar')
  assert.match(revisar.stdout, /nuevo .*skills\/qcc-implementador-odd\/SKILL\.md/)
  assert.ok(!fs.existsSync(path.join(claude, 'flujos-odd')))
  assert.equal(instalar().status, 0)
  const odd = path.join(claude, 'flujos-odd', 'odd.mjs')
  assert.ok(fs.existsSync(odd))
  assert.ok(fs.existsSync(path.join(claude, 'agents', 'qcc-odd-revisor.md')))
  assert.match(instalar().stdout, /RESULTADO: 0 copiado\(s\)/)
  fs.appendFileSync(odd, '\n// editado\n')
  const frenado = instalar()
  assert.equal(frenado.status, 1)
  assert.match(frenado.stdout, /FRENADO .*flujos-odd\/odd\.mjs/)
  assert.match(instalar('--traer', '--revisar').stdout, /cambia .*odd\.mjs → .*flujos-odd[\\/]herramientas[\\/]odd\.mjs|cambia .*→ herramientas\/odd\.mjs/)
})
