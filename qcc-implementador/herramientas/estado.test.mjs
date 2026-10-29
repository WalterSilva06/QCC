// Casos de estado.mjs (preflight, planes, fotos, cierre), de la config del flujo y de instalar.mjs.
// Correr: node --test qcc-implementador/herramientas/estado.test.mjs

import { PRUEBAS, repo, ESTADO, temporales, estadoEn, estadoCon, ev, hook, filasDe, borrarRegistro, VERIFICAR, escribirCmd, limpiar } from './pruebas-comun.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { registroDe, flujoDe, regexDeExterno } from './guardia.mjs'
import { listaPermitidos, lotesDe, opcionesDe, tokensDe, anotarFlujo, filaDelFlujo, permitidosDe, criticosDe, fusionarPlanes, partesDelPlan, agruparPorCarpeta, mapaDelRepo, decisionesDelPlan, contextoDelProyecto, fusionarExploraciones, techoDeExploradores, topeDeLineas, avisosDeLargo, externoDe, parecenExternas } from './estado.mjs'

test('estado: --cambios y --diff', () => {
  const cambios = (sha) => ['--cambios', sha, '--permitidos', 'src/a.ts']
  const diffDe = (...extra) => (sha) => ['--diff', sha, '--permitidos', 'src/a.ts', ...extra]

  const c = estadoCon({}, cambios)
  assert.match(c.salida, /^ {2}✓ M src\/a\.ts$/m)
  assert.match(c.salida, /^ {2}✗ M dist\/x\.js {3}← FUERA DE ALCANCE$/m)
  assert.match(c.salida, /^CAMBIOS desde \w+ \(2\):$/m)
  assert.match(c.salida, /ALCANCE: FUERA \(1\)\s*$/)
  assert.equal(c.codigo, 0)

  const todo = estadoCon({}, diffDe())
  assert.match(todo.salida, /diff --git a\/src\/a\.ts/)
  assert.match(todo.salida, /diff --git a\/dist\/x\.js/)

  const una = estadoCon({}, diffDe('--', 'src/a.ts'))
  assert.match(una.salida, /diff --git a\/src\/a\.ts/)
  assert.doesNotMatch(una.salida, /diff --git a\/dist\/x\.js/)
})

test('estado: opciones y --paso', () => {
  const aviso = (v) => `--paso ${v} no es un paso (0–7); se ignora`

  assert.deepEqual(opcionesDe([]), {
    modo: 'preflight', base: undefined, desde: undefined, permitidos: [], rutas: [], paso: null, aviso: undefined, tokens: undefined,
    resultado: undefined, agente: undefined, tipo: undefined, ajuste: false, forzar: false,
  })
  assert.equal(opcionesDe(['--cambios', 'abc', '--paso', '7', '--resultado', 'DETENIDO:3']).resultado, 'DETENIDO:3')
  assert.equal(opcionesDe(['--cambios', 'abc', '--resultado']).resultado, '')
  const g = opcionesDe(['--guardar', 'a86c3e', 'plan', '--ajuste', '--paso', '2'])
  assert.deepEqual([g.modo, g.agente, g.tipo, g.ajuste, g.paso], ['guardar', 'a86c3e', 'plan', true, 2])
  const varios = opcionesDe(['--guardar', 'a,b', 'exploracion', '--paso', '2'])
  assert.deepEqual([varios.modo, varios.agente, varios.tipo], ['guardar', 'a,b', 'exploracion'])
  assert.equal(opcionesDe(['--estado', '--paso', '5']).modo, 'estado')
  assert.equal(opcionesDe(['--cancelar', '--paso', '4']).modo, 'cancelar')
  assert.equal(opcionesDe(['--cancelar', '--guardar', 'a', 'plan']).modo, 'cancelar')
  assert.equal(opcionesDe(['--cancelar', '--estado']).modo, 'estado')

  const base = opcionesDe(['--base', '--paso', '5'])
  assert.equal(base.modo, 'base')
  assert.equal(base.paso, 5)
  assert.equal(base.aviso, undefined)

  const c = opcionesDe(['--cambios', 'abc123', '--desde', '2026-10-14T10:00:00.000Z', '--permitidos', 'a,b', '--paso', '6'])
  assert.equal(c.modo, 'cambios')
  assert.equal(c.base, 'abc123')
  assert.equal(c.desde, '2026-10-14T10:00:00.000Z')
  assert.deepEqual(c.permitidos, ['a', 'b'])
  assert.equal(c.paso, 6)

  // --sub y --global: las claves solo aparecen si el flag está, y --cambios no toma una opción como BASE.
  const s = opcionesDe(['--cambios', '--sub', '2', '--paso', '5'])
  assert.deepEqual([s.modo, s.base, s.sub, s.paso, 'global' in s], ['cambios', undefined, 2, 5, false])
  const gl = opcionesDe(['--cambios', '--global'])
  assert.deepEqual([gl.modo, gl.base, gl.global, 'sub' in gl], ['cambios', undefined, true, false])
  assert.equal(opcionesDe(['--cambios', '--sub', 'x']).sub, null)
  assert.equal(opcionesDe(['--cambios', '--sub', '0']).sub, null)
  assert.equal(opcionesDe(['--cambios', '--sub']).sub, null)
  assert.equal(opcionesDe(['--cambios', 'abc123', '--sub', '1']).base, 'abc123')
  assert.equal(opcionesDe(['--base', '--sub', '3']).sub, 3)
  assert.deepEqual(opcionesDe(['--base', '--sub', '1,2']).sub, [1, 2])
  assert.deepEqual(opcionesDe(['--cambios', '--sub', '3,1,2']).sub, [1, 2, 3])
  for (const malo of ['1,1', '1,', ',1', '1,x', '0,1', '1,,2', '1 ,2']) assert.equal(opcionesDe(['--base', '--sub', malo]).sub, null, malo)

  const d = opcionesDe(['--diff', 'abc123', '--', 'x.ts', '--paso', '2'])
  assert.equal(d.modo, 'diff')
  assert.equal(d.base, 'abc123')
  assert.deepEqual(d.rutas, ['x.ts', '--paso', '2'])
  assert.equal(d.paso, null)
  assert.equal(d.aviso, undefined)

  assert.equal(opcionesDe(['--paso', '0']).paso, 0)
  assert.equal(opcionesDe(['--paso', '7']).paso, 7)
  for (const v of ['x', '9', '-1', '2.5']) {
    const o = opcionesDe(['--paso', v])
    assert.equal(o.paso, null)
    assert.equal(o.aviso, aviso(v))
  }
  assert.equal(opcionesDe(['--paso']).paso, null)
  assert.ok(opcionesDe(['--paso']).aviso)

  // Precedencia: --base > --cambios > --diff > preflight.
  assert.equal(opcionesDe(['--diff', 'a', '--cambios', 'b', '--base']).modo, 'base')
  assert.equal(opcionesDe(['--diff', 'a', '--cambios', 'b']).modo, 'cambios')
})

test('estado: --tokens', () => {
  assert.deepEqual(tokensDe('explorador=41000,ejecutor=52000,ejecutor=48000,final=61000'), {
    explorador: [41000],
    ejecutor: [52000, 48000],
    final: [61000],
  })
  for (const v of ['x=1', 'ejecutor=', 'ejecutor=1.5', 'ejecutor', '', undefined, 'ejecutor=1,x=2', 'ejecutor=1,']) {
    assert.equal(tokensDe(v), null, String(v))
  }
  assert.equal(opcionesDe(['--cambios', 'abc', '--tokens', 'ejecutor=1']).tokens, 'ejecutor=1')

  const archivo = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'flujos-')), 'sub', 'flujos.jsonl')
  temporales.push(path.dirname(path.dirname(archivo)))
  anotarFlujo(archivo, { t: 'a', tokens: { ejecutor: [1] } })
  anotarFlujo(archivo, { t: 'b', tokens: { final: [2] } })
  const filas = fs.readFileSync(archivo, 'utf8').trimEnd().split('\n').map((l) => JSON.parse(l))
  assert.deepEqual(filas.map((f) => f.t), ['a', 'b'])

  const sinCierre = estadoCon({}, (sha) => ['--cambios', sha, '--tokens', 'ejecutor=1', '--paso', '6'])
  assert.match(sinCierre.salida, /^AVISO: --tokens solo vale en el cierre \(--cambios … --paso 7\); se ignora$/m)
  assert.match(sinCierre.salida, /ALCANCE: [^\n]*\s*$/)
  const malo = estadoCon({}, (sha) => ['--cambios', sha, '--tokens', 'x=1', '--paso', '7'])
  assert.match(malo.salida, /^AVISO: --tokens x=1 no es rol=n,…; el flujo se anota sin ellos$/m)
  assert.match(malo.salida, /ALCANCE: [^\n]*\s*$/)
})

