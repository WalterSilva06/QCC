// Casos de costos.mjs: precio por pedido, métricas del flujo desde transcripts y problemas de la revisión.
// Correr: node --test qcc-implementador/herramientas/costos.test.mjs

import { temporales, estadoEn, estadoCon, limpiar } from './pruebas-comun.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { registroDe, flujoDe } from './guardia.mjs'
import { costoDelFlujo, costoDePedido, metricasDelFlujo, precioDe, problemasDe, resumenDeCosto } from './costos.mjs'

test('costos: precio por pedido, y el cierre anota costo y veredictos del flujo', () => {
  assert.equal(precioDe('claude-sonnet-5-5').lectura, 0.1)
  assert.equal(precioDe('claude-haiku-5-5', 150_000).entrada, 0.5)
  assert.equal(precioDe('otro-modelo'), null)
  // Sonnet: 1000 de lectura, 100.000 escritos con caché de 1 h y 1000 de salida.
  assert.equal(costoDePedido({ cache_read_input_tokens: 1000, cache_creation_input_tokens: 100_000, cache_creation: { ephemeral_1h_input_tokens: 100_000 }, output_tokens: 1000 }, 'claude-sonnet-5-5'), (1000 * 0.1 + 100_000 * 4 + 1000 * 10) / 1e6)

  const config = { verificar: [{ nombre: 'test', cmd: 'echo x' }] }
  const { raiz } = estadoCon(config, () => ['--paso', '0'])
  const { inicio, base_global: global } = JSON.parse(fs.readFileSync(path.join(flujoDe(raiz), 'estado.json'), 'utf8'))
  // Las horas del transcript caen entre el preflight y ahora (el cierre llega después): `en(f)` es esa fracción del tramo.
  const tramo = Math.max(Date.now() - Date.parse(inicio), 10)
  const en = (f) => new Date(Date.parse(inicio) + Math.floor(tramo * f)).toISOString()
  const claude = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-config-'))
  temporales.push(claude)
  const sesion = path.join(claude, 'projects', path.resolve(raiz).replace(/[^a-zA-Z0-9]/g, '-'))
  const subagentes = path.join(sesion, 's1', 'subagents')
  fs.mkdirSync(subagentes, { recursive: true })
  const jsonl = (filas) => filas.map((f) => JSON.stringify(f)).join('\n') + '\n'
  const pedido = (id, t, model, usage, texto) => ({ type: 'assistant', timestamp: t, message: { id, model, usage, content: [{ type: 'text', text: texto ?? '' }] } })
  // Señuelo: otra sesión del mismo repo cuyo /impl quedó más cerca del preflight, pero no recibió su BASE_GLOBAL.
  fs.writeFileSync(path.join(sesion, 's0.jsonl'), jsonl([
    { type: 'user', timestamp: en(-0.5), message: { role: 'user', content: '<command-name>/impl</command-name>' } },
    pedido('x1', en(0.2), 'claude-opus-5-5', { cache_creation_input_tokens: 1_000_000, cache_creation: { ephemeral_1h_input_tokens: 1_000_000 } }),
  ]))
  fs.writeFileSync(path.join(sesion, 's1.jsonl'), jsonl([
    { type: 'user', timestamp: en(-1), message: { role: 'user', content: '<command-name>/impl</command-name>' } },
    { type: 'user', timestamp: en(0.05), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't0', content: `BASE_GLOBAL=${global} DESDE_GLOBAL=${inicio}` }] } },
    pedido('o1', en(0.1), 'claude-sonnet-5-5', { cache_creation_input_tokens: 100_000, cache_creation: { ephemeral_1h_input_tokens: 100_000 }, output_tokens: 1000 }),
    pedido('o2', en(0.4), 'claude-sonnet-5-5', { cache_read_input_tokens: 100_000, output_tokens: 1000 }),
  ]))
  const agente = (nombre, tipo, prompt, filas) => {
    fs.writeFileSync(path.join(subagentes, `${nombre}.meta.json`), JSON.stringify({ agentType: tipo }))
    fs.writeFileSync(path.join(subagentes, `${nombre}.jsonl`), jsonl([{ type: 'user', timestamp: en(0.2), message: { role: 'user', content: prompt } }, ...filas]))
  }
  agente('agent-e', 'explorador', 'PEDIDO: x', [pedido('e1', en(0.25), 'claude-haiku-5-5', { cache_creation_input_tokens: 50_000, output_tokens: 1000 }, 'ARCHIVOS')])
  agente('agent-f', 'revisor', 'QUÉ REVISAR: cambio completo (1 subtarea(s))', [pedido('f1', en(0.3), 'claude-opus-5-5', { cache_creation_input_tokens: 10_000, output_tokens: 1000 }, 'VEREDICTO: APROBADO')])

  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: raiz, encoding: 'utf8' }).trim()
  const cierre = estadoEn(raiz, ['--cambios', sha, '--paso', '7'], { CLAUDE_CONFIG_DIR: claude }).salida
  assert.match(cierre, /^COSTO: \$0,51 · [\d,]+ min · 264k tokens \(38 % caché\) · sal 4k · orquestador \$0,43 \(2 pedidos\) · final \$0,07 \(1 pedido\) · explorador \$0,01 \(1 pedido\) \(sin el mensaje de cierre\)$/m)
  assert.match(cierre, /^VEREDICTOS: final APROBADO$/m)
  assert.match(cierre, /^CONTEXTO: 100000 tokens en el último pedido del hilo principal · reescribirlo en Opus con caché de 1 h: \$0,80$/m)
  assert.match(cierre, /ALCANCE: [^\n]*\s*$/)
  const flujos = path.join(path.dirname(registroDe(raiz)), 'flujos.jsonl')
  const fila = fs.readFileSync(flujos, 'utf8').trimEnd().split('\n').map((l) => JSON.parse(l)).at(-1)
  assert.equal(fila.v, 2)
  assert.equal(fila.raiz, raiz)
  assert.equal(Math.round(fila.costo.usd * 1000), 507)
  assert.deepEqual(fila.costo.veredictos, { final: ['APROBADO'] })

  const historial = spawnSync(process.execPath, [fileURLToPath(new URL('./costos.mjs', import.meta.url)), '--archivo', flujos], { encoding: 'utf8' }).stdout
  assert.match(historial, /^FLUJOS \(últimos \d+ de \d+ con costo\):$/m)
  assert.match(historial, /· \$0,51 · [\d,]+ min · 264k tokens \(38 % caché\) · sal 4k · orquestador \$0,43 \(2 pedidos\) · final \$0,07 \(1 pedido\) · explorador \$0,01 \(1 pedido\) · final APROBADO$/m)
  assert.match(historial, /^PROMEDIO: \$[\d,]+ · /m)
})

