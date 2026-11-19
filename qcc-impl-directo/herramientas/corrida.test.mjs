import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { leer, resumen, lineaLimites, mapa, verificacionDe, reglasDe, arbolActual, consumoDe } from './corrida.mjs'

const SCRIPT = fileURLToPath(new URL('./corrida.mjs', import.meta.url))
const RESET_5H = '2026-11-14T05:00:00.000Z'
const RESET_SEM = '2026-11-16T09:00:00.000Z'
const lectura = (t, pct5, pctSem, reset5 = RESET_5H, resetSem = RESET_SEM) => ({ t, five_hour: { pct: pct5, resetsAt: reset5 }, seven_day: { pct: pctSem, resetsAt: resetSem } })
const temporal = (nombre) => fs.mkdtempSync(path.join(os.tmpdir(), `qcc-impl-d-${nombre}-`))
const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'core.autocrlf=false', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()

/** Un repo con `a.txt` en el commit y `suelto.txt` sin seguimiento. */
function repo() {
  const dir = temporal('repo')
  git(dir, 'init', '-q')
  fs.writeFileSync(path.join(dir, 'a.txt'), 'uno\n')
  git(dir, 'add', 'a.txt')
  git(dir, 'commit', '-qm', 'inicio')
  fs.writeFileSync(path.join(dir, 'suelto.txt'), 'previo\n')
  return dir
}

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
  const archivo = path.join(temporal('leer'), 'qcc-limites.json')
  const ahora = Date.parse('2026-11-14T01:00:00Z')
  assert.equal(leer(archivo, ahora).sinDato, 'sin snapshot del panel')
  fs.writeFileSync(archivo, '{"t":"no es fecha"}')
  assert.equal(leer(archivo, ahora).sinDato, 'snapshot roto')
  fs.writeFileSync(archivo, JSON.stringify(lectura('2026-11-14T00:49:00Z', 40, 10)))
  assert.equal(leer(archivo, ahora).sinDato, 'snapshot viejo')
  fs.writeFileSync(archivo, JSON.stringify(lectura('2026-11-14T00:55:00Z', 40, 10)))
  assert.deepEqual(leer(archivo, ahora).five_hour, { pct: 40, resetsAt: RESET_5H })
})

test('lineaLimites da el % actual y avisa el margen bajo desde 85 % de 5 h', () => {
  assert.equal(lineaLimites(lectura('t', 62, 30.5)), 'LÍMITES: 5h 62 % · sem 30,5 %')
  assert.equal(lineaLimites(lectura('t', 84.9, 30)), 'LÍMITES: 5h 84,9 % · sem 30 %')
  assert.equal(lineaLimites(lectura('t', 85, 30)), 'LÍMITES: 5h 85 % · sem 30 % · MARGEN BAJO (5h ≥ 85 %)')
  assert.equal(lineaLimites({ t: 't', sinDato: 'snapshot viejo' }), 'LÍMITES: s/d (snapshot viejo)')
})

test('mapa parte en subcarpetas lo que pasa del tope y nombra los archivos grandes', () => {
  const filas = [
    { ruta: 'README.md', lineas: 50 },
    { ruta: 'docs/guia.md', lineas: 400 },
    { ruta: 'src/main.js', lineas: 100 },
    { ruta: 'src/mundo/mundo.js', lineas: 1500 },
    { ruta: 'src/mundo/mundo.test.js', lineas: 900 },
    { ruta: 'src/arte/a.js', lineas: 300 },
    { ruta: 'img/logo.png', lineas: 0 },
  ]
  assert.deepEqual(mapa(filas, 2000), [
    'MAPA: 3250 líneas de texto (versionadas y sin commit, sin lockfiles), ~2000 por explorador:',
    '- ./* — 50 (1 archivos sueltos)',
    '- docs/ — 400 (1 archivos)',
    '- src/* — 100 (1 archivos sueltos)',
    '- src/arte/ — 300 (1 archivos)',
    '- src/mundo/ — 2400 (2 archivos; mundo.js 1500, mundo.test.js 900)',
  ])
  assert.deepEqual(mapa(filas, 5000).slice(1), ['- ./ — 3250 (6 archivos)'])
  assert.deepEqual(mapa([]), ['MAPA: 0 líneas de texto (versionadas y sin commit, sin lockfiles), ~2000 por explorador:'])
})