test('estado: preflight y --paso', () => {
  const config = { verificar: [{ nombre: 'test', cmd: 'echo x' }] }
  const preflight = (r) => {
    assert.match(r.salida, /^PROYECTO: /m)
    assert.match(r.salida, /^RAMA: /m)
    assert.match(r.salida, /^BASE_GLOBAL=\w+ DESDE_GLOBAL=\S+$/m)
    assert.match(r.salida, /^VERIFICACIÓN \(\.claude\/implementador\.json\): echo x$/m)
    assert.equal(r.codigo, 0)
  }

  const sin = estadoCon(config, () => [])
  preflight(sin)
  assert.doesNotMatch(sin.salida, /AVISO/)
  assert.match(sin.salida, /^VERIFICACIÓN \(.*\n^VERIFICACIÓN INICIAL: no se lanzó \(desactivada con FLUJOS_INICIAL=0\)$/m)

  const con = estadoCon(config, () => ['--paso', '0'])
  preflight(con)
  assert.doesNotMatch(con.salida, /AVISO/)

  const base = estadoCon(config, () => ['--base', '--paso', '5'])
  assert.match(base.salida, /^BASE=\w+ DESDE=\S+$/m)
  assert.doesNotMatch(base.salida, /AVISO/)
  assert.equal(base.codigo, 0)

  const malo = estadoCon(config, () => ['--paso', 'x'])
  assert.match(malo.salida, /^AVISO: --paso x no es un paso \(0–7\); se ignora$/m)
  preflight(malo)
})

test('estado: mapaDelRepo resume por carpeta con tope', () => {
  const cabecera = (n, k) => [
    `MAPA · ${n} archivos (git ls-files: versionados y nuevos, sin ignorados) · ${k} carpeta(s)`,
    'Las carpetas resumidas se exploran con Glob; lo ignorado por git no aparece.',
  ]

  // Pocas rutas: una línea por carpeta, con los nombres; la raíz es ./.
  assert.deepEqual(mapaDelRepo(['README.md', 'docs/x.md', 'src/a.ts', 'src/b.ts']), [
    ...cabecera(4, 3),
    './ — README.md',
    'docs/ — x.md',
    'src/ — a.ts, b.ts',
  ])
  assert.deepEqual(mapaDelRepo([]), cabecera(0, 0))

  // Con subcarpetas dentro del grupo: cuenta, subcarpetas y extensiones más frecuentes.
  assert.deepEqual(mapaDelRepo(['src/a/x.ts', 'src/b/y.ts', 'src/b/z.md', 'src/w.ts'], 2), [
    ...cabecera(4, 1),
    'src/ — 4 archivos en 2 subcarpetas (.ts 3, .md 1)',
  ])

  // 30 archivos en una carpeta: 25 nombres y el resto contado.
  const treinta = Array.from({ length: 30 }, (_, i) => `docs/f${String(i + 1).padStart(2, '0')}.md`)
  const [, , linea] = mapaDelRepo(treinta)
  assert.equal(linea, `docs/ — ${treinta.slice(0, 25).map((r) => r.slice(5)).join(', ')}, … y 5 más`)

  // 400 carpetas bajo a/: el resumen cabe en el tope.
  const muchas = Array.from({ length: 400 }, (_, i) => `a/${i}/b/f.ts`).sort()
  const resumen = mapaDelRepo(muchas)
  assert.ok(resumen.length <= 302, `líneas: ${resumen.length}`)
  assert.equal(resumen[2], 'a/ — 400 archivos en 400 subcarpetas (.ts 400)')

  // Más carpetas de primer nivel que el tope: se cortan y la última línea cuenta lo que falta.
  const raices = Array.from({ length: 310 }, (_, i) => `d${i}/f.ts`).sort()
  const cortado = mapaDelRepo(raices)
  assert.ok(cortado.length <= 302, `líneas: ${cortado.length}`)
  assert.match(cortado.at(-1), /^… y \d+ carpetas más \(\d+ archivos\)$/)
})

test('estado: el preflight deja mapa.md', () => {
  const config = { verificar: [{ nombre: 'test', cmd: 'echo x' }] }
  const { raiz, salida } = estadoCon(config, () => ['--paso', '0'], {
    '.gitignore': 'ignorado.txt\n',
    'ignorado.txt': 'i\n',
    'docs/canción.md': 'c\n',
  })
  const linea = /^MAPA: (.*mapa\.md) \(\d+ archivos\)$/m.exec(salida)
  assert.ok(linea, salida)
  assert.equal(linea[1], path.join(flujoDe(raiz), 'mapa.md'))
  // Va justo después de FLUJO.
  assert.match(salida, /^FLUJO: .*\n^MAPA: /m)
  const mapa = fs.readFileSync(linea[1], 'utf8')
  assert.match(mapa, /^docs\/ — canción\.md$/m)
  assert.doesNotMatch(mapa, /"|\\\d{3}/)
  assert.doesNotMatch(mapa, /ignorado\.txt/)

  // Con la carpeta ocupada no se toca el mapa.
  fs.writeFileSync(path.join(raiz, 'nuevo.ts'), 'n\n')
  assert.match(estadoEn(raiz, ['--paso', '0']).salida, /^MAPA: ninguno/m)
  assert.doesNotMatch(fs.readFileSync(linea[1], 'utf8'), /nuevo\.ts/)

  // Con --forzar se rehace e incluye lo nuevo sin commit.
  const forzado = estadoEn(raiz, ['--paso', '0', '--forzar'])
  assert.match(forzado.salida, /^MAPA: .*mapa\.md \(\d+ archivos\)$/m)
  assert.match(fs.readFileSync(linea[1], 'utf8'), /nuevo\.ts/)
  assert.equal(forzado.codigo, 0)
})

test('estado: preflight informa las reglas del proyecto', () => {
  const reglas = (extra) => /^REGLAS DEL PROYECTO: (.*)$/m.exec(estadoCon({}, () => [], extra).salida)?.[1]

  assert.equal(reglas({ '.claude/implementador/clasificacion.md': 'x\n' }), '.claude/implementador/')
  assert.equal(reglas({ '.claude/implementador.md': 'x\n' }), '.claude/implementador.md')
  assert.equal(
    reglas({}),
    'ninguna (no hay .claude/qcc-implementador/ ni .claude/qcc-implementador.md; rigen CLAUDE.md y las reglas comunes)',
  )
  assert.equal(
    reglas({ '.claude/implementador/clasificacion.md': 'x\n', '.claude/implementador.md': 'x\n' }),
    '.claude/implementador/',
  )
})

test('reglas: .claude/qcc-implementador/ manda sobre .claude/implementador/', () => {
  const reglas = (extra) => /^REGLAS DEL PROYECTO: (.*)$/m.exec(estadoCon({}, () => [], extra).salida)?.[1]
  const vieja = { '.claude/implementador/clasificacion.md': 'V\n', '.claude/implementador.md': 'V\n' }

  assert.equal(reglas({ '.claude/qcc-implementador/clasificacion.md': 'N\n' }), '.claude/qcc-implementador/')
  assert.equal(reglas({ '.claude/qcc-implementador.md': 'N\n' }), '.claude/qcc-implementador.md')
  // Con las dos a la vez manda la nueva (carpeta antes que .md) y las viejas no se mezclan.
  assert.equal(reglas({ ...vieja, '.claude/qcc-implementador/clasificacion.md': 'N\n' }), '.claude/qcc-implementador/')
  assert.equal(reglas({ ...vieja, '.claude/qcc-implementador.md': 'N\n' }), '.claude/qcc-implementador.md')
  assert.equal(reglas({ '.claude/qcc-implementador/clasificacion.md': 'N\n', '.claude/qcc-implementador.md': 'N\n' }), '.claude/qcc-implementador/')

  const texto = (extra) => estadoCon({}, () => ['--reglas'], extra).salida.trimEnd()
  assert.equal(
    texto({ ...vieja, '.claude/qcc-implementador/clasificacion.md': 'N\n' }),
    'REGLAS DEL PROYECTO: .claude/qcc-implementador/\n\nN',
  )
  assert.equal(
    texto({ ...vieja, '.claude/qcc-implementador.md': 'N\n' }),
    'REGLAS DEL PROYECTO: .claude/qcc-implementador.md\n\nN',
  )
})

test('estado: --reglas da las reglas del orquestador, sin avisos falsos', () => {
  const reglas = (extra) => estadoCon({}, () => ['--reglas'], extra).salida.trimEnd()
  const carpeta = (archivos) => Object.fromEntries(Object.entries(archivos).map(([a, t]) => [`.claude/implementador/${a}`, t]))

  const carpetaUno = 'REGLAS DEL PROYECTO: .claude/implementador/\n\n'
  assert.equal(reglas(carpeta({ 'clasificacion.md': 'C\n', 'buscar.md': 'B\n', 'planificar.md': 'P\n', 'ejecutor.md': 'E\n' })), `${carpetaUno}C\n\nB\n\nP`)
  // Con la carpeta y un archivo faltante va lo que hay, sin decir que el proyecto no tiene reglas.
  assert.equal(reglas(carpeta({ 'clasificacion.md': 'C\n', 'planificar.md': 'P\n' })), `${carpetaUno}C\n\nP`)
  assert.match(reglas(carpeta({ 'ejecutor.md': 'E\n' })), /^REGLAS DEL PROYECTO: \.claude\/implementador\/\n\n\(no tiene clasificacion\.md, buscar\.md ni planificar\.md/)
  assert.equal(reglas({ '.claude/implementador.md': 'U\n' }), 'REGLAS DEL PROYECTO: .claude/implementador.md\n\nU')
  assert.match(reglas({}), /^REGLAS DEL PROYECTO: ninguna\n\n\(Este proyecto no tiene \.claude\/qcc-implementador\/ ni \.claude\/qcc-implementador\.md/)
})

/** `CLAUDE_CONFIG_DIR` falso con esos agentes en `agents/` (`{ archivo: texto }`); devuelve la carpeta. */
function claudeConAgentes(agentes) {
  const dir = fs.mkdtempSync(path.join(PRUEBAS, 'claude-agentes-'))
  fs.mkdirSync(path.join(dir, 'agents'))
  for (const [archivo, texto] of Object.entries(agentes)) fs.writeFileSync(path.join(dir, 'agents', archivo), texto)
  return dir
}

test('preflight: la autoprueba lee hooks/hooks.json y avisa de una copia vieja de los agentes en ~/.claude', () => {
  const guardia = (agentes) => /^GUARDIA: (.*)$/m.exec(estadoCon({}, () => [], {}, { CLAUDE_CONFIG_DIR: claudeConAgentes(agentes) }).salida)?.[1] ?? ''

  // Los agentes viven en el plugin: no hace falta ningún agente instalado en ~/.claude.
  assert.equal(guardia({}), 'OK')
  assert.equal(guardia({ 'qcc-ejecutor.md': 'x\n' }), 'OK con avisos: ~/.claude/agents/qcc-ejecutor.md es una copia vieja del agente: instalar.mjs --limpiar la archiva')
  // Un agente del usuario con otro nombre no es del flujo.
  assert.equal(guardia({ 'ejecutor.md': 'x\n' }), 'OK')
})

test('estado --guia: comun.md y pasos.md salen con ${CLAUDE_PLUGIN_ROOT} resuelto a la carpeta del plugin, con /', () => {
  const raiz = fileURLToPath(new URL('..', import.meta.url)).replaceAll('\\', '/').replace(/\/$/, '')
  for (const guia of ['comun', 'pasos']) {
    const r = spawnSync(process.execPath, [ESTADO, '--guia', guia], { encoding: 'utf8' })
    assert.equal(r.status, 0)
    assert.doesNotMatch(r.stdout, /\$\{CLAUDE_PLUGIN_ROOT\}/)
    assert.ok(r.stdout.includes(`node "${raiz}/herramientas/estado.mjs"`), guia)
  }
  assert.equal(opcionesDe(['--guia', 'comun']).modo, 'guia')
  assert.equal(opcionesDe(['--guia', 'comun']).guia, 'comun')
  // Otro nombre no es una guía (y no sale de la carpeta con `..`).
  for (const mala of ['otro', '../instalar', '']) {
    const r = spawnSync(process.execPath, [ESTADO, '--guia', mala], { encoding: 'utf8' })
    assert.equal(r.status, 2)
    assert.match(r.stdout, /^ERROR: --guia pide comun o pasos/)
  }
})

const PLAN = `PREGUNTAS: ¿algo?
PLAN · Prueba
Clasificación: sin criterios — solo un ajuste
Objetivo: algo verificable
Fuera de alcance: nada

S1 · Cambiar la guardia
- Crítica: no — solo un ajuste
- Archivos permitidos: \`flujos/herramientas/guardia.mjs\`, README.md (índice)
- Hecho cuando: node --test → verde
- Tests: guardia.test.mjs
- Riesgos: ninguno → n/a
- Reversión: restaurar desde la base

**S2 · Documentar**
- **Crítica:** no
- **Archivos permitidos:** flujos/agents/ejecutor.md
- **Hecho cuando:** grep x → ≥ 1

Verificación final: verificar.mjs + revisión final (siempre)
Queda para ti: nada
Costo: 2 ejecutor(es) · revisión final`

const CRITICOS = [
  { rutas: ['flujos/'], excepto: ['flujos/agents/*.md'], criterios: [1, 5], motivo: 'm' },
  { rutas: ['flujos/agents/*.md'], criterios: [1, 5], si: 'cambia su frontmatter' },
]

/** `CLAUDE_CONFIG_DIR` falso con un transcript por agente: `{ id: texto final }`. */
function transcripts(agentes) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-config-'))
  temporales.push(dir)
  for (const [id, texto] of Object.entries(agentes)) {
    const sub = path.join(dir, 'projects', 'otro-proyecto', 'sesion-1', 'subagents')
    fs.mkdirSync(sub, { recursive: true })
    const filas = [
      { type: 'user', message: { role: 'user', content: 'PEDIDO: x' } },
      { type: 'assistant', message: { id: 'm1', content: [{ type: 'text', text: 'leyendo' }, { type: 'tool_use', id: 't1', name: 'Read', input: {} }] } },
      { type: 'assistant', message: { id: 'm2', content: [{ type: 'thinking', thinking: '' }] } },
      { type: 'assistant', message: { id: 'm2', content: [{ type: 'text', text: texto }] } },
    ]
    fs.writeFileSync(path.join(sub, `agent-${id}.jsonl`), filas.map((f) => JSON.stringify(f)).join('\n') + '\n')
  }
  return dir
}

test('estado: permitidos, rutas críticas y fusión de un re-plan (puras)', () => {
  assert.deepEqual(permitidosDe('`flujos/herramientas/estado.mjs` (modo nuevo), README.md — índice, ninguno'), ['flujos/herramientas/estado.mjs', 'README.md'])
  assert.deepEqual(criticosDe('flujos/herramientas/guardia.mjs', CRITICOS), { fijos: [1, 5], condicionales: [] })
  assert.deepEqual(criticosDe('flujos/agents/ejecutor.md', CRITICOS), { fijos: [], condicionales: [{ ns: [1, 5], si: 'cambia su frontmatter' }] })
  assert.deepEqual(criticosDe('README.md', CRITICOS), { fijos: [], condicionales: [] })

  const p = partesDelPlan(PLAN)
  assert.deepEqual(p.subtareas.map((s) => [s.n, s.objetivo]), [[1, 'Cambiar la guardia'], [2, 'Documentar']])
  assert.equal(p.pie.length, 3)

  const fusion = fusionarPlanes(PLAN, 'S2 · Documentar mejor\n- Crítica: sí (#1, #5)\nSin cambios: S1')
  assert.match(fusion, /^S1 · Cambiar la guardia$/m)
  assert.match(fusion, /^S2 · Documentar mejor\n- Crítica: sí \(#1, #5\)\n\nVerificación final:/m)
  assert.doesNotMatch(fusion, /Sin cambios|\*\*S2 · Documentar\*\*/)
  assert.match(fusion, /^Clasificación: sin criterios/m)
})

test('estado: decisionesDelPlan replica pasos.md y comun.md', () => {
  const sub = (n, permitidos, critica = 'no', fijos = []) => ({ n, critica, permitidos, fijos })
  const SIN = 'sin criterios — solo texto'

  // Sin criterios, 2 subtareas `no` y solo .md: un ciclo, nada crítico.
  const a = decisionesDelPlan({ clasificacion: SIN, subtareas: [sub(1, ['README.md']), sub(2, ['docs/x.MD'])], pedidos: [] })
  assert.equal(a.ciclos, 'CICLOS DE LA REVISIÓN FINAL: 1')
  assert.equal(a.critico, 'CRÍTICO: ninguno')
  assert.equal(a.aspectos, 'ASPECTOS: contratos, tipos y documentación')

  // El número de subtareas no cambia las decisiones: tres o ninguna siguen sin criterios.
  const tres = decisionesDelPlan({ clasificacion: SIN, subtareas: [sub(1, ['a.md']), sub(2, ['b.md']), sub(3, ['c.md'])] })
  assert.equal(tres.ciclos, 'CICLOS DE LA REVISIÓN FINAL: 1')
  assert.equal(decisionesDelPlan({ clasificacion: SIN, subtareas: [] }).ciclos, 'CICLOS DE LA REVISIÓN FINAL: 1')

  // Sin Clasificación cuenta como CRÍTICO y mira los casos borde si no es solo texto.
  const sinClas = decisionesDelPlan({ clasificacion: null, subtareas: [sub(1, ['flujos/herramientas/estado.mjs'])] })
  assert.equal(sinClas.ciclos, 'CICLOS DE LA REVISIÓN FINAL: 2')
  assert.equal(sinClas.critico, 'CRÍTICO: sin Clasificación en el plan (cuenta como CRÍTICO)')
  assert.match(sinClas.aspectos, /casos borde y seguridad/)
  assert.doesNotMatch(decisionesDelPlan({ clasificacion: null, subtareas: [sub(1, ['README.md'])] }).aspectos, /casos borde/)

  // CRÍTICO (#1, #5) cita #1: casos borde solo si el cambio no es solo texto.
  const solo = decisionesDelPlan({ clasificacion: 'CRÍTICO (#1, #5) — x', subtareas: [sub(1, ['README.md'], 'sí')] })
  assert.equal(solo.critico, 'CRÍTICO: #1, #5 — x · primero S1')
  assert.doesNotMatch(solo.aspectos, /casos borde/)
  assert.equal(solo.ciclos, 'CICLOS DE LA REVISIÓN FINAL: 2')
  assert.match(decisionesDelPlan({ clasificacion: 'CRÍTICO (#1, #5) — x', subtareas: [sub(1, ['a.mjs'], 'sí')] }).aspectos, /^ASPECTOS: contratos, tipos y documentación, casos borde y seguridad$/)

  // CRÍTICO (#5) no cita ninguno de #1, #2, #3, #6, #9: sin casos borde.
  assert.doesNotMatch(decisionesDelPlan({ clasificacion: 'CRÍTICO (#5)', subtareas: [sub(1, ['a.mjs'], 'sí')] }).aspectos, /casos borde/)
  for (const n of [2, 3, 6, 9]) assert.match(decisionesDelPlan({ clasificacion: `CRÍTICO (#${n})`, subtareas: [sub(1, ['a.mjs'], 'sí')] }).aspectos, /casos borde/, `#${n}`)

  // `critica` ausente o que no empieza con «no» cuenta como sí; «nota» no es «no».
  assert.match(decisionesDelPlan({ clasificacion: SIN, subtareas: [sub(1, ['a.md'], null)] }).critico, /· primero S1$/)
  assert.match(decisionesDelPlan({ clasificacion: SIN, subtareas: [sub(1, ['a.md'], 'nota')] }).critico, /· primero S1$/)
  assert.equal(decisionesDelPlan({ clasificacion: SIN, subtareas: [sub(1, ['a.md'], 'No — texto')] }).critico, 'CRÍTICO: ninguno')
  // Una subtarea `no` con rutas críticas fijas pasa a sí.
  const fijas = decisionesDelPlan({ clasificacion: SIN, subtareas: [sub(1, ['flujos/x.mjs'], 'no', [1])] })
  assert.equal(fijas.ciclos, 'CICLOS DE LA REVISIÓN FINAL: 2')
  assert.match(fijas.critico, /· primero S1$/)

  // Sin criterios con pedidos [1, 5]: CRÍTICO, dos ciclos y las rutas que lo piden.
  const pedidos = decisionesDelPlan({ clasificacion: SIN, subtareas: [sub(1, ['a.md'])], pedidos: [{ n: 1, ruta: 'flujos/a.mjs' }, 5] })
  assert.equal(pedidos.ciclos, 'CICLOS DE LA REVISIÓN FINAL: 2')
  assert.equal(pedidos.critico, 'CRÍTICO: #1, #5 — solo texto · rutas críticas: #1 (flujos/a.mjs), #5')
  // Si la Clasificación ya cita el criterio, no se repite como ruta crítica.
  assert.doesNotMatch(decisionesDelPlan({ clasificacion: 'CRÍTICO (#1) — y', subtareas: [sub(1, ['a.mjs'])], pedidos: [1] }).critico, /rutas críticas/)
  // Una Clasificación con texto extra no es «sin criterios»; un guion largo en la razón se conserva.
  assert.equal(decisionesDelPlan({ clasificacion: 'casi sin criterios', subtareas: [sub(1, ['a.md'])] }).ciclos, 'CICLOS DE LA REVISIÓN FINAL: 2')
  assert.equal(decisionesDelPlan({ clasificacion: 'CRÍTICO (#3) – uno — dos', subtareas: [sub(1, ['a.mjs'])] }).critico, 'CRÍTICO: #3 — uno — dos')

  // Tests entre los permitidos: `tests` en ASPECTOS (carpeta o sufijo, sin distinguir mayúsculas).
  for (const ruta of ['flujos/herramientas/guardia.test.mjs', 'qcc-panel/tests/panel.tsx', 'src/__tests__/a.ts', 'x/Foo.SPEC.ts', 'a_test.py']) {
    assert.match(decisionesDelPlan({ clasificacion: SIN, subtareas: [sub(1, [ruta])] }).aspectos, /, tests/, ruta)
  }
  assert.doesNotMatch(decisionesDelPlan({ clasificacion: SIN, subtareas: [sub(1, ['src/contest.ts', 'latest/a.ts'])] }).aspectos, /tests/)
})

test('estado: --guardar arma el plan, un S<n>.md por subtarea y avisa las rutas críticas', () => {
  const claude = transcripts({ planuno: PLAN, explora: 'ARCHIVOS\n- a.ts:1 — x', ajuste: 'S1 · Cambiar la guardia\n- Crítica: sí (#1, #5)\n- Archivos permitidos: flujos/herramientas/guardia.mjs\n- Hecho cuando: verde\n- Tests: t\n- Riesgos: r\n- Reversión: v\nSin cambios: S2' })
  const entorno = { CLAUDE_CONFIG_DIR: claude }
  const { raiz, salida } = estadoCon({ criticos: CRITICOS }, () => ['--guardar', 'planuno', 'plan', '--paso', '2'], {}, entorno)
  const carpeta = flujoDe(raiz)

  assert.match(salida, /^PLAN: 2 subtarea\(s\) · Clasificación: sin criterios — solo un ajuste$/m)
  assert.match(salida, /^S1 · Cambiar la guardia · Crítica: no — solo un ajuste · permitidos: flujos\/herramientas\/guardia\.mjs, README\.md → .*S1\.md$/m)
  assert.match(salida, /^RUTAS CRÍTICAS: #1 \(flujos\/herramientas\/guardia\.mjs\), #5 \(flujos\/herramientas\/guardia\.mjs\)$/m)
  assert.match(salida, /^ {2}- S1 · Crítica: no, pero sus rutas críticas piden #1, #5: debe ser sí$/m)
  assert.match(salida, /^ {2}- S2 · flujos\/agents\/ejecutor\.md: crítica \(#1, #5\) si cambia su frontmatter$/m)
  assert.match(salida, /^ {2}- S2 · falta «Tests»$/m)
  assert.match(salida, /^ {2}- Clasificación: dice «sin criterios», pero las rutas críticas piden #1, #5$/m)
  const s1 = fs.readFileSync(path.join(carpeta, 'S1.md'), 'utf8')
  assert.match(s1, /^PLAN · Prueba$/m)
  assert.match(s1, /^Objetivo: algo verificable$/m)
  assert.match(s1, /^- Hecho cuando: node --test → verde$/m)
  assert.doesNotMatch(s1, /Documentar|PREGUNTAS/)
  assert.equal(JSON.parse(fs.readFileSync(path.join(carpeta, 'estado.json'), 'utf8')).subtareas.length, 2)
  assert.match(salida, /^DECISIONES \(con los AVISOS resueltos a lo más estricto\):$/m)
  assert.match(salida, /^CICLOS DE LA REVISIÓN FINAL: 2$/m)
  assert.match(salida, /^CRÍTICO: #1, #5 /m)
  assert.match(salida, /^ASPECTOS: .*casos borde y seguridad/m)
  const decisiones = JSON.parse(fs.readFileSync(path.join(carpeta, 'estado.json'), 'utf8')).decisiones
  assert.deepEqual(Object.keys(decisiones).sort(), ['aspectos', 'ciclos', 'critico'])
  assert.match(decisiones.critico, /^CRÍTICO: #1, #5 — solo un ajuste · rutas críticas: #1 \(flujos\/herramientas\/guardia\.mjs\), #5 \(flujos\/herramientas\/guardia\.mjs\) · primero S1$/)

  // Un re-plan con --ajuste reemplaza solo S1; la Clasificación sigue siendo la del plan.
  const ajuste = estadoEn(raiz, ['--guardar', 'ajuste', 'plan', '--ajuste', '--paso', '4'], entorno).salida
  assert.match(ajuste, /^S1 · Cambiar la guardia · Crítica: sí \(#1, #5\) · permitidos: flujos\/herramientas\/guardia\.mjs → /m)
  assert.match(ajuste, /^S2 · Documentar · Crítica: no/m)
  assert.doesNotMatch(ajuste, /S1 · Crítica: no, pero/)
  assert.match(ajuste, /Clasificación: dice «sin criterios»/)

  // La exploración se guarda tal cual; un agente desconocido o un tipo inválido solo avisan.
  assert.match(estadoEn(raiz, ['--guardar', 'explora', 'exploracion', '--paso', '2'], entorno).salida, /^GUARDADO: exploración → .*exploracion\.md$/m)
  assert.equal(fs.readFileSync(path.join(carpeta, 'exploracion.md'), 'utf8'), 'ARCHIVOS\n- a.ts:1 — x\n')
  const nadie = estadoEn(raiz, ['--guardar', 'nadie', 'plan'], entorno)
  assert.match(nadie.salida, /^AVISO: no encontré el informe del agente nadie: despacha copiando su texto, como antes$/m)
  assert.equal(nadie.codigo, 0)
  assert.match(estadoEn(raiz, ['--guardar', 'planuno', 'otro'], entorno).salida, /^AVISO: --guardar <agentId> plan\|exploracion: tipo desconocido «otro»/m)
})

test('estado: --base --sub y --cambios --sub/--global toman la foto y los permitidos del flujo', () => {
  const subtarea = (n, permitidos) => `S${n} · Tarea ${n}\n- Crítica: no\n- Archivos permitidos: ${permitidos}\n- Hecho cuando: x\n- Tests: t\n- Riesgos: r\n- Reversión: v`
  const plan = `PLAN · Fotos\nClasificación: sin criterios\nObjetivo: probar\n\n${subtarea(1, 'src/a.ts')}\n\n${subtarea(2, 'docs/x.md')}`
  const claude = transcripts({ plano: plan, ajuste: subtarea(1, 'src/a.ts, src/b.ts') })
  const entorno = { CLAUDE_CONFIG_DIR: claude }
  const raiz = repo('foto-sub', { 'src/a.ts': 'a\n', 'dist/x.js': 'x\n', 'docs/x.md': 'd\n' })
  temporales.push(raiz)
  estadoEn(raiz, ['--paso', '0'], entorno)
  assert.match(estadoEn(raiz, ['--guardar', 'plano', 'plan'], entorno).salida, /^PLAN: 2 subtarea\(s\)/m)

  const foto = estadoEn(raiz, ['--base', '--sub', '1', '--paso', '5'], entorno)
  const f = /^BASE=(\w+) DESDE=(\S+)$/m.exec(foto.salida)
  assert.ok(f, foto.salida)
  assert.doesNotMatch(foto.salida, /AVISO/)
  const estadoJson = () => JSON.parse(fs.readFileSync(path.join(flujoDe(raiz), 'estado.json'), 'utf8'))
  assert.deepEqual(estadoJson().bases['1'], { base: f[1], desde: f[2] })
  assert.deepEqual(estadoJson().fotos, [])

  fs.writeFileSync(path.join(raiz, 'src/a.ts'), 'a2\n')
  fs.writeFileSync(path.join(raiz, 'dist/x.js'), 'x2\n')
  const c = estadoEn(raiz, ['--cambios', '--sub', '1', '--paso', '6'], entorno)
  assert.match(c.salida, new RegExp(`^FOTO S1: BASE=${f[1].slice(0, 9)} DESDE=${f[2]} · permitidos: 1 del plan \\+ 0 ampliados$`, 'm'))
  assert.match(c.salida, /^ {2}✓ M src\/a\.ts$/m)
  assert.match(c.salida, /^ {2}✗ M dist\/x\.js {3}← FUERA DE ALCANCE$/m)
  assert.match(c.salida, /ALCANCE: FUERA \(1\)\s*$/)
  assert.equal(c.codigo, 0)
  const ampliado = estadoEn(raiz, ['--cambios', '--sub', '1', '--permitidos', 'dist/x.js,src/a.ts'], entorno).salida
  assert.match(ampliado, /permitidos: 1 del plan \+ 1 ampliados$/m)
  assert.match(ampliado, /ALCANCE: OK\s*$/)

  // Repetir --base --sub conserva la primera foto: no esconde lo que el ejecutor ya editó.
  const otra = estadoEn(raiz, ['--base', '--sub', '1'], entorno).salida
  assert.match(otra, /^AVISO: S1 ya tenía foto; se conserva la primera \(la de antes de su ejecutor\)$/m)
  assert.match(otra, new RegExp(`^BASE=${f[1]} DESDE=${f[2]}$`, 'm'))
  assert.match(estadoEn(raiz, ['--cambios', '--sub', '1'], entorno).salida, /^ {2}✓ M src\/a\.ts$/m)

  // Un re-plan con --ajuste reemplaza las subtareas, pero las fotos siguen.
  const ajustado = estadoEn(raiz, ['--guardar', 'ajuste', 'plan', '--ajuste'], entorno).salida
  assert.match(ajustado, /permitidos: src\/a\.ts, src\/b\.ts/)
  assert.deepEqual(estadoJson().bases['1'], { base: f[1], desde: f[2] })
  assert.match(estadoEn(raiz, ['--cambios', '--sub', '1'], entorno).salida, /permitidos: 2 del plan \+ 0 ampliados$/m)

  // --base sin --sub sigue en `fotos`; --estado lista las dos.
  const sinSub = /^BASE=(\w+) DESDE=(\S+)$/m.exec(estadoEn(raiz, ['--base', '--paso', '5'], entorno).salida)
  assert.deepEqual(estadoJson().fotos, [{ base: sinSub[1], desde: sinSub[2] }])
  estadoEn(raiz, ['--base', '--sub', '2'], entorno)
  const resumen = estadoEn(raiz, ['--estado'], entorno).salida
  assert.match(resumen, new RegExp(`^FOTO 1 \\(--base\\): BASE=${sinSub[1]} DESDE=${sinSub[2]}$`, 'm'))
  assert.match(resumen, new RegExp(`^FOTO S1 \\(--base --sub\\): BASE=${f[1]} DESDE=${f[2]}$`, 'm'))
  assert.match(resumen, /^FOTO S2 \(--base --sub\): BASE=\w+ DESDE=\S+$/m)

  // --estado reimprime las DECISIONES guardadas después de PLAN:
  const decisiones = estadoJson().decisiones
  assert.ok(resumen.indexOf('PLAN:') < resumen.indexOf('DECISIONES (con los AVISOS resueltos a lo más estricto):'))
  for (const l of [decisiones.ciclos, decisiones.critico, decisiones.aspectos]) assert.ok(resumen.includes(`\n${l}\n`), l)

  // Errores: sin foto, argumentos incompatibles y --sub sin número.
  for (const args of [['--sub', '3'], ['--sub', '1', '--global'], ['--sub', 'x'], ['--sub']]) {
    const r = estadoEn(raiz, ['--cambios', ...args], entorno)
    assert.match(r.salida, /^ERROR: /m, args.join(' '))
    assert.equal(r.codigo, 2, args.join(' '))
  }
  assert.match(estadoEn(raiz, ['--cambios', '--sub', '3'], entorno).salida, /^ERROR: sin foto de S3 en la carpeta del flujo: usa --cambios <BASE> --desde <DESDE> --permitidos "…"$/m)
  const conBase = estadoEn(raiz, ['--cambios', f[1], '--sub', '1'], entorno)
  assert.match(conBase.salida, /^ERROR: /m)
  assert.equal(conBase.codigo, 2)
  const conDesde = estadoEn(raiz, ['--cambios', '--sub', '1', '--desde', f[2]], entorno)
  assert.match(conDesde.salida, /^ERROR: /m)
  assert.equal(conDesde.codigo, 2)
  const sinNumero = estadoEn(raiz, ['--base', '--sub', 'x'], entorno)
  assert.match(sinNumero.salida, /^ERROR: /m)
  assert.equal(sinNumero.codigo, 2)

  // --global: la foto del preflight y la unión de los permitidos del plan; en el cierre no avisa de otra BASE.
  const global = estadoEn(raiz, ['--cambios', '--global', '--paso', '7'], entorno)
  assert.match(global.salida, /^FOTO GLOBAL: BASE=\w+ DESDE=\S+ · permitidos: 3 del plan \+ 0 ampliados$/m)
  assert.doesNotMatch(global.salida, /AVISO: el cierre va con BASE_GLOBAL/)
  assert.match(global.salida, /^REVERSIÓN: /m)
  assert.match(global.salida, /ALCANCE: FUERA \(1\)\s*$/)
  assert.equal(global.codigo, 0)

  // Un flujo viejo (sin plan ni fotos por subtarea) pide la forma explícita.
  const vieja = repo('foto-vieja', { 'src/a.ts': 'a\n' })
  temporales.push(vieja)
  estadoEn(vieja, ['--paso', '0'], entorno)
  for (const args of [['--sub', '1'], ['--global']]) {
    const r = estadoEn(vieja, ['--cambios', ...args], entorno)
    assert.match(r.salida, /^ERROR: sin /m, args.join(' '))
    assert.equal(r.codigo, 2, args.join(' '))
  }
  assert.match(estadoEn(vieja, ['--cambios', '--global', '--permitidos', 'src/a.ts'], entorno).salida, /permitidos: 0 del plan \+ 1 ampliados$/m)
})

test('estado: lotesDe junta subtareas independientes cuyos permitidos no se pisan', () => {
  const s = (n, permitidos, depende) => ({ n, permitidos, depende })
  const a = ['a.ts']
  const casos = [
    ['sin subtareas', [], []],
    ['serial: ausente depende de la anterior', [s(1, a), s(2, ['b.ts']), s(3, ['c.ts'])], [[1], [2], [3]]],
    ['null cuenta como ausente', [s(1, a), s(2, ['b.ts'], null)], [[1], [2]]],
    ['independientes', [s(1, a), s(2, ['b.ts'], []), s(3, ['c.ts'], [])], [[1, 2, 3]]],
    ['tope de 3', [s(1, a), s(2, ['b.ts'], []), s(3, ['c.ts'], []), s(4, ['d.ts'], [])], [[1, 2, 3], [4]]],
    ['depende de un miembro del lote', [s(1, a), s(2, ['b.ts'], []), s(3, ['c.ts'], [1])], [[1, 2], [3]]],
    ['el lote siguiente puede seguir sumando', [s(1, a), s(2, ['b.ts'], []), s(3, ['c.ts'], [1]), s(4, ['d.ts'], [])], [[1, 2], [3, 4]]],
    ['carpeta pisa archivo', [s(1, ['src/']), s(2, ['src/a.ts'], [])], [[1], [2]]],
    ['archivo pisa carpeta', [s(1, ['src/a.ts']), s(2, ['src/'], [])], [[1], [2]]],
    ['glob pisa archivo', [s(1, ['docs/*.md']), s(2, ['docs/x.md'], [])], [[1], [2]]],
    ['carpetas disjuntas', [s(1, ['src/']), s(2, ['docs/'], [])], [[1, 2]]],
    ['dos globs que se pisan', [s(1, ['src/**/*.test.ts']), s(2, ['src/a/*.ts'], [])], [[1], [2]]],
    ['dos globs, a la inversa', [s(1, ['src/a/*.ts']), s(2, ['src/**/*.test.ts'], [])], [[1], [2]]],
    ['dos globs de carpetas distintas', [s(1, ['src/a/*.ts']), s(2, ['lib/*.ts'], [])], [[1, 2]]],
    ['dos globs desde la raíz se pisan', [s(1, ['*.md']), s(2, ['docs/*.md'], [])], [[1], [2]]],
    ['un glob contra una carpeta que lo contiene', [s(1, ['src/']), s(2, ['src/a/*.ts'], [])], [[1], [2]]],
    ['pisa a un miembro que no es el primero', [s(1, a), s(2, ['b.ts'], []), s(3, ['b.ts'], [])], [[1, 2], [3]]],
    ['sin permitidos no entra a un lote', [s(1, a), s(2, [], [])], [[1], [2]]],
    ['sin permitidos tampoco recibe a otra', [s(1, []), s(2, ['b.ts'], [])], [[1], [2]]],
    ['sin permitidos corta el lote siguiente', [s(1, a), s(2, [], []), s(3, ['c.ts'], [])], [[1], [2], [3]]],
  ]
  for (const [nombre, subtareas, esperado] of casos) assert.deepEqual(lotesDe(subtareas), esperado, nombre)
})

test('estado: --guardar plan lee «Depende de» y calcula los lotes', () => {
  const subtarea = (n, permitidos, dep) => `S${n} · Tarea ${n}\n- Crítica: no\n- Archivos permitidos: ${permitidos}\n${dep === undefined ? '' : `- Depende de: ${dep}\n`}- Hecho cuando: x\n- Tests: t\n- Riesgos: r\n- Reversión: v`
  const plan = [
    'PLAN · Dependencias\nClasificación: sin criterios\nObjetivo: probar',
    subtarea(1, 'src/a.ts'),
    subtarea(2, 'src/b.ts', 'ninguna'),
    subtarea(3, 'src/c.ts', 'S1, S2'),
    subtarea(4, 'src/d.ts', 'S9'),
    subtarea(5, 'src/e.ts', 'S5'),
    subtarea(6, 'src/f.ts', 'S7'),
    subtarea(7, 'src/g.ts'),
  ].join('\n\n')
  const entorno = { CLAUDE_CONFIG_DIR: transcripts({ plano: plan, ajuste: subtarea(3, 'src/c.ts', 'ninguna') }) }
  const raiz = repo('depende', { 'src/a.ts': 'a\n' })
  temporales.push(raiz)
  estadoEn(raiz, ['--paso', '0'], entorno)
  const salida = estadoEn(raiz, ['--guardar', 'plano', 'plan'], entorno).salida
  const subtareas = () => JSON.parse(fs.readFileSync(path.join(flujoDe(raiz), 'estado.json'), 'utf8')).subtareas
  const depende = (n) => subtareas().find((x) => x.n === n).depende
  assert.equal(depende(1), undefined)
  assert.deepEqual(depende(2), [])
  assert.deepEqual(depende(3), [1, 2])
  for (const n of [4, 5, 6]) {
    assert.equal(depende(n), undefined, `S${n}`)
    assert.match(salida, new RegExp(`^ {2}- S${n} · Depende de: `, 'm'))
  }
  assert.doesNotMatch(salida, /S[123] · Depende de: /)
  assert.doesNotMatch(salida, /falta «Depende de»/)
  assert.match(salida, /^LOTES: S1\+S2 \| S3 \| S4 \| S5 \| S6 \| S7$/m)

  // Con --ajuste la línea se recalcula sobre el plan fusionado: S3 ya no depende de S1 ni de S2.
  const ajuste = estadoEn(raiz, ['--guardar', 'ajuste', 'plan', '--ajuste'], entorno).salida
  assert.match(ajuste, /^LOTES: S1\+S2\+S3 \| S4 \| S5 \| S6 \| S7$/m)
  assert.deepEqual(depende(3), [])
})

/** Una subtarea de plan con `extra` (líneas `- Campo: …\n`) antes de «Hecho cuando» y ese texto como «Hecho cuando». */
const subtareaDePlan = (n, permitidos, { extra = '', hecho = 'x' } = {}) =>
  `S${n} · Tarea ${n}\n- Crítica: no\n- Archivos permitidos: ${permitidos}\n${extra}- Hecho cuando: ${hecho}\n- Tests: t\n- Riesgos: r\n- Reversión: v`
const EXTERNO_SEMILLA = '- Externo: node scripts/seed.mjs · contra la base de pruebas · reversible: sí\n'

/** Un repo con el flujo abierto (preflight) y ese plan guardado; devuelve `{ raiz, entorno, salida, estadoJson }`. */
function repoConPlanGuardado(nombre, subtareas, ajuste) {
  const plan = `PLAN · Externo\nClasificación: sin criterios\nObjetivo: probar\n\n${subtareas.join('\n\n')}`
  const entorno = { CLAUDE_CONFIG_DIR: transcripts({ plano: plan, ...(ajuste ? { ajuste } : {}) }) }
  const raiz = repo(nombre, { 'src/a.ts': 'a\n', 'src/b.ts': 'b\n', 'src/c.ts': 'c\n' })
  temporales.push(raiz)
  estadoEn(raiz, ['--paso', '0'], entorno)
  const salida = estadoEn(raiz, ['--guardar', 'plano', 'plan'], entorno).salida
  const estadoJson = () => JSON.parse(fs.readFileSync(path.join(flujoDe(raiz), 'estado.json'), 'utf8'))
  return { raiz, entorno, salida, estadoJson }
}

test('plan: Externo se guarda en el resumen de la subtarea', () => {
  const { salida, estadoJson } = repoConPlanGuardado('externo-resumen', [
    subtareaDePlan(1, 'src/a.ts'),
    subtareaDePlan(2, 'src/b.ts', { extra: EXTERNO_SEMILLA }),
    subtareaDePlan(3, 'src/c.ts', { extra: '- Externo: curl -s http://localhost:3000/salud · contra el servidor local\n' }),
  ])
  const [s1, s2, s3] = estadoJson().subtareas
  assert.equal('externo' in s1, false)
  assert.deepEqual(s2.externo, { comando: 'node scripts/seed.mjs', servicio: 'la base de pruebas', reversible: true })
  assert.deepEqual(s3.externo, { comando: 'curl -s http://localhost:3000/salud', servicio: 'el servidor local', reversible: false })
  assert.match(salida, /^S2 · Tarea 2 · Crítica: no · permitidos: src\/b\.ts · Externo: node scripts\/seed\.mjs \(reversible: sí\) → .*S2\.md$/m)
  assert.match(salida, /^ {2}- S3 · Externo: le falta «reversible: sí \| no» \(cuenta como no\)$/m)
  assert.doesNotMatch(salida, /S2 · Externo: le falta/)
  // Externo no es obligatorio: sin él no hay «falta».
  assert.doesNotMatch(salida, /falta «Externo»/)
  assert.deepEqual(externoDe('ninguno', 1), {})
  assert.deepEqual(externoDe(null, 1), {})
  assert.deepEqual(externoDe('', 1), {})
  // El plan escribe los comandos entre comillas invertidas: se quitan de los extremos y la guardia puede leerlos.
  const conComillas = externoDe('`gh pr list --json number` · contra GitHub · reversible: sí', 1).externo
  assert.equal(conComillas.comando, 'gh pr list --json number')
  assert.equal(conComillas.servicio, 'GitHub')
  assert.ok(regexDeExterno(conComillas.comando))
  assert.equal(externoDe('``gh pr list`` · contra GitHub · reversible: sí', 1).externo.comando, 'gh pr list')
  assert.equal(externoDe('echo `date` · contra x · reversible: sí', 1).externo.comando, 'echo `date`')
})

test('plan: AVISO si una subtarea sin Externo parece externa', () => {
  const { salida } = repoConPlanGuardado('externo-aviso', [
    subtareaDePlan(1, 'src/a.ts', { hecho: 'node --test → verde' }),
    subtareaDePlan(2, 'src/b.ts', { hecho: 'abre el servidor y Playwright ve el botón' }),
    subtareaDePlan(3, 'src/c.ts', { hecho: 'verde\n  - corre `supabase db push --linked` y responde 200' }),
  ])
  assert.doesNotMatch(salida, /S1 parece externa/)
  assert.match(salida, /^ {2}- S2 parece externa y no está marcada \(menciona «servidor»\)/m)
  assert.match(salida, /^ {2}- S3 parece externa y no está marcada \(menciona «--linked»\)/m)
  for (const [texto, palabra] of [['localhost', 'localhost'], ['curl', 'curl'], ['--env-file', '--env-file'], ['deploy', 'deploy'], ['GET a /salud', 'GET a']]) {
    assert.equal(parecenExternas([`- Tests: prueba con ${texto}`]), palabra, texto)
  }
  assert.equal(parecenExternas(['- Archivos permitidos: curl.ts', '- Reversión: borrar el servidor']), null)
  assert.equal(parecenExternas(['- Riesgos: r', '  - sub: deploy', '- Reversión: v']), 'deploy')
})

test('plan: sin AVISO con Externo marcado', () => {
  const { salida } = repoConPlanGuardado('externo-sin-aviso', [
    subtareaDePlan(1, 'src/a.ts'),
    subtareaDePlan(2, 'src/b.ts', { extra: EXTERNO_SEMILLA, hecho: 'curl a localhost responde 200 contra el servidor' }),
  ])
  assert.doesNotMatch(salida, /parece externa/)
  assert.match(salida, /^AVISOS: ninguno$/m)
})

test('--externo n aprobado anota la aprobación', () => {
  const plan = [subtareaDePlan(1, 'src/a.ts'), subtareaDePlan(2, 'src/b.ts', { extra: EXTERNO_SEMILLA })]
  const otroExterno = subtareaDePlan(2, 'src/b.ts', { extra: '- Externo: node scripts/otro.mjs · contra la base de pruebas · reversible: sí\n' })
  const { raiz, entorno, estadoJson } = repoConPlanGuardado('externo-aprobado', plan, otroExterno)
  assert.equal('externos' in estadoJson(), false)

  const r = estadoEn(raiz, ['--externo', '2', 'aprobado', '--paso', '4'], entorno)
  assert.equal(r.codigo, 0)
  assert.match(r.salida, /^EXTERNO: S2 aprobado$/m)
  const { aprobado, ...resto } = estadoJson().externos['2']
  assert.deepEqual(resto, { comando: 'node scripts/seed.mjs', servicio: 'la base de pruebas', reversible: true })
  assert.ok(Number.isFinite(Date.parse(aprobado)))
  assert.equal(estadoJson().subtareas.length, 2)

  // Repetir la aprobación o ver --estado no la pierde.
  assert.match(estadoEn(raiz, ['--estado'], entorno).salida, /^ {4}Externo: node scripts\/seed\.mjs \(reversible: sí\) · aprobado \S+$/m)
  assert.match(estadoEn(raiz, ['--externo', '2', 'aprobado', '--paso', '4'], entorno).salida, /^EXTERNO: S2 aprobado$/m)

  // Un re-plan que cambia el Externo de S2 anula su aprobación.
  estadoEn(raiz, ['--guardar', 'ajuste', 'plan', '--ajuste'], entorno)
  assert.deepEqual(estadoJson().externos, {})
  assert.equal(estadoJson().subtareas[1].externo.comando, 'node scripts/otro.mjs')
})

test('--externo rechaza una subtarea sin Externo', () => {
  const { raiz, entorno, estadoJson } = repoConPlanGuardado('externo-rechaza', [subtareaDePlan(1, 'src/a.ts'), subtareaDePlan(2, 'src/b.ts', { extra: EXTERNO_SEMILLA })])
  for (const [args, mensaje] of [
    [['1', 'aprobado'], /^ERROR: S1 no tiene «Externo:» en el plan/m],
    [['9', 'aprobado'], /^ERROR: S9 no está en el plan guardado$/m],
    [['2', 'rechazado'], /^ERROR: --externo 2: solo vale «aprobado»/m],
    [['2'], /^ERROR: --externo 2: solo vale «aprobado»/m],
    [['x', 'aprobado'], /^ERROR: --externo necesita el número de la subtarea/m],
  ]) {
    const r = estadoEn(raiz, ['--externo', ...args, '--paso', '4'], entorno)
    assert.match(r.salida, mensaje, args.join(' '))
    assert.equal(r.codigo, 2, args.join(' '))
    assert.doesNotMatch(r.salida, /EXTERNO: S/, args.join(' '))
  }
  assert.equal('externos' in estadoJson(), false)

  // Sin flujo abierto no hay dónde anotar.
  const sinFlujo = repo('externo-sin-flujo', { 'src/a.ts': 'a\n' })
  temporales.push(sinFlujo)
  const s = estadoEn(sinFlujo, ['--externo', '2', 'aprobado', '--paso', '4'], entorno)
  assert.match(s.salida, /^ERROR: el flujo no está abierto/m)
  assert.equal(s.codigo, 2)
  assert.equal(fs.existsSync(path.join(flujoDe(sinFlujo), 'estado.json')), false)

  // opcionesDe: las claves de --externo son condicionales y el modo no se confunde con el preflight.
  assert.equal('externo' in opcionesDe([]) || 'accion' in opcionesDe([]), false)
  const o = opcionesDe(['--externo', '2', 'aprobado', '--paso', '4'])
  assert.deepEqual([o.modo, o.externo, o.accion, o.paso], ['externo', 2, 'aprobado', 4])
  assert.deepEqual([opcionesDe(['--externo']).externo, opcionesDe(['--externo']).accion], [null, ''])
  assert.equal(opcionesDe(['--externo', '0', 'aprobado']).externo, null)
})

test('--base --sub anota la subtarea en curso y --cambios --sub la quita', () => {
  const independiente = (n, ruta) => subtareaDePlan(n, ruta, { extra: '- Depende de: ninguna\n' })
  const { raiz, entorno, estadoJson } = repoConPlanGuardado('en-curso', [subtareaDePlan(1, 'src/a.ts'), independiente(2, 'src/b.ts'), independiente(3, 'src/c.ts')])
  assert.equal('en_curso' in estadoJson(), false)

  const foto = estadoEn(raiz, ['--base', '--sub', '1', '--paso', '5'], entorno).salida
  const f = /^BASE=(\w+) DESDE=(\S+)$/m.exec(foto)
  assert.deepEqual(estadoJson().en_curso, [1])
  assert.deepEqual(estadoJson().bases['1'], { base: f[1], desde: f[2] })
  estadoEn(raiz, ['--cambios', '--sub', '1', '--paso', '6'], entorno)
  assert.equal('en_curso' in estadoJson(), false)
  assert.deepEqual(estadoJson().bases['1'], { base: f[1], desde: f[2] })

  // Una corrección repite --base --sub n: conserva la foto y vuelve a anotarla en curso.
  const otra = estadoEn(raiz, ['--base', '--sub', '1', '--paso', '4'], entorno).salida
  assert.match(otra, /^AVISO: S1 ya tenía foto/m)
  assert.deepEqual(estadoJson().en_curso, [1])
  assert.deepEqual(estadoJson().bases['1'], { base: f[1], desde: f[2] })
  assert.match(estadoEn(raiz, ['--estado'], entorno).salida, /^EN CURSO: S1$/m)

  // Un lote anota todos sus miembros; medirlo los quita.
  estadoEn(raiz, ['--base', '--sub', '2,3', '--paso', '5'], entorno)
  assert.deepEqual(estadoJson().en_curso, [2, 3])
  assert.match(estadoEn(raiz, ['--estado'], entorno).salida, /^EN CURSO: S2\+S3$/m)
  estadoEn(raiz, ['--cambios', '--sub', '2,3', '--paso', '6'], entorno)
  assert.equal('en_curso' in estadoJson(), false)

  // --cambios --global también la quita; un --base --sub fallido no la toca.
  estadoEn(raiz, ['--base', '--sub', '2'], entorno)
  assert.equal(estadoEn(raiz, ['--base', '--sub', 'x'], entorno).codigo, 2)
  assert.deepEqual(estadoJson().en_curso, [2])
  estadoEn(raiz, ['--cambios', '--global'], entorno)
  assert.equal('en_curso' in estadoJson(), false)

  // Un --cambios --sub que falla (sin foto) no la quita.
  estadoEn(raiz, ['--base', '--sub', '1'], entorno)
  assert.equal(estadoEn(raiz, ['--cambios', '--sub', '9'], entorno).codigo, 2)
  assert.deepEqual(estadoJson().en_curso, [1])
})

test('estado: --base --sub y --cambios --sub con una lista miden el lote entero', () => {
  const subtarea = (n, permitidos, dep) => `S${n} · Tarea ${n}\n- Crítica: no\n- Archivos permitidos: ${permitidos}\n${dep === undefined ? '' : `- Depende de: ${dep}\n`}- Hecho cuando: x\n- Tests: t\n- Riesgos: r\n- Reversión: v`
  const plan = `PLAN · Lote\nClasificación: sin criterios\nObjetivo: probar\n\n${subtarea(1, 'src/a.ts')}\n\n${subtarea(2, 'docs/x.md', 'ninguna')}\n\n${subtarea(3, 'src/c.ts')}`
  const entorno = { CLAUDE_CONFIG_DIR: transcripts({ plano: plan }) }
  const raiz = repo('lote', { 'src/a.ts': 'a\n', 'docs/x.md': 'd\n', 'dist/x.js': 'x\n', 'src/c.ts': 'c\n' })
  temporales.push(raiz)
  estadoEn(raiz, ['--paso', '0'], entorno)
  assert.match(estadoEn(raiz, ['--guardar', 'plano', 'plan'], entorno).salida, /^LOTES: S1\+S2 \| S3$/m)
  const bases = () => JSON.parse(fs.readFileSync(path.join(flujoDe(raiz), 'estado.json'), 'utf8')).bases
  const estadoCrudo = () => fs.readFileSync(path.join(flujoDe(raiz), 'estado.json'), 'utf8')

  // Una sola foto para el lote, guardada en cada n con su lote.
  const foto = estadoEn(raiz, ['--base', '--sub', '1,2', '--paso', '5'], entorno)
  const f = /^BASE=(\w+) DESDE=(\S+)$/m.exec(foto.salida)
  assert.ok(f, foto.salida)
  assert.match(foto.salida, /^LOTE=S1\+S2$/m)
  assert.doesNotMatch(foto.salida, /AVISO/)
  assert.deepEqual(bases(), { 1: { base: f[1], desde: f[2], lote: [1, 2] }, 2: { base: f[1], desde: f[2], lote: [1, 2] } })

  fs.writeFileSync(path.join(raiz, 'src/a.ts'), 'a2\n')
  fs.writeFileSync(path.join(raiz, 'docs/x.md'), 'd2\n')
  fs.writeFileSync(path.join(raiz, 'dist/x.js'), 'x2\n')

  // La unión de los permitidos: lo de S1 y lo de S2 está dentro; lo demás, fuera.
  const lote = estadoEn(raiz, ['--cambios', '--sub', '1,2', '--paso', '6'], entorno)
  assert.match(lote.salida, new RegExp(`^FOTO S1\\+S2: BASE=${f[1].slice(0, 9)} DESDE=${f[2]} · permitidos: 2 del plan \\+ 0 ampliados$`, 'm'))
  assert.match(lote.salida, /^ {2}✓ M src\/a\.ts$/m)
  assert.match(lote.salida, /^ {2}✓ M docs\/x\.md$/m)
  assert.match(lote.salida, /^ {2}✗ M dist\/x\.js {3}← FUERA DE ALCANCE$/m)
  assert.match(lote.salida, /ALCANCE: FUERA \(1\)\s*$/)
  assert.equal(lote.codigo, 0)

  // Un miembro suelto mide el lote entero y lo avisa.
  const suelto = estadoEn(raiz, ['--cambios', '--sub', '2'], entorno)
  assert.match(suelto.salida, /^AVISO: S2 es del lote S1\+S2: mide el lote entero \(--cambios --sub 1,2\)$/m)
  assert.match(suelto.salida, /^FOTO S1\+S2: BASE=/m)
  assert.match(suelto.salida, /^ {2}✓ M src\/a\.ts$/m)
  assert.equal(suelto.codigo, 0)

  // Listas inválidas o sin foto: ERROR y código 2, y el estado no cambia.
  const antes = estadoCrudo()
  for (const lista of ['1,1', '1,x', '1,']) {
    for (const modo of ['--base', '--cambios']) {
      const r = estadoEn(raiz, [modo, '--sub', lista], entorno)
      assert.match(r.salida, /^ERROR: /m, `${modo} ${lista}`)
      assert.equal(r.codigo, 2, `${modo} ${lista}`)
    }
  }
  const sinFoto = estadoEn(raiz, ['--cambios', '--sub', '1,3'], entorno)
  assert.match(sinFoto.salida, /^ERROR: sin foto de S3 en la carpeta del flujo/m)
  assert.equal(sinFoto.codigo, 2)
  assert.equal(estadoCrudo(), antes)

  // Repetir la foto del lote conserva la primera: un AVISO por subtarea y nada cambia.
  const otra = estadoEn(raiz, ['--base', '--sub', '1,2'], entorno).salida
  assert.match(otra, /^AVISO: S1 ya tenía foto; se conserva la primera \(la de antes de su ejecutor\)$/m)
  assert.match(otra, /^AVISO: S2 ya tenía foto; se conserva la primera \(la de antes de su ejecutor\)$/m)
  assert.match(otra, new RegExp(`^BASE=${f[1]} DESDE=${f[2]}$`, 'm'))
  // Lo único que cambia es la subtarea en curso, que cada --base --sub vuelve a anotar.
  const { en_curso: enCurso, ...sinEnCurso } = JSON.parse(estadoCrudo())
  assert.deepEqual(enCurso, [1, 2])
  assert.deepEqual(sinEnCurso, JSON.parse(antes))

  // Un solo número se comporta como siempre: BASE y DESDE, sin LOTE y sin `lote` en el estado.
  const una = estadoEn(raiz, ['--base', '--sub', '3'], entorno).salida
  const g = /^BASE=(\w+) DESDE=(\S+)$/m.exec(una)
  assert.ok(g, una)
  assert.doesNotMatch(una, /LOTE|AVISO/)
  assert.deepEqual(bases()['3'], { base: g[1], desde: g[2] })
  const solo = estadoEn(raiz, ['--cambios', '--sub', '3'], entorno).salida
  assert.match(solo, /^FOTO S3: BASE=\w+ DESDE=\S+ · permitidos: 1 del plan \+ 0 ampliados$/m)
  assert.doesNotMatch(solo, /AVISO/)

  // Fotos de lote y de una sola subtarea no se mezclan: ni al tomarlas ni al medir.
  const mezcla = estadoEn(raiz, ['--base', '--sub', '2,3'], entorno)
  assert.match(mezcla.salida, /^ERROR: /m)
  assert.equal(mezcla.codigo, 2)
  const medir = estadoEn(raiz, ['--cambios', '--sub', '2,3'], entorno)
  assert.match(medir.salida, /^ERROR: .*lote/m)
  assert.equal(medir.codigo, 2)
  assert.deepEqual(bases()['3'], { base: g[1], desde: g[2] })
})

test('estado: --base --sub con lista no absorbe una foto suelta', () => {
  const { raiz } = estadoCon({}, () => ['--paso', '0'])
  const estadoCrudo = () => fs.readFileSync(path.join(flujoDe(raiz), 'estado.json'), 'utf8')
  assert.match(estadoEn(raiz, ['--base', '--sub', '1']).salida, /^BASE=\w+ DESDE=/m)
  const antes = estadoCrudo()
  const r = estadoEn(raiz, ['--base', '--sub', '1,2'])
  assert.match(r.salida, /^ERROR: S1 ya tiene una foto suelta, sin lote; no entra en un lote$/m)
  assert.doesNotMatch(r.salida, /LOTE=|AVISO/)
  assert.equal(r.codigo, 2)
  assert.equal(estadoCrudo(), antes)

  // Una lista tomada entera sí se puede repetir: conserva la primera foto.
  assert.match(estadoEn(raiz, ['--base', '--sub', '3,4']).salida, /^LOTE=S3\+S4$/m)
  const repetida = estadoEn(raiz, ['--base', '--sub', '3,4'])
  assert.match(repetida.salida, /^AVISO: S3 ya tenía foto; se conserva la primera/m)
  assert.equal(repetida.codigo, 0)
})

test('cierre: atribuye archivos y líneas por subtarea también dentro de un lote', () => {
  const { raiz } = estadoCon({}, () => ['--paso', '0'])
  const carpeta = flujoDe(raiz)
  const estado = JSON.parse(fs.readFileSync(path.join(carpeta, 'estado.json'), 'utf8'))
  estado.subtareas = [
    { n: 1, objetivo: 'x', critica: 'no', permitidos: ['src/a.ts'] },
    { n: 2, objetivo: 'y', critica: 'no', permitidos: ['dist/'] },
    { n: 3, objetivo: 'z', critica: 'no', permitidos: ['docs/z.md'] },
  ]
  fs.writeFileSync(path.join(carpeta, 'estado.json'), JSON.stringify(estado))
  assert.match(estadoEn(raiz, ['--base', '--sub', '1,2']).salida, /^LOTE=S1\+S2$/m)
  // Los dos ejecutores del lote editan a la vez: S1 +3 −1 en src/a.ts y S2 +1 −1 en dist/x.js.
  fs.writeFileSync(path.join(raiz, 'src/a.ts'), 'a3\nb\nc\n')
  fs.writeFileSync(path.join(raiz, 'dist/x.js'), 'y\n')
  // S3 empieza después del lote: lo suyo no cuenta en el lote.
  assert.match(estadoEn(raiz, ['--base', '--sub', '3']).salida, /^BASE=\w+ DESDE=/m)
  fs.mkdirSync(path.join(raiz, 'docs'), { recursive: true })
  fs.writeFileSync(path.join(raiz, 'docs/z.md'), 'z1\nz2\n')

  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: raiz, encoding: 'utf8' }).trim()
  estadoEn(raiz, ['--cambios', sha, '--paso', '7', '--resultado', 'COMPLETO'])
  const fila = filasDeFlujos(raiz).at(-1)
  assert.deepEqual(fila.subtareas, [
    { n: 1, critica: false, archivos: 1, mas: 3, menos: 1 },
    { n: 2, critica: false, archivos: 1, mas: 1, menos: 1 },
    { n: 3, critica: false, archivos: 1, mas: 2, menos: 0 },
  ])
})

test('estado: --cambios agrupa muchos archivos por carpeta y el cierre da la reversión exacta', () => {
  assert.deepEqual(agruparPorCarpeta(['a/b/c/1', 'a/b/d/2', 'x/3'], 2), [
    { carpeta: 'a/b/', rutas: ['a/b/c/1', 'a/b/d/2'] },
    { carpeta: 'x/', rutas: ['x/3'] },
  ])
  assert.deepEqual(agruparPorCarpeta(['raiz.md']), [{ carpeta: './', rutas: ['raiz.md'] }])

  const raiz = repo('agrupa', { 'src/a.ts': 'a\n', 'docs/x.md': 'x\n' })
  temporales.push(raiz)
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: raiz, encoding: 'utf8' }).trim()
  fs.writeFileSync(path.join(raiz, 'src/a.ts'), 'a2\n')
  fs.writeFileSync(path.join(raiz, 'src/nuevo.ts'), 'n\n')

  // Pocos archivos: uno por línea, y la reversión va en la misma línea.
  const chico = estadoEn(raiz, ['--cambios', sha, '--permitidos', 'src/a.ts,src/nuevo.ts', '--paso', '7']).salida
  assert.match(chico, /^ {2}✓ M src\/a\.ts$/m)
  assert.match(chico, new RegExp(`^REVERSIÓN: git restore --source=${sha} --worktree -- 'src/a\\.ts' && rm -- 'src/nuevo\\.ts'$`, 'm'))
  assert.match(chico, /ALCANCE: OK\s*$/)

  // Muchos: agrupados por carpeta, lo de fuera uno por uno y la reversión en reversion.sh.
  for (let i = 1; i <= 25; i++) {
    fs.mkdirSync(path.join(raiz, 'gen', `p${i % 3}`), { recursive: true })
    fs.writeFileSync(path.join(raiz, 'gen', `p${i % 3}`, `f${i}.png`), String(i))
  }
  fs.writeFileSync(path.join(raiz, 'docs/x.md'), 'x2\n')
  const grande = estadoEn(raiz, ['--cambios', sha, '--permitidos', 'src/a.ts,src/nuevo.ts,gen/**', '--paso', '7']).salida
  assert.match(grande, /^CAMBIOS desde \w+ \(28\):$/m)
  assert.match(grande, /^ {2}✓ gen\/p1\/ — 9 archivo\(s\) \(A 9\)$/m)
  assert.match(grande, /^ {2}✓ src\/ — 2 archivo\(s\) \(M 1, A 1\)$/m)
  assert.match(grande, /^ {2}✗ M docs\/x\.md {3}← FUERA DE ALCANCE$/m)
  assert.doesNotMatch(grande, /f1\.png/)
  assert.match(grande, /^REVERSIÓN: 1 a restaurar · 26 a borrar → bash .*reversion\.sh$/m)
  assert.match(grande, /ALCANCE: FUERA \(1\)\s*$/)
  const guion = fs.readFileSync(path.join(flujoDe(raiz), 'reversion.sh'), 'utf8')
  assert.match(guion, new RegExp(`^git restore --source=${sha} --worktree -- 'src/a\\.ts'$`, 'm'))
  assert.match(guion, /^rm -- .*'gen\/p1\/f1\.png'/m)
  assert.doesNotMatch(guion, /docs\/x\.md/)

  // Con un flujo abierto, el cierre contra otra foto avisa.
  estadoEn(raiz, ['--paso', '0'])
  assert.match(estadoEn(raiz, ['--cambios', sha, '--paso', '7']).salida, /^AVISO: el cierre va con BASE_GLOBAL=\w+ y DESDE_GLOBAL/m)
})

test('estado: el preflight abre la carpeta del flujo y --estado la resume', () => {
  const config = { verificar: [{ nombre: 'test', cmd: 'echo x' }] }
  const { raiz, salida } = estadoCon(config, () => ['--paso', '0'])
  const carpeta = flujoDe(raiz)
  assert.equal(/^FLUJO: (.*)$/m.exec(salida)?.[1], carpeta)
  const global = /^BASE_GLOBAL=(\w+) DESDE_GLOBAL=(\S+)$/m.exec(salida)

  const base = /^BASE=(\w+) DESDE=(\S+)$/m.exec(estadoEn(raiz, ['--base', '--paso', '5']).salida)
  const resumen = estadoEn(raiz, ['--estado']).salida
  assert.match(resumen, new RegExp(`^BASE_GLOBAL=${global[1]} DESDE_GLOBAL=${global[2]} · rama `, 'm'))
  assert.match(resumen, new RegExp(`^FOTO 1 \\(--base\\): BASE=${base[1]} DESDE=${base[2]}$`, 'm'))

  // Con el flujo anterior abierto (sin cierre y con actividad reciente), el preflight avisa y no vacía la carpeta.
  fs.writeFileSync(path.join(carpeta, 'S9.md'), 'viejo\n')
  const candado = estadoEn(raiz, ['--paso', '0']).salida
  assert.match(candado, /^AVISO: hay otro flujo abierto en este repo \(sin plan todavía, empezó a las .*, sin cierre, con actividad hace \d+ min\)\./m)
  assert.match(candado, /^FLUJO: \(ocupada por el flujo anterior: repite el preflight con --forzar si ya no corre\)$/m)
  assert.ok(fs.existsSync(path.join(carpeta, 'S9.md')))
  // Con --forzar, o después de un cierre, la vacía: no quedan fotos ni plan del flujo anterior.
  assert.equal(/^FLUJO: (.*)$/m.exec(estadoEn(raiz, ['--paso', '0', '--forzar']).salida)?.[1], carpeta)
  assert.ok(!fs.existsSync(path.join(carpeta, 'S9.md')))
  assert.doesNotMatch(estadoEn(raiz, ['--estado']).salida, /^FOTO/m)
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: raiz, encoding: 'utf8' }).trim()
  estadoEn(raiz, ['--cambios', sha, '--paso', '7'])
  assert.doesNotMatch(estadoEn(raiz, ['--paso', '0']).salida, /^AVISO: hay otro flujo abierto/m)

  // Con plan guardado, el candado dura 6 h (puede estar esperando la aprobación) y el aviso nombra el plan.
  const archivo = path.join(carpeta, 'estado.json')
  const envejecer = (horas) => {
    const t = new Date(Date.now() - horas * 3_600_000)
    for (const a of [archivo, registroDe(raiz)]) if (fs.existsSync(a)) fs.utimesSync(a, t, t)
  }
  const conPlan = { ...JSON.parse(fs.readFileSync(archivo, 'utf8')), plan: path.join(carpeta, 'plan.md'), titulo: 'Corporativas' }
  fs.writeFileSync(archivo, JSON.stringify(conPlan))
  envejecer(2)
  assert.match(estadoEn(raiz, ['--paso', '0']).salida, /^AVISO: hay otro flujo abierto en este repo \(«Corporativas», empezó a las .*, con actividad hace 120 min\)\./m)
  envejecer(7)
  assert.doesNotMatch(estadoEn(raiz, ['--paso', '0']).salida, /^AVISO: hay otro flujo abierto/m)
  // Sin plan, a los 20 min ya no cuenta como abierto.
  envejecer(1)
  assert.doesNotMatch(estadoEn(raiz, ['--paso', '0']).salida, /^AVISO: hay otro flujo abierto/m)
})

test('estado: --cancelar cierra un flujo sin fotos y libera el candado', () => {
  const { raiz } = estadoCon({}, () => ['--paso', '0'])
  const carpeta = flujoDe(raiz)
  fs.writeFileSync(path.join(carpeta, 'plan.md'), 'PLAN · x\n')
  assert.match(estadoEn(raiz, ['--paso', '0']).salida, /^AVISO: hay otro flujo abierto/m)

  const salida = estadoEn(raiz, ['--cancelar', '--paso', '4']).salida
  assert.match(salida, /^CANCELADO: flujo cerrado sin plan aprobado; el candado queda libre$/m)
  assert.match(salida, /^HISTORIAL: /m)
  const fila = filasDeFlujos(raiz).at(-1)
  assert.equal(fila.v, 2)
  assert.equal(fila.resultado, 'CANCELADO')
  const estado = JSON.parse(fs.readFileSync(path.join(carpeta, 'estado.json'), 'utf8'))
  assert.equal(estado.resultado, 'CANCELADO')
  assert.equal(estado.cierre, fila.t)

  // Ya cerrado: no vuelve a anotar nada.
  assert.match(estadoEn(raiz, ['--cancelar']).salida, /^CANCELAR: el flujo ya estaba cerrado \(\S+\)$/m)
  assert.equal(filasDeFlujos(raiz).length, 1)
  assert.doesNotMatch(estadoEn(raiz, ['--paso', '0']).salida, /^AVISO: hay otro flujo abierto/m)

  // Sin flujo en curso (y fuera de un repo git: no pide git).
  const vacio = fs.mkdtempSync(path.join(os.tmpdir(), 'flujos-vacio-'))
  temporales.push(vacio)
  assert.match(estadoEn(vacio, ['--cancelar']).salida, /^CANCELAR: no hay un flujo en curso$/m)
})

test('estado: --cancelar con fotos de subtareas no cierra', () => {
  const { raiz } = estadoCon({}, () => ['--paso', '0'])
  const carpeta = flujoDe(raiz)
  assert.match(estadoEn(raiz, ['--base', '--sub', '1']).salida, /^BASE=\w+ DESDE=/m)
  const antes = fs.readFileSync(path.join(carpeta, 'estado.json'), 'utf8')

  const salida = estadoEn(raiz, ['--cancelar']).salida
  assert.match(salida, /^AVISO: .*\(S1\).*ciérralo con --cambios --global --resultado DETENIDO:<paso> --paso 7$/m)
  assert.doesNotMatch(salida, /^CANCELADO:/m)
  assert.equal(fs.readFileSync(path.join(carpeta, 'estado.json'), 'utf8'), antes)
  assert.deepEqual(filasDeFlujos(raiz), [])
  assert.match(estadoEn(raiz, ['--paso', '0']).salida, /^AVISO: hay otro flujo abierto/m)
})

test('estado: fusionarExploraciones une secciones sin repetir ruta:línea (pura)', () => {
  const uno = 'ARCHIVOS\n- x.ts:1 — primero\n- y.ts:10 — uno\n\nTESTS\n- ninguno\n\nACOPLAMIENTOS\n- ninguno\n\nDATOS\n- ninguno\n\nDUDAS\n- ninguno'
  const dos = 'ARCHIVOS\n- x.ts:1 — repetido\n- y.ts:1 — otro\n\nTESTS\n- t.test.ts:5 — cubre x\n\nACOPLAMIENTOS\n- ninguno\n\nDATOS\n- ninguno'
  const { texto, incompletos } = fusionarExploraciones([{ id: 'a', texto: uno }, { id: 'b', texto: dos }])

  assert.equal(texto.match(/x\.ts:1\b/g).length, 1)
  assert.match(texto, /- x\.ts:1 — primero/)
  assert.doesNotMatch(texto, /repetido/)
  // ruta:1 y ruta:10 son claves distintas.
  assert.match(texto, /- y\.ts:10 — uno/)
  assert.match(texto, /- y\.ts:1 — otro/)
  // Las secciones salen en orden y `ninguno` solo queda donde no hay hallazgos.
  const orden = ['ARCHIVOS', 'TESTS', 'ACOPLAMIENTOS', 'DATOS', 'DUDAS'].map((s) => texto.indexOf(`\n${s}\n`) + (s === 'ARCHIVOS' ? 1 : 0))
  assert.ok(orden[0] === 0 && orden.every((n, i) => n >= 0 && (i === 0 || n > orden[i - 1])), orden.join())
  assert.match(texto, /TESTS\n- t\.test\.ts:5 — cubre x\n/)
  assert.doesNotMatch(texto, /TESTS\n- ninguno/)
  assert.match(texto, /ACOPLAMIENTOS\n- ninguno\n/)
  assert.match(texto, /DUDAS\n- ninguno$/)
  assert.deepEqual(incompletos, [{ id: 'b', faltan: ['DUDAS'] }])
})

test('estado: --guardar con varios exploradores escribe un solo exploracion.md', () => {
  const claude = transcripts({
    e1: 'ARCHIVOS\n- flujos/herramientas/estado.mjs:12 — modo nuevo\n- src/a.ts:3 — uso\nTESTS\n- ninguno\nACOPLAMIENTOS\n- ninguno\nDATOS\n- ninguno\nDUDAS\n- ninguno',
    e2: 'ARCHIVOS\n- src/a.ts:3 — mismo uso\n- src/b.ts:7 — otro\nTESTS\n- src/a.test.ts:1 — prueba\nACOPLAMIENTOS\n- ninguno\nDATOS\n- ninguno',
  })
  const entorno = { CLAUDE_CONFIG_DIR: claude }
  const { raiz, salida } = estadoCon({ criticos: CRITICOS }, () => ['--guardar', 'e1,e2,nadie', 'exploracion', '--paso', '2'], {}, entorno)
  const md = fs.readFileSync(path.join(flujoDe(raiz), 'exploracion.md'), 'utf8')

  assert.match(salida, /^GUARDADO: exploración → .*exploracion\.md$/m)
  assert.match(salida, /^AVISO: no encontré el informe del agente nadie: despacha copiando su texto, como antes$/m)
  assert.match(salida, /^INCOMPLETO: agente e2 sin DUDAS: relanza solo esa parte$/m)
  assert.doesNotMatch(salida, /INCOMPLETO: agente e1/)
  assert.match(salida, /^RUTAS CRÍTICAS EN LA EXPLORACIÓN: #1 \(flujos\/herramientas\/estado\.mjs\), #5 \(flujos\/herramientas\/estado\.mjs\)$/m)
  assert.equal(md.match(/src\/a\.ts:3/g).length, 1)
  assert.match(md, /- src\/b\.ts:7 — otro/)
  assert.match(md, /TESTS\n- src\/a\.test\.ts:1 — prueba\n/)
  assert.equal(md.match(/^ARCHIVOS$/gm).length, 1)
  assert.ok(md.endsWith('\n'))

  // Sin ningún informe encontrado no se escribe nada.
  const vacio = estadoEn(raiz, ['--guardar', 'x1,x2', 'exploracion'], entorno)
  assert.match(vacio.salida, /agente x1:/)
  assert.match(vacio.salida, /agente x2:/)
  assert.doesNotMatch(vacio.salida, /GUARDADO/)

  // Con un solo id, un informe sin alguna sección también avisa, y el archivo queda tal cual.
  const solo = estadoEn(raiz, ['--guardar', 'e2', 'exploracion'], entorno).salida
  assert.match(solo, /^INCOMPLETO: agente e2 sin DUDAS: relanza solo esa parte$/m)
  assert.equal(
    fs.readFileSync(path.join(flujoDe(raiz), 'exploracion.md'), 'utf8'),
    'ARCHIVOS\n- src/a.ts:3 — mismo uso\n- src/b.ts:7 — otro\nTESTS\n- src/a.test.ts:1 — prueba\nACOPLAMIENTOS\n- ninguno\nDATOS\n- ninguno\n',
  )
})

test('techo de exploradores por tamaño del repo', () => {
  assert.equal(techoDeExploradores(0), 2)
  assert.equal(techoDeExploradores(149), 2)
  assert.equal(techoDeExploradores(150), 3)
  assert.equal(techoDeExploradores(800), 3)
  assert.equal(techoDeExploradores(801), 5)
  // Sin MAPA (null) o sin dato, el mínimo.
  assert.equal(techoDeExploradores(null), 2)
  assert.equal(techoDeExploradores(undefined), 2)

  // El preflight lo imprime junto a MAPA, con el mismo conteo de archivos.
  const config = { verificar: [{ nombre: 'test', cmd: 'echo x' }] }
  const grande = Object.fromEntries(Array.from({ length: 150 }, (_, i) => [`lote/f${i}.txt`, 'x\n']))
  const { raiz, salida } = estadoCon(config, () => ['--paso', '0'], grande)
  const archivos = /^MAPA: .*mapa\.md \((\d+) archivos\)$/m.exec(salida)?.[1]
  assert.ok(Number(archivos) >= 150, salida)
  assert.match(salida, /^MAPA: .*\n^EXPLORADORES: hasta 3 \(repo de \d+ archivos\)$/m)
  assert.equal(/^EXPLORADORES: hasta \d+ \(repo de (\d+) archivos\)$/m.exec(salida)?.[1], archivos)
  const chico = estadoCon(config, () => ['--paso', '0']).salida
  assert.match(chico, /^MAPA: .*\n^EXPLORADORES: hasta 2 \(repo de \d+ archivos\)$/m)

  // Con el flujo ocupado no hay MAPA.
  fs.writeFileSync(path.join(raiz, 'nuevo.ts'), 'n\n')
  assert.match(estadoEn(raiz, ['--paso', '0']).salida, /^MAPA: ninguno.*\n^EXPLORADORES: hasta 2 \(sin MAPA\)$/m)
})

test('tope de líneas por número de exploradores', () => {
  assert.deepEqual([1, 2, 3, 4, 5].map(topeDeLineas), [25, 20, 16, 15, 14])
  // Fuera de 1–5 se acota.
  assert.equal(topeDeLineas(0), 25)
  assert.equal(topeDeLineas(9), 14)
})

/** Informe de explorador con `n` hallazgos en ARCHIVOS y los otros 4 encabezados vacíos. */
const informeDe = (n, linea = (i) => `- src/f${i}.ts:${i} — hecho`) =>
  `ARCHIVOS\n${Array.from({ length: n }, (_, i) => linea(i + 1)).join('\n')}\nTESTS\nACOPLAMIENTOS\nDATOS\nDUDAS`

test('--guardar avisa LARGO por exceso de hallazgos', () => {
  const claude = transcripts({
    justo: informeDe(25),
    largo: informeDe(26),
    t1: informeDe(17, (i) => `- a/${i}.ts:${i} — uno`),
    t2: informeDe(16, (i) => `- b/${i}.ts:${i} — dos`),
    t3: informeDe(3, (i) => `- c/${i}.ts:${i} — tres`),
    d1: informeDe(21, (i) => `- d/${i}.ts:${i} — igual`),
    d2: informeDe(21, (i) => `- d/${i}.ts:${i} — igual`),
  })
  const entorno = { CLAUDE_CONFIG_DIR: claude }
  const { raiz, salida } = estadoCon({}, () => ['--guardar', 'justo', 'exploracion', '--paso', '2'], {}, entorno)
  const md = () => fs.readFileSync(path.join(flujoDe(raiz), 'exploracion.md'), 'utf8')

  // Con un explorador el tope es 25.
  assert.doesNotMatch(salida, /LARGO/)
  const largo = estadoEn(raiz, ['--guardar', 'largo', 'exploracion'], entorno).salida
  assert.match(largo, /^LARGO: agente largo con 26 hallazgos \(tope 25\)$/m)
  // El aviso no corta ni cambia lo guardado.
  assert.equal(md(), informeDe(26) + '\n')

  // Con tres, el tope de cada uno es 16 (solo t1 lo pasa).
  const tres = estadoEn(raiz, ['--guardar', 't1,t2,t3', 'exploracion'], entorno).salida
  assert.match(tres, /^LARGO: agente t1 con 17 hallazgos \(tope 16\)$/m)
  assert.doesNotMatch(tres, /LARGO: agente t[23]/)
  assert.equal((tres.match(/^LARGO/gm) ?? []).length, 1)
  assert.match(md(), /- a\/17\.ts:17 — uno/)

  // Se cuenta antes de deduplicar: d2 repite todo lo de d1 y aun así pasa el tope de 20.
  const dos = estadoEn(raiz, ['--guardar', 'd1,d2', 'exploracion'], entorno).salida
  assert.match(dos, /^LARGO: agente d1 con 21 hallazgos \(tope 20\)$/m)
  assert.match(dos, /^LARGO: agente d2 con 21 hallazgos \(tope 20\)$/m)
  assert.equal(md().match(/d\/1\.ts:1\b/g).length, 1)
})

test('--guardar avisa LARGO por líneas de más de 160 caracteres', () => {
  const ancha = (n) => `- src/a.ts:1 — ${'x'.repeat(n - '- src/a.ts:1 — '.length)}`
  assert.equal(ancha(161).length, 161)
  const claude = transcripts({
    justa: informeDe(2, (i) => (i === 1 ? ancha(160) : `- src/b.ts:${i} — ok`)),
    pasada: informeDe(3, (i) => (i === 3 ? `- src/b.ts:${i} — ok` : ancha(161 + i))),
  })
  const entorno = { CLAUDE_CONFIG_DIR: claude }
  const { raiz, salida } = estadoCon({}, () => ['--guardar', 'justa', 'exploracion', '--paso', '2'], {}, entorno)
  assert.doesNotMatch(salida, /LARGO/)
  const pasada = estadoEn(raiz, ['--guardar', 'pasada', 'exploracion'], entorno).salida
  assert.match(pasada, /^LARGO: agente pasada con 2 líneas de más de 160 caracteres$/m)
  assert.doesNotMatch(pasada, /hallazgos \(tope/)
  assert.match(fs.readFileSync(path.join(flujoDe(raiz), 'exploracion.md'), 'utf8'), /x{100}/)
})

test('los 5 encabezados no cuentan como hallazgos', () => {
  // 25 hallazgos más los 5 encabezados (30 líneas): sin aviso. Los encabezados con formato también se excluyen.
  const conFormato = `**ARCHIVOS**\n${Array.from({ length: 25 }, (_, i) => `- src/f${i}.ts:${i} — hecho`).join('\n')}\n## TESTS\nACOPLAMIENTOS:\n\nDATOS\n**DUDAS**`
  assert.deepEqual(avisosDeLargo([{ id: 'a', texto: informeDe(25) }, { id: 'b', texto: conFormato }], 25), [])
  // Las líneas vacías tampoco cuentan; con un hallazgo más sí se avisa, y el número no incluye encabezados.
  assert.deepEqual(avisosDeLargo([{ id: 'a', texto: informeDe(26).replace(/\n/g, '\n\n') }], 25), ['LARGO: agente a con 26 hallazgos (tope 25)'])
  // Un informe de solo encabezados tiene 0 hallazgos.
  assert.deepEqual(avisosDeLargo([{ id: 'a', texto: 'ARCHIVOS\nTESTS\nACOPLAMIENTOS\nDATOS\nDUDAS' }], 1), [])
  assert.deepEqual(avisosDeLargo([{ id: 'a', texto: null }], 1), [])
  // «- ninguno» no es un hallazgo: cinco secciones vacías no pasan de un tope de 1; un hallazgo real sí cuenta.
  const vacio = 'ARCHIVOS\n- src/a.ts:1 — uno\nTESTS\n- ninguno\nACOPLAMIENTOS\n- ninguno.\nDATOS\n* Ninguno\nDUDAS\nninguno'
  assert.deepEqual(avisosDeLargo([{ id: 'a', texto: vacio }], 1), [])
  assert.deepEqual(avisosDeLargo([{ id: 'a', texto: `${vacio}\n- src/b.ts:2 — dos` }], 1), ['LARGO: agente a con 2 hallazgos (tope 1)'])
})

test('estado: --guardar exploracion dice si la exploración toca rutas críticas', () => {
  const claude = transcripts({
    critica: 'ARCHIVOS\n- flujos/herramientas/estado.mjs:12 — modo nuevo\n- src/a.ts:3 — uso',
    tranquila: 'ARCHIVOS\n- src/a.ts:3 — uso\n- README.md — índice',
  })
  const entorno = { CLAUDE_CONFIG_DIR: claude }
  const critica = estadoCon({ criticos: CRITICOS }, () => ['--guardar', 'critica', 'exploracion', '--paso', '2'], {}, entorno)
  assert.match(critica.salida, /^RUTAS CRÍTICAS EN LA EXPLORACIÓN: #1 \(flujos\/herramientas\/estado\.mjs\), #5 \(flujos\/herramientas\/estado\.mjs\)$/m)
  assert.match(estadoEn(critica.raiz, ['--guardar', 'tranquila', 'exploracion'], entorno).salida, /^RUTAS CRÍTICAS EN LA EXPLORACIÓN: ninguna$/m)
  const sinCriticos = estadoCon({}, () => ['--guardar', 'tranquila', 'exploracion'], {}, entorno)
  assert.match(sinCriticos.salida, /^RUTAS CRÍTICAS EN LA EXPLORACIÓN: el proyecto no declara «criticos»/m)
})

/** Transcript mínimo del flujo de `raiz` (su `/impl` y un pedido con 100.000 tokens de contexto); devuelve su CLAUDE_CONFIG_DIR. */
function transcriptDelFlujo(raiz) {
  const { inicio, base_global: global } = JSON.parse(fs.readFileSync(path.join(flujoDe(raiz), 'estado.json'), 'utf8'))
  const tramo = Math.max(Date.now() - Date.parse(inicio), 10)
  const en = (f) => new Date(Date.parse(inicio) + Math.floor(tramo * f)).toISOString()
  const claude = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-config-'))
  temporales.push(claude)
  const carpeta = path.join(claude, 'projects', path.resolve(raiz).replace(/[^a-zA-Z0-9]/g, '-'))
  fs.mkdirSync(carpeta, { recursive: true })
  const filas = [
    { type: 'user', timestamp: en(-1), message: { role: 'user', content: '<command-name>/impl</command-name>\n<command-args>probar el cierre</command-args>' } },
    { type: 'user', timestamp: en(0.05), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't0', content: `BASE_GLOBAL=${global} DESDE_GLOBAL=${inicio}` }] } },
    { type: 'assistant', timestamp: en(0.1), message: { id: 'o1', model: 'claude-sonnet-5-5', usage: { cache_read_input_tokens: 100_000, output_tokens: 10 }, content: [{ type: 'text', text: '' }] } },
  ]
  fs.writeFileSync(path.join(carpeta, 's1.jsonl'), filas.map((f) => JSON.stringify(f)).join('\n') + '\n')
  return claude
}

/** Las filas de `registros/flujos.jsonl` que son del repo `raiz` (el archivo es común a los repos de las pruebas). */
function filasDeFlujos(raiz) {
  const archivo = path.join(path.dirname(registroDe(raiz)), 'flujos.jsonl')
  if (!fs.existsSync(archivo)) return []
  return fs.readFileSync(archivo, 'utf8').trimEnd().split('\n').map((l) => JSON.parse(l)).filter((f) => f.raiz === raiz)
}

test('estado: filaDelFlujo omite lo que falta y arma subtareas, calidad y uso', () => {
  assert.deepEqual(filaDelFlujo({ t: 'T', raiz: 'R', base: 'B' }), { v: 2, t: 'T', raiz: 'R', base: 'B' })
  const roles = {
    orquestador: { pedidos: 2, usd: 1, sinPrecio: 0, agentes: 0, tokens: { entrada: 1, leidos: 2, escritos: 3, salida: 4, thinking: 5 } },
    ejecutor: { pedidos: 1, usd: 1, sinPrecio: 0, agentes: 1, tokens: { entrada: 10, leidos: 20, escritos: 30, salida: 40, thinking: 50 } },
  }
  const fila = filaDelFlujo({
    t: 'T', raiz: 'R', base: 'B', version: 'abc', resultado: 'COMPLETO', tokens: { final: [1] }, negados: 2,
    estado: { titulo: 'Titulo', clasificacion: 'sin criterios', subtareas: [{ n: 1, critica: 'sí (#1)' }, { n: 2, critica: 'No — texto' }, { n: 3 }], verificacion_inicial: { resultado: 'RESULTADO: VERDE' } },
    metricas: {
      costo: { inicio: 'I', minutos: 1, usd: 2, roles, veredictos: {} },
      sesion: 'S.jsonl', pedido: 'p', contexto: { primero: 10, ultimo: 99 }, tiempos: { fases: {}, activo: 1, espera: 0 },
      ejecutores: { 1: { usd: 0.123456, segundos: 7, correcciones: 1, estado: 'HECHO', esfuerzo: 'medium' } },
      problemas: { final: [{ veredicto: 'APROBADO', items: [] }] }, alcanceFuera: [], explorador: { pedidos: 1, glob: 0, read: 0, mapa: false },
    },
    cambios: { 1: { archivos: 2, mas: 5, menos: 1 } },
  })
  assert.deepEqual(Object.keys(fila), ['v', 't', 'raiz', 'base', 'version', 'sesion', 'pedido', 'titulo', 'resultado', 'clasificacion', 'costo', 'uso', 'contexto', 'tiempos', 'subtareas', 'calidad', 'explorador', 'tokens'])
  assert.deepEqual(fila.uso, { pedidos: 3, tokens: { entrada: 11, leidos: 22, escritos: 33, salida: 44, thinking: 55 } })
  assert.deepEqual(fila.contexto, { primero: 10 })
  assert.deepEqual(fila.subtareas, [
    { n: 1, critica: true, esfuerzo: 'medium', archivos: 2, mas: 5, menos: 1, usd: 0.1235, segundos: 7, correcciones: 1, estado: 'HECHO' },
    { n: 2, critica: false },
    { n: 3, critica: true },
  ])
  assert.deepEqual(fila.calidad, { final: [{ veredicto: 'APROBADO', items: [] }], negados: 2, alcanceFuera: [], inicial: 'RESULTADO: VERDE' })
})

test('cierre: anota la fila v2, imprime CONTEXTO y archiva en historial', () => {
  const { raiz } = estadoCon({}, () => ['--paso', '0'])
  const carpeta = flujoDe(raiz)
  const estado = JSON.parse(fs.readFileSync(path.join(carpeta, 'estado.json'), 'utf8'))
  estado.subtareas = [{ n: 1, objetivo: 'x', critica: 'sí', permitidos: ['src/a.ts'] }]
  fs.writeFileSync(path.join(carpeta, 'estado.json'), JSON.stringify(estado))
  fs.writeFileSync(path.join(carpeta, 'plan.md'), 'PLAN · x\n')
  fs.writeFileSync(path.join(carpeta, 'S1.md'), 'S1 · x\n')
  fs.writeFileSync(path.join(carpeta, 'mapa.md'), 'no se archiva\n')
  // La foto de S1 se toma con `a2`; el cierre ve `a3, b, c`: +3 −1 en un archivo.
  assert.match(estadoEn(raiz, ['--base', '--sub', '1']).salida, /^BASE=\w+ DESDE=/m)
  fs.writeFileSync(path.join(raiz, 'src/a.ts'), 'a3\nb\nc\n')
  // 31 carpetas viejas, una que no es del historial y un archivo con nombre de carpeta: solo las viejas se podan.
  const historial = path.join(path.dirname(carpeta), 'historial')
  fs.mkdirSync(path.join(historial, 'notas'), { recursive: true })
  fs.writeFileSync(path.join(historial, '20200101T000099-archivo'), 'no es una carpeta')
  for (let i = 0; i < 31; i++) fs.mkdirSync(path.join(historial, `20200101T0000${String(i).padStart(2, '0')}-viejo`), { recursive: true })

  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: raiz, encoding: 'utf8' }).trim()
  const salida = estadoEn(raiz, ['--cambios', sha, '--paso', '7', '--resultado', 'COMPLETO'], { CLAUDE_CONFIG_DIR: transcriptDelFlujo(raiz) }).salida
  assert.match(salida, /^CONTEXTO: 100000 tokens en el último pedido del hilo principal · reescribirlo en Opus con caché de 1 h: \$0,80$/m)
  assert.doesNotMatch(salida, /AVISO: --resultado/)
  const fila = filasDeFlujos(raiz).at(-1)
  assert.equal(fila.v, 2)
  assert.equal(fila.resultado, 'COMPLETO')
  assert.equal(fila.pedido, 'probar el cierre')
  assert.deepEqual(fila.contexto, { primero: 100_000 })
  assert.deepEqual(fila.subtareas, [{ n: 1, critica: true, archivos: 1, mas: 3, menos: 1 }])
  assert.equal(fila.calidad.negados, 0)
  assert.equal(fila.calidad.inicial, 'SIN PASOS')
  assert.equal(JSON.parse(fs.readFileSync(path.join(carpeta, 'estado.json'), 'utf8')).resultado, 'COMPLETO')

  const destino = /^HISTORIAL: (.+)$/m.exec(salida)?.[1]
  assert.ok(destino, salida)
  assert.equal(path.dirname(destino), historial)
  assert.match(path.basename(destino), new RegExp(`^${fila.t.replace(/[-:]/g, '').slice(0, 15)}-${path.basename(carpeta).replace(/-flujo$/, '')}$`))
  assert.deepEqual(fs.readdirSync(destino).sort(), ['S1.md', 'estado.json', 'plan.md'])
  const archivado = JSON.parse(fs.readFileSync(path.join(destino, 'estado.json'), 'utf8'))
  assert.equal(archivado.cierre, fila.t)
  assert.equal(archivado.resultado, 'COMPLETO')
  const carpetas = fs.readdirSync(historial, { withFileTypes: true }).filter((d) => d.isDirectory() && /^\d{8}T\d{6}-/.test(d.name)).map((d) => d.name)
  assert.equal(carpetas.length, 30)
  assert.ok(!carpetas.includes('20200101T000000-viejo'))
  assert.ok(carpetas.includes(path.basename(destino)))
  assert.ok(fs.statSync(path.join(historial, 'notas')).isDirectory())
  assert.ok(fs.existsSync(path.join(historial, '20200101T000099-archivo')))
})

test('cierre: --resultado inválido avisa y anota sin resultado', () => {
  const { raiz } = estadoCon({}, () => ['--paso', '0'])
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: raiz, encoding: 'utf8' }).trim()
  const sinCierre = estadoEn(raiz, ['--cambios', sha, '--paso', '6', '--resultado', 'COMPLETO']).salida
  assert.match(sinCierre, /^AVISO: --resultado solo vale en el cierre \(--cambios … --paso 7\); se ignora$/m)
  assert.deepEqual(filasDeFlujos(raiz), [], 'sin cierre no se anota nada')
  assert.equal(JSON.parse(fs.readFileSync(path.join(flujoDe(raiz), 'estado.json'), 'utf8')).cierre, undefined)

  for (const malo of ['listo', 'DETENIDO:8', 'completo', '']) {
    const { raiz: otra } = estadoCon({}, () => ['--paso', '0'])
    const sha2 = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: otra, encoding: 'utf8' }).trim()
    const salida = estadoEn(otra, ['--cambios', sha2, '--paso', '7', '--resultado', malo]).salida
    assert.match(salida, /^AVISO: --resultado .* no es COMPLETO ni DETENIDO:<0-7>; el flujo se anota sin él$/m, malo)
    const fila = filasDeFlujos(otra).at(-1)
    assert.equal(fila.v, 2)
    assert.ok(!('resultado' in fila), malo)
    const e = JSON.parse(fs.readFileSync(path.join(flujoDe(otra), 'estado.json'), 'utf8'))
    assert.ok(e.cierre && !('resultado' in e), malo)
  }
  // DETENIDO:<n> vale.
  const { raiz: detenida } = estadoCon({}, () => ['--paso', '0'])
  const sha3 = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: detenida, encoding: 'utf8' }).trim()
  const salida = estadoEn(detenida, ['--cambios', sha3, '--paso', '7', '--resultado', 'DETENIDO:3']).salida
  assert.doesNotMatch(salida, /AVISO: --resultado/)
  assert.equal(filasDeFlujos(detenida).at(-1).resultado, 'DETENIDO:3')
})