test('resumenDeCosto muestra tokens, caché y pedidos por rol', () => {
  const rol = (usd, pedidos, agentes, tokens) => ({ pedidos, usd, sinPrecio: 0, agentes, tokens: { entrada: 0, leidos: 0, escritos: 0, salida: 0, thinking: 0, ...tokens } })
  const costo = {
    usd: 15.3,
    minutos: 42.5,
    roles: {
      // thinking ya va dentro de la salida: no se suma aparte.
      orquestador: rol(0.66, 10, 0, { entrada: 100_000, leidos: 1_000_000, escritos: 200_000, salida: 44_000, thinking: 30_000 }),
      ejecutor: rol(14.64, 388, 12, { entrada: 300_000, leidos: 10_900_000, escritos: 900_000, salida: 800_000, thinking: 500_000 }),
      explorador: rol(0, 0, 0, {}),
      revisor: rol(0.5, 1, 1, { leidos: 950 }),
    },
  }
  const linea = resumenDeCosto(costo)
  // Total 14,244M; prompt 13,4M (leídos 11,9M = 88,8 → 89 %); salida 844k.
  assert.equal(linea, '$15,30 · 42,5 min · 14,2M tokens (89 % caché) · sal 844k · ejecutor $14,64 (×12, 388 pedidos) · orquestador $0,66 (10 pedidos) · revisor $0,50 (1 pedido)')

  // Sin tokens (flujos viejos) el tramo no aparece, y sin pedidos queda «sin pedidos».
  const viejo = { usd: 0.5, minutos: 2, roles: { orquestador: { pedidos: 3, usd: 0.5, sinPrecio: 0, agentes: 0 } } }
  assert.equal(resumenDeCosto(viejo), '$0,50 · 2,0 min · orquestador $0,50 (3 pedidos)')
  assert.equal(resumenDeCosto({ usd: 0, minutos: 0, roles: { orquestador: rol(0, 0, 0, {}) } }), '$0,00 · 0,0 min · sin pedidos')

  // Solo salida: sin prompt no hay porcentaje de caché.
  assert.equal(resumenDeCosto({ usd: 0.01, minutos: 1, roles: { orquestador: rol(0.01, 1, 0, { salida: 1000 }) } }), '$0,01 · 1,0 min · 1k tokens · sal 1k · orquestador $0,01 (1 pedido)')
  // Un solo agente con un pedido, y varios agentes con un pedido en total: singular con y sin «×N».
  assert.equal(resumenDeCosto({ usd: 1, minutos: 1, roles: { ejecutor: rol(1, 1, 3, {}) } }), '$1,00 · 1,0 min · ejecutor $1,00 (×3, 1 pedido)')
})