test('verificacionDe y reglasDe leen la configuración de /impl con su respaldo', () => {
  const dir = temporal('config')
  assert.deepEqual(verificacionDe(dir), ['VERIFICAR: sin .claude/qcc-implementador.json: los del CLAUDE.md o AGENTS.md'])
  assert.equal(reglasDe(dir), 'REGLAS: ninguna')
  fs.mkdirSync(path.join(dir, '.claude', 'implementador'), { recursive: true })
  fs.writeFileSync(path.join(dir, '.claude', 'implementador.json'), JSON.stringify({ verificar: [{ nombre: 'test', cmd: 'node --test' }, { nombre: 'web', cmd: 'pnpm test', rutas: ['web/**'], paralelo: true }] }))
  fs.writeFileSync(path.join(dir, '.claude', 'implementador', 'revisor.md'), '')
  assert.deepEqual(verificacionDe(dir), ['VERIFICAR (.claude/implementador.json):', '- test: `node --test`', '- web: `pnpm test` · solo si toca web/** · paralelo'])
  assert.equal(reglasDe(dir), 'REGLAS: sesión ninguna · explorador ninguna · revisor .claude/implementador/revisor.md')
  fs.writeFileSync(path.join(dir, '.claude', 'qcc-implementador.json'), '{ roto')
  assert.match(verificacionDe(dir)[0], /^VERIFICAR: \.claude\/qcc-implementador\.json roto/)
  fs.writeFileSync(path.join(dir, '.claude', 'qcc-implementador.md'), '')
  assert.equal(reglasDe(dir), 'REGLAS: .claude/qcc-implementador.md (para todos)')
})

test('arbolActual y --diff incluyen lo sin seguimiento y no tocan el índice real', () => {
  const dir = repo()
  const antes = git(dir, 'status', '--porcelain')
  const base = arbolActual(dir)
  assert.match(base, /^[0-9a-f]{40}$/)
  assert.equal(git(dir, 'status', '--porcelain'), antes)
  assert.equal(git(dir, 'show', `${base}:suelto.txt`), 'previo')
  fs.appendFileSync(path.join(dir, 'a.txt'), 'dos\n')
  fs.writeFileSync(path.join(dir, 'nuevo.txt'), 'nuevo\n')
  const diff = (...args) => spawnSync(process.execPath, [SCRIPT, '--diff', base, ...args], { cwd: dir, encoding: 'utf8' }).stdout
  const stat = diff('--stat')
  assert.match(stat, /a\.txt/)
  assert.match(stat, /nuevo\.txt/)
  assert.doesNotMatch(stat, /suelto\.txt/)
  assert.match(diff('--', 'a.txt'), /^\+dos$/m)
  assert.equal(arbolActual(temporal('sin-git')), null)
})