/** Repo con `src/a.ts` y `dist/x.js` versionados; corre un paso build que reescribe `dist/x.js`. `{ raiz, sha, cambios }`. */
function repoConBuild(nombre = 'build') {
  const raiz = repo(`estado-${nombre}`, {
    '.claude/implementador.json': { verificar: [{ nombre: 'build', cmd: escribirCmd('dist/x.js', 'nuevo') }] },
    'src/a.ts': 'a\n',
    'dist/x.js': 'viejo\n',
  })
  temporales.push(raiz)
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: raiz, encoding: 'utf8' }).trim()
  fs.writeFileSync(path.join(raiz, 'src/a.ts'), 'a2\n')
  const v = spawnSync(process.execPath, [VERIFICAR], { cwd: raiz, encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: raiz } })
  assert.match(v.stdout, /RESULTADO: VERDE/)
  return { raiz, sha, cambios: (...extra) => estadoEn(raiz, ['--cambios', sha, '--permitidos', 'src/a.ts', ...extra]) }
}

test('estado: --cambios no marca FUERA la salida de verificar', () => {
  const { sha, cambios } = repoConBuild()
  // Que se reconozca prueba que el blob de la foto es el mismo que anota verificar para el mismo contenido.
  const c = cambios()
  assert.match(c.salida, /^ {2}~ M dist\/x\.js {3}← \(salida de verificar: build\)$/m)
  assert.doesNotMatch(c.salida, /FUERA DE ALCANCE/)
  assert.match(c.salida, /^CAMBIOS desde \w+ \(2\): src\/ 1 · salida de verificar 1$/m)
  assert.match(c.salida, /^ALCANCE: OK$/m)

  // Un desde posterior a la corrida descarta esa salida: ya no se perdona.
  const futuro = cambios('--desde', new Date(Date.now() + 3_600_000).toISOString())
  assert.match(futuro.salida, /^ {2}✗ M dist\/x\.js {3}← FUERA DE ALCANCE$/m)
  assert.match(futuro.salida, /^ALCANCE: FUERA \(1\)$/m)

  // En el cierre entra en la reversión, como lo de dentro, y el detalle sigue completo.
  const cierre = cambios('--paso', '7').salida
  assert.match(cierre, /^ {2}✓ M src\/a\.ts$/m)
  assert.match(cierre, /^ {2}~ M dist\/x\.js {3}← \(salida de verificar: build\)$/m)
  assert.match(cierre, new RegExp(`^REVERSIÓN: git restore --source=${sha} --worktree -- 'dist/x\\.js' 'src/a\\.ts'$`, 'm'))
})

