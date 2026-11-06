// Casos de estado.mjs (preflight, planes, fotos, cierre), de la config del flujo y de instalar.mjs.

import { repo, ESTADO, temporales, estadoEn, estadoCon, ev, hook, filasDe, borrarRegistro, VERIFICAR, escribirCmd, limpiar, transcripts, subtareaDePlan, repoConPlanGuardado } from './pruebas-comun.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { registroDe, flujoDe, carpetaGlobal } from './guardia.mjs'
import { filaDelFlujo, agruparPorCarpeta } from './estado.mjs'

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
  // Lo único que cambia es la subtarea en curso y la fase en paralelo, que cada --base --sub de un lote vuelve a anotar.
  const { en_curso: enCurso, paralelos, ...sinEnCurso } = JSON.parse(estadoCrudo())
  const { paralelos: antesParalelos, ...antesSinParalelos } = JSON.parse(antes)
  assert.deepEqual(enCurso, [1, 2])
  assert.deepEqual(paralelos.slice(0, -1), antesParalelos)
  assert.deepEqual(Object.keys(paralelos.at(-1)).sort(), ['desde', 'n', 'tipo'])
  assert.deepEqual(sinEnCurso, antesSinParalelos)

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

/** Repo con a.ts, b.ts y c.ts, el flujo abierto y tres subtareas (una por archivo) en el estado. */
function repoConTresSubtareas() {
  const raiz = repo('ondas', { 'src/a.ts': 'a\n', 'src/b.ts': 'b\n', 'src/c.ts': 'c\n' })
  temporales.push(raiz)
  estadoEn(raiz, ['--paso', '0'])
  const archivo = path.join(flujoDe(raiz), 'estado.json')
  const estado = JSON.parse(fs.readFileSync(archivo, 'utf8'))
  estado.subtareas = ['a', 'b', 'c'].map((x, i) => ({ n: i + 1, objetivo: x, critica: 'no', permitidos: [`src/${x}.ts`] }))
  fs.writeFileSync(archivo, JSON.stringify(estado))
  return { raiz, estadoJson: () => JSON.parse(fs.readFileSync(archivo, 'utf8')) }
}

test('cierre: con ondas, la siguiente foto en el tiempo cierra a cada subtarea, no el próximo n', () => {
  const { raiz } = repoConTresSubtareas()
  // Onda 1: S1+S3 a la vez.
  assert.match(estadoEn(raiz, ['--base', '--sub', '1,3']).salida, /^LOTE=S1\+S3$/m)
  fs.writeFileSync(path.join(raiz, 'src/a.ts'), 'a1\na2\n')
  fs.writeFileSync(path.join(raiz, 'src/c.ts'), 'c1\nc2\nc3\n')
  const lote = estadoEn(raiz, ['--cambios', '--sub', '1,3', '--paso', '6']).salida
  assert.match(lote, /^FOTO S1\+S3: /m)
  assert.match(lote, /ALCANCE: OK\s*$/)
  // Onda 2: S2, con su foto posterior a la del lote aunque su n sea menor que el de S3.
  assert.match(estadoEn(raiz, ['--base', '--sub', '2']).salida, /^BASE=\w+ DESDE=/m)
  fs.writeFileSync(path.join(raiz, 'src/b.ts'), 'b1\n')
  assert.match(estadoEn(raiz, ['--cambios', '--sub', '2', '--paso', '6']).salida, /ALCANCE: OK\s*$/)

  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: raiz, encoding: 'utf8' }).trim()
  estadoEn(raiz, ['--cambios', sha, '--paso', '7', '--resultado', 'COMPLETO'])
  assert.deepEqual(filasDeFlujos(raiz).at(-1).subtareas, [
    { n: 1, critica: false, archivos: 1, mas: 2, menos: 1 },
    { n: 2, critica: false, archivos: 1, mas: 1, menos: 1 },
    { n: 3, critica: false, archivos: 1, mas: 3, menos: 1 },
  ])
})

