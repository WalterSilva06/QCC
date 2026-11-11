// Casos de costos.mjs: consumo y métricas del flujo desde transcripts, problemas de la revisión y el % de los límites de uso.
// Correr: node --test qcc-implementador/herramientas/costos.test.mjs

import { temporales, estadoEn, estadoCon, limpiar, repoConPlanGuardado } from './pruebas-comun.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { registroDe, flujoDe } from './guardia.mjs'
import { costoDelFlujo, FASES, fasesDeLimites, gastoDeLimites, leerLimites, LIMITES_MAX_SEG, metricasDelFlujo, problemasDe, resumenDeCosto, resumenDeFases, resumenDeLimites } from './costos.mjs'

test('costos: el cierre anota consumo y veredictos del flujo, sin dólares', () => {
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
  assert.match(cierre, /^CONSUMO: [\d,]+ min · 264k tokens \(38 % caché\) · sal 4k · orquestador 202k tok \(2 pedidos\) · explorador 51k tok \(1 pedido\) · final 11k tok \(1 pedido\) \(sin el mensaje de cierre\)$/m)
  assert.match(cierre, /^VEREDICTOS: final APROBADO$/m)
  assert.match(cierre, /^CONTEXTO: 100000 tokens en el último pedido del hilo principal$/m)
  assert.doesNotMatch(cierre, /\$\d/)
  assert.match(cierre, /ALCANCE: [^\n]*\s*$/)
  const flujos = path.join(path.dirname(registroDe(raiz)), 'flujos.jsonl')
  const fila = fs.readFileSync(flujos, 'utf8').trimEnd().split('\n').map((l) => JSON.parse(l)).at(-1)
  assert.equal(fila.v, 2)
  assert.equal(fila.raiz, raiz)
  assert.equal(fila.costo.usd, undefined)
  assert.equal(fila.costo.roles.orquestador.usd, undefined)
  assert.deepEqual(fila.costo.veredictos, { final: ['APROBADO'] })

  const historial = spawnSync(process.execPath, [fileURLToPath(new URL('./costos.mjs', import.meta.url)), '--archivo', flujos], { encoding: 'utf8' }).stdout
  assert.match(historial, /^FLUJOS \(últimos \d+ de \d+\):$/m)
  assert.match(historial, /· [\d,]+ min · 264k tokens \(38 % caché\) · sal 4k · orquestador 202k tok \(2 pedidos\) · explorador 51k tok \(1 pedido\) · final 11k tok \(1 pedido\) · 5h s\/d · sem s\/d · final APROBADO$/m)
  assert.match(historial, /^PROMEDIO: [\d,]+ min · orquestador [\d,]+ pedidos · 5h s\/d · sem s\/d$/m)
})

test('resumenDeCosto muestra tokens, caché y pedidos por rol', () => {
  const rol = (pedidos, agentes, tokens) => ({ pedidos, agentes, tokens: { entrada: 0, leidos: 0, escritos: 0, salida: 0, thinking: 0, ...tokens } })
  const costo = {
    minutos: 42.5,
    roles: {
      // thinking ya va dentro de la salida: no se suma aparte.
      orquestador: rol(10, 0, { entrada: 100_000, leidos: 1_000_000, escritos: 200_000, salida: 44_000, thinking: 30_000 }),
      ejecutor: rol(388, 12, { entrada: 300_000, leidos: 10_900_000, escritos: 900_000, salida: 800_000, thinking: 500_000 }),
      explorador: rol(0, 0, {}),
      revisor: rol(1, 1, { leidos: 950 }),
    },
  }
  const linea = resumenDeCosto(costo)
  // Total 14,244M; prompt 13,4M (leídos 11,9M = 88,8 → 89 %); salida 844k. Los roles, de más a menos tokens.
  assert.equal(linea, '42,5 min · 14,2M tokens (89 % caché) · sal 844k · ejecutor 12,9M tok (×12, 388 pedidos) · orquestador 1,3M tok (10 pedidos) · revisor 950 tok (1 pedido)')

  // Una fila vieja con dólares y sin tokens: el `usd` se ignora, el tramo de tokens no aparece, y sin pedidos queda «sin pedidos».
  const viejo = { usd: 0.5, minutos: 2, roles: { orquestador: { pedidos: 3, usd: 0.5, sinPrecio: 0, agentes: 0 } } }
  assert.equal(resumenDeCosto(viejo), '2,0 min · orquestador (3 pedidos)')
  assert.equal(resumenDeCosto({ minutos: 0, roles: { orquestador: rol(0, 0, {}) } }), '0,0 min · sin pedidos')

  // Solo salida: sin prompt no hay porcentaje de caché.
  assert.equal(resumenDeCosto({ minutos: 1, roles: { orquestador: rol(1, 0, { salida: 1000 }) } }), '1,0 min · 1k tokens · sal 1k · orquestador 1k tok (1 pedido)')
  // Un solo agente con un pedido, y varios agentes con un pedido en total: singular con y sin «×N».
  assert.equal(resumenDeCosto({ minutos: 1, roles: { ejecutor: rol(1, 3, {}) } }), '1,0 min · ejecutor (×3, 1 pedido)')
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
  assert.deepEqual(Object.keys(m.costo).sort(), ['inicio', 'minutos', 'roles', 'veredictos'])
  assert.deepEqual(Object.keys(m.costo.roles.ejecutor).sort(), ['agentes', 'pedidos', 'tokens'])
  assert.deepEqual(m.contexto, { primero: 1510, ultimo: 3020 })
  // Tiempos: el preflight a los 60 s es la fase 0; el AskUserQuestion «Plan» tarda 300 s dentro de la fase 4.
  assert.deepEqual(m.tiempos, { fases: { 0: 60, 1: 70, 2: 140, 4: 10, 5: 320, 7: 0 }, espera: 300, activo: 600 })
  assert.equal(Object.values(m.tiempos.fases).reduce((s, n) => s + n, 0), m.tiempos.activo)
  assert.deepEqual(Object.keys(m.ejecutores), ['1', '2'])
  assert.deepEqual(m.ejecutores['1'], { segundos: 180, correcciones: 1, estado: 'HECHO', esfuerzo: 'medium' })
  assert.deepEqual(m.ejecutores['2'], { segundos: 48, correcciones: 0, estado: 'HECHO', esfuerzo: 'high' })
  assert.deepEqual(m.problemas, { final: [{ veredicto: 'RECHAZADO', items: ['Falla X'] }] })
  assert.deepEqual(m.alcanceFuera, ['ALCANCE: FUERA (a.ts)'])
  assert.deepEqual(m.explorador, { pedidos: 2, glob: 1, read: 2, mapa: true, agentes: [{ id: 'e', contexto: 200, lineas: 0 }] })
  // Sin sesión en ese repo, no hay métricas; el consumo sigue siendo el mismo que con costoDelFlujo.
  assert.equal(metricasDelFlujo(path.join(os.tmpdir(), 'repo-sin-sesion'), en(0), opciones), null)
  assert.deepEqual(costoDelFlujo(raiz, en(0), opciones).roles, m.costo.roles)
})