test('estado: --cambios marca FUERA un cambio a mano sobre la salida de verificar', () => {
  const { raiz, cambios } = repoConBuild('mano')
  assert.match(cambios().salida, /^ALCANCE: OK$/m)
  fs.writeFileSync(path.join(raiz, 'dist/x.js'), 'a mano\n')
  const c = cambios()
  assert.match(c.salida, /^ {2}✗ M dist\/x\.js {3}← FUERA DE ALCANCE$/m)
  assert.doesNotMatch(c.salida, /salida de verificar/)
  assert.match(c.salida, /^ALCANCE: FUERA \(1\)$/m)
})

test('estado: --cambios compacto con ALCANCE OK', () => {
  const raiz = repo('compacto', { 'src/a.ts': 'a\n', 'src/b.ts': 'b\n', 'docs/x.md': 'x\n' })
  temporales.push(raiz)
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: raiz, encoding: 'utf8' }).trim()
  fs.writeFileSync(path.join(raiz, 'src/a.ts'), 'a2\n')
  fs.writeFileSync(path.join(raiz, 'src/b.ts'), 'b2\n')
  fs.writeFileSync(path.join(raiz, 'docs/x.md'), 'x2\n')
  const c = estadoEn(raiz, ['--cambios', sha, '--permitidos', 'src/**,docs/x.md']).salida
  assert.match(c, /^CAMBIOS desde \w+ \(3\): (docs\/ 1 · src\/ 2|src\/ 2 · docs\/ 1)$/m)
  assert.match(c, /^ALCANCE: OK$/m)
  assert.doesNotMatch(c, /^ {2}[✓✗~]/m)
  assert.equal(c.trimEnd().split('\n').filter((l) => /^(CAMBIOS|ALCANCE)/.test(l)).length, 2)
})

