// Casos de estado.mjs (preflight, planes, fotos, cierre), de la config del flujo y de instalar.mjs.

import { repo, temporales, estadoEn, estadoCon, limpiar, transcripts, subtareaDePlan, repoConPlanGuardado } from './pruebas-comun.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { flujoDe, regexDeExterno } from './guardia.mjs'
import { lotesDe, opcionesDe, permitidosDe, criticosDe, fusionarPlanes, partesDelPlan, decisionesDelPlan, fusionarExploraciones, techoDeExploradores, topeDeLineas, avisosDeLargo, externoDe, parecenExternas } from './estado.mjs'

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

const EXTERNO_SEMILLA = '- Externo: node scripts/seed.mjs · contra la base de pruebas · reversible: sí\n'

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

test.after(() => limpiar())