test('costos: métricas del flujo desde transcripts armados', () => {
  const raiz = path.join(os.tmpdir(), 'repo-metricas')
  const claude = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-config-'))
  temporales.push(claude)
  const sesion = path.join(claude, 'projects', path.resolve(raiz).replace(/[^a-zA-Z0-9]/g, '-'))
  const subagentes = path.join(sesion, 's1', 'subagents')
  fs.mkdirSync(subagentes, { recursive: true })
  const inicio = Date.parse('2026-01-01T10:00:00.000Z')
  const en = (s) => new Date(inicio + s * 1000).toISOString()
  const jsonl = (filas) => filas.map((f) => JSON.stringify(f)).join('\n') + '\n'
  const uso = (k, salida = 100) => ({ input_tokens: 10 * k, cache_read_input_tokens: 1000 * k, cache_creation_input_tokens: 500 * k, output_tokens: salida, output_tokens_details: { thinking_tokens: 40 } })
  const turno = (id, s, bloques, usage, modelo = 'claude-sonnet-5-5') => ({ type: 'assistant', timestamp: en(s), message: { id, model: modelo, usage, content: bloques } })
  const resultado = (s, id, texto) => ({ type: 'user', timestamp: en(s), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: texto }] } })
  const bash = (id, comando) => ({ type: 'tool_use', id, name: 'Bash', input: { command: comando } })
  const agenteDe = (id, tipo, prompt, effort) => ({ type: 'tool_use', id, name: 'Agent', input: { subagent_type: tipo, prompt, ...(effort ? { effort } : {}) } })
  const texto = (t) => ({ type: 'text', text: t })
  const E1 = 'SUBTAREA 1/2: crear x'
  const E1_CORRECCION = `${E1}\nCORRECCIÓN: arreglar y`
  const E2 = 'SUBTAREA 2/2: otra cosa'
  const ESTADO = 'node ~/.claude/plugins/cache/qcc/impl/0.1.0/herramientas/estado.mjs'

  fs.writeFileSync(path.join(sesion, 's1.jsonl'), jsonl([
    { type: 'user', timestamp: en(0), message: { role: 'user', content: '<command-name>/impl</command-name>\n<command-args>  Mejorar   el flujo\n con métricas </command-args>' } },
    turno('o1', 5, [bash('b0', `${ESTADO} --paso 0`)], uso(1)),
    resultado(10, 'b0', 'FLUJO: x'),
    turno('o2', 60, [agenteDe('a1', 'explorador', 'PEDIDO: x\nMAPA: mapa.md')], uso(1)),
    resultado(120, 'a1', 'ARCHIVOS'),
    turno('o3', 130, [bash('b2', `${ESTADO} --guardar x exploracion --paso 2`)], uso(1)),
    turno('o5', 270, [{ type: 'tool_use', id: 'q1', name: 'AskUserQuestion', input: { questions: [{ header: 'Plan', question: '¿Apruebas?' }] } }], uso(1)),
    resultado(570, 'q1', 'Aprobado'),
    turno('o6', 580, [bash('b5', `${ESTADO} --paso 5`)], uso(1)),
    turno('o7', 585, [agenteDe('x1', 'ejecutor', E1, 'medium'), agenteDe('x2', 'ejecutor', E2)], uso(1)),
    turno('o8', 700, [agenteDe('x3', 'ejecutor', E1_CORRECCION, 'low')], uso(1)),
    turno('o9', 800, [agenteDe('x4', 'revisor', 'QUÉ REVISAR: cambio completo (2 subtarea(s))')], uso(1)),
    resultado(850, 'x4', 'VEREDICTO: RECHAZADO'),
    resultado(860, 'b6', 'ALCANCE: FUERA (a.ts)\nresto\n  12\tconsole.log(`ALCANCE: FUERA (${fuera})`)'),
    turno('o10', 900, [bash('b7', `${ESTADO} --cambios abc --paso 7`)], uso(2)),
  ]))
  const agente = (nombre, tipo, prompt, desde, filas) => {
    fs.writeFileSync(path.join(subagentes, `${nombre}.meta.json`), JSON.stringify({ agentType: tipo }))
    fs.writeFileSync(path.join(subagentes, `${nombre}.jsonl`), jsonl([{ type: 'user', timestamp: en(desde), message: { role: 'user', content: prompt } }, ...filas]))
  }
  const haiku = 'claude-haiku-5-5'
  agente('agent-e', 'explorador', 'PEDIDO: x\nMAPA: mapa.md (3 archivos)', 62, [
    turno('e1', 70, [{ type: 'tool_use', id: 'g', name: 'Glob', input: {} }, { type: 'tool_use', id: 'r1', name: 'Read', input: {} }, { type: 'tool_use', id: 'r2', name: 'Read', input: {} }], { input_tokens: 100, output_tokens: 50 }, haiku),
    turno('e2', 110, [texto('ARCHIVOS')], { input_tokens: 200, output_tokens: 70 }, haiku),
  ])
  agente('agent-x1', 'ejecutor', E1, 590, [turno('m1', 690, [texto('ESTADO: FALLA')], uso(1))])
  agente('agent-x2', 'ejecutor', E2, 592, [turno('m2', 640, [texto('ESTADO: HECHO')], uso(1))])
  agente('agent-x3', 'ejecutor', E1_CORRECCION, 710, [turno('m3', 790, [texto('ESTADO: HECHO')], uso(1))])
  agente('agent-f', 'revisor', 'QUÉ REVISAR: cambio completo (2 subtarea(s))', 810, [turno('f1', 840, [texto('VEREDICTO: RECHAZADO\nPROBLEMAS:\n1. Falla X\nOBSERVACIONES: ninguna')], uso(1), 'claude-opus-5-5')])

  const opciones = { proyectos: path.join(claude, 'projects'), hasta: en(1200), base: null }
  const m = metricasDelFlujo(raiz, en(0), opciones)
  assert.equal(m.sesion, path.join(sesion, 's1.jsonl'))
  assert.equal(m.pedido, 'Mejorar el flujo con métricas')
  // Tokens: 8 pedidos con uso(1) y uno con uso(2) en el hilo principal; la forma vieja del costo sigue.
  assert.deepEqual(m.costo.roles.orquestador.tokens, { entrada: 100, leidos: 10_000, escritos: 5000, salida: 900, thinking: 360 })
  assert.deepEqual(m.costo.roles.explorador.tokens, { entrada: 300, leidos: 0, escritos: 0, salida: 120, thinking: 0 })
  assert.deepEqual(m.costo.roles.ejecutor.tokens, { entrada: 30, leidos: 3000, escritos: 1500, salida: 300, thinking: 120 })
  assert.equal(m.costo.roles.ejecutor.agentes, 3)
  assert.deepEqual(m.costo.veredictos, { ejecutor: ['FALLA', 'HECHO', 'HECHO'], final: ['RECHAZADO'] })
  assert.deepEqual(Object.keys(m.costo).sort(), ['inicio', 'minutos', 'roles', 'usd', 'veredictos'])
  assert.deepEqual(m.contexto, { primero: 1510, ultimo: 3020 })
  // Tiempos: el preflight a los 60 s es la fase 0; el AskUserQuestion «Plan» tarda 300 s dentro de la fase 4.
  assert.deepEqual(m.tiempos, { fases: { 0: 60, 1: 70, 2: 140, 4: 10, 5: 320, 7: 0 }, espera: 300, activo: 600 })
  assert.equal(Object.values(m.tiempos.fases).reduce((s, n) => s + n, 0), m.tiempos.activo)
  assert.deepEqual(Object.keys(m.ejecutores), ['1', '2'])
  assert.deepEqual({ ...m.ejecutores['1'], usd: undefined }, { usd: undefined, segundos: 180, correcciones: 1, estado: 'HECHO', esfuerzo: 'medium' })
  assert.ok(m.ejecutores['1'].usd > 0)
  assert.deepEqual({ ...m.ejecutores['2'], usd: undefined }, { usd: undefined, segundos: 48, correcciones: 0, estado: 'HECHO', esfuerzo: 'high' })
  assert.deepEqual(m.problemas, { final: [{ veredicto: 'RECHAZADO', items: ['Falla X'] }] })
  assert.deepEqual(m.alcanceFuera, ['ALCANCE: FUERA (a.ts)'])
  assert.deepEqual(m.explorador, { pedidos: 2, glob: 1, read: 2, mapa: true })
  // Sin sesión en ese repo, no hay métricas; el costo sigue siendo el mismo que con costoDelFlujo.
  assert.equal(metricasDelFlujo(path.join(os.tmpdir(), 'repo-sin-sesion'), en(0), opciones), null)
  assert.equal(costoDelFlujo(raiz, en(0), opciones).usd, m.costo.usd)
})

