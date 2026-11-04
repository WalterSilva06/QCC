// Casos de estado.mjs (preflight, planes, fotos, cierre), de la config del flujo y de instalar.mjs.

import { repo, temporales, estadoEn, estadoCon, limpiar, transcripts, subtareaDePlan, repoConPlanGuardado, ev, hook, transcriptConLineas, turnoConUso } from './pruebas-comun.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { flujoDe, regexDeExterno } from './guardia.mjs'
import { lotesDe, opcionesDe, permitidosDe, criticosDe, fusionarPlanes, partesDelPlan, decisionesDelPlan, fusionarExploraciones, hallazgosDe, sinExplorarDe, techoDeExploradores, topeDeLineas, avisosDeLargo, externoDe, parecenExternas, permitidosDeSubtarea, noPareceRuta, contextoDe, acopladosSinCubrir } from './estado.mjs'

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

const EXTERNO_SEMILLA ='- Externo: node scripts/seed.mjs · contra la base de pruebas · reversible: sí\n'

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
  assert.equal(parecenExternas(['- Tests: corre playwright test e2e/flujo.spec.ts']), null)
  assert.equal(parecenExternas(['- Hecho cuando: playwright-cli snapshot muestra el botón']), null)
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

  // La misma línea en otra sección, con otro destino o dos veces en un mismo informe no es repetición.
  const tres = 'ARCHIVOS\n- x.ts:1 — define f\n- x.ts:1 — exporta f\n\nACOPLAMIENTOS\n- x.ts:1 → y.ts:9 — llama'
  const cuatro = 'ARCHIVOS\n- x.ts:1 — repetido\n\nACOPLAMIENTOS\n- x.ts:1 — rompe si cambia\n- x.ts:1 → z.ts:3 — importa\n- x.ts:1 → y.ts:9 — repetido'
  const otra = fusionarExploraciones([{ id: 'a', texto: tres }, { id: 'b', texto: cuatro }]).texto
  for (const hecho of ['define f', 'exporta f', 'llama', 'rompe si cambia', 'importa']) assert.match(otra, new RegExp(hecho))
  assert.doesNotMatch(otra, /repetido/)
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
  assert.equal(techoDeExploradores(150), 4)
  assert.equal(techoDeExploradores(800), 4)
  assert.equal(techoDeExploradores(801), 6)
  // Sin MAPA (null) o sin dato, el mínimo.
  assert.equal(techoDeExploradores(null), 2)
  assert.equal(techoDeExploradores(undefined), 2)

  // El preflight lo imprime junto a MAPA, con el mismo conteo de archivos.
  const config = { verificar: [{ nombre: 'test', cmd: 'echo x' }] }
  const grande = Object.fromEntries(Array.from({ length: 150 }, (_, i) => [`lote/f${i}.txt`, 'x\n']))
  const { raiz, salida } = estadoCon(config, () => ['--paso', '0'], grande)
  const archivos = /^MAPA: .*mapa\.md \((\d+) archivos\)$/m.exec(salida)?.[1]
  assert.ok(Number(archivos) >= 150, salida)
  assert.match(salida, /^MAPA: .*\n^EXPLORADORES: hasta 4 \(repo de \d+ archivos\)$/m)
  assert.equal(/^EXPLORADORES: hasta \d+ \(repo de (\d+) archivos\)$/m.exec(salida)?.[1], archivos)
  const chico = estadoCon(config, () => ['--paso', '0']).salida
  assert.match(chico, /^MAPA: .*\n^EXPLORADORES: hasta 2 \(repo de \d+ archivos\)$/m)

  // Con el flujo ocupado no hay MAPA.
  fs.writeFileSync(path.join(raiz, 'nuevo.ts'), 'n\n')
  assert.match(estadoEn(raiz, ['--paso', '0']).salida, /^MAPA: ninguno.*\n^EXPLORADORES: hasta 2 \(sin MAPA\)$/m)
})

test('tope de líneas por número de exploradores', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6].map(topeDeLineas), [25, 20, 16, 15, 14, 13])
  // Fuera de 1–6 se acota.
  assert.equal(topeDeLineas(0), 25)
  assert.equal(topeDeLineas(9), 13)
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
  const sin = estadoEn(raiz, ['--guardar', 'c1,c2', 'exploracion', '--paso', '2'], entorno).salida
  assert.match(sin, /^GUARDADO: exploración/m)
  assert.doesNotMatch(sin, /CORTADO/)

  // La fila que produce la guardia real marca solo al agente negado, también al volver a guardar con más ids.
  assert.equal(JSON.parse(leer('c1', 90_000).stdout).hookSpecificOutput.permissionDecision, 'deny')
  const con = estadoEn(raiz, ['--guardar', 'c1,c2', 'exploracion', '--paso', '2'], entorno).salida
  assert.match(con, /^CORTADO: agente c1 por contexto \(90k\)$/m)
  assert.equal((con.match(/^CORTADO/gm) ?? []).length, 1)
  assert.match(estadoEn(raiz, ['--guardar', 'c1', 'exploracion'], entorno).salida, /^CORTADO: agente c1 por contexto \(90k\)$/m)
  assert.doesNotMatch(estadoEn(raiz, ['--guardar', 'c2', 'exploracion'], entorno).salida, /CORTADO/)
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
  // LARGO sale solo en la primera corrida de un flujo: cada caso usa un flujo nuevo.
  const guardar = (ids) => {
    const { raiz, salida } = estadoCon({}, () => ['--guardar', ids, 'exploracion', '--paso', '2'], {}, entorno)
    return { salida, md: fs.readFileSync(path.join(flujoDe(raiz), 'exploracion.md'), 'utf8'), raiz }
  }

  // Con un explorador el tope es 25.
  assert.doesNotMatch(guardar('justo').salida, /LARGO/)
  const largo = guardar('largo')
  assert.match(largo.salida, /^LARGO: agente largo con 26 hallazgos \(tope 25\)$/m)
  // El aviso no corta ni cambia lo guardado.
  assert.equal(largo.md, informeDe(26) + '\n')

  // Con tres, el tope de cada uno es 16 (solo t1 lo pasa).
  const tres = guardar('t1,t2,t3')
  assert.match(tres.salida, /^LARGO: agente t1 con 17 hallazgos \(tope 16\)$/m)
  assert.doesNotMatch(tres.salida, /LARGO: agente t[23]/)
  assert.equal((tres.salida.match(/^LARGO/gm) ?? []).length, 1)
  assert.match(tres.md, /- a\/17\.ts:17 — uno/)

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

test('--guardar avisa LARGO por líneas de más de 160 caracteres', () => {
  const ancha = (n) => `- src/a.ts:1 — ${'x'.repeat(n - '- src/a.ts:1 — '.length)}`
  assert.equal(ancha(161).length, 161)
  const claude = transcripts({
    justa: informeDe(2, (i) => (i === 1 ? ancha(160) : `- src/b.ts:${i} — ok`)),
    pasada: informeDe(3, (i) => (i === 3 ? `- src/b.ts:${i} — ok` : ancha(161 + i))),
  })
  const entorno = { CLAUDE_CONFIG_DIR: claude }
  assert.doesNotMatch(estadoCon({}, () => ['--guardar', 'justa', 'exploracion', '--paso', '2'], {}, entorno).salida, /LARGO/)
  const { raiz, salida: pasada } = estadoCon({}, () => ['--guardar', 'pasada', 'exploracion', '--paso', '2'], {}, entorno)
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
