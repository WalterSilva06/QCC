import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parsearFases, validarPlan, resumenPlan, lineasEstado, clasificar, lecturaDe, gastoEntre, sumarGastos, textoGasto, gastoDeSesion, consumoDe, sumarConsumos, seccionDe, esperaMs } from './largo.mjs'

const SCRIPT = fileURLToPath(new URL('./largo.mjs', import.meta.url))
const temporal = (nombre) => fs.mkdtempSync(path.join(os.tmpdir(), `qcc-impl-l-${nombre}-`))
const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'core.autocrlf=false', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
const texto = (t) => ({ type: 'assistant', message: { content: [{ type: 'text', text: t }] } })
const limite = (pct5, pctSem, reset5 = 1794676800, status = 'allowed') => ({ type: 'rate_limit_event', rate_limit_info: { status, resetsAt: reset5, unifiedWindows: { five_hour: { utilization: pct5 / 100, resetsAt: reset5 }, seven_day: { utilization: pctSem / 100, resetsAt: 1794830400 } } } })

const PLAN = `# Compras

PEDIDO: agrega proveedores y órdenes

Criterios globales:
- README documenta cada comando (fuente: AGENTS.md:28)

## F1 · Proveedores
Depende de: ninguna
Área: src/compras.js, test/compras.test.js
Objetivo: alta y baja de proveedores.
Criterios:
- código \`PRV-000\` (fuente: pedido)
- email válido; sin
  puntos dobles (fuente: pedido)
Fuera de la fase: órdenes

## F2 · Órdenes
Depende de: F1
Área: src/compras.js
Objetivo: órdenes.
Criterios:
- número \`OC-0001\` correlativo (fuente: pedido)

## F3 · Ayuda
Depende de: ninguna
Área: src/cli.js
Objetivo: el uso.
Criterios:
- el uso lista los comandos (fuente: pedido)
`