test('consumoDe suma por rol desde el inicio y lee los veredictos y el pedido', () => {
  const dir = temporal('consumo')
  const sesion = path.join(dir, 's.jsonl')
  const uso = (id, t, salida, extra = {}) => ({ type: 'assistant', timestamp: t, message: { id, model: 'claude-opus-5-5', usage: { input_tokens: 1, cache_read_input_tokens: 100, cache_creation_input_tokens: 10, output_tokens: salida }, ...extra } })
  const lineas = (eventos) => eventos.map((e) => JSON.stringify(e)).join('\n') + '\n'
  fs.writeFileSync(sesion, lineas([
    uso('viejo', '2026-11-14T00:00:00Z', 999),
    { type: 'user', timestamp: '2026-11-14T01:00:00Z', message: { content: '<command-name>/impl-d:n</command-name>\n<command-args>-p arregla el login</command-args>' } },
    uso('m1', '2026-11-14T01:00:05Z', 5),
    uso('m1', '2026-11-14T01:00:05Z', 5),
    uso('m2', '2026-11-14T01:01:00Z', 7),
    { type: 'assistant', timestamp: '2026-11-14T01:01:30Z', message: { id: 's', model: '<synthetic>', usage: { output_tokens: 50 } } },
  ]))
  const sub = path.join(dir, 's', 'subagents')
  fs.mkdirSync(sub, { recursive: true })
  const agente = (id, tipo, t, texto) => {
    fs.writeFileSync(path.join(sub, `agent-${id}.meta.json`), JSON.stringify({ agentType: tipo }))
    fs.writeFileSync(path.join(sub, `agent-${id}.jsonl`), lineas([uso(`${id}-1`, t, 3, { content: [{ type: 'text', text: texto }] })]))
  }
  agente('e1', 'impl-d:qcc-explorador-directo', '2026-11-14T01:00:10Z', 'ARCHIVOS')
  agente('r2', 'impl-d:qcc-revisor-directo', '2026-11-14T01:05:00Z', 'VEREDICTO: APROBADO\nCRITERIOS:')
  agente('r1', 'impl-d:qcc-revisor-directo', '2026-11-14T01:03:00Z', 'VEREDICTO: RECHAZADO')
  agente('viejo', 'impl-d:qcc-revisor-directo', '2026-11-13T23:00:00Z', 'VEREDICTO: APROBADO')
  agente('a1', 'impl-d:qcc-asesor-directo', '2026-11-14T01:02:00Z', 'CONSEJO: SIGUE')
  agente('t1', 'impl-d:qcc-trabajador-directo', '2026-11-14T01:02:30Z', 'ESTADO: HECHO')
  agente('t2', 'impl-d:qcc-trabajador-directo', '2026-11-14T01:02:31Z', 'ESTADO: HECHO')
  const r = consumoDe(sesion, '2026-11-14T01:00:00.500Z', '2026-11-14T02:00:00Z')
  assert.equal(r.pedido, '-p arregla el login')
  assert.equal(r.modo, 'normal')
  assert.deepEqual(r.veredictos, ['RECHAZADO', 'APROBADO'])
  assert.deepEqual(r.roles.sesion, { agentes: 0, pedidos: 2, tokens: { entrada: 2, leidos: 200, escritos: 20, salida: 12 } })
  assert.equal(r.roles.explorador.agentes, 1)
  assert.deepEqual(r.roles.revisor, { agentes: 2, pedidos: 2, tokens: { entrada: 2, leidos: 200, escritos: 20, salida: 6 } })
  assert.deepEqual(r.roles.asesor, { agentes: 1, pedidos: 1, tokens: { entrada: 1, leidos: 100, escritos: 10, salida: 3 } })
  assert.deepEqual(r.roles.trabajador, { agentes: 2, pedidos: 2, tokens: { entrada: 2, leidos: 200, escritos: 20, salida: 6 } })
  assert.equal(r.roles.otros, undefined)
})

test('consumoDe anota el modo paralelo de /impl-d:p', () => {
  const sesion = path.join(temporal('consumo-paralelo'), 's.jsonl')
  fs.writeFileSync(sesion, JSON.stringify({ type: 'user', timestamp: '2026-11-14T01:00:00Z', message: { content: '<command-name>/impl-d:p</command-name>\n<command-args>aplica plan/largo.md</command-args>' } }))
  const r = consumoDe(sesion, '2026-11-14T01:00:00.500Z', '2026-11-14T02:00:00Z')
  assert.equal(r.pedido, 'aplica plan/largo.md')
  assert.equal(r.modo, 'paralelo')
})

test('consumoDe lee el pedido y el modo cuando la sesión lanza la skill con Skill', () => {
  const sesion = path.join(temporal('consumo-skill'), 's.jsonl')
  const t = '2026-11-14T01:00:00Z'
  fs.writeFileSync(sesion, [
    { type: 'user', timestamp: t, message: { content: 'texto pegado… /impl-d:e aplica 1 y 2' } },
    { type: 'assistant', timestamp: t, message: { id: 'm1', model: 'claude-opus-5-5', content: [{ type: 'tool_use', name: 'Skill', input: { skill: 'impl-d:e', args: ' aplica 1 y 2 ' } }], usage: { output_tokens: 1 } } },
  ].map((e) => JSON.stringify(e)).join('\n'))
  const r = consumoDe(sesion, '2026-11-14T01:00:00.500Z', '2026-11-14T02:00:00Z')
  assert.equal(r.pedido, 'aplica 1 y 2')
  assert.equal(r.modo, 'esfuerzo')
})