test('costos: reconoce /impl y agentType qcc-ejecutor como rol ejecutor', () => {
  const raiz = path.join(os.tmpdir(), 'repo-metricas-qcc')
  const claude = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-config-'))
  temporales.push(claude)
  const sesion = path.join(claude, 'projects', path.resolve(raiz).replace(/[^a-zA-Z0-9]/g, '-'))
  const subagentes = path.join(sesion, 's1', 'subagents')
  fs.mkdirSync(subagentes, { recursive: true })
  const inicio = Date.parse('2026-01-01T10:00:00.000Z')
  const en = (s) => new Date(inicio + s * 1000).toISOString()
  const jsonl = (filas) => filas.map((f) => JSON.stringify(f)).join('\n') + '\n'
  const uso = { input_tokens: 10, cache_read_input_tokens: 1000, cache_creation_input_tokens: 500, output_tokens: 100 }
  const turno = (id, s, bloques) => ({ type: 'assistant', timestamp: en(s), message: { id, model: 'claude-sonnet-5-5', usage: uso, content: bloques } })
  const agenteDe = (id, tipo, prompt) => ({ type: 'tool_use', id, name: 'Agent', input: { subagent_type: tipo, prompt } })
  const texto = (t) => ({ type: 'text', text: t })
  const E1 = 'SUBTAREA 1/1: crear x'

  fs.writeFileSync(path.join(sesion, 's1.jsonl'), jsonl([
    { type: 'user', timestamp: en(0), message: { role: 'user', content: '<command-name>/impl</command-name>\n<command-args> Probar el prefijo </command-args>' } },
    turno('o1', 60, [agenteDe('a1', 'impl:qcc-explorador', 'PEDIDO: x')]),
    turno('o2', 200, [agenteDe('x1', 'impl:qcc-ejecutor', E1)]),
    turno('o3', 300, [agenteDe('x2', 'impl:qcc-revisor', 'QUÉ REVISAR: cambio completo (1 subtarea(s))')]),
  ]))
  const agente = (nombre, tipo, prompt, desde, filas) => {
    fs.writeFileSync(path.join(subagentes, `${nombre}.meta.json`), JSON.stringify({ agentType: tipo }))
    fs.writeFileSync(path.join(subagentes, `${nombre}.jsonl`), jsonl([{ type: 'user', timestamp: en(desde), message: { role: 'user', content: prompt } }, ...filas]))
  }
  agente('agent-e', 'impl:qcc-explorador', 'PEDIDO: x', 62, [turno('e1', 100, [texto('ARCHIVOS')])])
  agente('agent-x1', 'impl:qcc-ejecutor', E1, 205, [turno('m1', 280, [texto('ESTADO: HECHO')])])
  agente('agent-f', 'impl:qcc-revisor', 'QUÉ REVISAR: cambio completo (1 subtarea(s))', 305, [turno('f1', 340, [texto('VEREDICTO: APROBADO\nPROBLEMAS: ninguno\nOBSERVACIONES: ninguna')])])

  const m = metricasDelFlujo(raiz, en(0), { proyectos: path.join(claude, 'projects'), hasta: en(500), base: null })
  assert.equal(m.sesion, path.join(sesion, 's1.jsonl'))
  assert.equal(m.pedido, 'Probar el prefijo')
  assert.deepEqual(Object.keys(m.costo.roles).sort(), ['ejecutor', 'explorador', 'final', 'orquestador'])
  assert.equal(m.costo.roles.ejecutor.agentes, 1)
  assert.deepEqual(m.costo.veredictos.ejecutor, ['HECHO'])
  assert.deepEqual(Object.keys(m.ejecutores), ['1'])
  // El explorador lanzado como qcc-explorador marca la fase 1.
  assert.ok('1' in m.tiempos.fases)
})