test('costos: explorador.agentes da el contexto máximo y las líneas de Read y Grep sin system-reminder ni repetidos', () => {
  const raiz = path.join(os.tmpdir(), 'repo-metricas-agentes')
  const claude = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-config-'))
  temporales.push(claude)
  const sesion = path.join(claude, 'projects', path.resolve(raiz).replace(/[^a-zA-Z0-9]/g, '-'))
  const subagentes = path.join(sesion, 's1', 'subagents')
  fs.mkdirSync(subagentes, { recursive: true })
  const inicio = Date.parse('2026-01-01T10:00:00.000Z')
  const en = (s) => new Date(inicio + s * 1000).toISOString()
  const jsonl = (filas) => filas.map((f) => JSON.stringify(f)).join('\n') + '\n'
  const turno = (id, s, bloques, usage) => ({ type: 'assistant', timestamp: en(s), message: { id, model: 'claude-haiku-5-5', usage, content: bloques } })
  const uso = (t) => ({ input_tokens: t.input, cache_read_input_tokens: t.leido ?? 0, cache_creation_input_tokens: t.escrito ?? 0, output_tokens: 10 })
  const resultado = (s, id, texto) => ({ type: 'user', timestamp: en(s), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: texto }] } })
  const usa = (id, name) => ({ type: 'tool_use', id, name, input: {} })
  fs.writeFileSync(path.join(sesion, 's1.jsonl'), jsonl([
    { type: 'user', timestamp: en(0), message: { role: 'user', content: '<command-name>/impl</command-name>' } },
    turno('o1', 5, [{ type: 'text', text: 'x' }], uso({ input: 1 })),
  ]))
  fs.writeFileSync(path.join(subagentes, 'agent-e1.meta.json'), JSON.stringify({ agentType: 'explorador' }))
  const pedido = turno('e1', 20, [usa('r1', 'Read'), usa('g1', 'Grep'), usa('b1', 'Bash')], uso({ input: 100, leido: 4000, escrito: 900 }))
  const lectura = resultado(25, 'r1', 'a\nb\nc\n<system-reminder>\nmalware?\notro\n</system-reminder>')
  const busqueda = resultado(26, 'g1', [{ type: 'text', text: 'x.ts:1:a\ny.ts:2:b' }])
  fs.writeFileSync(path.join(subagentes, 'agent-e1.jsonl'), jsonl([
    { type: 'user', timestamp: en(10), message: { role: 'user', content: 'PEDIDO: x' } },
    pedido,
    lectura,
    busqueda,
    resultado(27, 'b1', '1\n2\n3\n4'),
    // El transcript repite los mismos bloques: no suman.
    pedido,
    lectura,
    busqueda,
    turno('e2', 30, [{ type: 'text', text: 'ARCHIVOS' }], uso({ input: 50, leido: 100 })),
  ]))
  const m = metricasDelFlujo(raiz, en(0), { proyectos: path.join(claude, 'projects'), hasta: en(100), base: null })
  assert.deepEqual(m.explorador.agentes, [{ id: 'e1', contexto: 5000, lineas: 5 }])
  assert.equal(m.explorador.read, 1)
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
  const fases = [{ fase: 'plan', five_hour: { gasto: 2 }, seven_day: { gasto: 0.5 } }, { fase: 'ejecución', five_hour: { gasto: 5 }, seven_day: { gasto: null, motivo: 'sin dato' } }, 'roto']
  const limites = { five_hour: { gasto: 7 }, seven_day: { gasto: 1.5, incompleto: true }, fases }
  const v2 = { v: 2, t: t2, raiz: '/x/otro', base: 'def', costo, limites, resultado: 'HECHO', sesion: '/no/existe.jsonl', subtareas: [{ n: 1 }, { n: 2 }, { n: 3 }] }
  const filas = [v1, v2, { v: 2, tipo: 'defecto', flujo: t2, texto: 'faltó un test', t: '2026-01-02T12:00:00.000Z' }]
  fs.writeFileSync(archivo, filas.map((f) => JSON.stringify(f)).join('\n') + '\n')

  const lineas = costosCon('--archivo', archivo).salida.split('\n')
  assert.equal(lineas[0], 'FLUJOS (últimos 2 de 2):')
  // Las filas viejas traen `usd`: se leen igual y el dinero no sale. La v1 queda sin resultado ni defectos y sin límites (s/d).
  assert.equal(lineas[1], '  2026-01-01 10:05 · repo · 2,0 min · orquestador (3 pedidos) · 5h s/d · sem s/d · CRÍTICO (#1) · 2 subtarea(s) · final APROBADO')
  assert.equal(lineas[2], '  2026-01-02 11:30 · otro · 2,0 min · orquestador (3 pedidos) · 5h +7 % · sem ≥+1,5 % · 3 subtarea(s) · final APROBADO · HECHO · defectos: 1')
  // Bajo el flujo con lecturas por fase, su línea (la entrada rota se salta); la v1, sin ellas, no imprime nada más.
  assert.equal(lineas[3], '    por fase: plan: 5h +2 % · sem +0,5 % | ejecución: 5h +5 % · sem s/d')
  // El promedio de cada ventana cuenta solo los gastos completos (el semanal incompleto no entra).
  assert.equal(lineas[4], 'PROMEDIO: 2,0 min · orquestador 3,0 pedidos · 5h +7,0 % (1) · sem s/d')
})

