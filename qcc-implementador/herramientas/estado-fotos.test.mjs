// Casos de estado.mjs (preflight, planes, fotos, cierre), de la config del flujo y de instalar.mjs.

import { repo, temporales, estadoEn, estadoCon, limpiar, transcripts, subtareaDePlan, repoConPlanGuardado, ev, hook, transcriptConLineas, turnoConUso, sesionConImpl } from './pruebas-comun.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { flujoDe, regexDePermiso, evaluar } from './guardia.mjs'
import { lotesDe, opcionesDe, permitidosDe, criticosDe, fusionarPlanes, partesDelPlan, decisionesDelPlan, fusionarExploraciones, hallazgosDe, sinExplorarDe, avisosDeLargo, permisosDe, parecenExternas, comandosParaTi, permitidosDeSubtarea, noPareceRuta, contextoDe, acopladosSinCubrir } from './estado.mjs'

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

test('plan: la prosa tras Costo no entra en el pie', () => {
  const prosa = 'Omití X; riesgo Y'
  // Con o sin renglón vacío antes, la prosa tras «Costo:» se descarta.
  assert.deepEqual(partesDelPlan(`${PLAN}\n\n${prosa}`).pie, partesDelPlan(PLAN).pie)
  assert.deepEqual(partesDelPlan(`${PLAN}\n${prosa}`).pie, partesDelPlan(PLAN).pie)
  const replan = `S1 · Cambiar la guardia\n- Crítica: sí\nVerificación final: v\nQueda para ti: nada\nCosto: 1 ejecutor(es)\n\n${prosa}`
  const fusion = fusionarPlanes(PLAN, replan)
  assert.doesNotMatch(fusion, /Omití X/)
  assert.match(fusion, /^Costo: 1 ejecutor\(es\)$/m)

  // «Queda para ti» con líneas `! comando` (sin viñeta) antes de «Costo:» se conserva entero.
  const conComandos = PLAN.replace('Queda para ti: nada', 'Queda para ti: migrar\n! pnpm db:migrate  # requiere red\n! pnpm db:seed')
  const pie = partesDelPlan(`${conComandos}\n\n${prosa}`).pie
  assert.deepEqual(pie, partesDelPlan(conComandos).pie)
  assert.ok(pie.includes('! pnpm db:migrate  # requiere red') && pie.includes('! pnpm db:seed'))

  // Una subtarea o un «Sin cambios» tras «Costo:» siguen contando.
  const tras = partesDelPlan(`${PLAN}\nS3 · Otra\n- Crítica: no\nSin cambios: S1`)
  assert.deepEqual(tras.subtareas.map((s) => s.n), [1, 2, 3])
  assert.deepEqual(tras.subtareas[2].lineas, ['S3 · Otra', '- Crítica: no'])
})

test('plan: --guardar un plan nuevo descarta la prosa tras Costo y deja el resto igual', () => {
  const claude = transcripts({
    sola: `${PLAN}\n\nOmití X; riesgo Y`,
    pegada: `${PLAN}\nOmití X; riesgo Y\nOtra línea`,
    limpia: PLAN,
  })
  const entorno = { CLAUDE_CONFIG_DIR: claude }
  const { raiz } = estadoCon({}, () => ['--guardar', 'sola', 'plan', '--paso', '2'], {}, entorno)
  const plan = () => fs.readFileSync(path.join(flujoDe(raiz), 'plan.md'), 'utf8')
  assert.equal(plan(), PLAN + '\n')
  estadoEn(raiz, ['--guardar', 'pegada', 'plan'], entorno)
  assert.equal(plan(), PLAN + '\n')
  estadoEn(raiz, ['--guardar', 'limpia', 'plan'], entorno)
  assert.equal(plan(), PLAN + '\n')
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
  assert.match(estadoEn(raiz, ['--guardar', 'planuno', 'otro'], entorno).salida, /^AVISO: --guardar <agentId> plan\|exploracion\|revision: tipo desconocido «otro»/m)
})