test('estado: --cambios compacto nombra lo que solo está en el registro', () => {
  const raiz = repo('compacto-registro', { 'src/a.ts': 'a\n' })
  temporales.push(raiz)
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: raiz, encoding: 'utf8' }).trim()
  const desde = new Date(Date.now() - 60_000).toISOString()
  fs.writeFileSync(path.join(raiz, 'src/a.ts'), 'a2\n')
  // Un Edit del ejecutor que no dejó cambio en git (sin efecto o ruta ignorada).
  const fila = { t: new Date().toISOString(), rol: 'ejecutor', herramienta: 'Edit', objetivo: 'src/b.ts', decision: 'permitido' }
  fs.mkdirSync(path.dirname(registroDe(raiz)), { recursive: true })
  fs.appendFileSync(registroDe(raiz), JSON.stringify(fila) + '\n')
  try {
    const c = estadoEn(raiz, ['--cambios', sha, '--desde', desde, '--permitidos', 'src/**']).salida
    assert.match(c, /^CAMBIOS desde \w+ \(2\): src\/ 1 · solo en el registro 1$/m)
    assert.match(c, /^ {2}✓ · src\/b\.ts {3}← solo en el registro: /m)
    assert.doesNotMatch(c, /src\/a\.ts/)
    assert.match(c, /^ALCANCE: OK$/m)
  } finally {
    borrarRegistro(raiz)
  }
})