test('parsearFases lee título, pedido, globales y cada fase con sus dependencias y criterios', () => {
  const p = parsearFases(PLAN)
  assert.equal(p.titulo, 'Compras')
  assert.equal(p.pedido, 'agrega proveedores y órdenes')
  assert.deepEqual(p.globales, ['README documenta cada comando (fuente: AGENTS.md:28)'])
  assert.deepEqual(p.fases.map((f) => [f.id, f.titulo, f.depende]), [['F1', 'Proveedores', []], ['F2', 'Órdenes', ['F1']], ['F3', 'Ayuda', []]])
  assert.deepEqual(p.fases[0].criterios, ['código `PRV-000` (fuente: pedido)', 'email válido; sin puntos dobles (fuente: pedido)'])
  assert.equal(p.fases[0].area, 'src/compras.js, test/compras.test.js')
  assert.match(p.fases[0].texto, /^## F1 · Proveedores[\s\S]*Fuera de la fase: órdenes$/)
  assert.deepEqual(validarPlan(p), [])
  assert.deepEqual(resumenPlan(p).slice(0, 2), ['PLAN: Compras · 3 fase(s) · 1 criterio(s) global(es)', 'F1 · Proveedores · depende: ninguna · 2 criterio(s) · área: src/compras.js, test/compras.test.js'])
})

test('validarPlan pide pedido, orden de ids, área, criterios y dependencias hacia atrás', () => {
  const malo = parsearFases('# x\n\n## F1 · a\nDepende de: F2\nCriterios:\n- c\n\n## F3 · b\nÁrea: x\nCriterios:\n')
  assert.deepEqual(validarPlan(malo), [
    'falta la línea «PEDIDO: <literal>» antes de la primera fase',
    'F1: falta «Área:»',
    'F1: «Depende de» nombra F2, que no es una fase anterior',
    'F3: las fases van F1, F2… en orden (esperaba F2)',
    'F3: falta «Criterios:» con al menos una viñeta',
  ])
  assert.deepEqual(validarPlan(parsearFases('PEDIDO: x')), ['no hay fases: cada una empieza con «## F1 · <título>»'])
})

test('clasificar distingue completo, sin verificar, detenido, límite y cortada', () => {
  assert.equal(clasificar([texto('**Resultado:** COMPLETO\nCambios: x')]).estado, 'completo')
  assert.equal(clasificar([texto('Resultado: COMPLETO (sin verificar: navegador)')]).estado, 'incompleto')
  const d = clasificar([texto('Resultado: DETENIDO (rechazado)\nTraspaso:\n- nada')])
  assert.equal(d.estado, 'detenido')
  assert.match(d.cierre, /Traspaso/)
  assert.deepEqual(clasificar([limite(90, 50), { type: 'rate_limit_event', rate_limit_info: { status: 'rejected', resetsAt: 123 } }]), { estado: 'limite', resetsAt: 123 })
  assert.equal(clasificar([limite(99, 50), texto('Resultado: DETENIDO (límite: 5h 99 %)')]).estado, 'limite')
  assert.equal(clasificar([{ type: 'result', is_error: true, result: 'error' }]).estado, 'cortada')
  assert.equal(esperaMs(1000, 1000e3 + 5 * 60e3), 60e3)
  assert.equal(esperaMs(undefined), 10 * 60e3)
})

test('lecturaDe, gastoEntre y sumarGastos encadenan el % de las ventanas sin inventar ceros', () => {
  assert.deepEqual(lecturaDe([limite(20, 40), texto('x'), limite(26.5, 41)]), { five_hour: { pct: 26.5, resetsAt: 1794676800 }, seven_day: { pct: 41, resetsAt: 1794830400 } })
  assert.equal(lecturaDe([texto('x')]), null)
  const a = lecturaDe([limite(20, 40)])
  assert.deepEqual(gastoEntre(a, lecturaDe([limite(28, 41)])), { five_hour: { gasto: 8 }, seven_day: { gasto: 1 } })
  // Reinicio: bajó el % y cambió la hora de reinicio → la cota mínima.
  assert.deepEqual(gastoEntre(a, lecturaDe([limite(3, 42, 1794694800)])).five_hour, { gasto: 3, incompleto: true })
  assert.deepEqual(gastoEntre(null, a).five_hour, { gasto: null })
  const suma = sumarGastos([{ five_hour: { gasto: 8 }, seven_day: { gasto: 1 } }, { five_hour: { gasto: 3, incompleto: true }, seven_day: { gasto: null } }])
  assert.deepEqual(suma, { five_hour: { gasto: 11, incompleto: true }, seven_day: { gasto: 1, incompleto: true } })
  assert.equal(textoGasto(suma), '5h ≥+11 % · sem ≥+1 %')
  assert.equal(textoGasto(sumarGastos([null])), '5h s/d · sem s/d')
})

test('gastoDeSesion abre un tramo nuevo tras la espera de un límite', () => {
  const eventos = [limite(80, 40), limite(100, 42, 1794676800, 'rejected'), { type: 'qcc_lectura', lectura: lecturaDe([limite(1, 42, 1794694800)]) }, limite(9, 43, 1794694800)]
  const g = gastoDeSesion(lecturaDe([limite(70, 40)]), eventos)
  assert.deepEqual(g.gasto, { five_hour: { gasto: 38 }, seven_day: { gasto: 3 } })
  assert.equal(g.lectura.five_hour.pct, 9)
})

test('consumoDe suma los result de varias sesiones por modelo', () => {
  const result = (usd, modelos) => ({ type: 'result', total_cost_usd: usd, num_turns: 3, modelUsage: modelos })
  const c = consumoDe([result(1.5, { 'claude-opus-5-5': { inputTokens: 1, outputTokens: 10, cacheReadInputTokens: 100, cacheCreationInputTokens: 20, costUSD: 1.4 }, 'claude-haiku-5-5': { inputTokens: 2, outputTokens: 1, cacheReadInputTokens: 0, cacheCreationInputTokens: 5, costUSD: 0.1 } }), texto('x'), result(0.5, { 'claude-opus-5-5': { inputTokens: 1, outputTokens: 5, cacheReadInputTokens: 50, cacheCreationInputTokens: 0, costUSD: 0.5 } })])
  assert.equal(c.usd, 2)
  assert.equal(c.turnos, 6)
  assert.deepEqual(c.modelos.opus, { entrada: 2, escritos: 20, leidos: 150, salida: 15, usd: 1.9 })
  assert.deepEqual(sumarConsumos([c, null, c]).modelos.haiku, { entrada: 4, escritos: 10, leidos: 0, salida: 2, usd: 0.2 })
})

test('seccionDe toma la sección del cierre hasta la siguiente etiqueta', () => {
  const cierre = 'Resultado: COMPLETO\nRevisión: **APROBADO en ciclo 2**\nTraspaso:\n- `src/a.js`: `crear()`\n- pendiente: el README\n\n**Riesgos pendientes:** ninguno'
  assert.deepEqual(seccionDe(cierre, 'Traspaso'), ['- `src/a.js`: `crear()`', '- pendiente: el README'])
  assert.deepEqual(seccionDe(cierre, 'Revisión', 1), ['APROBADO en ciclo 2'])
  assert.deepEqual(seccionDe(cierre, 'Queda para ti'), [])
})

/** Un `claude` falso: responde según la fase del pedido y guarda en `estado-doble.json` lo que vio. */
const DOBLE = `
import fs from 'node:fs'
import path from 'node:path'
const args = process.argv.slice(2)
const archivo = process.env.DOBLE_ESTADO
const e = fs.existsSync(archivo) ? JSON.parse(fs.readFileSync(archivo, 'utf8')) : { pct: 10, sesiones: {}, llamadas: [] }
const pedido = args[args.indexOf('-p') + 1]
const id = args.includes('--resume') ? args[args.indexOf('--resume') + 1] : args[args.indexOf('--session-id') + 1]
if (args.includes('--session-id')) e.sesiones[id] = pedido
const fase = (e.sesiones[id] ?? pedido).match(/fase -p (\\S+)/)?.[1] ?? (pedido.startsWith('responde') ? 'sondeo' : 'otro')
e.llamadas.push(fase + (args.includes('--resume') ? ':resume' : ''))
const n = e.llamadas.filter((l) => l.startsWith(fase)).length
e.pct += fase === 'sondeo' ? 0 : 2
const ev = (o) => process.stdout.write(JSON.stringify(o) + '\\n')
const lim = (status = 'allowed') => ev({ type: 'rate_limit_event', rate_limit_info: { status, resetsAt: 1794676800, unifiedWindows: { five_hour: { utilization: e.pct / 100, resetsAt: 1794676800 }, seven_day: { utilization: 0.5, resetsAt: 1794830400 } } } })
const fin = (t) => { ev({ type: 'assistant', message: { content: [{ type: 'text', text: t }] } }); ev({ type: 'result', result: t, total_cost_usd: 0.25, num_turns: 2, modelUsage: { 'claude-opus-5-5': { inputTokens: 1, outputTokens: 10, cacheReadInputTokens: 0, cacheCreationInputTokens: 5, costUSD: 0.25 } } }) }
lim()
if (fase === 'sondeo') ev({ type: 'result', result: 'ok' })
else if (fase === 'F1') { fs.writeFileSync('f1.txt', 'uno\\n'); fin('Resultado: COMPLETO\\nRevisión: APROBADO en ciclo 1\\nTraspaso:\\n- f1.txt nuevo\\nRiesgos pendientes: ninguno') }
else if (fase === 'F2') fin('Resultado: DETENIDO (rechazado dos veces)\\nRevisión: RECHAZADO (x)')
else if (fase === 'F3' && n === 1) lim('rejected')
else if (fase === 'F3') { fs.writeFileSync('f3.txt', 'tres\\n'); fin('Resultado: COMPLETO (sin verificar: navegador)\\nTraspaso:\\n- f3.txt') }
else if (fase === 'final') fin('Resultado: COMPLETO\\nRevisión: APROBADO en ciclo 1\\nTraspaso: ninguno')
fs.writeFileSync(archivo, JSON.stringify(e))
`

test('el driver planifica, corre las fases, reintenta, espera el límite, salta dependientes y anota la corrida', () => {
  const dir = temporal('e2e')
  git(dir, 'init', '-q')
  fs.writeFileSync(path.join(dir, 'a.txt'), 'a\n')
  git(dir, 'add', 'a.txt')
  git(dir, 'commit', '-qm', 'inicio')
  const doble = path.join(temporal('doble'), 'claude.mjs')
  fs.writeFileSync(doble, DOBLE)
  const registros = temporal('registros')
  const env = { ...process.env, QCC_LARGO_CLAUDE: doble, DOBLE_ESTADO: path.join(path.dirname(doble), 'estado-doble.json'), QCC_LARGO_ESPERA_MS: '0', QCC_LARGO_PAUSA_MS: '0', FLUJOS_REGISTROS: registros }
  const correr = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd: dir, env, encoding: 'utf8' })

  const plan = correr('--plan').stdout
  const carpeta = plan.match(/^CARPETA: (.+)$/m)[1]
  assert.equal(path.resolve(carpeta), path.resolve(dir, '.git', 'qcc-impl', 'largo'))
  assert.match(plan, /^BASE: [0-9a-f]{40}$/m)
  assert.match(plan, /^- \.\/ — 1 \(1 archivos\)$/m)
  assert.match(plan, /^REGLAS: ninguna$/m)

  assert.equal(correr('--validar').status, 1)
  fs.writeFileSync(path.join(carpeta, 'fases.md'), PLAN)
  assert.match(correr('--validar').stdout, /^PLAN: Compras · 3 fase\(s\)/)
  const aprobado = correr('--aprobar')
  assert.match(aprobado.stdout, /^APROBADO: .+ · BASE [0-9a-f]{40}$/m)
  const fase1 = correr('--fase', 'F1').stdout
  assert.match(fase1, /^FASE: F1 · Proveedores \(1 de 3\)$/m)
  assert.match(fase1, /email válido; sin\n {2}puntos dobles/)
  assert.match(fase1, /^REINTENTO: ninguno$/m)

  const r = correr('--correr')
  assert.equal(r.status, 0, r.stdout + r.stderr)
  const estado = JSON.parse(fs.readFileSync(path.join(carpeta, 'estado.json'), 'utf8'))
  assert.equal(estado.fases.F1.estado, 'completo')
  assert.equal(estado.fases.F2.estado, 'detenido')
  assert.equal(estado.fases.F2.intentos.length, 2, 'la fase detenida se reintenta una vez')
  assert.equal(estado.fases.F2.reintento, path.join(carpeta, 'cierre-F2.txt'))
  assert.equal(estado.fases.F3.estado, 'incompleto')
  assert.equal(estado.fases.F3.intentos[0].procesos, 2, 'el límite se espera y la sesión se retoma')
  assert.equal(estado.final.estado, 'completo')
  assert.equal(estado.terminada, false)
  assert.equal(estado.resultado, 'INCOMPLETO (2 de 3 fases, integración completo)')
  assert.deepEqual(estado.fases.F1.limites, { five_hour: { gasto: 2 }, seven_day: { gasto: 0 } })
  assert.equal(fs.readFileSync(path.join(carpeta, 'traspaso-F1.md'), 'utf8'), '- f1.txt nuevo\n')
  assert.match(fs.readFileSync(path.join(carpeta, 'F1.patch'), 'utf8'), /\+\+\+ b\/f1\.txt/)
  assert.match(correr('--fase', 'F2').stdout, /^REINTENTO: .*cierre-F2\.txt$/m)
  assert.match(correr('--fase', 'final').stdout, /- F1 · Proveedores:\n {2}- f1\.txt nuevo/)
  const doble1 = JSON.parse(fs.readFileSync(env.DOBLE_ESTADO, 'utf8'))
  assert.deepEqual(doble1.llamadas.filter((l) => l !== 'sondeo'), ['F1', 'F2', 'F2', 'F3', 'F3:resume', 'final'])
  const fila = JSON.parse(fs.readFileSync(path.join(registros, 'impl-l.jsonl'), 'utf8'))
  assert.equal(fila.resultado, estado.resultado)
  assert.equal(fila.fases.length, 3)
  assert.equal(fila.consumo.usd, 1.25)
  assert.match(fs.readFileSync(path.join(carpeta, 'resumen.md'), 'utf8'), /^CIERRE IMPL-L · Compras — INCOMPLETO/)

  // Otra corrida retoma solo lo que no terminó; la integración ya hecha no se repite.
  correr('--correr')
  const doble2 = JSON.parse(fs.readFileSync(env.DOBLE_ESTADO, 'utf8'))
  assert.deepEqual(doble2.llamadas.filter((l) => l !== 'sondeo').slice(doble1.llamadas.filter((l) => l !== 'sondeo').length), ['F2', 'F2'])
  assert.match(correr('--plan').stdout, /^AVISO: hay una corrida sin terminar: Compras/m)
  assert.match(correr('--plan', '--forzar').stdout, /^ARCHIVADA: /m)
  assert.equal(fs.existsSync(path.join(carpeta, 'estado.json')), false)
})

test('con menos de 3 fases no hay integración y la última fase recibe los criterios globales', () => {
  const dos = PLAN.slice(0, PLAN.indexOf('## F3'))
  const p = parsearFases(dos)
  assert.deepEqual(lineasEstado(p, null), ['F1 · Proveedores — pendiente', 'F2 · Órdenes — pendiente'])
  assert.equal(lineasEstado(parsearFases(PLAN), null).at(-1), 'final · integración — pendiente')
  const dir = temporal('dos')
  git(dir, 'init', '-q')
  fs.writeFileSync(path.join(dir, 'a.txt'), 'a\n')
  git(dir, 'add', 'a.txt')
  git(dir, 'commit', '-qm', 'inicio')
  const correr = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd: dir, encoding: 'utf8' }).stdout
  const carpeta = correr('--plan').match(/^CARPETA: (.+)$/m)[1]
  fs.writeFileSync(path.join(carpeta, 'fases.md'), dos)
  correr('--aprobar')
  assert.doesNotMatch(correr('--fase', 'F1'), /CRITERIOS GLOBALES/)
  assert.match(correr('--fase', 'F2'), /^CRITERIOS GLOBALES \(también tuyos[^\n]*\n- README documenta cada comando/m)
})