test('--inicio imprime lo que la skill usa y --fin anota la corrida y borra la lectura', () => {
  const dir = repo()
  fs.mkdirSync(path.join(dir, '.claude'))
  fs.writeFileSync(path.join(dir, '.claude', 'qcc-implementador.json'), JSON.stringify({ verificar: [{ nombre: 'test', cmd: 'node --test' }] }))
  const carpeta = temporal('e2e')
  const config = path.join(carpeta, 'config')
  const proyecto = path.join(config, 'projects', path.resolve(dir).replace(/[^a-zA-Z0-9]/g, '-'))
  fs.mkdirSync(path.join(proyecto, 'memory'), { recursive: true })
  fs.writeFileSync(path.join(proyecto, 'memory', 'MEMORY.md'), '- [x](x.md)\n')
  const snapshot = path.join(carpeta, 'qcc-limites.json')
  const registros = path.join(carpeta, 'registros')
  const tmp = path.join(carpeta, 'tmp')
  fs.mkdirSync(tmp)
  const huerfana = path.join(tmp, 'cortada.json')
  fs.writeFileSync(huerfana, '{}')
  const dosDias = (Date.now() - 2 * 86_400_000) / 1000
  fs.utimesSync(huerfana, dosDias, dosDias)
  const env = { ...process.env, QCC_LIMITES: snapshot, QCC_IMPL_D_TMP: tmp, CLAUDE_CODE_SESSION_ID: 'sesion-1', CLAUDE_CONFIG_DIR: config, FLUJOS_REGISTROS: registros }
  const correr = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd: dir, env, encoding: 'utf8' }).stdout.trim()
  const reset = new Date(Date.now() + 3_600_000).toISOString()
  fs.writeFileSync(snapshot, JSON.stringify(lectura(new Date().toISOString(), 20, 5, reset, reset)))
  const salida = correr('--inicio').split('\n')
  assert.equal(salida[0], 'LÍMITES: 5h 20 % · sem 5 %')
  assert.match(salida[1], /^BASE: [0-9a-f]{40}$/)
  assert.ok(salida.includes('- ./ — 3 (3 archivos)'), salida.join('\n'))
  assert.ok(salida.includes('- test: `node --test`'))
  assert.ok(salida.includes('REGLAS: ninguna'))
  assert.equal(salida.at(-1), `MEMORIA: ${path.join(proyecto, 'memory', 'MEMORY.md')}`)
  assert.equal(fs.existsSync(huerfana), false)
  const t = new Date().toISOString()
  fs.writeFileSync(path.join(proyecto, 'sesion-1.jsonl'), [
    { type: 'user', timestamp: t, message: { content: '<command-name>/impl-d:e</command-name>\n<command-args>-p cambia algo</command-args>' } },
    { type: 'assistant', timestamp: t, message: { id: 'm1', model: 'claude-opus-5-5', usage: { input_tokens: 1, output_tokens: 9 } } },
  ].map((e) => JSON.stringify(e)).join('\n'))
  fs.writeFileSync(snapshot, JSON.stringify(lectura(new Date().toISOString(), 24, 5, reset, reset)))
  assert.equal(correr('--fin', '--resultado', 'COMPLETO'), 'LÍMITES: 5h +4 % · sem +0 %')
  assert.deepEqual(fs.readdirSync(tmp), [])
  const fila = JSON.parse(fs.readFileSync(path.join(registros, 'impl-d.jsonl'), 'utf8'))
  assert.equal(fila.pedido, '-p cambia algo')
  assert.equal(fila.modo, 'esfuerzo')
  assert.equal(fila.resultado, 'COMPLETO')
  assert.equal(fila.limites, '5h +4 % · sem +0 %')
  assert.deepEqual(fila.roles.sesion.tokens, { entrada: 1, leidos: 0, escritos: 0, salida: 9 })
  assert.equal(correr('--fin'), 'LÍMITES: 5h s/d · sem s/d (sin lectura inicial)')
})