test('costos: veredicto con negrita que cierra antes de los dos puntos', () => {
  const raiz = path.join(os.tmpdir(), 'repo-metricas-negrita')
  const claude = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-config-'))
  temporales.push(claude)
  const sesion = path.join(claude, 'projects', path.resolve(raiz).replace(/[^a-zA-Z0-9]/g, '-'))
  const subagentes = path.join(sesion, 's1', 'subagents')
  fs.mkdirSync(subagentes, { recursive: true })
  const inicio = Date.parse('2026-01-01T10:00:00.000Z')
  const en = (s) => new Date(inicio + s * 1000).toISOString()
  const jsonl = (filas) => filas.map((f) => JSON.stringify(f)).join('\n') + '\n'
  const uso = { input_tokens: 10, cache_read_input_tokens: 1000, cache_creation_input_tokens: 500, output_tokens: 100 }
  const turno = (id, s, texto) => ({ type: 'assistant', timestamp: en(s), message: { id, model: 'claude-sonnet-5-5', usage: uso, content: [{ type: 'text', text: texto }] } })
  fs.writeFileSync(path.join(sesion, 's1.jsonl'), jsonl([
    { type: 'user', timestamp: en(0), message: { role: 'user', content: '<command-name>/impl</command-name>' } },
    turno('o1', 60, 'x'),
  ]))
  const agente = (nombre, tipo, prompt, desde, texto) => {
    fs.writeFileSync(path.join(subagentes, `${nombre}.meta.json`), JSON.stringify({ agentType: tipo }))
    fs.writeFileSync(path.join(subagentes, `${nombre}.jsonl`), jsonl([{ type: 'user', timestamp: en(desde), message: { role: 'user', content: prompt } }, turno(`m-${nombre}`, desde + 10, texto)]))
  }
  agente('agent-x1', 'impl:qcc-ejecutor', 'SUBTAREA 1/2: a', 100, '**ESTADO**: HECHO')
  agente('agent-x2', 'impl:qcc-ejecutor', 'SUBTAREA 2/2: b', 120, '**ESTADO: FALLA**')
  const final = 'QUÉ REVISAR: cambio completo (2 subtarea(s))'
  agente('agent-f1', 'impl:qcc-revisor', final, 200, '**VEREDICTO**: APROBADO\nPROBLEMAS: ninguno')
  agente('agent-f2', 'impl:qcc-revisor', final, 220, '**VEREDICTO: AJUSTAR**')
  agente('agent-f3', 'impl:qcc-revisor', final, 240, 'VEREDICTO: RECHAZADO')

  const m = metricasDelFlujo(raiz, en(0), { proyectos: path.join(claude, 'projects'), hasta: en(500), base: null })
  assert.deepEqual(m.costo.veredictos.ejecutor, ['HECHO', 'FALLA'])
  assert.deepEqual(m.costo.veredictos.final, ['APROBADO', 'AJUSTAR', 'RECHAZADO'])
})

test('costos: un agente retomado anota un veredicto y sus problemas por cada informe', () => {
  const raiz = path.join(os.tmpdir(), 'repo-metricas-retome')
  const claude = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-config-'))
  temporales.push(claude)
  const sesion = path.join(claude, 'projects', path.resolve(raiz).replace(/[^a-zA-Z0-9]/g, '-'))
  const subagentes = path.join(sesion, 's1', 'subagents')
  fs.mkdirSync(subagentes, { recursive: true })
  const inicio = Date.parse('2026-01-01T10:00:00.000Z')
  const en = (s) => new Date(inicio + s * 1000).toISOString()
  const jsonl = (filas) => filas.map((f) => JSON.stringify(f)).join('\n') + '\n'
  const uso = { input_tokens: 10, cache_read_input_tokens: 1000, cache_creation_input_tokens: 500, output_tokens: 100 }
  const turno = (id, s, texto) => ({ type: 'assistant', timestamp: en(s), message: { id, model: 'claude-sonnet-5-5', usage: uso, content: [{ type: 'text', text: texto }] } })
  const humano = (s, texto) => ({ type: 'user', timestamp: en(s), message: { role: 'user', content: texto } })
  fs.writeFileSync(path.join(sesion, 's1.jsonl'), jsonl([humano(0, '<command-name>/impl</command-name>'), turno('o1', 60, 'x')]))
  fs.writeFileSync(path.join(subagentes, 'agent-f.meta.json'), JSON.stringify({ agentType: 'impl:qcc-revisor' }))
  // Un solo archivo: informe con rechazo, un texto intermedio sin veredicto, y el informe tras el retome.
  fs.writeFileSync(path.join(subagentes, 'agent-f.jsonl'), jsonl([
    humano(100, 'QUÉ REVISAR: cambio completo (1 subtarea(s))'),
    turno('f1', 120, 'VEREDICTO: RECHAZADO\nPROBLEMAS:\n1. Falla X\n2. Falla Y\nOBSERVACIONES: ninguna'),
    humano(140, 'RETOMA: corregido'),
    turno('f2', 150, 'Reviso otra vez.'),
    turno('f3', 160, 'VEREDICTO: APROBADO\nPROBLEMAS: ninguno'),
  ]))

  const m = metricasDelFlujo(raiz, en(0), { proyectos: path.join(claude, 'projects'), hasta: en(500), base: null })
  assert.deepEqual(m.costo.veredictos, { final: ['RECHAZADO', 'APROBADO'] })
  assert.deepEqual(m.problemas, { final: [{ veredicto: 'RECHAZADO', items: ['Falla X', 'Falla Y'] }, { veredicto: 'APROBADO', items: [] }] })
})

/** Corre costos.mjs con esos argumentos: `{ salida, codigo }`. */
const costosCon = (...args) => {
  const r = spawnSync(process.execPath, [fileURLToPath(new URL('./costos.mjs', import.meta.url)), ...args], { encoding: 'utf8' })
  return { salida: r.stdout, codigo: r.status }
}