test('estado: corregir una subtarea vieja no marca FUERA lo de las posteriores', () => {
  const { raiz } = repoConTresSubtareas()
  assert.match(estadoEn(raiz, ['--base', '--sub', '1,2']).salida, /^LOTE=S1\+S2$/m)
  fs.writeFileSync(path.join(raiz, 'src/a.ts'), 'a1\n')
  fs.writeFileSync(path.join(raiz, 'src/b.ts'), 'b1\n')
  assert.match(estadoEn(raiz, ['--cambios', '--sub', '1,2']).salida, /ALCANCE: OK\s*$/)
  // S3 llega después del lote y se mide sola.
  assert.match(estadoEn(raiz, ['--base', '--sub', '3']).salida, /^BASE=\w+ DESDE=/m)
  fs.writeFileSync(path.join(raiz, 'src/c.ts'), 'c1\n')
  assert.match(estadoEn(raiz, ['--cambios', '--sub', '3']).salida, /ALCANCE: OK\s*$/)

  // Corrección de S1: conserva la foto del lote (anterior a S3) y mide el lote; lo de S3 es suyo, no FUERA.
  assert.match(estadoEn(raiz, ['--base', '--sub', '1']).salida, /^AVISO: S1 ya tenía foto/m)
  fs.writeFileSync(path.join(raiz, 'src/a.ts'), 'a2\n')
  const corregida = estadoEn(raiz, ['--cambios', '--sub', '1']).salida
  assert.match(corregida, /^FOTO S1\+S2: .* · permitidos: 2 del plan \+ 0 ampliados \+ 1 de subtareas posteriores \(S3\)$/m)
  assert.match(corregida, /ALCANCE: OK\s*$/)
  assert.doesNotMatch(corregida, /FUERA DE ALCANCE/)

  // Un archivo que no es de nadie sigue saliendo FUERA.
  fs.writeFileSync(path.join(raiz, 'src/z.ts'), 'z\n')
  const fuera = estadoEn(raiz, ['--cambios', '--sub', '1']).salida
  assert.match(fuera, /^ {2}✗ [?A] src\/z\.ts {3}← FUERA DE ALCANCE$/m)
  assert.match(fuera, /ALCANCE: FUERA \(1\)\s*$/)
})