test('estado: lotesDe junta subtareas independientes cuyos permitidos no se pisan', () => {
  const s = (n, permitidos, depende) => ({ n, permitidos, depende })
  const a = ['a.ts']
  const casos = [
    ['sin subtareas', [], []],
    ['serial: ausente depende de la anterior', [s(1, a), s(2, ['b.ts']), s(3, ['c.ts'])], [[1], [2], [3]]],
    ['null cuenta como ausente', [s(1, a), s(2, ['b.ts'], null)], [[1], [2]]],
    ['independientes', [s(1, a), s(2, ['b.ts'], []), s(3, ['c.ts'], [])], [[1, 2, 3]]],
    ['tope de 4', [s(1, a), s(2, ['b.ts'], []), s(3, ['c.ts'], []), s(4, ['d.ts'], [])], [[1, 2, 3, 4]]],
    ['depende de un miembro del lote', [s(1, a), s(2, ['b.ts'], []), s(3, ['c.ts'], [1])], [[1, 2], [3]]],
    ['el lote siguiente puede seguir sumando', [s(1, a), s(2, ['b.ts'], []), s(3, ['c.ts'], [1]), s(4, ['d.ts'], [])], [[1, 2, 4], [3]]],
    ['ondas', [s(1, a), s(2, ['b.ts']), s(3, ['c.ts'], [])], [[1, 3], [2]]],
    ['una que se pisa con una anterior no se adelanta', [s(1, a), s(2, ['b.ts']), s(3, ['b.ts'], [])], [[1], [2], [3]]],
    ['barrera con permitido dudoso', [s(1, a), s(2, ['b.mjs y sus tests'], []), s(3, ['c.ts'], [])], [[1], [2], [3]]],
    ['tope de 4 con 5 independientes', [1, 2, 3, 4, 5].map((n) => s(n, [`f${n}.ts`], [])), [[1, 2, 3, 4], [5]]],
    ['depende de una de un lote posterior', [s(1, a), s(2, ['b.ts']), s(3, ['c.ts'], []), s(4, ['d.ts'], [2])], [[1, 3], [2], [4]]],
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
    ['sola sin dependencias comparte onda pero no lote', [s(1, a), { ...s(2, ['b.ts'], []), sola: true }, s(3, ['c.ts'], [])], [[1, 3], [2]]],
    ['sola que se pisa con una previa va después', [s(1, a), { ...s(2, a, []), sola: true }, s(3, ['c.ts'], [])], [[1, 3], [2]]],
    ['una posterior que depende de sola va después', [s(1, a), { ...s(2, ['b.ts'], []), sola: true }, s(3, ['c.ts'], [2])], [[1], [2], [3]]],
    ['una posterior que se pisa con sola va después', [s(1, a), { ...s(2, ['b.ts'], []), sola: true }, s(3, ['b.ts'], [])], [[1], [2], [3]]],
    ['dos sola no comparten lote', [s(1, a), { ...s(2, ['b.ts'], []), sola: true }, { ...s(3, ['c.ts'], []), sola: true }], [[1], [2], [3]]],
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

test('plan: permitidosDeSubtarea lee viñetas, continuaciones, «;» y avisa las rutas dudosas', () => {
  const de = (texto) => permitidosDeSubtarea(texto.split('\n'), 1)
  // (a) viñetas
  assert.deepEqual(de('- Archivos permitidos:\n  - `a.mjs`\n  - b.test.mjs (nuevo)'), { permitidos: ['a.mjs', 'b.test.mjs'], avisos: [] })
  assert.deepEqual(de('- Archivos permitidos:\n  * a.mjs\n  * b.mjs'), { permitidos: ['a.mjs', 'b.mjs'], avisos: [] })
  // (b) continuación de una lista con coma, y con la 1.ª línea ya con valor
  assert.deepEqual(de('- Archivos permitidos: a.mjs,\n  b.mjs').permitidos, ['a.mjs', 'b.mjs'])
  assert.deepEqual(de('- Archivos permitidos: a.mjs\n  b.mjs').permitidos, ['a.mjs', 'b.mjs'])
  // (c) «;» fuera de paréntesis parte; dentro no
  assert.deepEqual(de('- Archivos permitidos: a.mjs; b.mjs (generado; build)'), { permitidos: ['a.mjs', 'b.mjs'], avisos: [] })
  assert.deepEqual(permitidosDe('a.mjs; b.mjs, c.mjs'), ['a.mjs', 'b.mjs', 'c.mjs'])
  // (d) frase
  assert.deepEqual(de('- Archivos permitidos: a.mjs y sus tests'), { permitidos: ['a.mjs y sus tests'], avisos: ['S1 · permitido «a.mjs y sus tests» no parece una ruta'] })
  // (e) termina en punto
  assert.deepEqual(de('- Archivos permitidos: a.md.'), { permitidos: ['a.md.'], avisos: ['S1 · permitido «a.md.» no parece una ruta'] })
  // (f) el campo siguiente corta el bloque
  assert.deepEqual(de('- Archivos permitidos: a.mjs\n- Hecho cuando:\n  - b.mjs existe'), { permitidos: ['a.mjs'], avisos: [] })
  // (g) campo vacío; rutas a la misma sangría que el campo no se leen; sin campo no avisa (ya sale «falta»)
  assert.deepEqual(de('- Archivos permitidos:\n- Hecho cuando: x'), { permitidos: [], avisos: ['S1 · Archivos permitidos: no se leyó ninguna ruta'] })
  assert.deepEqual(de('- Archivos permitidos:\n- a.mjs').avisos, ['S1 · Archivos permitidos: no se leyó ninguna ruta'])
  assert.deepEqual(de('- Hecho cuando: x'), { permitidos: [], avisos: [] })
  // (h) negritas y explicación
  assert.deepEqual(de('- **Archivos permitidos:** `a.mjs` (modo nuevo), README.md — índice'), { permitidos: ['a.mjs', 'README.md'], avisos: [] })
  // Un glob con «**» conserva sus asteriscos.
  assert.deepEqual(de('- Archivos permitidos: src/**/*.ts').permitidos, ['src/**/*.ts'])
  assert.equal(noPareceRuta('a b'), true)
  assert.equal(noPareceRuta('a.md.'), true)
  assert.equal(noPareceRuta('src/a.md'), false)
})

test('plan: --guardar plan avisa los permitidos sin ruta o que no parecen una', () => {
  const { salida, estadoJson } = repoConPlanGuardado('permitidos-avisos', [
    subtareaDePlan(1, '\n  - src/a.ts y sus tests\n  - src/b.ts.\n  - `src/c.ts` (nuevo)'),
    subtareaDePlan(2, ''),
    subtareaDePlan(3, 'src/d.ts; src/e.ts'),
  ])
  assert.match(salida, /^ {2}- S1 · permitido «src\/a\.ts y sus tests» no parece una ruta$/m)
  assert.match(salida, /^ {2}- S1 · permitido «src\/b\.ts\.» no parece una ruta$/m)
  assert.doesNotMatch(salida, /S1 · permitido «src\/c\.ts/)
  assert.match(salida, /^ {2}- S2 · Archivos permitidos: no se leyó ninguna ruta$/m)
  assert.doesNotMatch(salida, /S2 · falta «Archivos permitidos»/)
  assert.doesNotMatch(salida, /S3 · permitido/)
  assert.deepEqual(estadoJson().subtareas.map((s) => s.permitidos), [['src/a.ts y sus tests', 'src/b.ts.', 'src/c.ts'], [], ['src/d.ts', 'src/e.ts']])
})

const PIE_PERMISOS = [
  'PERMISOS A APROBAR:',
  '  P1 · ejecutor S3 · `pnpm db:push` · Supabase dev · reversible: no',
  '     Qué hace: revisa y aplica las migraciones pendientes en la base linkeada.',
  '     Para qué: S3 necesita la columna nueva para probar contra datos reales.',
  '  P2 · ejecutor S5 · `node --env-file=.env scripts/flow/tunel/ui.mjs sem4 *` · Flow sandbox · reversible: no',
  '     Qué hace: abre Mi suscripción de la cuenta sem4 en el navegador y ejecuta la acción indicada.',
  '     Para qué: medir qué cobra Flow al subir cupo durante el trial.',
  '  P3 · orquestador · `pnpm dev` (en fondo, lo cierra al terminar) · local + túnel · reversible: sí',
  '     Qué hace: levanta Vite y expone la app en dev.horaki.cl.',
  '     Para qué: que Playwright use la app y lleguen los webhooks de Flow.',
].join('\n')
const SUBTAREAS_5 = [1, 2, 3, 4, 5].map((n) => subtareaDePlan(n, `src/${'abcde'[n - 1]}.ts`))

test('plan: permisosDe lee el bloque del pie', () => {
  const [p1, p2, p3] = permisosDe(PIE_PERMISOS.split('\n'))
  assert.deepEqual(p1, { id: 'P1', rol: 'ejecutor', sub: 3, comando: 'pnpm db:push', servicio: 'Supabase dev', reversible: false, queHace: 'revisa y aplica las migraciones pendientes en la base linkeada.', paraQue: 'S3 necesita la columna nueva para probar contra datos reales.' })
  assert.deepEqual([p2.sub, p2.comando], [5, 'node --env-file=.env scripts/flow/tunel/ui.mjs sem4 *'])
  assert.deepEqual([p3.rol, 'sub' in p3, p3.comando, p3.servicio, p3.reversible], ['orquestador', false, 'pnpm dev', 'local + túnel', true])
  assert.deepEqual(permisosDe(['Costo: x']), [])
  // Sin «reversible» cuenta como no y queda marcado; sin comillas invertidas no hay comando.
  const [q1, q2] = permisosDe(['PERMISOS A APROBAR:', '  P1 · ejecutor S1 · `gh pr list` · GitHub', '  P2 · revisor · sin comillas · x · reversible: sí'])
  assert.deepEqual([q1.reversible, q1.sinReversible, q2.rol, q2.comando], [false, true, 'revisor', ''])
  assert.ok(regexDePermiso(p1.comando) && regexDePermiso(p2.comando) && regexDePermiso(p3.comando))
})

test('plan: los permisos del ejemplo salen en PARA APROBAR, normal y compacto, sin AVISOS', () => {
  const { salida, estadoJson, raiz } = repoConPlanGuardado('permisos-resumen', [...SUBTAREAS_5, PIE_PERMISOS])
  assert.match(salida, /^AVISOS: ninguno$/m)
  const aprobar = salida.slice(salida.indexOf('PARA APROBAR'))
  assert.match(aprobar, /^PERMISOS A APROBAR:\n {2}P1 · ejecutor S3 · `pnpm db:push` · Supabase dev · reversible: no\n {5}Qué hace: revisa/m)
  assert.match(aprobar, /P3 · orquestador · `pnpm dev` \(en fondo[^\n]*\n {5}Qué hace: levanta Vite[^\n]*\n {5}Para qué: que Playwright/)
  const { P1, P2, P3 } = estadoJson().permisos
  assert.deepEqual(P1, { rol: 'ejecutor', sub: 3, comando: 'pnpm db:push', servicio: 'Supabase dev', reversible: false, queHace: 'revisa y aplica las migraciones pendientes en la base linkeada.', paraQue: 'S3 necesita la columna nueva para probar contra datos reales.' })
  assert.deepEqual([P2.sub, P3.rol, P3.reversible], [5, 'orquestador', true])
  assert.equal('externo' in estadoJson().subtareas[2], false)
  // S<n>.md lista sus permisos.
  const sn = (n) => fs.readFileSync(path.join(flujoDe(raiz), `S${n}.md`), 'utf8')
  assert.match(sn(3), /^Permisos \(.*\):\n- P1 · `pnpm db:push` · Supabase dev · reversible: no · Qué hace: revisa .* · Para qué: S3 necesita/m)
  assert.match(sn(5), /^- P2 · `node --env-file=\.env scripts\/flow\/tunel\/ui\.mjs sem4 \*`/m)
  assert.match(sn(1), /^Permisos: ninguno$/m)
  assert.doesNotMatch(sn(1) + sn(2) + sn(4), /pnpm dev/)

  // Compacto (más de 20 subtareas): el bloque también va completo.
  const muchas = Array.from({ length: 21 }, (_, i) => subtareaDePlan(i + 1, `src/${'abc'[i % 3]}.ts`))
  const c = repoConPlanGuardado('permisos-compacto', [...muchas, PIE_PERMISOS.replace('S3', 'S1').replace('S5', 'S2')]).salida
  assert.match(c, /^AVISOS: ninguno$/m)
  assert.match(c.slice(c.indexOf('PARA APROBAR')), /^PERMISOS A APROBAR:\n {2}P1 · ejecutor S1 .*\n {5}Qué hace:.*\n {5}Para qué:.*\n {2}P2 · ejecutor S2/m)
})

test('plan: AVISOS de permisos', () => {
  const pie = (...lineas) => ['PERMISOS A APROBAR:', ...lineas].join('\n')
  const hace = ['     Qué hace: x', '     Para qué: y']
  const avisos = (lineas) => repoConPlanGuardado('permisos-avisos', [...SUBTAREAS_5.slice(0, 2), pie(...lineas)]).salida
  // Campos que faltan, quién inválido y subtarea inexistente.
  let s = avisos(['  P1 · ejecutor S1 · `pnpm db:push` · Supabase', '  P2 · revisor · `pnpm dev` · local · reversible: sí', ...hace, '  P3 · ejecutor S9 · `pnpm dev` · local · reversible: sí', ...hace])
  assert.match(s, /^ {2}- P1 · le falta «reversible: sí \| no» \(cuenta como no\), «Qué hace», «Para qué»$/m)
  assert.match(s, /^ {2}- P2 · quién «revisor» no vale/m)
  assert.match(s, /^ {2}- P3 · quién «ejecutor S9» no vale/m)
  // Comodín inválido, lo que se niega aun aprobado y un script que la subtarea puede editar.
  s = avisos(['  P1 · ejecutor S1 · `pnpm *` · x · reversible: sí', ...hace, '  P2 · ejecutor S1 · `git commit -m x` · x · reversible: sí', ...hace, '  P3 · ejecutor S2 · `node src/b.ts` · x · reversible: sí', ...hace])
  assert.match(s, /^ {2}- P1 · «pnpm \*» no se puede aprobar/m)
  assert.match(s, /^ {2}- P2 · «git commit -m x» se niega aun aprobado/m)
  assert.match(s, /^ {2}- P3 · «src\/b\.ts» está en los permitidos de una subtarea/m)
  // Bloque sin permisos leídos (quedó tras «Costo:»).
  s = repoConPlanGuardado('permisos-costo', [...SUBTAREAS_5.slice(0, 1), 'Costo: x\nPERMISOS A APROBAR:\n  P1 · ejecutor S1 · `pnpm dev` · x · reversible: sí\n     Qué hace: x\n     Para qué: y']).salida
  assert.match(s, /^ {2}- PERMISOS A APROBAR: el bloque está pero no se leyó ningún permiso/m)
})

test('plan: AVISO si una subtarea sin permiso parece externa', () => {
  const { salida } = repoConPlanGuardado('externo-aviso', [
    subtareaDePlan(1, 'src/a.ts', { hecho: 'node --test → verde' }),
    subtareaDePlan(2, 'src/b.ts', { hecho: 'abre el servidor y Playwright ve el botón' }),
    subtareaDePlan(3, 'src/c.ts', { hecho: 'verde\n  - corre `supabase db push --linked` y responde 200' }),
  ])
  assert.doesNotMatch(salida, /S1 parece externa/)
  assert.match(salida, /^ {2}- S2 parece externa y no tiene permiso \(menciona «servidor»\)/m)
  assert.match(salida, /^ {2}- S3 parece externa y no tiene permiso \(menciona «--linked»\)/m)
  for (const [texto, palabra] of [['localhost', 'localhost'], ['--env-file', '--env-file'], ['deploy', 'deploy'], ['GET a /salud', 'GET a']]) {
    assert.equal(parecenExternas([`- Tests: prueba con ${texto}`]), palabra, texto)
  }
  assert.equal(parecenExternas(['- Hecho cuando: curl -sI https://example.com → 200']), null)
  assert.equal(parecenExternas(['- Tests: corre playwright test e2e/flujo.spec.ts']), null)
  assert.equal(parecenExternas(['- Hecho cuando: playwright-cli snapshot muestra el botón']), null)
  assert.equal(parecenExternas(['- Archivos permitidos: curl.ts', '- Reversión: borrar el servidor']), null)
  assert.equal(parecenExternas(['- Riesgos: r', '  - sub: deploy', '- Reversión: v']), 'deploy')
})

test('plan: AVISO si «Queda para ti» trae comandos que un agente podría correr aprobados', () => {
  assert.deepEqual(comandosParaTi([
    'Queda para ti: la verificación visual; además',
    '`! pnpm supabase db push  # (objetivo) requiere red`',
    '  - `! supabase functions deploy calcular  # requiere red`',
    '  - `! git push` · `! rm -rf dist`',
  ]), ['pnpm supabase db push', 'supabase functions deploy calcular'])
  assert.deepEqual(comandosParaTi(['PERMISOS A APROBAR:', '  P1 · ejecutor S1 · `pnpm db:push` · Supabase', 'Queda para ti: nada']), [])
  const { salida } = repoConPlanGuardado('para-ti-aviso', [subtareaDePlan(1, 'src/a.ts'), 'Queda para ti: `! supabase db push  # requiere red`'])
  assert.match(salida, /^ {2}- «Queda para ti» trae comandos \(`supabase db push`\): los que un agente/m)
})

test('plan: sin AVISO con permiso en la subtarea', () => {
  const { salida } = repoConPlanGuardado('externo-sin-aviso', [
    subtareaDePlan(1, 'src/a.ts'),
    subtareaDePlan(2, 'src/b.ts', { hecho: 'curl a localhost responde 200 contra el servidor' }),
    'PERMISOS A APROBAR:\n  P1 · ejecutor S2 · `node scripts/seed.mjs` · base de pruebas · reversible: sí\n     Qué hace: siembra.\n     Para qué: probar.',
  ])
  assert.doesNotMatch(salida, /parece externa/)
  assert.match(salida, /^AVISOS: ninguno$/m)
})

const PLAN_P = [subtareaDePlan(1, 'src/a.ts'), subtareaDePlan(2, 'src/b.ts'), 'PERMISOS A APROBAR:\n  P1 · ejecutor S2 · `node scripts/seed.mjs` · base de pruebas · reversible: sí\n     Qué hace: siembra.\n     Para qué: probar.']
const aprobadoDe = (e, id) => e.permisos[id].aprobado

test('--permiso id aprobado anota la aprobación y el re-plan la conserva solo si no cambia', () => {
  const { raiz, entorno, estadoJson } = repoConPlanGuardado('permiso-aprobado', PLAN_P, [
    // renumera P1 → P4 (mismo quién y comando) y suma un permiso nuevo
    PLAN_P[1], 'PERMISOS A APROBAR:\n  P4 · ejecutor S2 · `node scripts/seed.mjs` · base de pruebas · reversible: sí\n     Qué hace: siembra.\n     Para qué: probar.',
  ].join('\n\n'))
  assert.equal('aprobado' in estadoJson().permisos.P1, false)

  const r = estadoEn(raiz, ['--permiso', 'p1', 'aprobado', '--paso', '4'], entorno)
  assert.equal(r.codigo, 0)
  assert.match(r.salida, /^PERMISO: P1 aprobado$/m)
  assert.ok(Number.isFinite(Date.parse(aprobadoDe(estadoJson(), 'P1'))))
  assert.match(estadoEn(raiz, ['--estado'], entorno).salida, /^ {2}PERMISO P1 · ejecutor S2 · node scripts\/seed\.mjs \(reversible: sí\) · aprobado \S+$/m)
  assert.match(estadoEn(raiz, ['--reanudar'], entorno).salida, /PERMISO P1 · ejecutor S2 .* · aprobado /)

  // Un re-plan que solo renumera conserva la aprobación.
  const antes = aprobadoDe(estadoJson(), 'P1')
  estadoEn(raiz, ['--guardar', 'ajuste', 'plan', '--ajuste'], entorno)
  assert.deepEqual(Object.keys(estadoJson().permisos), ['P4'])
  assert.equal(aprobadoDe(estadoJson(), 'P4'), antes)
})

test('un re-plan que cambia el comando deja el permiso sin aprobar; --ajuste sin bloque conserva los permisos', () => {
  const cambia = `${PLAN_P[1]}\n\nPERMISOS A APROBAR:\n  P1 · ejecutor S2 · \`node scripts/otro.mjs\` · base de pruebas · reversible: sí\n     Qué hace: siembra.\n     Para qué: probar.`
  const { raiz, entorno, estadoJson } = repoConPlanGuardado('permiso-cambia', PLAN_P, cambia)
  estadoEn(raiz, ['--permiso', 'P1', 'aprobado', '--paso', '4'], entorno)
  estadoEn(raiz, ['--guardar', 'ajuste', 'plan', '--ajuste'], entorno)
  assert.equal(estadoJson().permisos.P1.comando, 'node scripts/otro.mjs')
  assert.equal('aprobado' in estadoJson().permisos.P1, false)

  // Un ajuste que solo trae una subtarea (sin pie ni bloque) no pierde los permisos.
  const sin = repoConPlanGuardado('permiso-sin-bloque', PLAN_P, subtareaDePlan(1, 'src/a.ts'))
  estadoEn(sin.raiz, ['--permiso', 'P1', 'aprobado', '--paso', '4'], sin.entorno)
  estadoEn(sin.raiz, ['--guardar', 'ajuste', 'plan', '--ajuste'], sin.entorno)
  assert.equal(sin.estadoJson().permisos.P1.comando, 'node scripts/seed.mjs')
  assert.ok(sin.estadoJson().permisos.P1.aprobado)
  // Con pie propio pero sin bloque, tampoco: el bloque anterior se conserva.
  assert.match(fusionarPlanes(`PLAN · x\nClasificación: c\n\n${PLAN_P.join('\n\n')}\nCosto: 1`, `${subtareaDePlan(1, 'src/a.ts')}\n\nCosto: 2`), /PERMISOS A APROBAR:\n {2}P1 · ejecutor S2[^]*Costo: 2$/)
})

test('--permiso rechaza ids que no existen o que no son «aprobado»', () => {
  const { raiz, entorno, estadoJson } = repoConPlanGuardado('permiso-rechaza', PLAN_P)
  for (const [args, mensaje] of [
    [['P9', 'aprobado'], /^ERROR: P9 no está en los permisos del plan guardado$/m],
    [['P1', 'rechazado'], /^ERROR: --permiso P1: solo vale «aprobado»/m],
    [['P1'], /^ERROR: --permiso P1: solo vale «aprobado»/m],
    [['x', 'aprobado'], /^ERROR: --permiso necesita el id del permiso/m],
  ]) {
    const r = estadoEn(raiz, ['--permiso', ...args, '--paso', '4'], entorno)
    assert.match(r.salida, mensaje, args.join(' '))
    assert.equal(r.codigo, 2, args.join(' '))
    assert.doesNotMatch(r.salida, /PERMISO: /, args.join(' '))
  }
  assert.equal('aprobado' in estadoJson().permisos.P1, false)

  // Sin flujo abierto no hay dónde anotar.
  const sinFlujo = repo('externo-sin-flujo', { 'src/a.ts': 'a\n' })
  temporales.push(sinFlujo)
  const s = estadoEn(sinFlujo, ['--permiso', 'P1', 'aprobado', '--paso', '4'], entorno)
  assert.match(s.salida, /^ERROR: el flujo no está abierto/m)
  assert.equal(s.codigo, 2)
  assert.equal(fs.existsSync(path.join(flujoDe(sinFlujo), 'estado.json')), false)

  // opcionesDe: las claves de --permiso son condicionales y el modo no se confunde con el preflight.
  assert.equal('permiso' in opcionesDe([]) || 'accion' in opcionesDe([]), false)
  const o = opcionesDe(['--permiso', 'n2', 'aprobado', '--paso', '4'])
  assert.deepEqual([o.modo, o.permiso, o.accion, o.paso], ['permiso', 'N2', 'aprobado', 4])
  assert.deepEqual([opcionesDe(['--permiso']).permiso, opcionesDe(['--permiso']).accion], [null, ''])
  assert.equal(opcionesDe(['--permiso', 'P0', 'aprobado']).permiso, null)
  assert.equal(opcionesDe(['--permiso', 'p1,n2', 'aprobado']).permiso, 'P1,N2')
  for (const malo of ['P1,', ',P1', 'P1,,P2', 'P1,x', 'P1 ,P2']) assert.equal(opcionesDe(['--permiso', malo, 'aprobado']).permiso, null, malo)
})

const permisoDe = (id, quien, comando) => `  ${id} · ${quien} · \`${comando}\` · base de pruebas · reversible: no\n     Qué hace: x.\n     Para qué: y.`
const planConPermisos = (...permisos) => [subtareaDePlan(1, 'src/a.ts'), subtareaDePlan(2, 'src/b.ts'), `PERMISOS A APROBAR:\n${permisos.join('\n')}`]

test('permisos: post-revisión no da aviso de quién y queda en el estado', () => {
  const { salida, estadoJson } = repoConPlanGuardado('permiso-post', planConPermisos(permisoDe('P1', 'post-revisión', 'pnpm db:push')))
  assert.doesNotMatch(salida, /no vale/)
  assert.doesNotMatch(salida, /no parece un servidor/)
  assert.match(salida, /^AVISOS: ninguno$/m)
  assert.equal(estadoJson().permisos.P1.rol, 'post-revisión')
  assert.equal(estadoJson().permisos.P1.comando, 'pnpm db:push')
  // sola mira solo al ejecutor: una subtarea sin permisos propios no queda aparte por un post-revisión irreversible.
  assert.equal(estadoJson().subtareas.some((s) => s.sola), false)
})

test('permisos: orquestador con `pnpm db:push` avisa que no parece un servidor', () => {
  const { salida } = repoConPlanGuardado('permiso-orq-push', planConPermisos(permisoDe('P1', 'orquestador', 'pnpm db:push')))
  assert.match(salida, /^ {2}- P1 · «pnpm db:push» es del orquestador pero no parece un servidor .*¿es «post-revisión» o del ejecutor de una subtarea\?$/m)
})

test('permisos: orquestador con `pnpm dev` no avisa', () => {
  const { salida } = repoConPlanGuardado('permiso-orq-dev', planConPermisos(permisoDe('P1', 'orquestador', 'pnpm dev')))
  assert.doesNotMatch(salida, /no parece un servidor/)
  assert.match(salida, /^AVISOS: ninguno$/m)
})

const PLAN_PP = planConPermisos(permisoDe('P1', 'ejecutor S2', 'node scripts/seed.mjs'), permisoDe('P2', 'orquestador', 'pnpm dev'))

test('--permiso P1,P2 aprobado anota los dos', () => {
  const { raiz, entorno, estadoJson } = repoConPlanGuardado('permiso-lista', PLAN_PP)
  const r = estadoEn(raiz, ['--permiso', 'p1,P2', 'aprobado', '--paso', '4'], entorno)
  assert.equal(r.codigo, 0)
  assert.match(r.salida, /^PERMISO: P1 aprobado\nPERMISO: P2 aprobado$/m)
  assert.ok(Number.isFinite(Date.parse(aprobadoDe(estadoJson(), 'P1'))))
  assert.ok(Number.isFinite(Date.parse(aprobadoDe(estadoJson(), 'P2'))))
})

test('--permiso P1,P9 no anota ninguno (ERROR)', () => {
  const { raiz, entorno, estadoJson } = repoConPlanGuardado('permiso-lista-falla', PLAN_PP)
  const r = estadoEn(raiz, ['--permiso', 'P1,P9', 'aprobado', '--paso', '4'], entorno)
  assert.match(r.salida, /^ERROR: P9 no está en los permisos del plan guardado$/m)
  assert.equal(r.codigo, 2)
  assert.doesNotMatch(r.salida, /PERMISO: /)
  assert.equal('aprobado' in estadoJson().permisos.P1, false)
  assert.equal('aprobado' in estadoJson().permisos.P2, false)
})

test('--aprobado --permisos anota la aprobación y los permisos en una llamada; uno que falta no anota nada', () => {
  const { raiz, entorno, estadoJson } = repoConPlanGuardado('aprobado-permisos', PLAN_PP)
  const malo = estadoEn(raiz, ['--aprobado', '--permisos', 'P1,P9', '--paso', '4'], entorno)
  assert.match(malo.salida, /^ERROR: P9 no está en los permisos del plan guardado$/m)
  assert.equal(malo.codigo, 2)
  assert.equal(estadoJson().aprobacion, undefined)
  assert.equal('aprobado' in estadoJson().permisos.P1, false)
  assert.match(estadoEn(raiz, ['--aprobado', '--permisos', '', '--paso', '4'], entorno).salida, /^ERROR: --permisos necesita ids/m)
  const r = estadoEn(raiz, ['--aprobado', '--permisos', 'p1,P2', '--paso', '4'], entorno)
  assert.equal(r.codigo, 0)
  assert.match(r.salida, /^APROBADO: plan de 2 subtarea\(s\) · ajustes: ninguno\nPERMISO: P1 aprobado\nPERMISO: P2 aprobado$/m)
  assert.ok(estadoJson().aprobacion)
  assert.ok(Number.isFinite(Date.parse(aprobadoDe(estadoJson(), 'P2'))))
  assert.equal(opcionesDe(['--aprobado', '--permisos', 'P1']).permisos, 'P1')
  assert.equal('permisos' in opcionesDe(['--aprobado']), false)
})

test('permisos de punta a punta: --guardar plan, --permiso, --base --sub y la guardia', () => {
  const { raiz, entorno } = repoConPlanGuardado('permiso-punta', [
    subtareaDePlan(1, 'src/a.ts'),
    'PERMISOS A APROBAR:\n  P1 · ejecutor S1 · `docker ps -a` · docker local · reversible: sí\n     Qué hace: siembra.\n     Para qué: probar.',
  ])
  const pasa = (comando) => evaluar(ev(raiz, 'Bash', { command: comando }), 'ejecutor', raiz).motivo === null
  const cmd = 'docker ps -a'
  assert.equal(pasa(cmd), false)
  estadoEn(raiz, ['--permiso', 'P1', 'aprobado', '--paso', '4'], entorno)
  assert.equal(pasa(cmd), false, 'aprobado pero sin subtarea en curso')
  estadoEn(raiz, ['--base', '--sub', '1', '--paso', '5'], entorno)
  assert.equal(pasa(cmd), true)
  assert.equal(pasa('docker ps'), false)
  estadoEn(raiz, ['--cambios', '--sub', '1', '--paso', '5'], entorno)
  assert.equal(pasa(cmd), false)
})

const NUEVO = (comando, reversible = 'sí') => `${comando} · docker local · reversible: ${reversible} · Qué hace: lista · con · puntos. · Para qué: probar.`

test('--permiso-nuevo crea N1 aprobado, falla con lo que no se puede aprobar y sobrevive a un re-plan', () => {
  const { raiz, entorno, estadoJson } = repoConPlanGuardado('permiso-nuevo', PLAN_P, PLAN_P[1])
  const nuevo = (texto, ...resto) => estadoEn(raiz, ['--permiso-nuevo', texto, ...resto, '--paso', '5'], entorno)
  const r = nuevo(NUEVO('docker ps -a'), '--sub', '1')
  assert.equal(r.codigo, 0)
  assert.match(r.salida, /^PERMISO: N1 aprobado$/m)
  const { aprobado, ...n1 } = estadoJson().permisos.N1
  assert.deepEqual(n1, { rol: 'ejecutor', sub: 1, comando: 'docker ps -a', servicio: 'docker local', reversible: true, queHace: 'lista · con · puntos.', paraQue: 'probar.', nuevo: true })
  assert.ok(Number.isFinite(Date.parse(aprobado)))
  assert.match(nuevo(NUEVO('docker images', 'no'), '--sub', '2').salida, /^PERMISO: N2 aprobado$/m)
  assert.equal(estadoJson().permisos.N2.reversible, false)
  assert.match(estadoEn(raiz, ['--estado'], entorno).salida, /^ {2}PERMISO N1 · ejecutor S1 · docker ps -a \(reversible: sí\) · aprobado \S+$/m)

  for (const [args, mensaje] of [
    [[NUEVO('pnpm *'), '--sub', '1'], /^ERROR: «pnpm \*» no se puede aprobar/m],
    [[NUEVO('git commit -m x'), '--sub', '1'], /^ERROR: «git commit -m x» se niega aun aprobado/m],
    [[NUEVO('docker ps'), '--sub', '9'], /^ERROR: S9 no está en el plan guardado$/m],
    [[NUEVO('docker ps')], /^ERROR: --permiso-nuevo necesita --sub <n>/m],
    [[NUEVO('docker ps'), '--sub', '1,2'], /^ERROR: --permiso-nuevo necesita --sub <n>/m],
    [['docker ps · docker local · reversible: sí · Qué hace: x', '--sub', '1'], /^ERROR: --permiso-nuevo: el texto debe ser/m],
    [['docker ps · docker local · Qué hace: x · Para qué: y', '--sub', '1'], /^ERROR: --permiso-nuevo: el texto debe ser/m],
  ]) {
    const f = nuevo(...args)
    assert.match(f.salida, mensaje, args.join(' '))
    assert.equal(f.codigo, 2, args.join(' '))
  }
  assert.deepEqual(Object.keys(estadoJson().permisos).sort(), ['N1', 'N2', 'P1'])

  // Un re-plan que deja a S1 y S2 en el plan conserva N1 y N2.
  estadoEn(raiz, ['--guardar', 'ajuste', 'plan', '--ajuste'], entorno)
  assert.deepEqual(Object.keys(estadoJson().permisos).sort(), ['N1', 'N2', 'P1'])
  assert.equal(estadoJson().permisos.N1.aprobado, aprobado)

  // Sin flujo abierto no hay dónde anotar; opcionesDe reconoce el modo.
  const sinFlujo = repo('permiso-nuevo-sin-flujo', { 'src/a.ts': 'a\n' })
  temporales.push(sinFlujo)
  assert.match(estadoEn(sinFlujo, ['--permiso-nuevo', NUEVO('docker ps'), '--sub', '1'], entorno).salida, /^ERROR: el flujo no está abierto/m)
  const o = opcionesDe(['--permiso-nuevo', 'x', '--sub', '2', '--paso', '5'])
  assert.deepEqual([o.modo, o.permisoNuevo, o.sub, o.paso], ['permisoNuevo', 'x', 2, 5])
  assert.equal('permisoNuevo' in opcionesDe([]), false)
})

test('--permiso-nuevo: N<k> sigue al mayor y la guardia lo deja pasar solo en la subtarea en curso', () => {
  const { raiz, entorno } = repoConPlanGuardado('permiso-nuevo-guardia', [subtareaDePlan(1, 'src/a.ts')])
  estadoEn(raiz, ['--permiso-nuevo', NUEVO('docker ps -a'), '--sub', '1'], entorno)
  const pasa = (comando) => evaluar(ev(raiz, 'Bash', { command: comando }), 'ejecutor', raiz).motivo === null
  assert.equal(pasa('docker ps -a'), false, 'sin subtarea en curso')
  estadoEn(raiz, ['--base', '--sub', '1', '--paso', '5'], entorno)
  assert.equal(pasa('docker ps -a'), true)
})

test('plan: una subtarea con permiso irreversible queda sola en LOTES', () => {
  const sin = { extra: '- Depende de: ninguna\n' }
  const permiso = (reversible) => `PERMISOS A APROBAR:\n  P1 · ejecutor S2 · \`node scripts/seed.mjs\` · base de pruebas · reversible: ${reversible}\n     Qué hace: siembra.\n     Para qué: probar.`
  const subtareas = [subtareaDePlan(1, 'src/a.ts', sin), subtareaDePlan(2, 'src/b.ts', sin), subtareaDePlan(3, 'src/c.ts', sin)]
  const reversible = repoConPlanGuardado('lotes-reversible', [...subtareas, permiso('sí')])
  assert.match(reversible.salida, /^LOTES: S1\+S2\+S3$/m)
  assert.equal(reversible.estadoJson().subtareas.some((s) => 'sola' in s), false)
  const irreversible = repoConPlanGuardado('lotes-irreversible', [...subtareas, permiso('no')])
  assert.match(irreversible.salida, /^LOTES: S1\+S3 \| S2$/m)
  assert.deepEqual(irreversible.estadoJson().subtareas.map((s) => s.sola), [undefined, true, undefined])
  // --reanudar lee las subtareas del estado: las mismas barreras.
  assert.match(estadoEn(irreversible.raiz, ['--reanudar'], irreversible.entorno).salida, /^SIGUE: paso 4/m)
  // Pura: `sola` no comparte lote con ninguna, pero tampoco es barrera.
  const s = (n, permitidos, extra = {}) => ({ n, permitidos, depende: [], ...extra })
  assert.deepEqual(lotesDe([s(1, ['a.ts']), s(2, ['b.ts'], { sola: true }), s(3, ['c.ts'])]), [[1, 3], [2]])
  assert.deepEqual(lotesDe([s(1, ['a.ts']), s(2, ['b.ts'], { sola: false }), s(3, ['c.ts'])]), [[1, 2, 3]])
  // --aprobado --sumar: el valor crudo, '' si falta o es otra opción.
  assert.equal(opcionesDe(['--aprobado', '--sumar', 'S1:a.ts']).sumar, 'S1:a.ts')
  assert.equal(opcionesDe(['--aprobado', '--sumar', '--paso', '4']).sumar, '')
  assert.equal('sumar' in opcionesDe(['--aprobado', '--ajustes', 'x']), false)
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

  // La misma línea en otra sección, con otro destino o dos veces en un mismo informe no es repetición.
  const tres = 'ARCHIVOS\n- x.ts:1 — define f\n- x.ts:1 — exporta f\n\nACOPLAMIENTOS\n- x.ts:1 → y.ts:9 — llama'
  const cuatro = 'ARCHIVOS\n- x.ts:1 — repetido\n\nACOPLAMIENTOS\n- x.ts:1 — rompe si cambia\n- x.ts:1 → z.ts:3 — importa\n- x.ts:1 → y.ts:9 — repetido'
  const otra = fusionarExploraciones([{ id: 'a', texto: tres }, { id: 'b', texto: cuatro }]).texto
  for (const hecho of ['define f', 'exporta f', 'llama', 'rompe si cambia', 'importa']) assert.match(otra, new RegExp(hecho))
  assert.doesNotMatch(otra, /repetido/)
})

test('estado: fusionarExploraciones une el reintento: mismo ruta:líneas y DUDAS ya cubiertas', () => {
  const vacias = '\nTESTS\n- ninguno\nACOPLAMIENTOS\n- ninguno\nDATOS\n- ninguno\n'
  const primera = `ARCHIVOS\n- src/billing/alta.ts:455-456 — trial = días + 1\n- src/billing/alta.ts:40 — otro tramo${vacias}DUDAS\n` +
    '- no explorado: src/components/Lista.tsx (la pista) — tope de contexto.\n' +
    '- no explorado: cupo.ts (cuerpo de subir) y corte.ts:50-112 — tope de contexto.\n' +
    '- no explorado: src/routes/onboarding.tsx y src/components/Lista.tsx — tope de contexto.\n' +
    '- no explorado: pruebas.md §3 — fuera de ÁREA.\n' +
    '- ¿Lista.tsx guarda en localStorage?'
  const reintento = 'ARCHIVOS\n- src/billing/alta.ts:455-456; src/lib/precios.ts:48-52 — repetido\n' +
    '- src\\billing\\alta.ts:455-456 — repetido con barras\n- src/billing/alta.ts:455 — otro rango\n' +
    '- src/components/Lista.tsx:59 — pista oculta si !data\n- src\\billing\\cupo.ts:200-206 — subir\n- src\\billing\\corte.ts:117 — barrido' +
    `${vacias}DUDAS\n- no explorado: src/components/Lista.tsx:80 — en el mismo informe que la cita: queda`
  const { texto } = fusionarExploraciones([{ id: 'a', texto: primera }, { id: 'b', texto: reintento }])

  assert.doesNotMatch(texto, /repetido/)
  assert.match(texto, /alta\.ts:455 — otro rango/)
  assert.match(texto, /alta\.ts:40 — otro tramo/)
  assert.doesNotMatch(texto, /\(la pista\)|cuerpo de subir/)
  // Queda la que nombra un archivo sin cubrir, la que no nombra archivos cubiertos, las preguntas y la del mismo informe.
  assert.match(texto, /onboarding\.tsx/)
  assert.match(texto, /pruebas\.md §3/)
  assert.match(texto, /¿Lista\.tsx guarda/)
  assert.match(texto, /en el mismo informe que la cita: queda/)
})

test('estado: fusionarExploraciones ignora la prosa tras la última sección', () => {
  const base = 'ARCHIVOS\n- x.ts:1 — uno\n\nTESTS\n- ninguno\n\nACOPLAMIENTOS\n- ninguno\n\nDATOS\n- ninguno\n\nDUDAS\n- ¿algo?'
  const uno = `${base}\n\nOmití X; riesgo Y`
  const dos = `${base.replace('x.ts:1', 'y.ts:2')}\n\nOtra prosa suelta\n- viñeta tras vacío\nz.ts:9 — con ruta\nprosa pegada`
  const { texto } = fusionarExploraciones([{ id: 'a', texto: uno }, { id: 'b', texto: dos }])

  assert.doesNotMatch(texto, /Omití X|Otra prosa|prosa pegada/)
  assert.match(texto, /- viñeta tras vacío/)
  assert.match(texto, /z\.ts:9 — con ruta/)
  // Una sección que no es la última no pierde líneas sin viñeta.
  assert.match(fusionarExploraciones([{ id: 'a', texto: 'ARCHIVOS\n\nsin viñeta\nTESTS\n- t.ts:1' }]).texto, /sin viñeta/)

  // Tope justo: la prosa no cuenta como hallazgo; una viñeta tras el vacío sí.
  const justo = `${informeDe(24).replace('\nDUDAS', '\nDUDAS\n- ¿algo?')}\n\nOmití X; riesgo Y`
  assert.deepEqual(avisosDeLargo([{ id: 'a', texto: justo }], 25), [])
  assert.deepEqual(avisosDeLargo([{ id: 'a', texto: `${justo}\n- otra viñeta` }], 25), ['LARGO: agente a con 26 hallazgos (tope 25)'])
  assert.deepEqual(avisosDeLargo([{ id: 'a', texto: `${justo}\n- otra viñeta` }], 26), [])
  // Ni las líneas anchas de la prosa avisan.
  assert.deepEqual(avisosDeLargo([{ id: 'a', texto: `${justo} ${'x'.repeat(200)}` }], 25), [])
})

test('estado: --guardar e1,e2 exploracion deja fuera la prosa final', () => {
  const claude = transcripts({
    p1: 'ARCHIVOS\n- a.ts:1 — uno\nTESTS\n- ninguno\nACOPLAMIENTOS\n- ninguno\nDATOS\n- ninguno\nDUDAS\n- ninguno\n\nOmití X; riesgo Y',
    p2: 'ARCHIVOS\n- b.ts:2 — dos\nTESTS\n- ninguno\nACOPLAMIENTOS\n- ninguno\nDATOS\n- ninguno\nDUDAS\n- ninguno\n\nCierro aquí.',
  })
  const { raiz } = estadoCon({}, () => ['--guardar', 'p1,p2', 'exploracion', '--paso', '2'], {}, { CLAUDE_CONFIG_DIR: claude })
  const md = fs.readFileSync(path.join(flujoDe(raiz), 'exploracion.md'), 'utf8')
  assert.doesNotMatch(md, /Omití|Cierro aquí/)
  assert.match(md, /- a\.ts:1 — uno/)
  assert.match(md, /- b\.ts:2 — dos/)
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
  const solo = estadoCon({}, () => ['--guardar', 'e2', 'exploracion'], {}, entorno)
  assert.match(solo.salida, /^INCOMPLETO: agente e2 sin DUDAS: relanza solo esa parte$/m)
  assert.equal(
    fs.readFileSync(path.join(flujoDe(solo.raiz), 'exploracion.md'), 'utf8'),
    'ARCHIVOS\n- src/a.ts:3 — mismo uso\n- src/b.ts:7 — otro\nTESTS\n- src/a.test.ts:1 — prueba\nACOPLAMIENTOS\n- ninguno\nDATOS\n- ninguno\n',
  )
})

test('el preflight imprime EXPLORADORES: hasta 20 y el reintento sin importar el repo', () => {
  const config = { verificar: [{ nombre: 'test', cmd: 'echo x' }] }
  const grande = Object.fromEntries(Array.from({ length: 150 }, (_, i) => [`lote/f${i}.txt`, 'x\n']))
  const { raiz, salida } = estadoCon(config, () => ['--paso', '0'], grande)
  assert.match(salida, /^MAPA: .*\n^EXPLORADORES: hasta 20 \(según el pedido\) · reintento: hasta 4$/m)
  const chico = estadoCon(config, () => ['--paso', '0']).salida
  assert.match(chico, /^MAPA: .*\n^EXPLORADORES: hasta 20 \(según el pedido\) · reintento: hasta 4$/m)

  // Con el flujo ocupado no hay MAPA y el tope es el mismo.
  fs.writeFileSync(path.join(raiz, 'nuevo.ts'), 'n\n')
  assert.match(estadoEn(raiz, ['--paso', '0']).salida, /^MAPA: ninguno.*\n^EXPLORADORES: hasta 20 \(según el pedido\) · reintento: hasta 4$/m)
})

test('estado: los encabezados con paréntesis cuentan como encabezados', () => {
  const informe = 'ARCHIVOS (ruta base: qcc-implementador/)\n- a.ts:1 — uno\n**TESTS (a la vista)**\n- ninguno\nACOPLAMIENTOS (x):\n- ninguno\n## DATOS (n/a)\n- ninguno\n**DUDAS** (pendientes)\n- ¿algo?'
  const { texto, incompletos } = fusionarExploraciones([{ id: 'a', texto: informe }])
  assert.deepEqual(incompletos, [])
  assert.match(texto, /^ARCHIVOS\n- a\.ts:1 — uno$/m)
  assert.match(texto, /^DUDAS\n- ¿algo\?$/m)
  assert.deepEqual(hallazgosDe(informe).map((h) => h.seccion), ['ARCHIVOS', 'DUDAS'])
})

test('--guardar: REINTENTO sale en la primera corrida y la segunda avisa solo de los ids nuevos', () => {
  const informe = (ruta, dudas) => `ARCHIVOS\n- ${ruta}:1 — uno\nTESTS\n- ninguno\nACOPLAMIENTOS\n- ninguno\nDATOS\n- ninguno\nDUDAS\n${dudas}`
  const claude = transcripts({
    a: informe('a.ts', '- no explorado: viejo — corte'),
    b: 'ARCHIVOS\n- b.ts:2 — dos',
    n: informe('n.ts', '- no explorado: nuevo — corte'),
    m: 'ARCHIVOS\n- m.ts:3 — tres',
  })
  const entorno = { CLAUDE_CONFIG_DIR: claude }
  const { raiz, salida: primera } = estadoCon({}, () => ['--guardar', 'a,b', 'exploracion', '--paso', '2'], {}, entorno)
  assert.match(primera, /^REINTENTO: caben 4$/m)
  assert.match(primera, /^SIN EXPLORAR: no explorado: viejo — corte$/m)
  assert.match(primera, /^INCOMPLETO: agente b sin /m)

  const segunda = estadoEn(raiz, ['--guardar', 'a,b,n,m', 'exploracion', '--paso', '2'], entorno).salida
  assert.doesNotMatch(segunda, /REINTENTO/)
  assert.doesNotMatch(segunda, /SIN EXPLORAR: no explorado: viejo/)
  assert.doesNotMatch(segunda, /INCOMPLETO: agente b/)
  assert.match(segunda, /^SIN EXPLORAR: no explorado: nuevo — corte$/m)
  assert.match(segunda, /^INCOMPLETO: agente m sin /m)
  // El archivo sí une los informes de las dos rondas.
  const md = fs.readFileSync(path.join(flujoDe(raiz), 'exploracion.md'), 'utf8')
  assert.match(md, /no explorado: viejo/)
  assert.match(md, /no explorado: nuevo/)

  // El cupo se descuenta de los 24: los ids sin informe también se despacharon.
  const cupo = (n) => estadoCon({}, () => ['--guardar', ['a', ...Array.from({ length: n - 1 }, (_, i) => `x${i}`)].join(','), 'exploracion', '--paso', '2'], {}, entorno).salida
  assert.match(cupo(20), /^REINTENTO: caben 4$/m)
  assert.match(cupo(23), /^REINTENTO: caben 1$/m)
  assert.match(cupo(26), /^REINTENTO: caben 0$/m)
})

test('--guardar avisa CORTADO del explorador que la guardia dejó sin leer por contexto', () => {
  const informe = 'ARCHIVOS\n- a.ts:1 — uno\nTESTS\n- ninguno\nACOPLAMIENTOS\n- ninguno\nDATOS\n- ninguno\nDUDAS\n- ninguno'
  const claude = transcripts({ c1: informe, c2: informe.replace('a.ts', 'b.ts') })
  const entorno = { CLAUDE_CONFIG_DIR: claude }
  const { raiz, salida: preflight } = estadoCon({ verificar: [{ nombre: 'test', cmd: 'echo x' }] }, () => ['--paso', '0'], {}, entorno)
  assert.match(preflight, /^MAPA: /m)
  const leer = (id, tokens) => hook(raiz, 'explorador', { ...ev(raiz, 'Read', { file_path: path.join(raiz, 'src', 'a.ts') }), agent_id: id, transcript_path: transcriptConLineas(id, [turnoConUso(tokens)]) })

  // Sin negados no hay ningún CORTADO.
  assert.equal(leer('c2', 50_000).stdout, '')
  const sin = estadoEn(raiz, ['--guardar', 'c2', 'exploracion', '--paso', '2'], entorno).salida
  assert.match(sin, /^GUARDADO: exploración/m)
  assert.doesNotMatch(sin, /CORTADO/)

  // La fila que produce la guardia real marca solo al agente negado, también si llega en una corrida posterior.
  assert.equal(JSON.parse(leer('c1', 95_000).stdout).hookSpecificOutput.permissionDecision, 'deny')
  const con = estadoEn(raiz, ['--guardar', 'c1,c2', 'exploracion', '--paso', '2'], entorno).salida
  assert.match(con, /^CORTADO: agente c1 por contexto \(95k\)$/m)
  assert.equal((con.match(/^CORTADO/gm) ?? []).length, 1)
  // Ya avisado, no se repite.
  assert.doesNotMatch(estadoEn(raiz, ['--guardar', 'c1', 'exploracion'], entorno).salida, /CORTADO/)
})

/** Informe de explorador con `n` hallazgos en ARCHIVOS y los otros 4 encabezados vacíos. */
const informeDe = (n, linea = (i) => `- src/f${i}.ts:${i} — hecho`) =>
  `ARCHIVOS\n${Array.from({ length: n }, (_, i) => linea(i + 1)).join('\n')}\nTESTS\nACOPLAMIENTOS\nDATOS\nDUDAS`

test('--guardar avisa LARGO por exceso de hallazgos', () => {
  const claude = transcripts({
    justo: informeDe(20),
    largo: informeDe(21),
    t1: informeDe(21, (i) => `- a/${i}.ts:${i} — uno`),
    t2: informeDe(20, (i) => `- b/${i}.ts:${i} — dos`),
    t3: informeDe(3, (i) => `- c/${i}.ts:${i} — tres`),
    d1: informeDe(21, (i) => `- d/${i}.ts:${i} — igual`),
    d2: informeDe(21, (i) => `- d/${i}.ts:${i} — igual`),
  })
  const entorno = { CLAUDE_CONFIG_DIR: claude }
  // LARGO sale solo en la primera corrida de un flujo: cada caso usa un flujo nuevo.
  const guardar = (ids) => {
    const { raiz, salida } = estadoCon({}, () => ['--guardar', ids, 'exploracion', '--paso', '2'], {}, entorno)
    return { salida, md: fs.readFileSync(path.join(flujoDe(raiz), 'exploracion.md'), 'utf8'), raiz }
  }

  // El tope es 20 con un explorador, justo en el tope no avisa.
  assert.doesNotMatch(guardar('justo').salida, /LARGO/)
  const largo = guardar('largo')
  assert.match(largo.salida, /^LARGO: agente largo con 21 hallazgos \(tope 20\)$/m)
  // El aviso no corta ni cambia lo guardado.
  assert.equal(largo.md, informeDe(21) + '\n')

  // Con tres, el tope de cada uno sigue siendo 20 (solo t1 lo pasa).
  const tres = guardar('t1,t2,t3')
  assert.match(tres.salida, /^LARGO: agente t1 con 21 hallazgos \(tope 20\)$/m)
  assert.doesNotMatch(tres.salida, /LARGO: agente t[23]/)
  assert.equal((tres.salida.match(/^LARGO/gm) ?? []).length, 1)
  assert.match(tres.md, /- a\/21\.ts:21 — uno/)

  // Se cuenta antes de deduplicar: d2 repite todo lo de d1 y aun así pasa el tope de 20.
  const dos = guardar('d1,d2')
  assert.match(dos.salida, /^LARGO: agente d1 con 21 hallazgos \(tope 20\)$/m)
  assert.match(dos.salida, /^LARGO: agente d2 con 21 hallazgos \(tope 20\)$/m)
  assert.equal(dos.md.match(/d\/1\.ts:1\b/g).length, 1)

  // En la segunda corrida del mismo flujo, aunque el informe pase el tope, no vuelve a avisar.
  const otra = estadoEn(tres.raiz, ['--guardar', 'largo', 'exploracion'], entorno).salida
  assert.match(otra, /^GUARDADO: exploración/m)
  assert.doesNotMatch(otra, /LARGO/)
})

test('estado: sinExplorarDe marca las DUDAS no explorado: (pura)', () => {
  const informe = (dudas) => `ARCHIVOS\n- a.ts:1 — uno\nTESTS\n- ninguno\nACOPLAMIENTOS\n- ninguno\nDATOS\n- ninguno\nDUDAS\n${dudas}`
  const avisos = (texto) => sinExplorarDe(hallazgosDe(texto))

  assert.deepEqual(avisos(informe('- no explorado: src/x.ts — corte por contexto')), ['SIN EXPLORAR: no explorado: src/x.ts — corte por contexto'])
  // Otras formas de escribirlo.
  assert.deepEqual(avisos(informe('* No explorados: carpeta z')), ['SIN EXPLORAR: No explorados: carpeta z'])
  assert.deepEqual(avisos(informe('- **no explorado:** z')), ['SIN EXPLORAR: **no explorado:** z'])
  assert.deepEqual(avisos(informe('- **no explorado**: a')), ['SIN EXPLORAR: **no explorado**: a'])
  assert.deepEqual(avisos(informe('- no explorada: a')), ['SIN EXPLORAR: no explorada: a'])
  assert.deepEqual(avisos(informe('- No exploradas: a')), ['SIN EXPLORAR: No exploradas: a'])
  assert.deepEqual(avisos(informe('- `no explorado: a`')), ['SIN EXPLORAR: `no explorado: a`'])
  // Fuera de DUDAS, o una DUDA normal, no avisan.
  assert.deepEqual(avisos(informe('- ¿algo?')), [])
  assert.deepEqual(avisos(informe('- ninguno')), [])
  assert.deepEqual(avisos(informe('- ¿se ha no explorado: algo?')), [])
  assert.deepEqual(avisos('ARCHIVOS\n- no explorado: x.ts — nada\nTESTS\nACOPLAMIENTOS\n- no explorado: y.ts — nada\nDATOS\nDUDAS\n- ninguno'), [])
})

test('--guardar avisa SIN EXPLORAR una vez por DUDA marcada', () => {
  const informe = (dudas) => `ARCHIVOS\n- a.ts:1 — uno\nTESTS\n- ninguno\nACOPLAMIENTOS\n- ninguno\nDATOS\n- ninguno\nDUDAS\n${dudas}`
  const marca = '- no explorado: src/x.ts — corte por contexto'
  const claude = transcripts({ a: informe(marca), b: informe(marca).replace('a.ts', 'b.ts'), c: informe('- ¿algo?') })
  const entorno = { CLAUDE_CONFIG_DIR: claude }

  const dos = estadoCon({}, () => ['--guardar', 'a,b', 'exploracion', '--paso', '2'], {}, entorno).salida
  assert.equal((dos.match(/^SIN EXPLORAR: no explorado: src\/x\.ts — corte por contexto$/gm) ?? []).length, 1)
  assert.doesNotMatch(estadoCon({}, () => ['--guardar', 'c', 'exploracion', '--paso', '2'], {}, entorno).salida, /SIN EXPLORAR/)
  // Con un solo id también.
  assert.match(estadoCon({}, () => ['--guardar', 'a', 'exploracion', '--paso', '2'], {}, entorno).salida, /^SIN EXPLORAR: no explorado: src\/x\.ts/m)
  // Con la negrita antes de los dos puntos.
  const negrita = transcripts({ n: informe('- **no explorado**: x') })
  assert.match(estadoCon({}, () => ['--guardar', 'n', 'exploracion', '--paso', '2'], {}, { CLAUDE_CONFIG_DIR: negrita }).salida, /^SIN EXPLORAR: \*\*no explorado\*\*: x$/m)
})

test('--guardar no avisa LARGO por el ancho de las líneas', () => {
  const claude = transcripts({ ancha: informeDe(2, () => `- src/a.ts:1 — ${'x'.repeat(200)}`) })
  const { raiz, salida } = estadoCon({}, () => ['--guardar', 'ancha', 'exploracion', '--paso', '2'], {}, { CLAUDE_CONFIG_DIR: claude })
  assert.doesNotMatch(salida, /LARGO/)
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

test('estado: --guardar exploracion escribe pedido.md con el /impl de la sesión principal', () => {
  const claude = transcripts({ explora: 'ARCHIVOS\n- a.ts:1 — x' })
  const raiz = repo('pedido', { 'src/a.ts': 'a\n' })
  temporales.push(raiz)
  sesionConImpl(claude, raiz, 'arregla el login')
  const entorno = { CLAUDE_CONFIG_DIR: claude }
  estadoEn(raiz, ['--paso', '0'], entorno)
  assert.match(estadoEn(raiz, ['--guardar', 'explora', 'exploracion'], entorno).salida, /^GUARDADO: exploración → /m)
  assert.equal(fs.readFileSync(path.join(flujoDe(raiz), 'pedido.md'), 'utf8'), 'arregla el login\n')
})

test('estado: --guardar exploracion sin transcript principal guarda y no escribe pedido.md', () => {
  const claude = transcripts({ explora: 'ARCHIVOS\n- a.ts:1 — x' })
  const raiz = repo('sinpedido', { 'src/a.ts': 'a\n' })
  temporales.push(raiz)
  const entorno = { CLAUDE_CONFIG_DIR: claude }
  estadoEn(raiz, ['--paso', '0'], entorno)
  const r = estadoEn(raiz, ['--guardar', 'explora', 'exploracion'], entorno)
  assert.match(r.salida, /^GUARDADO: exploración → /m)
  assert.equal(r.codigo, 0)
  assert.equal(fs.existsSync(path.join(flujoDe(raiz), 'pedido.md')), false)
})

test('plan: CONTEXTO por subtarea, acoplados sin cubrir, DUDAS y bloque para aprobar', () => {
  const exploracion = [
    'ARCHIVOS', '- src/a.ts:3 — función x', '- src/b.ts:1 — función y',
    'TESTS', '- ninguno',
    'ACOPLAMIENTOS', '- src/a.ts:3 usa src/d.ts:9', '- src/b.ts:1 usa src/c.ts:2',
    'DATOS', '- ninguno',
    'DUDAS', '- ¿se borra z?',
  ].join('\n')
  const plan = [
    'PLAN · Contexto', 'Clasificación: sin criterios', 'Objetivo: probar', 'Fuera de alcance: src/c.ts (no cambia)', '',
    subtareaDePlan(1, 'src/a.ts', { extra: '- Cómo: src/a.ts:3, cambia x\n' }), '',
    subtareaDePlan(2, 'src/b.ts'), '',
    'Verificación final: test', 'Queda para ti: nada', 'Costo: 2 ejecutores · revisión final',
  ].join('\n')
  const entorno = { CLAUDE_CONFIG_DIR: transcripts({ plano: plan }) }
  const raiz = repo('contexto', { 'src/a.ts': 'a\n', 'src/b.ts': 'b\n' })
  temporales.push(raiz)
  estadoEn(raiz, ['--paso', '0'], entorno)
  fs.writeFileSync(path.join(flujoDe(raiz), 'exploracion.md'), exploracion)
  const { salida } = estadoEn(raiz, ['--guardar', 'plano', 'plan'], entorno)
  const s1 = fs.readFileSync(path.join(flujoDe(raiz), 'S1.md'), 'utf8')
  const s2 = fs.readFileSync(path.join(flujoDe(raiz), 'S2.md'), 'utf8')
  assert.match(s1, /^- \[ARCHIVOS\] src\/a\.ts:3 — función x$/m)
  assert.match(s1, /^- \[ACOPLAMIENTOS\] src\/a\.ts:3 usa src\/d\.ts:9$/m)
  assert.doesNotMatch(s1, /src\/b\.ts:1/)
  assert.match(s2, /^- \[ACOPLAMIENTOS\] src\/b\.ts:1 usa src\/c\.ts:2$/m)
  assert.match(salida, /^S1 · Tarea 1 · Crítica: no · permitidos: src\/a\.ts · contexto: 2 → /m)
  assert.match(salida, /^ {2}- acoplado «src\/d\.ts» \(ACOPLAMIENTOS de la exploración\) no está/m)
  assert.doesNotMatch(salida, /acoplado «src\/c\.ts»/)
  assert.match(salida, /^DUDAS DE LA EXPLORACIÓN .*\n {2}- ¿se borra z\?$/m)
  const aprobar = /^PARA APROBAR .*\n([\s\S]*?)\nFIN PARA APROBAR$/m.exec(salida)?.[1] ?? ''
  assert.match(aprobar, /^PLAN · Contexto$/m)
  assert.match(aprobar, /^Fuera de alcance: src\/c\.ts \(no cambia\)$/m)
  assert.match(aprobar, /^- Cómo: src\/a\.ts:3, cambia x$/m)
  assert.match(aprobar, /^Costo: 2 ejecutores/m)
  assert.doesNotMatch(aprobar, /Hecho cuando|Reversión|Verificación final/)
})

test('plan: el CONTEXTO y los acoplados aceptan rutas abreviadas por el explorador', () => {
  const hallazgos = [{ seccion: 'ARCHIVOS', linea: 'billing/x.ts:3 — corta' }, { seccion: 'ACOPLAMIENTOS', linea: 'billing/x.ts:3 usa otros/y.ts:1' }]
  assert.deepEqual(contextoDe(hallazgos, ['src/billing/x.ts']), ['- [ARCHIVOS] billing/x.ts:3 — corta', '- [ACOPLAMIENTOS] billing/x.ts:3 usa otros/y.ts:1'])
  assert.deepEqual(contextoDe(hallazgos, []), [])
  assert.deepEqual(acopladosSinCubrir(hallazgos, ['src/billing/x.ts'], ''), ['otros/y.ts'])
  assert.deepEqual(acopladosSinCubrir(hallazgos, ['src/billing/x.ts'], 'y.ts: no cambia'), [])
})