test('costos: lista filas v1 y v2 juntas', () => {
  const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-config-'))
  temporales.push(carpeta)
  const archivo = path.join(carpeta, 'flujos.jsonl')
  const costo = { inicio: '2026-01-01T10:00:00.000Z', minutos: 2, usd: 0.5, roles: { orquestador: { pedidos: 3, usd: 0.5, sinPrecio: 0, agentes: 0 } }, veredictos: { final: ['APROBADO'] } }
  const v1 = { t: '2026-01-01T10:05:00.000Z', raiz: '/x/repo', base: 'abc', costo, clasificacion: 'CRÍTICO (#1) porque sí', subtareas: 2 }
  const t2 = '2026-01-02T11:30:00.000Z'
  const v2 = { v: 2, t: t2, raiz: '/x/otro', base: 'def', costo, resultado: 'HECHO', sesion: '/no/existe.jsonl', subtareas: [{ n: 1 }, { n: 2 }, { n: 3 }] }
  const filas = [v1, v2, { v: 2, tipo: 'defecto', flujo: t2, texto: 'faltó un test', t: '2026-01-02T12:00:00.000Z' }]
  fs.writeFileSync(archivo, filas.map((f) => JSON.stringify(f)).join('\n') + '\n')

  const lineas = costosCon('--archivo', archivo).salida.split('\n')
  assert.equal(lineas[0], 'FLUJOS (últimos 2 de 2 con costo):')
  // La línea v1 queda como siempre: sin resultado ni defectos.
  assert.equal(lineas[1], '  2026-01-01 10:05 · repo · $0,50 · 2,0 min · orquestador $0,50 (3 pedidos) · CRÍTICO (#1) · 2 subtarea(s) · final APROBADO')
  assert.equal(lineas[2], '  2026-01-02 11:30 · otro · $0,50 · 2,0 min · orquestador $0,50 (3 pedidos) · 3 subtarea(s) · final APROBADO · HECHO · defectos: 1')
  assert.match(lineas[3], /^PROMEDIO: \$0,50 · 2,0 min · orquestador 3,0 pedidos$/)
})

test('costos: --anotar suma un defecto y --fuga mide lo gastado después del cierre', () => {
  const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-config-'))
  temporales.push(carpeta)
  const subagentes = path.join(carpeta, 's1', 'subagents')
  fs.mkdirSync(subagentes, { recursive: true })
  const inicio = Date.parse('2026-01-01T10:00:00.000Z')
  const en = (s) => new Date(inicio + s * 1000).toISOString()
  const jsonl = (filas) => filas.map((f) => JSON.stringify(f)).join('\n') + '\n'
  // Cada pedido: 1000 tokens de salida de Sonnet = $0,01.
  const pedido = (id, s) => ({ type: 'assistant', timestamp: en(s), message: { id, model: 'claude-sonnet-5-5', usage: { output_tokens: 1000 }, content: [{ type: 'text', text: '' }] } })
  const comando = (s) => ({ type: 'user', timestamp: en(s), message: { role: 'user', content: '<command-name>/impl</command-name>' } })
  const sesion = path.join(carpeta, 's1.jsonl')
  fs.writeFileSync(sesion, jsonl([
    comando(0),
    pedido('antes', 50),
    // El cierre es a los 100 s: estos dos pedidos y el subagente de los 130 s son la fuga.
    pedido('d1', 110),
    pedido('d2', 120),
    // El siguiente /impl corta el tramo: lo que sigue es de otro flujo.
    comando(200),
    pedido('otro', 210),
  ]))
  const agente = (nombre, desde) => {
    fs.writeFileSync(path.join(subagentes, `${nombre}.meta.json`), JSON.stringify({ agentType: 'ejecutor' }))
    fs.writeFileSync(path.join(subagentes, `${nombre}.jsonl`), jsonl([{ type: 'user', timestamp: en(desde), message: { role: 'user', content: 'SUBTAREA 1/1: x' } }, pedido(`m-${nombre}`, desde + 5)]))
  }
  agente('agent-antes', 50)
  agente('agent-despues', 130)
  agente('agent-otro', 250)

  const costo = { inicio: en(0), minutos: 1, usd: 0.1, roles: { orquestador: { pedidos: 1, usd: 0.1, sinPrecio: 0, agentes: 0 } }, veredictos: {} }
  const archivo = path.join(carpeta, 'flujos.jsonl')
  const v2 = (t, extra) => ({ v: 2, t, raiz: '/x/repo', base: 'abc', costo, resultado: 'HECHO', subtareas: [], ...extra })
  fs.writeFileSync(archivo, [
    v2(en(100), { sesion }),
    v2('2026-01-03T09:00:00.000Z', {}),
  ].map((f) => JSON.stringify(f)).join('\n') + '\n')

  // --fuga: solo los flujos v2 con sesión, y el tramo cortado en el siguiente /impl.
  const fuga = costosCon('--fuga', '--archivo', archivo)
  assert.equal(fuga.codigo, 0)
  assert.equal(fuga.salida.trimEnd(), 'FUGA: 2026-01-01 10:01 · repo · $0,03 (3 pedidos) después del cierre')

  // --anotar: un prefijo con espacio o con T, y exit 2 si no es una sola coincidencia.
  const ok = costosCon('--anotar', '2026-01-01 10:01', 'faltó un test', '--archivo', archivo)
  assert.equal(ok.codigo, 0)
  assert.match(ok.salida, /^ANOTADO: /)
  const defecto = fs.readFileSync(archivo, 'utf8').trimEnd().split('\n').map((l) => JSON.parse(l)).at(-1)
  assert.deepEqual({ ...defecto, t: undefined }, { v: 2, tipo: 'defecto', flujo: en(100), texto: 'faltó un test', t: undefined })
  assert.ok(Number.isFinite(Date.parse(defecto.t)))
  assert.equal(costosCon('--anotar', '2026-01-01T10:01', 'otra', '--archivo', archivo).codigo, 0)
  const varios = costosCon('--anotar', '2026-01', 'x', '--archivo', archivo)
  assert.equal(varios.codigo, 2)
  assert.match(varios.salida, /^ERROR: .*coincide con 2 flujos/)
  const ninguno = costosCon('--anotar', '2027', 'x', '--archivo', archivo)
  assert.equal(ninguno.codigo, 2)
  assert.match(ninguno.salida, /^ERROR: ningún flujo/)
  assert.equal(costosCon('--anotar', '2026-01-01', '--archivo', archivo).codigo, 2)
  const lineas = fs.readFileSync(archivo, 'utf8').trimEnd().split('\n')
  assert.equal(lineas.length, 4)
  // Las filas de defecto no cuentan como flujos y el listado muestra cuántos tiene cada uno.
  const listado = costosCon('--archivo', archivo).salida
  assert.match(listado, /^FLUJOS \(últimos 2 de 2 con costo\):$/m)
  assert.match(listado, /2026-01-01 10:01 · repo · .* · HECHO · defectos: 2$/m)
})