test('preflight: la verificación inicial en segundo plano llega a --estado como VERDE', () => {
  const config = { verificar: [{ nombre: 'bien', cmd: 'node -e "0"' }] }
  const entorno = { FLUJOS_INICIAL: undefined, CLAUDE_CONFIG_DIR: PRUEBAS }
  const { raiz, salida } = estadoCon(config, () => ['--paso', '0'], {}, entorno)
  assert.match(salida, /^VERIFICACIÓN INICIAL: en segundo plano \(pid \d+\); la espera --guardar … exploracion$/m)
  assert.match(salida, /^BASE_GLOBAL=\w+ DESDE_GLOBAL=\S+$/m)

  // --guardar … exploracion espera la corrida aunque no encuentre el informe.
  const guardado = estadoEn(raiz, ['--guardar', 'no-existe', 'exploracion'], entorno).salida
  assert.match(guardado, /^AVISO: no encontré el informe del agente no-existe/m)
  assert.match(guardado, /^VERIFICACIÓN INICIAL: VERDE$/m)
  assert.match(estadoEn(raiz, ['--estado'], entorno).salida, /^VERIFICACIÓN INICIAL: VERDE$/m)
  const estado = JSON.parse(fs.readFileSync(path.join(flujoDe(raiz), 'estado.json'), 'utf8'))
  assert.equal(estado.verificacion_inicial.resultado, 'RESULTADO: VERDE')
  assert.ok(fs.existsSync(estado.verificacion_inicial.log))
})