test('estado: repetir el lote con menos miembros conserva la foto y abre otra fase en paralelo', () => {
  const { raiz, estadoJson } = repoConTresSubtareas()
  const f = /^BASE=(\w+) DESDE=(\S+)$/m.exec(estadoEn(raiz, ['--base', '--sub', '1,2,3']).salida)
  assert.ok(f)
  assert.equal(estadoJson().paralelos.length, 1)

  const otra = estadoEn(raiz, ['--base', '--sub', '1,3']).salida
  assert.match(otra, /^AVISO: S1 ya tenía foto; se conserva la primera \(la de antes de su ejecutor\)$/m)
  assert.match(otra, /^AVISO: S3 ya tenía foto; se conserva la primera \(la de antes de su ejecutor\)$/m)
  assert.doesNotMatch(otra, /AVISO: S2/)
  assert.match(otra, new RegExp(`^BASE=${f[1]} DESDE=${f[2]}$`, 'm'))
  const abierto = estadoJson()
  assert.deepEqual(abierto.en_curso, [1, 3])
  assert.equal(abierto.paralelos.length, 2)
  assert.ok(abierto.paralelos.every((p) => p.tipo === 'lote' && p.hasta === undefined))
  assert.deepEqual(Object.values(abierto.bases).map((b) => [b.base, b.desde]), [[f[1], f[2]], [f[1], f[2]], [f[1], f[2]]])

  // Medir el lote entero cierra las dos fases y borra la subtarea en curso.
  assert.equal(estadoEn(raiz, ['--cambios', '--sub', '1,2,3']).codigo, 0)
  const cerrado = estadoJson()
  assert.equal(cerrado.en_curso, undefined)
  assert.ok(cerrado.paralelos.every((p) => typeof p.hasta === 'string'))
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
  const historialDe = path.join(carpetaGlobal(), 'historial')
  const envejecer = (horas) => {
    const t = new Date(Date.now() - horas * 3_600_000)
    for (const a of [archivo, registroDe(raiz)]) if (fs.existsSync(a)) fs.utimesSync(a, t, t)
  }
  const conPlan = { ...JSON.parse(fs.readFileSync(archivo, 'utf8')), plan: path.join(carpeta, 'plan.md'), titulo: 'Corporativas' }
  fs.writeFileSync(archivo, JSON.stringify(conPlan))
  envejecer(2)
  assert.match(estadoEn(raiz, ['--paso', '0']).salida, /^AVISO: hay otro flujo abierto en este repo \(«Corporativas», empezó a las .*, con actividad hace 120 min\)\./m)
  // Con plan y sin cierre, ni 7 h sin actividad lo vacían: avisa que quedó cortado y ofrece reanudarlo.
  envejecer(7)
  const cortado = estadoEn(raiz, ['--paso', '0']).salida
  assert.match(cortado, /^AVISO: hay un flujo cortado en este repo \(«Corporativas», empezó a las .*, sin actividad hace 7 h\)\. No vacié su carpeta\.$/m)
  assert.match(cortado, /^REANUDAR:/m)
  assert.doesNotMatch(cortado, /^AVISO: hay otro flujo abierto/m)
  assert.equal(JSON.parse(fs.readFileSync(archivo, 'utf8')).plan, conPlan.plan)
  // --forzar lo archiva en historial/ (con su plan) antes de vaciar la carpeta.
  const antes = new Set(fs.existsSync(historialDe) ? fs.readdirSync(historialDe) : [])
  estadoEn(raiz, ['--paso', '0', '--forzar'])
  assert.equal(JSON.parse(fs.readFileSync(archivo, 'utf8')).plan, undefined)
  const nuevas = fs.readdirSync(historialDe).filter((n) => !antes.has(n))
  assert.equal(nuevas.length, 1)
  assert.equal(JSON.parse(fs.readFileSync(path.join(historialDe, nuevas[0], 'estado.json'), 'utf8')).plan, conPlan.plan)
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
  // Un flujo reanudado anota cuántas sesiones sumó; una subtarea OMITIDA lo dice aunque su ejecutor volviera BLOQUEADO.
  const reanudada = filaDelFlujo({ t: 'T', estado: { subtareas: [{ n: 1 }], avance: { 1: { estado: 'OMITIDA' } } }, metricas: { sesiones: 2, ejecutores: { 1: { estado: 'BLOQUEADO' } } } })
  assert.equal(reanudada.sesiones, 2)
  assert.equal(reanudada.subtareas[0].estado, 'OMITIDA')
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

test('cierre: COMPLETO avisa de las subtareas que terminaron BLOQUEADO o FALLA', () => {
  const { raiz } = estadoCon({}, () => ['--paso', '0'])
  const claude = transcriptDelFlujo(raiz)
  const { inicio } = JSON.parse(fs.readFileSync(path.join(flujoDe(raiz), 'estado.json'), 'utf8'))
  const subagentes = path.join(claude, 'projects', path.resolve(raiz).replace(/[^a-zA-Z0-9]/g, '-'), 's1', 'subagents')
  fs.mkdirSync(subagentes, { recursive: true })
  const ts = new Date(Date.parse(inicio) + 1).toISOString()
  const ejecutor = (n, estado) => {
    fs.writeFileSync(path.join(subagentes, `agent-x${n}.meta.json`), JSON.stringify({ agentType: 'impl:qcc-ejecutor' }))
    const filas = [
      { type: 'user', timestamp: ts, message: { role: 'user', content: `SUBTAREA ${n}/3: x` } },
      { type: 'assistant', timestamp: ts, message: { id: `m${n}`, model: 'claude-sonnet-5-5', usage: { output_tokens: 1 }, content: [{ type: 'text', text: `ESTADO: ${estado}` }] } },
    ]
    fs.writeFileSync(path.join(subagentes, `agent-x${n}.jsonl`), filas.map((f) => JSON.stringify(f)).join('\n') + '\n')
  }
  ejecutor(1, 'HECHO')
  ejecutor(2, 'BLOQUEADO')
  ejecutor(3, 'FALLA')
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: raiz, encoding: 'utf8' }).trim()
  const salida = estadoEn(raiz, ['--cambios', sha, '--paso', '7', '--resultado', 'COMPLETO'], { CLAUDE_CONFIG_DIR: claude }).salida
  assert.doesNotMatch(salida, /AVISO: S1 /)
  assert.match(salida, /^AVISO: S2 terminó BLOQUEADO y el cierre es COMPLETO: dilo en Riesgos pendientes$/m)
  assert.match(salida, /^AVISO: S3 terminó FALLA y el cierre es COMPLETO: dilo en Riesgos pendientes$/m)
  assert.equal(filasDeFlujos(raiz).at(-1).resultado, 'COMPLETO')
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

/**
 * Un repo con el flujo abierto, un plan de tres subtareas (src/a.ts, src/b.ts, src/c.ts) y `verificar` como pasos de la config
 * (que ya va en la foto del flujo). Devuelve `{ raiz, estadoJson, estado, verificar }`: `estado(...args)` corre estado.mjs,
 * `verificar()` corre verificar.mjs de verdad.
 */
function repoParalelo(nombre, verificar) {
  const plan = `PLAN · Paralelo\nClasificación: sin criterios\nObjetivo: probar\n\n${['a', 'b', 'c'].map((x, i) => subtareaDePlan(i + 1, `src/${x}.ts`)).join('\n\n')}`
  const entorno = { CLAUDE_CONFIG_DIR: transcripts({ plano: plan }) }
  const raiz = repo(nombre, { '.claude/implementador.json': { verificar }, 'dist/.gitkeep': '', 'src/a.ts': 'a\n', 'src/b.ts': 'b\n', 'src/c.ts': 'c\n' })
  temporales.push(raiz)
  estadoEn(raiz, ['--paso', '0'], entorno)
  assert.match(estadoEn(raiz, ['--guardar', 'plano', 'plan'], entorno).salida, /^LOTES: /m)
  return {
    raiz,
    estadoJson: () => JSON.parse(fs.readFileSync(path.join(flujoDe(raiz), 'estado.json'), 'utf8')),
    estado: (...args) => estadoEn(raiz, args),
    verificar: () => {
      const v = spawnSync(process.execPath, [VERIFICAR], { cwd: raiz, encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: raiz } })
      assert.match(v.stdout, /RESULTADO: VERDE/)
    },
  }
}

// El paso falso hace de «otro agente»: escribe un archivo fuera de los permitidos mientras la fase en paralelo está abierta.
const PASO_DE_OTRO = [{ nombre: 'otro', cmd: escribirCmd('dist/otro.js', 'de otro') }]

test('estado: --cambios marca FUERA lo que cambió durante verificar con un lote en paralelo', () => {
  const { estadoJson, estado, verificar } = repoParalelo('paralelo-lote', PASO_DE_OTRO)
  assert.match(estado('--base', '--sub', '1,2', '--paso', '5').salida, /^LOTE=S1\+S2$/m)
  const [fase, ...resto] = estadoJson().paralelos
  assert.deepEqual([resto.length, fase.tipo, fase.n, typeof fase.desde, fase.hasta], [0, 'lote', 2, 'string', undefined])
  verificar()
  const c = estado('--cambios', '--sub', '1,2', '--paso', '5').salida
  assert.match(c, /^ {2}✗ [AM] dist\/otro\.js {3}← FUERA DE ALCANCE$/m)
  assert.doesNotMatch(c, /salida de verificar/)
  assert.match(c, /^ALCANCE: FUERA \(1\)$/m)
  // --cambios cierra la fase.
  assert.equal(typeof estadoJson().paralelos[0].hasta, 'string')
  assert.equal(estadoJson().en_curso, undefined)
})

test('estado: --cambios marca FUERA lo que cambió durante verificar en una tanda', () => {
  const { estadoJson, estado, verificar } = repoParalelo('paralelo-tanda', PASO_DE_OTRO)
  const t = estado('--tanda', '2', '--paso', '6')
  assert.match(t.salida, /^TANDA=2 DESDE=\S+$/m)
  assert.match(t.salida, /^BASE=[0-9a-f]{40}$/m)
  assert.equal(t.codigo, 0)
  const [fase, ...resto] = estadoJson().paralelos
  assert.deepEqual([resto.length, fase.tipo, fase.n, typeof fase.desde, fase.hasta], [0, 'tanda', 2, 'string', undefined])
  verificar()
  const c = estado('--cambios', '--global', '--paso', '6').salida
  assert.match(c, /^ {2}✗ [AM] dist\/otro\.js {3}← FUERA DE ALCANCE$/m)
  assert.doesNotMatch(c, /salida de verificar/)
  assert.match(c, /^ALCANCE: FUERA \(1\)$/m)
  assert.equal(typeof estadoJson().paralelos[0].hasta, 'string')
})

test('estado: --tanda de 1 solo avisa y sin flujo abierto falla', () => {
  const { estadoJson, estado } = repoParalelo('paralelo-uno', PASO_DE_OTRO)
  const uno = estado('--tanda', '1', '--paso', '6')
  assert.match(uno.salida, /^AVISO: una tanda de 1 no corre en paralelo/m)
  assert.doesNotMatch(uno.salida, /TANDA=/)
  assert.match(uno.salida, /^BASE=[0-9a-f]{40}$/m)
  assert.equal(uno.codigo, 0)
  assert.equal(estadoJson().paralelos, undefined)
  for (const valor of ['0', 'x']) {
    const r = estado('--tanda', valor)
    assert.match(r.salida, /^ERROR: --tanda necesita/m, valor)
    assert.equal(r.codigo, 2, valor)
  }
  const sinFlujo = repo('paralelo-sin-flujo', { 'src/a.ts': 'a\n' })
  temporales.push(sinFlujo)
  const r = estadoEn(sinFlujo, ['--tanda', '2'])
  assert.match(r.salida, /^ERROR: el flujo no está abierto/m)
  assert.equal(r.codigo, 2)
})

test('estado: --cambios sigue perdonando la salida de un build sin agentes en paralelo', () => {
  const build = [{ nombre: 'build', cmd: escribirCmd('dist/x.js', 'nuevo') }]
  const solo = repoParalelo('paralelo-build', build)
  solo.estado('--base', '--sub', '1')
  assert.equal(solo.estadoJson().paralelos, undefined)
  solo.verificar()
  const c = solo.estado('--cambios', '--sub', '1').salida
  assert.match(c, /^ {2}~ [AM] dist\/x\.js {3}← \(salida de verificar: build\)$/m)
  assert.match(c, /^ALCANCE: OK$/m)

  // Una corrida posterior al --cambios que cerró un lote de 2 también se perdona.
  const lote = repoParalelo('paralelo-build-despues', [{ nombre: 'build', cmd: `node -e "require('fs').writeFileSync('dist/x.js', String(Date.now()))"` }])
  lote.estado('--base', '--sub', '2,3')
  assert.match(lote.estado('--cambios', '--sub', '2,3').salida, /^ALCANCE: OK$/m)
  assert.equal(typeof lote.estadoJson().paralelos[0].hasta, 'string')
  lote.verificar()
  const despues = lote.estado('--cambios', '--sub', '2,3').salida
  assert.match(despues, /^ {2}~ [AM] dist\/x\.js {3}← \(salida de verificar: build\)$/m)
  assert.match(despues, /^ALCANCE: OK$/m)
})

/** Escribe en `claude` el transcript de un subagente del proyecto `raiz` (sesión `sesion`): su despacho y su informe, con hora de ahora. */
function subagente(claude, raiz, sesion, id, tipo, prompt, informe) {
  const sub = path.join(claude, 'projects', path.resolve(raiz).replace(/[^a-zA-Z0-9]/g, '-'), sesion, 'subagents')
  fs.mkdirSync(sub, { recursive: true })
  const t = new Date().toISOString()
  fs.writeFileSync(path.join(sub, `agent-${id}.meta.json`), JSON.stringify({ agentType: tipo }))
  const filas = [
    { type: 'user', timestamp: t, message: { role: 'user', content: prompt } },
    { type: 'assistant', timestamp: t, message: { id: `m-${id}`, model: 'claude-sonnet-5-5', usage: { output_tokens: 1 }, content: [{ type: 'text', text: informe }] } },
  ]
  fs.writeFileSync(path.join(sub, `agent-${id}.jsonl`), filas.map((f) => JSON.stringify(f)).join('\n') + '\n')
}

test('estado: --reanudar sigue un flujo cortado sin vaciar su carpeta, en el paso y el lote donde quedó', () => {
  const sin = { extra: '- Depende de: ninguna\n' }
  const { raiz, entorno, estadoJson } = repoConPlanGuardado('reanudar', [
    subtareaDePlan(1, 'src/a.ts', sin),
    subtareaDePlan(2, 'src/b.ts', sin),
    subtareaDePlan(3, 'src/c.ts', { extra: '- Depende de: S1, S2\n' }),
  ])
  const claude = entorno.CLAUDE_CONFIG_DIR
  const carpeta = flujoDe(raiz)
  const reanudar = () => estadoEn(raiz, ['--reanudar', '--paso', '0'], { ...entorno, CLAUDE_CODE_SESSION_ID: 'sesion-b' }).salida

  // El candado con plan guardado ofrece reanudar; --forzar sigue empezando de cero (lo prueba el test del candado).
  assert.match(estadoEn(raiz, ['--paso', '0'], entorno).salida, /^REANUDAR: estado\.mjs --reanudar --paso 0 sigue ese flujo sin vaciar su carpeta \(plan guardado, sin aprobar, 0\/3 subtareas terminadas\)$/m)

  // Cortado antes de aprobar: sigue en la aprobación, con el PARA APROBAR del plan guardado.
  const antes = reanudar()
  assert.match(antes, /^SIGUE: paso 4 · aprobación del plan/m)
  assert.match(antes, /^PARA APROBAR /m)

  assert.match(estadoEn(raiz, ['--aprobado', '--ajustes', 'S2 sin tests nuevos', '--paso', '4'], entorno).salida, /^APROBADO: plan de 3 subtarea\(s\) · ajustes: anotados$/m)
  // Cortado a mitad del lote 1 (foto tomada, ejecutores sin volver).
  const foto = /^BASE=(\w+) DESDE=(\S+)$/m.exec(estadoEn(raiz, ['--base', '--sub', '1,2', '--paso', '5'], entorno).salida)
  const enLote = reanudar()
  assert.match(enLote, /^SIGUE: paso 5 · lote 1\/2 \(S1\+S2\)$/m)
  assert.match(enLote, new RegExp(`^ {2}S1 · a medias \\(foto sin --cambios\\).* · FOTO BASE=${foto[1]} DESDE=${foto[2]}$`, 'm'))
  assert.match(enLote, /^AJUSTES AL PLAN: S2 sin tests nuevos$/m)
  assert.match(enLote, /^REANUDADO: misma sesión del flujo/m)
  assert.ok(fs.existsSync(path.join(carpeta, 'S1.md')), 'no vacía la carpeta')
  assert.equal(estadoJson().en_curso, undefined)
  assert.deepEqual(estadoJson().sesiones.map((s) => s.id ?? null), ['sesion-a', 'sesion-b'])

  // Vuelven: S1 HECHO y S2 FALLA. --cambios --sub anota el avance leyendo los ejecutores de los transcripts.
  subagente(claude, raiz, 'sesion-b', 'e1', 'impl:qcc-ejecutor', 'SUBTAREA 1/3: Tarea 1', 'ESTADO: HECHO')
  subagente(claude, raiz, 'sesion-b', 'e2', 'impl:qcc-ejecutor', 'SUBTAREA 2/3: Tarea 2', 'ESTADO: FALLA')
  assert.match(estadoEn(raiz, ['--cambios', '--sub', '1,2', '--permitidos', 'src/extra.ts', '--paso', '5'], entorno).salida, /^AVANCE: S1 HECHO · S2 FALLA$/m)
  const conFalla = reanudar()
  assert.match(conFalla, /^SIGUE: paso 5 · lote 1\/2 \(S1\+S2\)$/m)
  assert.match(conFalla, /^ {2}S2 · FALLA \(0 correcciones\) · FOTO /m)
  assert.doesNotMatch(conFalla.split('PENDIENTES:')[1], /^ {2}S1 · /m)
  assert.match(conFalla, /^PERMITIDOS AMPLIADOS: src\/extra\.ts$/m)

  // La corrección de S2 vuelve HECHO: el lote 1 terminó y sigue el lote 2, sin empezar.
  subagente(claude, raiz, 'sesion-b', 'e3', 'impl:qcc-ejecutor', 'SUBTAREA 2/3: Tarea 2\nCORRECCIÓN 1/2: corrige la causa', 'ESTADO: HECHO')
  assert.match(estadoEn(raiz, ['--cambios', '--sub', '2', '--paso', '5'], entorno).salida, /^AVANCE: S1 HECHO · S2 HECHO$/m)
  assert.equal(estadoJson().avance['2'].ciclos, 1)
  const lote2 = reanudar()
  assert.match(lote2, /^SIGUE: paso 5 · lote 2\/2 \(S3\)$/m)
  assert.match(lote2, /^ {2}S3 · sin empezar$/m)

  // «Seguir sin ella»: --omitida la da por terminada y sigue la revisión final.
  estadoEn(raiz, ['--base', '--sub', '3', '--paso', '5'], entorno)
  assert.match(estadoEn(raiz, ['--cambios', '--sub', '3', '--omitida', '--paso', '6'], entorno).salida, /^AVANCE: S3 OMITIDA$/m)
  assert.match(reanudar(), /^SIGUE: paso 6 · revisión ciclo 1$/m)

  // Otra sesión suma una nueva; la misma de antes no.
  const otra = estadoEn(raiz, ['--reanudar', '--paso', '0'], { ...entorno, CLAUDE_CODE_SESSION_ID: 'sesion-c' }).salida
  assert.match(otra, /^REANUDADO: sesión 3 del flujo/m)
  assert.deepEqual(estadoJson().sesiones.map((s) => s.id ?? null), ['sesion-a', 'sesion-b', 'sesion-c'])
})

test('estado: --reanudar en la revisión final da el ciclo que sigue y los PROBLEMAS literales', () => {
  const { raiz, entorno } = repoConPlanGuardado('reanudar-revision', [subtareaDePlan(1, 'src/a.ts'), subtareaDePlan(2, 'src/b.ts')])
  const claude = entorno.CLAUDE_CONFIG_DIR
  const reanudar = () => estadoEn(raiz, ['--reanudar', '--paso', '6'], entorno).salida
  estadoEn(raiz, ['--aprobado', '--paso', '4'], entorno)
  for (const n of [1, 2]) {
    estadoEn(raiz, ['--base', '--sub', String(n), '--paso', '5'], entorno)
    subagente(claude, raiz, 's1', `e${n}`, 'impl:qcc-ejecutor', `SUBTAREA ${n}/2: x`, 'ESTADO: HECHO')
    estadoEn(raiz, ['--cambios', '--sub', String(n), '--paso', '5'], entorno)
  }
  const reporte = 'VEREDICTO: RECHAZADO\nVERIFICACIÓN: orquestador · RESULTADO: VERDE\nCRITERIOS:\nS1 — ok\nS2 — no: falta el borde\nPROBLEMAS:\nsrc/b.ts:3 — sin borde — que lo maneje · repro: b(0) → lanza\nOBSERVACIONES: ninguna'
  subagente(claude, raiz, 's1', 'rev1', 'impl:qcc-revisor', 'QUÉ REVISAR: cambio completo (2 subtarea(s))\nSALIDA DEL OWNER: sin ejecutar\nNO corras verificar.mjs.\nCRÍTICO: ninguno', reporte)
  const guardada = estadoEn(raiz, ['--guardar', 'rev1', 'revision', '--paso', '6'], entorno).salida
  const archivo = path.join(flujoDe(raiz), 'revision-1.md')
  assert.equal(/^GUARDADO: revisión ciclo 1 \(RECHAZADO\) → (.*)$/m.exec(guardada)?.[1], archivo)
  assert.equal(fs.readFileSync(archivo, 'utf8'), `${reporte}\n\nSALIDA DEL OWNER: sin ejecutar\n`)
  // Volver a guardar el mismo agente no suma un ciclo.
  assert.match(estadoEn(raiz, ['--guardar', 'rev1', 'revision', '--paso', '6'], entorno).salida, /^GUARDADO: revisión ciclo 1 /m)

  // «sin criterios» da un solo ciclo: RECHAZADO en el ciclo 1 ya los agota y sigue el cierre DETENIDO.
  assert.match(reanudar(), /^SIGUE: paso 7 · cierre DETENIDO:6 \(1 ciclo\(s\) de la revisión final agotados\)$/m)
  const estadoJson = path.join(flujoDe(raiz), 'estado.json')
  const e = JSON.parse(fs.readFileSync(estadoJson, 'utf8'))
  fs.writeFileSync(estadoJson, JSON.stringify({ ...e, decisiones: { ...e.decisiones, ciclos: 'CICLOS DE LA REVISIÓN FINAL: 2' } }))
  const sinTanda = reanudar()
  assert.match(sinTanda, /^SIGUE: paso 6 · correcciones del ciclo 1 \(los PROBLEMAS de abajo\)$/m)
  assert.ok(sinTanda.includes('  PROBLEMAS:\n  src/b.ts:3 — sin borde — que lo maneje · repro: b(0) → lanza\n'))
  assert.ok(sinTanda.includes('  CRITERIOS:\n  S1 — ok\n  S2 — no: falta el borde\n'))
  assert.match(sinTanda, /^ {2}SALIDA DEL OWNER: sin ejecutar$/m)

  // Con la tanda abierta y sus ejecutores sin volver, la tanda está a medias; con los dos de vuelta, sigue el ciclo 2.
  const tanda = /^BASE=(\w+)$/m.exec(estadoEn(raiz, ['--tanda', '2', '--paso', '6'], entorno).salida)[1]
  const aMedias = reanudar()
  assert.match(aMedias, /^SIGUE: paso 6 · correcciones del ciclo 1 \(tanda a medias: 0\/2 volvieron\)$/m)
  assert.match(aMedias, new RegExp(`^ {2}TANDA DEL CICLO 1: BASE=${tanda} `, 'm'))
  for (const g of [1, 2]) subagente(claude, raiz, 's1', `g${g}`, 'impl:qcc-ejecutor', `SUBTAREA: correcciones de la revisión final\nGRUPO: ${g}/2\nCORRECCIÓN 1/2: x`, 'ESTADO: HECHO')
  const ciclo2 = reanudar()
  assert.match(ciclo2, /^SIGUE: paso 6 · revisión ciclo 2 /m)
  assert.ok(ciclo2.includes('src/b.ts:3 — sin borde'))
  assert.match(ciclo2, new RegExp(`TANDA DEL CICLO 1: BASE=${tanda}`))

  // Con la revisión APROBADO, el cierre; sin flujo o ya cerrado, --reanudar no tiene qué seguir.
  subagente(claude, raiz, 's1', 'rev2', 'impl:qcc-revisor', 'QUÉ REVISAR: cambio completo', 'VEREDICTO: APROBADO\nOBSERVACIONES: ninguna')
  assert.match(estadoEn(raiz, ['--guardar', 'rev2', 'revision', '--paso', '6'], entorno).salida, /^GUARDADO: revisión ciclo 2 \(APROBADO\)/m)
  assert.match(reanudar(), /^SIGUE: paso 7 · cierre/m)
  estadoEn(raiz, ['--cambios', '--global', '--paso', '7', '--resultado', 'COMPLETO'], entorno)
  const cerrado = estadoEn(raiz, ['--reanudar'], entorno)
  assert.equal(cerrado.codigo, 2)
  assert.match(cerrado.salida, /^ERROR: el flujo ya cerró/m)
  assert.ok(fs.readdirSync(path.join(path.dirname(flujoDe(raiz)), 'historial')).some((d) => fs.existsSync(path.join(path.dirname(flujoDe(raiz)), 'historial', d, 'revision-2.md'))))
})

test('estado: --guardar plan con más de 20 subtareas da un PARA APROBAR compacto y una salida bajo 30.000 caracteres', () => {
  const como = { extra: `- Cómo: ${'cambia la función con cuidado y revisa los llamadores '.repeat(4)}\n` }
  const largo = repoConPlanGuardado('aprobar-largo', Array.from({ length: 60 }, (_, i) => subtareaDePlan(i + 1, `src/f${i + 1}.ts`, como)))
  assert.ok(largo.salida.length < 30_000, `salida de ${largo.salida.length} caracteres`)
  const bloque = /^PARA APROBAR [^\n]*\n([\s\S]*?)\nFIN PARA APROBAR$/m.exec(largo.salida)[1]
  assert.doesNotMatch(bloque, /Cómo/)
  assert.match(bloque, /^S7 · Tarea 7 · Crítica: no · Depende de: \(la anterior\) · permitidos: src\/f7\.ts$/m)
  assert.equal((bloque.match(/^S\d+ · /gm) ?? []).length, 60)
  assert.doesNotMatch(largo.salida, /→ .*S7\.md$/m)
  assert.match(largo.salida, /^SUBTAREAS: 60 → /m)
  // Con 20 o menos, el bloque de siempre (con «Cómo») y una línea de resumen por subtarea.
  const corto = repoConPlanGuardado('aprobar-corto', Array.from({ length: 20 }, (_, i) => subtareaDePlan(i + 1, `src/f${i + 1}.ts`, como)))
  assert.match(/^PARA APROBAR [^\n]*\n([\s\S]*?)\nFIN PARA APROBAR$/m.exec(corto.salida)[1], /^- Cómo: /m)
  assert.match(corto.salida, /→ .*S7\.md$/m)
})

test.after(() => limpiar())