/** Arma un repo con su carpeta de sesiones y los ayudantes de transcript de los tests de arriba. */
function transcripts(nombre) {
  const raiz = path.join(os.tmpdir(), nombre)
  const claude = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-config-'))
  temporales.push(claude)
  const sesion = path.join(claude, 'projects', path.resolve(raiz).replace(/[^a-zA-Z0-9]/g, '-'))
  const subagentes = path.join(sesion, 's1', 'subagents')
  fs.mkdirSync(subagentes, { recursive: true })
  const inicio = Date.parse('2026-01-01T10:00:00.000Z')
  const en = (s) => new Date(inicio + s * 1000).toISOString()
  const jsonl = (filas) => filas.map((f) => JSON.stringify(f)).join('\n') + '\n'
  const turno = (id, s, bloques) => ({ type: 'assistant', timestamp: en(s), message: { id, model: 'claude-sonnet-5-5', usage: { output_tokens: 100 }, content: bloques } })
  const texto = (t) => ({ type: 'text', text: t })
  const usuario = (s, contenido, extra = {}) => ({ type: 'user', timestamp: en(s), message: { role: 'user', content: contenido }, ...extra })
  const escribir = (filas) => fs.writeFileSync(path.join(sesion, 's1.jsonl'), jsonl(filas))
  const agente = (nombre, tipo, prompt, desde, filas) => {
    fs.writeFileSync(path.join(subagentes, `${nombre}.meta.json`), JSON.stringify({ agentType: tipo }))
    fs.writeFileSync(path.join(subagentes, `${nombre}.jsonl`), jsonl([usuario(desde, prompt), ...filas]))
  }
  const opciones = (hasta) => ({ proyectos: path.join(claude, 'projects'), hasta: en(hasta), base: null })
  return { raiz, en, turno, texto, usuario, escribir, agente, opciones }
}

test('costos: un /impl lanzado por la skill abre su propio flujo, y con /impl tecleado manda el comando', () => {
  const { raiz, en, turno, texto, usuario, escribir, opciones } = transcripts('repo-metricas-skill')
  const skill = (s, pedido) => usuario(s, [texto(`Base directory for this skill: D:\\GitHub-Personal\\QCC\\qcc-implementador\\skills\\impl\n\n# /impl\n\nEres el orquestador.\n\n**Pedido:** ${pedido}\n\nresto`)], { isMeta: true, isSidechain: false })
  escribir([
    usuario(0, '<command-name>/impl</command-name>\n<command-args> primero </command-args>'),
    // Con /impl tecleado, la fila de la skill llega ms después: el comienzo sigue siendo el comando.
    skill(0.05, 'primero'),
    turno('o1', 100, [texto('uno')]),
    skill(1000, '  segundo   pedido '),
    turno('o2', 1100, [texto('dos')]),
    // Otra skill con nombre parecido no abre flujo.
    usuario(1500, [texto('Base directory for this skill: D:\\x\\skills\\implementador\n\n**Pedido:** no')], { isMeta: true, isSidechain: false }),
    turno('o3', 1600, [texto('tres')]),
  ])
  const primero = metricasDelFlujo(raiz, en(0), opciones(500))
  assert.equal(primero.costo.inicio, en(0))
  assert.equal(primero.pedido, 'primero')
  assert.equal(primero.costo.roles.orquestador.pedidos, 1)
  const segundo = metricasDelFlujo(raiz, en(1000), opciones(2000))
  assert.equal(segundo.costo.inicio, en(1000))
  assert.equal(segundo.pedido, 'segundo pedido')
  assert.equal(segundo.costo.roles.orquestador.pedidos, 2)
})

test('costos: la espera incluye al usuario que responde tras un turno cerrado con texto', () => {
  const { raiz, en, turno, texto, usuario, escribir, opciones } = transcripts('repo-metricas-espera')
  const bash = (id, comando) => ({ type: 'tool_use', id, name: 'Bash', input: { command: comando } })
  const ESTADO = 'node ~/.claude/plugins/cache/qcc/impl/0.1.0/herramientas/estado.mjs'
  escribir([
    usuario(0, '<command-name>/impl</command-name>'),
    turno('o1', 5, [bash('b0', `${ESTADO} --paso 0`)]),
    // El turno termina con texto y el usuario pega comandos 1000 s después.
    turno('o2', 100, [texto('Pega estos comandos con !')]),
    usuario(1100, '<bash-input>node x</bash-input>'),
    turno('o3', 1110, [bash('b5', `${ESTADO} --paso 5`)]),
    turno('o4', 1120, [texto('listo')]),
    // Una notificación del sistema no es el usuario: no corta la espera.
    usuario(1200, '<task-notification>fin</task-notification>'),
    usuario(1205, '<bash-stdout>ok</bash-stdout>'),
    turno('o5', 1210, [bash('b7', `${ESTADO} --cambios abc --paso 7`)]),
  ])
  const m = metricasDelFlujo(raiz, en(0), opciones(1300))
  assert.deepEqual(m.tiempos, { fases: { 0: 110, 5: 100, 7: 0 }, espera: 1000, activo: 210 })
})

test('costos: todo revisor es la revisión final y su veredicto entra en final', () => {
  const { raiz, en, turno, texto, usuario, escribir, agente, opciones } = transcripts('repo-metricas-final')
  escribir([usuario(0, '<command-name>/impl</command-name>'), turno('o1', 60, [texto('x')])])
  agente('agent-f', 'impl:qcc-revisor', 'REVISIÓN FINAL · repo /x', 100, [turno('f1', 140, [texto('VEREDICTO: RECHAZADO\nPROBLEMAS:\n1. Falla X\nOBSERVACIONES: ninguna')])])
  const m = metricasDelFlujo(raiz, en(0), opciones(500))
  assert.deepEqual(m.costo.veredictos, { final: ['RECHAZADO'] })
  assert.deepEqual(m.problemas, { final: [{ veredicto: 'RECHAZADO', items: ['Falla X'] }] })
})