test('preflight: la verificación inicial ROJA nombra los pasos y el detalle', () => {
  const config = { verificar: [{ nombre: 'falla', cmd: 'node -e "process.exit(1)"' }] }
  const { raiz, salida } = estadoCon(config, () => ['--paso', '0'], {}, { FLUJOS_INICIAL: undefined })
  assert.match(salida, /^VERIFICACIÓN INICIAL: en segundo plano /m)
  const estado = estadoEn(raiz, ['--estado']).salida
  assert.match(estado, /^VERIFICACIÓN INICIAL: ROJA \(falla\) · detalle: .*verificacion-inicial\.log$/m)
})

test('preflight: sin pasos la verificación inicial es SIN PASOS', () => {
  const { raiz, salida } = estadoCon({}, () => ['--paso', '0'], {}, { FLUJOS_INICIAL: undefined })
  assert.match(salida, /^VERIFICACIÓN INICIAL: SIN PASOS$/m)
  assert.match(estadoEn(raiz, ['--estado']).salida, /^VERIFICACIÓN INICIAL: SIN PASOS$/m)
})

const INSTALAR = fileURLToPath(new URL('../instalar.mjs', import.meta.url))

test('instalar: archiva las copias viejas de ~/.claude sin borrar, frena lo editado y deja los registros', () => {
  const destino = fs.mkdtempSync(path.join(os.tmpdir(), 'instalar-'))
  temporales.push(destino)
  const poner = (rel, texto) => {
    fs.mkdirSync(path.dirname(path.join(destino, rel)), { recursive: true })
    fs.writeFileSync(path.join(destino, rel), texto)
  }
  const hash = (texto) => crypto.createHash('sha1').update(texto).digest('hex')
  const instalar = (...args) => {
    const r = spawnSync(process.execPath, [INSTALAR, ...args], { encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: destino } })
    return { salida: r.stdout ?? '', codigo: r.status }
  }
  // Sin manifiesto no hay nada que limpiar.
  assert.match(instalar().salida, /^RESULTADO: nada que limpiar/m)

  const copias = { 'flujos/pasos.md': 'pasos\n', 'flujos/qcc-commit/solo-git.mjs': 'git\n', 'agents/qcc-ejecutor.md': 'agente\n', 'skills/qcc-commit/SKILL.md': 'skill\n', 'flujos/editado.md': 'original\n' }
  for (const [rel, texto] of Object.entries(copias)) poner(rel, texto)
  poner('flujos/.instalado.json', JSON.stringify({ ...Object.fromEntries(Object.entries(copias).map(([rel, texto]) => [rel, hash(texto)])), 'flujos/ya-no-esta.md': hash('x') }))
  fs.appendFileSync(path.join(destino, 'flujos/editado.md'), 'edición a mano\n')
  poner('flujos/registros/flujos.jsonl', '{}\n')

  // Sin --limpiar solo lista.
  const lista = instalar()
  assert.match(lista.salida, /archivaría .*agents\/qcc-ejecutor\.md/)
  assert.match(lista.salida, /editado .*flujos\/editado\.md se editó ahí/)
  assert.match(lista.salida, /^RESULTADO: 4 por archivar \(--limpiar lo hace\) · 1 sin tocar$/m)
  assert.equal(lista.codigo, 1)
  assert.ok(fs.existsSync(path.join(destino, 'agents', 'qcc-ejecutor.md')))

  const hecha = instalar('--limpiar')
  assert.match(hecha.salida, /^RESULTADO: 4 archivado\(s\) en .*_archivo-limpieza-\d{4}-\d{2}-\d{2} · 1 sin tocar$/m)
  const archivo = fs.readdirSync(destino).find((n) => n.startsWith('_archivo-limpieza-'))
  assert.ok(archivo)
  for (const rel of ['flujos/pasos.md', 'flujos/qcc-commit/solo-git.mjs', 'agents/qcc-ejecutor.md', 'skills/qcc-commit/SKILL.md']) {
    assert.ok(!fs.existsSync(path.join(destino, rel)), `${rel} sigue en ~/.claude`)
    assert.equal(fs.readFileSync(path.join(destino, archivo, rel), 'utf8'), copias[rel])
  }
  // Lo editado y los registros se quedan; las carpetas vacías se quitan; el manifiesto solo guarda lo que sigue ahí.
  assert.ok(fs.existsSync(path.join(destino, 'flujos', 'editado.md')))
  assert.ok(fs.existsSync(path.join(destino, 'flujos', 'registros', 'flujos.jsonl')))
  assert.ok(!fs.existsSync(path.join(destino, 'skills', 'qcc-commit')))
  assert.ok(!fs.existsSync(path.join(destino, 'flujos', 'qcc-commit')))
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(path.join(destino, 'flujos', '.instalado.json'), 'utf8'))), ['flujos/editado.md'])
})