test('costos: --anotar suma un defecto y --fuga mide lo gastado después del cierre', () => {
  const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-config-'))
  temporales.push(carpeta)
  const subagentes = path.join(carpeta, 's1', 'subagents')
  fs.mkdirSync(subagentes, { recursive: true })
  const inicio = Date.parse('2026-01-01T10:00:00.000Z')
  const en = (s) => new Date(inicio + s * 1000).toISOString()
  const jsonl = (filas) => filas.map((f) => JSON.stringify(f)).join('\n') + '\n'
  // Cada pedido: 1000 tokens de salida.
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
  assert.equal(fuga.salida.trimEnd(), 'FUGA: 2026-01-01 10:01 · repo · 3 pedidos · 3k tokens después del cierre')

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
  assert.match(listado, /^FLUJOS \(últimos 2 de 2\):$/m)
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

test('costos: tiemposDe resta la espera del límite de 5 h dentro de un subagente', () => {
  const { raiz, en, turno, texto, usuario, escribir, agente, opciones } = transcripts('repo-metricas-limite-agente')
  const bash = (id, comando) => ({ type: 'tool_use', id, name: 'Bash', input: { command: comando } })
  const ESTADO = 'node ~/.claude/plugins/cache/qcc/impl/0.1.0/herramientas/estado.mjs'
  escribir([
    usuario(0, '<command-name>/impl</command-name>'),
    turno('o1', 5, [bash('b0', `${ESTADO} --paso 0`)]),
    turno('o2', 10, [{ type: 'tool_use', id: 'x1', name: 'Agent', input: { subagent_type: 'impl:qcc-ejecutor', prompt: 'SUBTAREA 1/1: x' } }]),
    usuario(3050, [{ type: 'tool_result', tool_use_id: 'x1', content: 'ESTADO: HECHO' }]),
    turno('o3', 3060, [bash('b7', `${ESTADO} --cambios abc --paso 7`)]),
  ])
  // El ejecutor choca con el límite a los 30 s y sigue 3000 s después, cuando se reinicia.
  agente('agent-e1', 'impl:qcc-ejecutor', 'SUBTAREA 1/1: x', 20, [
    turno('e1', 30, [texto("You've hit your session limit · resets 3pm")]),
    turno('e2', 3030, [texto('Your limit has reset')]),
    turno('e3', 3040, [texto('ESTADO: HECHO')]),
  ])
  const m = metricasDelFlujo(raiz, en(0), opciones(3100))
  assert.deepEqual(m.tiempos, { fases: { 0: 60, 7: 0 }, espera: 3000, activo: 60 })
})

test('costos: el aviso del límite en el hilo principal no se resta dos veces con la espera del turno', () => {
  const { raiz, en, turno, texto, usuario, escribir, opciones } = transcripts('repo-metricas-limite-turno')
  const bash = (id, comando) => ({ type: 'tool_use', id, name: 'Bash', input: { command: comando } })
  const ESTADO = 'node ~/.claude/plugins/cache/qcc/impl/0.1.0/herramientas/estado.mjs'
  escribir([
    usuario(0, '<command-name>/impl</command-name>'),
    turno('o1', 5, [bash('b0', `${ESTADO} --paso 0`)]),
    // El aviso cierra el turno con texto y el usuario sigue 1000 s después: es una sola espera, no dos.
    turno('o2', 100, [texto("You've hit your limit · resets 3pm")]),
    usuario(1100, 'continúa'),
    turno('o3', 1110, [bash('b5', `${ESTADO} --paso 5`)]),
    turno('o4', 1120, [bash('b7', `${ESTADO} --cambios abc --paso 7`)]),
  ])
  assert.deepEqual(metricasDelFlujo(raiz, en(0), opciones(1300)).tiempos, { fases: { 0: 110, 5: 10, 7: 0 }, espera: 1000, activo: 120 })
})

test('costos: el subagente que muere en el límite sin reinicio espera hasta el siguiente mensaje del humano', () => {
  const { raiz, en, turno, texto, usuario, escribir, agente, opciones } = transcripts('repo-metricas-limite-muere')
  const bash = (id, comando) => ({ type: 'tool_use', id, name: 'Bash', input: { command: comando } })
  const ESTADO = 'node ~/.claude/plugins/cache/qcc/impl/0.1.0/herramientas/estado.mjs'
  escribir([
    usuario(0, '<command-name>/impl</command-name>'),
    turno('o1', 5, [bash('b0', `${ESTADO} --paso 0`)]),
    turno('o2', 10, [{ type: 'tool_use', id: 'x1', name: 'Agent', input: { subagent_type: 'impl:qcc-ejecutor', prompt: 'SUBTAREA 1/1: x' } }]),
    usuario(40, [{ type: 'tool_result', tool_use_id: 'x1', content: 'sin informe' }]),
    usuario(3045, 'continúa'),
    turno('o3', 3050, [bash('b5', `${ESTADO} --paso 5`)]),
    turno('o4', 5050, [bash('b7', `${ESTADO} --cambios abc --paso 7`)]),
  ])
  // El subagente avisa del límite a los 30 s y su transcript termina ahí, sin «limit has reset».
  agente('agent-e1', 'impl:qcc-ejecutor', 'SUBTAREA 1/1: x', 20, [turno('e1', 30, [texto("You've hit your limit · resets 3pm")])])
  assert.deepEqual(metricasDelFlujo(raiz, en(0), opciones(5100)).tiempos, { fases: { 0: 35, 5: 2000, 7: 0 }, espera: 3015, activo: 2035 })
})

test('costos: un mensaje del humano o un resultado de herramienta que citan el aviso del límite no abren espera', () => {
  const { raiz, en, turno, usuario, escribir, opciones } = transcripts('repo-metricas-limite-cita')
  const bash = (id, comando) => ({ type: 'tool_use', id, name: 'Bash', input: { command: comando } })
  const ESTADO = 'node ~/.claude/plugins/cache/qcc/impl/0.1.0/herramientas/estado.mjs'
  escribir([
    usuario(0, '<command-name>/impl</command-name>'),
    usuario(1, "Pedido: restar la espera de «You've hit your 5-hour limit»"),
    turno('o1', 5, [bash('b0', `${ESTADO} --paso 0`)]),
    turno('o2', 6, [{ type: 'tool_use', id: 'g1', name: 'Grep', input: { pattern: 'hit your' } }]),
    usuario(7, [{ type: 'tool_result', tool_use_id: 'g1', content: "LIMITES.md: Cuando «You've hit your … limit» avisa" }]),
    turno('o3', 500, [bash('b7', `${ESTADO} --cambios abc --paso 7`)]),
  ])
  assert.deepEqual(metricasDelFlujo(raiz, en(0), opciones(600)).tiempos, { fases: { 0: 500, 7: 0 }, espera: 0, activo: 500 })
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

test('límites: leerLimites lee el snapshot del panel y marca «sin dato» sin archivo, roto o viejo, nunca con ceros', () => {
  const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'limites-'))
  temporales.push(carpeta)
  const archivo = path.join(carpeta, 'qcc-limites.json')
  const ahora = Date.parse('2026-11-10T12:00:00.000Z')
  assert.equal(leerLimites(archivo, ahora).sinDato, 'sin snapshot del panel')
  fs.writeFileSync(archivo, '{roto')
  assert.equal(leerLimites(archivo, ahora).sinDato, 'sin snapshot del panel')
  fs.writeFileSync(archivo, JSON.stringify({ five_hour: { pct: 3 } }))
  assert.equal(leerLimites(archivo, ahora).sinDato, 'snapshot roto')
  // Fresco: cada ventana por separado (la semanal puede faltar) y con su antigüedad.
  fs.writeFileSync(archivo, JSON.stringify({ t: new Date(ahora - 30_000).toISOString(), five_hour: { pct: 23.5, resetsAt: '2026-11-10T15:00:00.000Z' } }))
  const fresca = leerLimites(archivo, ahora)
  assert.deepEqual({ ...fresca, cuenta: undefined }, { t: '2026-11-10T12:00:00.000Z', cuenta: undefined, edad: 30, five_hour: { pct: 23.5, resetsAt: '2026-11-10T15:00:00.000Z' } })
  assert.equal(fresca.seven_day, undefined)
  // Más viejo que el tope: sin dato, con la edad para saber cuánto.
  fs.writeFileSync(archivo, JSON.stringify({ t: new Date(ahora - (LIMITES_MAX_SEG + 1) * 1000).toISOString(), five_hour: { pct: 1 } }))
  const vieja = leerLimites(archivo, ahora)
  assert.equal(vieja.sinDato, 'snapshot viejo')
  assert.equal(vieja.five_hour, undefined)
})

test('límites: gastoDeLimites resta, suma los tramos, detecta el reinicio y dice s/d', () => {
  const R5 = '2026-11-10T15:00:00.000Z'
  const R7 = '2026-11-14T00:00:00.000Z'
  const lectura = (t, h, s, r5 = R5) => ({ t, ...(h === null ? {} : { five_hour: { pct: h, resetsAt: r5 } }), ...(s === null ? {} : { seven_day: { pct: s, resetsAt: R7 } }) })
  const a = lectura('2026-11-10T12:00:00.000Z', 40, 10)
  const b = lectura('2026-11-10T12:30:00.000Z', 47.5, 11)
  assert.deepEqual(gastoDeLimites([{ inicio: a, fin: b }]), { five_hour: { gasto: 7.5 }, seven_day: { gasto: 1 } })
  // Reinicio: cambió la hora de reinicio, bajó el %, o la lectura final es posterior al reinicio previsto. Nunca un negativo:
  // da la cota mínima (el % de la lectura final) y el gasto queda incompleto.
  const tras = lectura('2026-11-10T16:00:00.000Z', 10, 12, '2026-11-10T20:00:00.000Z')
  assert.deepEqual(gastoDeLimites([{ inicio: a, fin: tras }]), { five_hour: { gasto: 10, incompleto: true }, seven_day: { gasto: 2 } })
  assert.deepEqual(gastoDeLimites([{ inicio: a, fin: lectura('2026-11-10T13:00:00.000Z', 30, 10) }]).five_hour, { gasto: 30, incompleto: true })
  assert.deepEqual(gastoDeLimites([{ inicio: a, fin: lectura('2026-11-10T15:00:00.000Z', 60, 10) }]).five_hour, { gasto: 60, incompleto: true })
  // Sin lectura (el panel no corrió, o una ventana faltó): s/d, nunca cero.
  assert.deepEqual(gastoDeLimites([{ inicio: { t: a.t, sinDato: 'sin snapshot del panel' }, fin: b }]), { five_hour: { gasto: null, motivo: 'sin dato' }, seven_day: { gasto: null, motivo: 'sin dato' } })
  assert.deepEqual(gastoDeLimites([{ inicio: a }]).five_hour, { gasto: null, motivo: 'sin dato' })
  assert.deepEqual(gastoDeLimites([{ inicio: lectura(a.t, 40, null), fin: b }]).seven_day, { gasto: null, motivo: 'sin dato' })
  assert.deepEqual(gastoDeLimites(undefined).five_hour, { gasto: null, motivo: 'sin dato' })
  // Dos sesiones: se suman (el hueco entre ellas no cuenta); si a una le falta dato, el gasto lleva `incompleto`.
  const c = lectura('2026-11-10T18:00:00.000Z', 3, 20, '2026-11-10T22:00:00.000Z')
  const d = lectura('2026-11-10T18:40:00.000Z', 10, 22, '2026-11-10T22:00:00.000Z')
  assert.deepEqual(gastoDeLimites([{ inicio: a, fin: b }, { inicio: c, fin: d }]), { five_hour: { gasto: 14.5 }, seven_day: { gasto: 3 } })
  assert.deepEqual(gastoDeLimites([{ inicio: a, fin: tras }, { inicio: c, fin: d }]).five_hour, { gasto: 17, incompleto: true })
  assert.deepEqual(gastoDeLimites([{ inicio: { t: a.t, sinDato: 'x' }, fin: b }, { inicio: c, fin: d }]).five_hour, { gasto: 7, incompleto: true })
  // El resumen: el reinicio sale como cota (`≥+`); las filas viejas con `motivo: 'reinicio'` siguen diciendo `reinicio`.
  assert.equal(resumenDeLimites({ five_hour: { gasto: 7.5 }, seven_day: { gasto: 1 } }), '5h +7,5 % · sem +1 %')
  assert.equal(resumenDeLimites(gastoDeLimites([{ inicio: a, fin: tras }])), '5h ≥+10 % · sem +2 %')
  assert.equal(resumenDeLimites({ five_hour: { gasto: 7, incompleto: true }, seven_day: { gasto: null, motivo: 'reinicio' } }), '5h ≥+7 % · sem reinicio')
  assert.equal(resumenDeLimites(undefined), '5h s/d · sem s/d')
})

test('límites por fase: cada tramo entre lecturas va a la fase del paso de la primera, se acumula y suma lo mismo que el total', () => {
  const R5 = '2026-11-10T15:00:00.000Z'
  const R7 = '2026-11-14T00:00:00.000Z'
  let minuto = 0
  /** Lectura del `paso` a la hora siguiente; `h` o `s` null: esa ventana falta; `sinDato`: la lectura no sirvió. */
  const l = (paso, h, s, r5 = R5) => ({ paso, t: new Date(Date.parse('2026-11-10T12:00:00.000Z') + 60_000 * minuto++).toISOString(), ...(h === 'sinDato' ? { sinDato: 'snapshot viejo' } : { five_hour: { pct: h, resetsAt: r5 }, ...(s === null ? {} : { seven_day: { pct: s, resetsAt: R7 } }) }) })
  const tramo = (...fases) => ({ inicio: fases[0], fases, fin: fases.at(-1) })
  const fase = (fases, nombre) => fases.find((f) => f.fase === nombre)
  // Paso 0 → 2 → 4 → 5 → 6 → 5 → 6 (una corrección tras la revisión) y el fin: la exploración es lo de 0 a 2, y los pasos
  // repetidos (5 y 6, dos veces cada uno) se acumulan en su fase.
  const a = tramo(l(0, 10, 1), l(2, 12.5, 1.2), l(4, 15, 1.5), l(5, 15.5, 1.5), l(6, 20, 2.5), l(5, 21, 2.6), l(6, 23, 3))
  a.fin = l(7, 24.5, 3.1)
  const fases = fasesDeLimites([a])
  assert.deepEqual(fases.map((f) => f.fase), ['exploración', 'plan', 'aprobación', 'ejecución', 'revisión'])
  assert.deepEqual(fase(fases, 'exploración'), { fase: 'exploración', five_hour: { gasto: 2.5 }, seven_day: { gasto: 0.2 } })
  // Ejecución: 15,5 → 20 y 21 → 23; revisión: 20 → 21 y 23 → 24,5 (el fin).
  assert.deepEqual(fase(fases, 'ejecución'), { fase: 'ejecución', five_hour: { gasto: 6.5 }, seven_day: { gasto: 1.4 } })
  assert.deepEqual(fase(fases, 'revisión'), { fase: 'revisión', five_hour: { gasto: 2.5 }, seven_day: { gasto: 0.2 } })
  // Invariante: con todas las lecturas válidas, la suma por fase de cada ventana es el gasto total (misma resta inicio → fin).
  const total = gastoDeLimites([a])
  for (const k of ['five_hour', 'seven_day']) assert.equal(Math.round(fases.reduce((s, f) => s + f[k].gasto, 0) * 10) / 10, total[k].gasto)
  assert.equal(resumenDeFases(fases), 'exploración: 5h +2,5 % · sem +0,2 % | plan: 5h +2,5 % · sem +0,3 % | aprobación: 5h +0,5 % · sem +0 % | ejecución: 5h +6,5 % · sem +1,4 % | revisión: 5h +2,5 % · sem +0,2 %')

  // Una lectura sin dato (el paso 4) une las dos fases que toca en una, sin repartir la diferencia; las demás siguen.
  const b = tramo(l(0, 10, 1), l(2, 12, 1), l(4, 'sinDato'), l(5, 16, 2), l(6, 20, 3))
  const sinDato = fasesDeLimites([b])
  assert.deepEqual(sinDato.map((f) => f.fase), ['exploración', 'plan+aprobación', 'ejecución', 'revisión'])
  assert.deepEqual(fase(sinDato, 'plan+aprobación'), { fase: 'plan+aprobación', five_hour: { gasto: 4 }, seven_day: { gasto: 1 } })
  assert.deepEqual(fase(sinDato, 'exploración').five_hour, { gasto: 2 })
  assert.deepEqual(fase(sinDato, 'ejecución').five_hour, { gasto: 4 })
  // Una ventana que falta solo en una lectura: s/d solo en esa ventana.
  assert.deepEqual(fase(fasesDeLimites([tramo(l(0, 10, 1), l(5, 12, null), l(6, 13, 2))]), 'exploración'), { fase: 'exploración', five_hour: { gasto: 2 }, seven_day: { gasto: null, motivo: 'sin dato' } })

  // Reinicio entre dos lecturas (bajó el % y cambió la hora de reinicio): esa fase de esa ventana da la cota mínima (el % de la
  // lectura final, `incompleto`), sin negativos.
  const c = tramo(l(0, 80, 1), l(5, 90, 2), l(6, 4, 3, '2026-11-10T20:00:00.000Z'))
  c.fin = l(7, 9, 3.5, '2026-11-10T20:00:00.000Z')
  const reinicio = fasesDeLimites([c])
  assert.deepEqual(fase(reinicio, 'ejecución'), { fase: 'ejecución', five_hour: { gasto: 4, incompleto: true }, seven_day: { gasto: 1 } })
  assert.deepEqual(fase(reinicio, 'revisión').five_hour, { gasto: 5 })
  assert.deepEqual(fase(reinicio, 'exploración').five_hour, { gasto: 10 })

  // --reanudar: el segundo tramo empieza en el paso que dice SIGUE (5) y se suma a la misma fase; si a un pedazo de la
  // fase le faltó dato y a otro no, el de la fase queda incompleto (≥).
  const d = tramo(l(0, 10, 1), l(5, 12, 1.5))
  d.fin = l(5, 14, 1.6)
  const e = tramo(l(5, 'sinDato'), l(6, 30, 5))
  e.fin = l(6, 33, 5.5)
  const reanudado = fasesDeLimites([d, e])
  assert.deepEqual(fase(reanudado, 'ejecución').five_hour, { gasto: 2, incompleto: true })
  assert.deepEqual(fase(reanudado, 'revisión').five_hour, { gasto: 3 })
  assert.equal(resumenDeFases(reanudado), 'exploración: 5h +2 % · sem +0,5 % | ejecución: 5h ≥+2 % · sem ≥+0,1 % | revisión: 5h +3 % · sem +0,5 %')
  const d2 = tramo(l(0, 10, 1), l(5, 12, 1.5))
  d2.fin = l(5, 14, 1.6)
  const e2 = tramo(l(5, 20, 4), l(6, 30, 5))
  e2.fin = l(6, 33, 5.5)
  const dos = fasesDeLimites([d2, e2])
  assert.deepEqual(fase(dos, 'ejecución').five_hour, { gasto: 12 })
  assert.equal(Math.round(dos.reduce((s, f) => s + f.five_hour.gasto, 0) * 10) / 10, gastoDeLimites([d2, e2]).five_hour.gasto)

  // Un tramo sin lecturas por fase (flujo de antes de la 0.5.1, o un paso inválido) deja todo el desglose en null.
  assert.equal(fasesDeLimites([{ inicio: a.inicio, fin: a.fin }]), null)
  assert.equal(fasesDeLimites([a, { inicio: a.inicio, fin: a.fin }]), null)
  assert.equal(fasesDeLimites([{ inicio: a.inicio, fases: [{ ...a.inicio, paso: null }], fin: a.fin }]), null)
  assert.equal(fasesDeLimites(undefined), null)
  assert.deepEqual(Object.values(FASES).filter((f, i, todas) => todas.indexOf(f) === i), ['exploración', 'plan', 'aprobación', 'ejecución', 'revisión', 'cierre'])
})

test('límites por fase: fasesDeLimites une una lectura vieja con la siguiente', () => {
  const R5 = '2026-11-10T15:00:00.000Z'
  const R7 = '2026-11-14T00:00:00.000Z'
  let minuto = 0
  const l = (paso, h, s) => ({ paso, t: new Date(Date.parse('2026-11-10T12:00:00.000Z') + 60_000 * minuto++).toISOString(), ...(h === 'sinDato' ? { sinDato: 'snapshot viejo' } : { five_hour: { pct: h, resetsAt: R5 }, seven_day: { pct: s, resetsAt: R7 } }) })
  const total = (fases, k) => Math.round(fases.reduce((suma, f) => suma + f[k].gasto, 0) * 10) / 10
  // Dos lecturas seguidas sin dato (pasos 4 y 5): la fase unida abarca de la lectura del 2 a la del 6.
  const a = { fases: [l(0, 10, 1), l(2, 12, 1.5), l(4, 'sinDato'), l(5, 'sinDato'), l(6, 20, 3)] }
  a.inicio = a.fases[0]
  a.fin = l(7, 24, 3.5)
  const fases = fasesDeLimites([a])
  assert.deepEqual(fases.map((f) => f.fase), ['exploración', 'plan+aprobación+ejecución', 'revisión'])
  assert.deepEqual(fases[1], { fase: 'plan+aprobación+ejecución', five_hour: { gasto: 8 }, seven_day: { gasto: 1.5 } })
  // Invariante de LIMITES.md: la suma de las fases es el gasto total.
  for (const k of ['five_hour', 'seven_day']) assert.equal(total(fases, k), gastoDeLimites([a])[k].gasto)
  assert.equal(resumenDeFases(fases), 'exploración: 5h +2 % · sem +0,5 % | plan+aprobación+ejecución: 5h +8 % · sem +1,5 % | revisión: 5h +4 % · sem +0,5 %')
  // La fase unida (ejecución+revisión) y la fase suelta del mismo paso (ejecución, tras volver al 5) quedan aparte y suman el total.
  const b = { fases: [l(0, 10, 1), l(5, 12, 1), l(6, 'sinDato'), l(5, 20, 2)] }
  b.inicio = b.fases[0]
  b.fin = l(7, 22, 2)
  const unida = fasesDeLimites([b])
  assert.deepEqual(unida.map((f) => f.fase), ['exploración', 'ejecución', 'ejecución+revisión'])
  assert.equal(total(unida, 'five_hour'), gastoDeLimites([b]).five_hour.gasto)
  // La primera lectura sin dato no tiene con quién unirse: queda sola, s/d.
  const c = { fases: [l(5, 'sinDato'), l(6, 30, 5)] }
  c.inicio = c.fases[0]
  c.fin = l(6, 33, 5.5)
  assert.deepEqual(fasesDeLimites([c]).find((f) => f.fase === 'ejecución').five_hour, { gasto: null, motivo: 'sin dato' })
})

test('límites: el preflight, cada --paso, --reanudar y el cierre anotan el % gastado en la fila del flujo', () => {
  const futuro = (h) => new Date(Date.now() + h * 3_600_000).toISOString()
  const R5 = futuro(3)
  const R5b = futuro(4.5)
  const R7 = futuro(72)
  const snapshot = (h, s, r5 = R5) => fs.writeFileSync(process.env.QCC_LIMITES, JSON.stringify({ t: new Date().toISOString(), five_hour: { pct: h, resetsAt: r5 }, seven_day: { pct: s, resetsAt: R7 } }))
  try {
    // Sesión A: el preflight lee 40/10 y un --paso posterior, 45/12.
    snapshot(40, 10)
    const { raiz, entorno, estadoJson } = repoConPlanGuardado('limites', ['S1 · Tarea\n- Crítica: no\n- Archivos permitidos: src/a.ts\n- Hecho cuando: x\n- Tests: t\n- Riesgos: r\n- Reversión: v'])
    assert.equal(estadoJson().limites[0].inicio.five_hour.pct, 40)
    // Una lectura por cambio de paso: 0 (el preflight), 2 y 5; el segundo --paso 5 solo pone al día el fin.
    snapshot(42, 11)
    estadoEn(raiz, ['--estado', '--paso', '2'], entorno)
    snapshot(44, 12)
    estadoEn(raiz, ['--estado', '--paso', '5'], entorno)
    snapshot(45, 12)
    estadoEn(raiz, ['--estado', '--paso', '5'], entorno)
    assert.equal(estadoJson().limites[0].fin.five_hour.pct, 45)
    assert.deepEqual(estadoJson().limites[0].fases.map((l) => [l.paso, l.five_hour.pct]), [[0, 40], [2, 42], [5, 44]])
    // Sin snapshot, el cambio de paso igual deja su lectura (sin dato) y el fin no se toca; con el snapshot de vuelta, sigue.
    fs.rmSync(process.env.QCC_LIMITES, { force: true })
    estadoEn(raiz, ['--estado', '--paso', '6'], entorno)
    assert.equal(estadoJson().limites[0].fases.at(-1).sinDato, 'sin snapshot del panel')
    assert.equal(estadoJson().limites[0].fin.five_hour.pct, 45)
    snapshot(45, 12)
    estadoEn(raiz, ['--estado', '--paso', '5'], entorno)
    assert.deepEqual(estadoJson().limites[0].fases.map((l) => l.paso), [0, 2, 5, 6, 5])
    // Sesión B, tras el reinicio de la ventana de 5 h: otro tramo, 3 → 10 y 20 → 22. Lo de entre sesiones no cuenta.
    snapshot(3, 20, R5b)
    const b = { ...entorno, CLAUDE_CODE_SESSION_ID: 'sesion-b' }
    assert.match(estadoEn(raiz, ['--reanudar', '--paso', '5'], b).salida, /REANUDADO/)
    assert.equal(estadoJson().limites.length, 2)
    // El tramo nuevo empieza en la fase del paso que dice SIGUE (el plan no se aprobó: 4).
    assert.deepEqual(estadoJson().limites[1].fases.map((l) => [l.paso, l.five_hour.pct]), [[4, 3]])
    snapshot(10, 22, R5b)
    const cierre = estadoEn(raiz, ['--cambios', '--global', '--paso', '7', '--resultado', 'COMPLETO'], b).salida
    assert.match(cierre, /^LÍMITES: 5h \+12 % · sem \+4 %$/m)
    // La lectura sin dato (paso 6) une ejecución y revisión: 44 → 45 (+1); la ejecución que sigue (45 → 45) suma +0.
    assert.match(cierre, /^LÍMITES POR FASE: exploración: 5h \+2 % · sem \+1 % \| plan: 5h \+2 % · sem \+1 % \| aprobación: 5h \+7 % · sem \+2 % \| ejecución: 5h \+0 % · sem \+0 % \| ejecución\+revisión: 5h \+1 % · sem \+0 %$/m)
    // El 7 no abre fase: lo cierra el fin del tramo.
    assert.deepEqual(estadoJson().limites[1].fases.map((l) => l.paso), [4])
    const fila = fs.readFileSync(path.join(path.dirname(registroDe(raiz)), 'flujos.jsonl'), 'utf8').trimEnd().split('\n').map((l) => JSON.parse(l)).filter((f) => f.raiz === raiz).at(-1)
    assert.deepEqual({ five_hour: fila.limites.five_hour, seven_day: fila.limites.seven_day }, { five_hour: { gasto: 12 }, seven_day: { gasto: 4 } })
    assert.deepEqual(fila.limites.tramos.map((t) => [t.inicio.five_hour.pct, t.fin.five_hour.pct, t.fin.five_hour.resetsAt]), [[40, 45, R5], [3, 10, R5b]])
    assert.deepEqual(fila.limites.fases.find((f) => f.fase === 'aprobación'), { fase: 'aprobación', five_hour: { gasto: 7 }, seven_day: { gasto: 2 } })
    assert.deepEqual(fila.limites.fases.map((f) => f.fase), ['exploración', 'plan', 'aprobación', 'ejecución', 'ejecución+revisión'])
  } finally {
    fs.rmSync(process.env.QCC_LIMITES, { force: true })
  }
})

test('costos: el cierre desde otra cuenta suma la primera sesión, que está en la cuenta de A', () => {
  const { raiz, en, turno, texto, usuario, escribir, opciones } = transcripts('repo-metricas-otra-cuenta')
  const jsonl = (filas) => filas.map((f) => JSON.stringify(f)).join('\n') + '\n'
  const bash = (id, comando) => ({ type: 'tool_use', id, name: 'Bash', input: { command: comando } })
  const ESTADO = 'node ~/.claude/plugins/cache/qcc/impl/0.1.0/herramientas/estado.mjs'
  const base = 'abc123'
  // Cuenta A: el /impl original (3 pedidos).
  escribir([
    usuario(0, '<command-name>/impl</command-name><command-args>pedido original entero</command-args>'),
    turno('a1', 10, [bash('b0', `${ESTADO} --paso 0`)]),
    turno('a2', 300, [bash('b5', `${ESTADO} --base --sub 1 --paso 5`)]),
    turno('a3', 600, [texto('cortado')]),
  ])
  const archivoA = path.join(opciones(0).proyectos, path.resolve(raiz).replace(/[^a-zA-Z0-9]/g, '-'), 's1.jsonl')
  // Cuenta B: otra carpeta projects/ con solo el transcript reanudado, que lleva la marca BASE_GLOBAL.
  const claudeB = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-config-b-'))
  temporales.push(claudeB)
  const carpetaB = path.join(claudeB, 'projects', path.resolve(raiz).replace(/[^a-zA-Z0-9]/g, '-'))
  fs.mkdirSync(carpetaB, { recursive: true })
  const archivoB = path.join(carpetaB, 's2.jsonl')
  fs.writeFileSync(archivoB, jsonl([
    usuario(4200, '<command-name>/impl</command-name><command-args>reanudar</command-args>'),
    usuario(4205, `<system-reminder>BASE_GLOBAL=${base}</system-reminder>`),
    turno('b1', 4210, [bash('c0', `${ESTADO} --reanudar --paso 6`)]),
    turno('b2', 4400, [bash('c7', `${ESTADO} --cambios --global --paso 7`)]),
  ]))
  const sesiones = [{ id: 's1', transcript: archivoA, desde: en(0) }, { id: 's2', transcript: archivoB, desde: en(4210) }]
  const m = metricasDelFlujo(raiz, en(0), { ...opciones(4500), proyectos: path.join(claudeB, 'projects'), base, sesiones })
  assert.equal(m.sesiones, 2)
  assert.equal(m.pedido, 'pedido original entero')
  assert.equal(m.sesion, archivoB)
  assert.equal(m.costo.roles.orquestador.pedidos, 5)
  assert.equal(m.costo.roles.orquestador.tokens.salida, 500)
  assert.equal(m.tiempos.corte, 3600)

  // Sin `transcript` en sesiones[0]: la búsqueda de siempre en la carpeta de B (solo ve la reanudada).
  const sin = metricasDelFlujo(raiz, en(0), { ...opciones(4500), proyectos: path.join(claudeB, 'projects'), base, sesiones: [{ id: 's1', desde: en(0) }] })
  assert.equal(sin.sesiones, 1)
  assert.equal(sin.sesion, archivoB)
})