test('costos: un flujo reanudado en otra sesión suma las dos y no cuenta el corte', () => {
  const { raiz, en, turno, texto, usuario, escribir, agente, opciones } = transcripts('repo-metricas-reanudado')
  const carpeta = path.join(opciones(0).proyectos, path.resolve(raiz).replace(/[^a-zA-Z0-9]/g, '-'))
  const bash = (id, comando) => ({ type: 'tool_use', id, name: 'Bash', input: { command: comando } })
  const ESTADO = 'node ~/.claude/plugins/cache/qcc/impl/0.1.0/herramientas/estado.mjs'
  // Sesión A: el /impl original, la ejecución y un ejecutor; se corta a los 600 s.
  escribir([
    usuario(0, '<command-name>/impl</command-name><command-args>pedido original entero</command-args>'),
    turno('a1', 10, [bash('b0', `${ESTADO} --paso 0`)]),
    turno('a2', 300, [bash('b5', `${ESTADO} --base --sub 1 --paso 5`)]),
    turno('a3', 600, [texto('cortado')]),
  ])
  agente('agent-e1', 'impl:qcc-ejecutor', 'SUBTAREA 1/1: x', 310, [turno('e1', 500, [texto('ESTADO: HECHO')])])
  // Sesión B (otra cuenta), una hora después: /impl reanudar, la revisión final y el cierre.
  const sub = path.join(carpeta, 's2', 'subagents')
  fs.mkdirSync(sub, { recursive: true })
  const jsonl = (filas) => filas.map((f) => JSON.stringify(f)).join('\n') + '\n'
  fs.writeFileSync(path.join(carpeta, 's2.jsonl'), jsonl([
    usuario(4200, '<command-name>/impl</command-name><command-args>reanudar</command-args>'),
    turno('b1', 4210, [bash('c0', `${ESTADO} --reanudar --paso 6`)]),
    turno('b2', 4400, [bash('c7', `${ESTADO} --cambios --global --paso 7`)]),
  ]))
  fs.writeFileSync(path.join(sub, 'agent-r1.meta.json'), JSON.stringify({ agentType: 'impl:qcc-revisor' }))
  fs.writeFileSync(path.join(sub, 'agent-r1.jsonl'), jsonl([usuario(4220, 'QUÉ REVISAR: cambio completo'), turno('r1', 4300, [texto('VEREDICTO: APROBADO\nOBSERVACIONES: ninguna')])]))

  const sesiones = [{ id: 's1', desde: en(0) }, { id: 's2', desde: en(4210) }]
  const m = metricasDelFlujo(raiz, en(0), { ...opciones(4500), sesiones })
  assert.equal(m.sesiones, 2)
  assert.equal(m.pedido, 'pedido original entero')
  assert.equal(m.sesion, path.join(carpeta, 's2.jsonl'))
  assert.equal(m.costo.roles.orquestador.pedidos, 5)
  assert.deepEqual(m.costo.veredictos, { ejecutor: ['HECHO'], final: ['APROBADO'] })
  // El corte es el hueco entre la última fila de A (600 s) y el /impl de B (4200 s): no cuenta como activo ni como espera.
  assert.equal(m.tiempos.corte, 3600)
  assert.equal(m.tiempos.activo, 600 + 200)
  assert.ok(Math.abs(m.costo.minutos - (4500 - 3600) / 60) < 1e-9)
  assert.equal(m.ejecutores[1].estado, 'HECHO')
  // Sin las sesiones anotadas (un flujo de antes), lee solo la primera, como siempre.
  const viejo = metricasDelFlujo(raiz, en(0), opciones(4500))
  assert.equal(viejo.sesiones, 1)
  assert.equal(viejo.tiempos.corte, undefined)
})

test('costos: problemasDe acepta viñetas y ruta:línea sin numeración', () => {
  assert.deepEqual(problemasDe('VEREDICTO: RECHAZADO\nPROBLEMAS:\n1. uno\n2) dos\nOBSERVACIONES: x'), ['uno', 'dos'])
  assert.deepEqual(problemasDe('PROBLEMAS:\n- a falla\n* b falla\n• c falla\nOBSERVACIONES:\n- no cuenta'), ['a falla', 'b falla', 'c falla'])
  assert.deepEqual(problemasDe('PROBLEMAS:\nsrc/a.ts:12 — mal\nsrc/b.ts:3-5 – peor\n- src/c.ts:9 - otro\n\nOBSERVACIONES: nada'), ['src/a.ts:12 — mal', 'src/b.ts:3-5 – peor', 'src/c.ts:9 - otro'])
  // Con numerados presentes, sus sub-viñetas no se cuentan aparte.
  assert.deepEqual(problemasDe('PROBLEMAS:\n1. src/a.ts:1 — mal\n   - detalle\n   - otro detalle\n2. dos\nOBSERVACIONES: x'), ['src/a.ts:1 — mal', 'dos'])
  assert.deepEqual(problemasDe('PROBLEMAS:\nsrc/main.js:45,61 + src/texturas.js:153-174 — texto\nOBSERVACIONES: x'), ['src/main.js:45,61 + src/texturas.js:153-174 — texto'])
  assert.deepEqual(problemasDe('PROBLEMAS: ninguno\nOBSERVACIONES: - algo'), [])
  assert.deepEqual(problemasDe('PROBLEMAS:\n- ninguno'), [])
  assert.deepEqual(problemasDe('sin sección'), [])
})

test.after(() => limpiar())