test('estado: --cambios ignora las lecturas', () => {
  const raiz = repo('lecturas-estado', { 'src/a.ts': 'a\n' })
  temporales.push(raiz)
  try {
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: raiz, encoding: 'utf8' }).trim()
    fs.writeFileSync(path.join(raiz, 'src/a.ts'), 'a2\n')
    const env = { ...process.env, CLAUDE_PROJECT_DIR: raiz }
    const cambios = () => spawnSync(process.execPath, [ESTADO, '--cambios', sha, '--desde', '2000-01-01T00:00:00.000Z', '--permitidos', 'src/a.ts'], { cwd: raiz, encoding: 'utf8', env }).stdout

    const antes = cambios()
    assert.match(antes, /^CAMBIOS desde \w+ \(1\): src\/ 1$/m)
    assert.match(antes, /ALCANCE: OK/)

    hook(raiz, 'explorador', ev(raiz, 'Read', { file_path: path.join(raiz, 'docs', 'leida.md') }))
    assert.equal(filasDe(raiz).at(-1)?.objetivo, 'docs/leida.md')

    const despues = cambios()
    assert.doesNotMatch(despues, /leida\.md/)
    assert.doesNotMatch(despues, /FUERA DE ALCANCE/)
    assert.equal(despues, antes)

    // Un script del ejecutor en un temporal queda en el registro, pero no es del alcance.
    const medir = path.join(os.tmpdir(), 'medir-flujo.mjs')
    assert.equal(hook(raiz, 'ejecutor', ev(raiz, 'Write', { file_path: medir })).stdout, '')
    assert.equal(filasDe(raiz).at(-1)?.decision, 'permitido')
    assert.equal(cambios(), antes)
  } finally {
    borrarRegistro(raiz)
  }
})

test('estado: listaPermitidos no parte en comas entre paréntesis', () => {
  assert.deepEqual(listaPermitidos("src/a.ts (nuevo, sin 'use server', cliente inyectado)"), ['src/a.ts'])
  assert.deepEqual(listaPermitidos("src/a.ts (nuevo, sin 'use server'), b/*.ts, c.md (doc, corto)"), ['src/a.ts', 'b/*.ts', 'c.md'])
  assert.deepEqual(permitidosDe('`src/a.ts` (nuevo, sin x), README.md — índice'), ['src/a.ts', 'README.md'])
})

test('estado: preflight avisa el contexto del proyecto por encima de 10k tokens', () => {
  const grande = estadoCon({}, () => [], { 'CLAUDE.md': '# Reglas\n' + 'x'.repeat(40_000) })
  assert.match(grande.salida, /^CONTEXTO DEL PROYECTO: ~11\d{3} tokens por agente \(CLAUDE\.md\)$/m)
  assert.match(grande.salida, /^AVISO: contexto del proyecto pesado: ~\$0,25 por flujo solo en escribirlo en caché; /m)
  assert.match(grande.salida, /^REGLAS DEL PROYECTO: .*\n^CONTEXTO DEL PROYECTO: /m)
  assert.equal(grande.codigo, 0)
})

test('estado: preflight sin AVISO de contexto por debajo del umbral', () => {
  const chico = estadoCon({}, () => [], { 'CLAUDE.md': 'Reglas cortas\n' })
  assert.match(chico.salida, /^CONTEXTO DEL PROYECTO: ~\d tokens por agente \(CLAUDE\.md\)$/m)
  assert.doesNotMatch(chico.salida, /AVISO/)
  const ninguno = estadoCon({}, () => [])
  assert.match(ninguno.salida, /^CONTEXTO DEL PROYECTO: ~0 tokens por agente \(ningún CLAUDE\.md ni AGENTS\.md\)$/m)
})

test('estado: contextoDelProyecto cuenta AGENTS.md solo sin CLAUDE.md y sigue los @import', () => {
  const sinClaude = repo('contexto', { 'AGENTS.md': 'a'.repeat(350) })
  temporales.push(sinClaude)
  assert.deepEqual(contextoDelProyecto(sinClaude), { tokens: 100, archivos: ['AGENTS.md'] })

  const conClaude = repo('contexto', { 'CLAUDE.md': 'c'.repeat(35), 'AGENTS.md': 'a'.repeat(350) })
  temporales.push(conClaude)
  assert.deepEqual(contextoDelProyecto(conClaude), { tokens: 10, archivos: ['CLAUDE.md'] })

  const importando = repo('contexto', {
    'CLAUDE.md': 'Ver @AGENTS.md y @docs/reglas.md, también @falta.md y `@en-codigo.md` y a@b.com\n```\n@en-bloque.md\n```\n',
    'AGENTS.md': 'a'.repeat(350),
    'docs/reglas.md': 'Sigue @otra.md y vuelve a @../CLAUDE.md',
    'docs/otra.md': 'o'.repeat(70),
    'en-codigo.md': 'z'.repeat(700),
    'en-bloque.md': 'z'.repeat(700),
  })
  temporales.push(importando)
  const { tokens, archivos } = contextoDelProyecto(importando)
  assert.deepEqual(archivos, ['CLAUDE.md', 'AGENTS.md', 'docs/reglas.md', 'docs/otra.md'])
  const bytes = ['CLAUDE.md', 'AGENTS.md', 'docs/reglas.md', 'docs/otra.md'].reduce((s, a) => s + fs.statSync(path.join(importando, a)).size, 0)
  assert.equal(tokens, Math.round(bytes / 3.5))

  const importado = estadoEn(importando, [])
  assert.match(importado.salida, /^CONTEXTO DEL PROYECTO: ~\d+ tokens por agente \(CLAUDE\.md, AGENTS\.md, docs\/reglas\.md, docs\/otra\.md\)$/m)
})

test.after(() => limpiar())
