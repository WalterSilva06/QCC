// Casos de verificar.mjs: resúmenes, caché del árbol, esperas entre corridas y salidas del build.
// Correr: node --test qcc-implementador/herramientas/verificar.test.mjs

import { PRUEBAS, repo, temporales, VERIFICAR, escribirCmd, limpiar } from './pruebas-comun.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { arbolDe } from './guardia.mjs'
import { pasosDe, detalleTipos, resumenTest, detalleTest, conDetalle, claveDe, marcaDe, esBuild, salidasDe } from './verificar.mjs'

test('verificar: resúmenes y detalle', () => {
  const lineas = (n, f) => Array.from({ length: n }, (_, i) => f(i + 1))

  // detalleTipos: solo las líneas de error; tope de 40 con aviso; sin errores, la cola de 30.
  const pocos = ['Found errors', 'src/a.ts(1,1): error TS2322: mal', 'ruido', 'src/b.ts(2,2): error TS2304: falta'].join('\n')
  assert.equal(detalleTipos(pocos), 'src/a.ts(1,1): error TS2322: mal\nsrc/b.ts(2,2): error TS2304: falta')
  const muchos = lineas(45, (i) => `src/f${i}.ts(1,1): error TS2322: x${i}`).join('\n')
  const tipos = detalleTipos(muchos).split('\n')
  assert.equal(tipos.length, 41)
  assert.equal(tipos[39], 'src/f40.ts(1,1): error TS2322: x40')
  assert.equal(tipos[40], '(+5 errores más)')
  const sinErrores = lineas(50, (i) => `linea ${i}`).join('\n')
  const cola30 = detalleTipos(sinErrores).split('\n')
  assert.equal(cola30.length, 30)
  assert.equal(cola30[0], 'linea 21')
  assert.equal(cola30[29], 'linea 50')

  // resumenTest: vitest, pytest y cargo.
  assert.equal(resumenTest(' Test Files  1 failed | 2 passed (3)\n      Tests  2 failed | 10 passed (12)\n'), 'archivos: 1 failed | 2 passed (3) · tests: 2 failed | 10 passed (12)')
  assert.equal(resumenTest('...\n=== 1 failed, 4 passed in 0.12s ===\n'), '1 failed, 4 passed in 0.12s')
  assert.equal(
    resumenTest('test result: ok. 3 passed; 0 failed\n\ntest result: FAILED. 5 passed; 1 failed\n'),
    'FAILED. 5 passed; 1 failed',
  )
  assert.equal(resumenTest('nada que resumir'), '')

  // detalleTest: desde «Failed Tests», respaldo `FAIL`, cola de 40.
  const vitest = ['ok 1', 'ok 2', ' FAIL  a.test.ts > algo', '⎯⎯ Failed Tests 1 ⎯⎯', 'detalle del fallo', ' Test Files  1 failed (1)', '      Tests  1 failed (1)'].join('\n')
  const dv = detalleTest(vitest)
  assert.ok(dv.startsWith('⎯⎯ Failed Tests 1 ⎯⎯\ndetalle del fallo'))
  assert.ok(!dv.includes('ok 2'))
  assert.ok(dv.endsWith('…\narchivos: 1 failed (1) · tests: 1 failed (1)'))
  const respaldo = detalleTest(['ok 1', 'FAIL algo.test', 'traza'].join('\n'))
  assert.equal(respaldo, 'FAIL algo.test\ntraza')
  const larga = detalleTest(lineas(60, (i) => `salida ${i}`).join('\n')).split('\n')
  assert.equal(larga.length, 40)
  assert.equal(larga[0], 'salida 21')

  // conDetalle: el detalle y el resumen según el tipo de paso.
  const t = conDetalle({ nombre: 'test', cmd: 'npm run test' })
  assert.equal(t.detalle, detalleTest)
  assert.equal(t.resumen, resumenTest)
  const tc = conDetalle({ nombre: 'typecheck', cmd: 'tsc --noEmit' })
  assert.equal(tc.detalle, detalleTipos)
  assert.equal(tc.resumen, undefined)
  for (const paso of [{ nombre: 'validate', cmd: 'claude plugin validate x' }, { nombre: 'lint', cmd: 'eslint .' }]) {
    const p = conDetalle(paso)
    assert.equal(p.resumen, undefined)
    const n50 = lineas(50, (i) => `l${i}`).join('\n')
    assert.equal(p.detalle(n50).split('\n').length, 40)
  }
})

/** Corre verificar.mjs en un repo temporal con estos pasos. */
function verificarCon(pasos) {
  const raiz = repo('verificar', { '.claude/implementador.json': { verificar: pasos } })
  temporales.push(raiz)
  const env = { ...process.env, CLAUDE_PROJECT_DIR: raiz }
  const r = spawnSync(process.execPath, [VERIFICAR], { cwd: raiz, encoding: 'utf8', env })
  return { salida: r.stdout ?? '', codigo: r.status, lineas: (r.stdout ?? '').trimEnd().split('\n') }
}

test('verificar: con ROJO repite RESULTADO al final y corta el paso que pasa su tope', () => {
  const t0 = Date.now()
  const rojo = verificarCon([
    { nombre: 'bien', cmd: 'node -e "console.log(1)"' },
    { nombre: 'mal', cmd: 'node -e "process.exit(3)"' },
    { nombre: 'colgado', cmd: 'node -e "setTimeout(() => {}, 60000)"', timeoutSeg: 1 },
  ])
  assert.ok(Date.now() - t0 < 30000, 'el tope de 1 s no cortó el paso colgado')
  assert.equal(rojo.codigo, 1)
  assert.equal(rojo.lineas.at(-1), 'RESULTADO: ROJO (mal, colgado)')
  assert.equal(rojo.lineas.filter((l) => l.startsWith('RESULTADO:')).length, 2)
  assert.match(rojo.salida, /^bien {7}OK/m)
  assert.match(rojo.salida, /^── mal: falló \(exit 3\) ──$/m)
  assert.match(rojo.salida, /^── colgado: superó 1 s \(timeoutSeg\) y se cortó ──$/m)

  const verde = verificarCon([{ nombre: 'bien', cmd: 'node -e "console.log(1)"' }])
  assert.equal(verde.codigo, 0)
  assert.equal(verde.lineas.at(-1), 'RESULTADO: VERDE')
  assert.equal(verde.lineas.filter((l) => l.startsWith('RESULTADO:')).length, 1)
})

test('verificar: repite un VERDE desde la caché mientras el árbol no cambie', () => {
  const raiz = repo('cache', { '.claude/implementador.json': { verificar: [{ nombre: 'bien', cmd: 'node -e "console.log(1)"' }] }, 'src/a.ts': 'a\n' })
  temporales.push(raiz)
  const correr = (...args) => spawnSync(process.execPath, [VERIFICAR, ...args], { cwd: raiz, encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: raiz } }).stdout

  const primera = correr()
  assert.doesNotMatch(primera, /caché/)
  assert.match(primera, /^bien {7}OK/m)
  const repetida = correr()
  assert.match(repetida, /^\(caché: el árbol \w{9} ya salió VERDE con estos pasos a las .*\)$/m)
  // Desde la caché se repite la tabla guardada (va al cierre como evidencia), sin la cabecera.
  assert.match(repetida, /^bien {7}OK/m)
  assert.doesNotMatch(repetida, /^verificar \(/m)
  assert.equal(repetida.trimEnd().split('\n').length, 3)
  assert.equal(repetida.trimEnd().split('\n').at(-1), 'RESULTADO: VERDE')
  assert.doesNotMatch(correr('--sin-cache'), /caché/)
  // Un archivo nuevo (no ignorado) cambia el árbol.
  fs.writeFileSync(path.join(raiz, 'src/b.ts'), 'b\n')
  assert.doesNotMatch(correr(), /caché/)
})

/** Repo de prueba con dist/x.js y src/a.js versionados y estos pasos; `correr()` devuelve la salida de verificar.mjs. */
function repoDeSalidas(pasos) {
  const raiz = repo('salidas', { '.claude/implementador.json': { verificar: pasos }, 'dist/x.js': 'viejo', 'src/a.js': 'a' })
  temporales.push(raiz)
  const correr = (...args) => spawnSync(process.execPath, [VERIFICAR, ...args], { cwd: raiz, encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: raiz } }).stdout
  return { raiz, correr }
}

test('verificar: esBuild distingue los pasos de build de lint, format y fix', () => {
  for (const [nombre, cmd] of [['build', 'npm run build'], ['x', 'go build ./...'], ['codegen', 'node gen.mjs'], ['bundle', 'rollup -c']]) {
    assert.equal(esBuild({ nombre, cmd }), true, `${nombre} ${cmd}`)
  }
  for (const [nombre, cmd] of [['lint', 'eslint .'], ['build', 'eslint --fix . && tsc'], ['format', 'prettier -w .'], ['test', 'vitest run'], ['typecheck', 'tsc --noEmit']]) {
    assert.equal(esBuild({ nombre, cmd }), false, `${nombre} ${cmd}`)
  }
})

test('verificar: caché con el árbol posterior acierta si solo cambió la salida del build', () => {
  const { correr } = repoDeSalidas([{ nombre: 'build', cmd: escribirCmd('dist/x.js', 'nuevo') }])
  const primera = correr()
  assert.doesNotMatch(primera, /caché/)
  assert.equal(primera.trimEnd().split('\n').at(-1), 'RESULTADO: VERDE')
  // El árbol ya trae la salida generada: la segunda corrida sale de la caché, sin correr el build.
  const segunda = correr()
  assert.match(segunda, /^\(caché: el árbol \w{9} ya salió VERDE/m)
  // Repite la tabla guardada de la primera, tal cual: no hay una corrida nueva con otro tiempo.
  assert.equal(segunda.split('\n')[0], primera.split('\n')[0])
  assert.equal(segunda.trimEnd().split('\n').at(-1), 'RESULTADO: VERDE')
})

test('verificar: un paso que cambia código fuente no deja caché', () => {
  const { correr } = repoDeSalidas([{ nombre: 'lint', cmd: escribirCmd('src/a.js', 'arreglado') }])
  assert.equal(correr().trimEnd().split('\n').at(-1), 'RESULTADO: VERDE')
  // Ni la clave del árbol previo ni la posterior: la segunda corrida vuelve a correr (y esta vez no cambia nada).
  const segunda = correr()
  assert.doesNotMatch(segunda, /caché/)
  assert.match(segunda, /^lint {7}OK/m)
  // Con el árbol ya estable (el lint no cambia nada) la tercera sí sale de la caché.
  assert.match(correr(), /^\(caché: /m)
})

test('verificar: VERDE compacto, y con ROJO sigue la cabecera y el detalle', () => {
  const verde = verificarCon([{ nombre: 'uno', cmd: 'node -e "console.log(1)"' }, { nombre: 'dos', cmd: 'node -e "console.log(2)"' }])
  assert.equal(verde.codigo, 0)
  assert.ok(verde.lineas.length <= 3, verde.salida)
  assert.doesNotMatch(verde.salida, /verificar \(/)
  assert.match(verde.lineas[0], /^uno {8}OK/)
  assert.equal(verde.lineas.at(-1), 'RESULTADO: VERDE')

  const rojo = verificarCon([{ nombre: 'uno', cmd: 'node -e "console.log(1)"' }, { nombre: 'dos', cmd: 'node -e "console.log(\'detalle-del-fallo\'); process.exit(2)"' }])
  assert.equal(rojo.codigo, 1)
  assert.match(rojo.lineas[0], /^verificar \(\.claude\/implementador\.json\): /)
  assert.match(rojo.lineas[1], /^uno {8}OK/)
  assert.match(rojo.salida, /^dos {8}FALLÓ/m)
  assert.match(rojo.salida, /detalle-del-fallo/)
  assert.equal(rojo.lineas.at(-1), 'RESULTADO: ROJO (dos)')
})

test('verificar: anota en salidas lo que cambió la corrida', () => {
  const { raiz, correr } = repoDeSalidas([
    { nombre: 'build', cmd: `${escribirCmd('dist/x.js', 'nuevo')} && ${escribirCmd('dist/y.js', 'otro')}` },
    { nombre: 'lint', cmd: escribirCmd('src/a.js', 'arreglado') },
  ])
  assert.deepEqual(salidasDe(raiz), [])
  correr()
  const hash = (rel) => execFileSync('git', ['hash-object', rel], { cwd: raiz, encoding: 'utf8' }).trim()
  const salidas = Object.fromEntries(salidasDe(raiz).map((s) => [s.ruta, s]))
  assert.deepEqual(Object.keys(salidas).sort(), ['dist/x.js', 'dist/y.js', 'src/a.js'])
  assert.equal(salidas['dist/x.js'].blob, hash('dist/x.js'))
  assert.equal(salidas['dist/y.js'].blob, hash('dist/y.js'))
  assert.equal(salidas['src/a.js'].blob, hash('src/a.js'))
  assert.deepEqual([salidas['dist/x.js'].paso, salidas['dist/x.js'].generado], ['build', true])
  assert.deepEqual([salidas['src/a.js'].paso, salidas['src/a.js'].generado], ['lint', false])
  assert.ok(Number.isFinite(Date.parse(salidas['dist/x.js'].t)))

  // Un archivo borrado queda con el blob de ceros; una corrida que no cambia nada no anota nada más.
  const previas = salidasDe(raiz).length
  fs.writeFileSync(path.join(raiz, '.claude/implementador.json'), JSON.stringify({ verificar: [{ nombre: 'build', cmd: 'node -e "require(\'fs\').rmSync(\'dist/y.js\', { force: true })"' }] }))
  correr()
  const borrado = salidasDe(raiz).filter((s) => s.ruta === 'dist/y.js').at(-1)
  assert.equal(borrado.blob, '0'.repeat(40))
  assert.equal(salidasDe(raiz).length, previas + 1)
  correr('--sin-cache')
  assert.equal(salidasDe(raiz).length, previas + 1)
})

/** Corre verificar.mjs en `raiz` sin bloquear: `{ salida, codigo }` al terminar. */
const verificarAsync = (raiz) => new Promise((listo) => {
  const hijo = spawn(process.execPath, [VERIFICAR], { cwd: raiz, env: { ...process.env, CLAUDE_PROJECT_DIR: raiz } })
  let salida = ''
  hijo.stdout.setEncoding('utf8').on('data', (d) => (salida += d))
  hijo.on('close', (codigo) => listo({ salida, codigo }))
})

/** Clave de la corrida de `raiz`, como la calcula verificar.mjs. */
const claveDeRepo = (raiz) => claveDe(arbolDe(raiz), pasosDe(raiz).pasos)

test('verificar: una segunda corrida con el mismo árbol espera la que está en curso', async () => {
  const contador = path.join(PRUEBAS, 'contador.txt')
  const script = path.join(PRUEBAS, 'espera.cjs')
  fs.writeFileSync(script, "require('fs').appendFileSync(process.argv[2], 'x\\n')\nsetTimeout(() => {}, 1500)\n")
  const aRuta = (p) => `"${p.replace(/\\/g, '/')}"`
  const raiz = repo('espera', { '.claude/implementador.json': { verificar: [{ nombre: 'lento', cmd: `node ${aRuta(script)} ${aRuta(contador)}` }] }, 'src/a.ts': 'a\n' })
  temporales.push(raiz)

  const [a, b] = await Promise.all([verificarAsync(raiz), verificarAsync(raiz)])
  assert.equal(fs.readFileSync(contador, 'utf8').trimEnd().split('\n').length, 1)
  for (const r of [a, b]) {
    assert.equal(r.salida.trimEnd().split('\n').at(-1), 'RESULTADO: VERDE')
    assert.equal(r.codigo, 0)
  }
  assert.equal([a, b].filter((r) => /^\(esperó la corrida en curso de las /m.test(r.salida)).length, 1)
  const marca = JSON.parse(fs.readFileSync(marcaDe(raiz), 'utf8'))
  assert.equal(marca.resultado, 'RESULTADO: VERDE')
  assert.ok(marca.fin)
})

test('verificar: una marca de un proceso muerto no se espera', async () => {
  const raiz = repo('muerta', { '.claude/implementador.json': { verificar: [{ nombre: 'bien', cmd: 'node -e "console.log(1)"' }] }, 'src/a.ts': 'a\n' })
  temporales.push(raiz)
  const muerto = spawnSync(process.execPath, ['-e', '0']).pid
  fs.mkdirSync(path.dirname(marcaDe(raiz)), { recursive: true })
  fs.writeFileSync(marcaDe(raiz), JSON.stringify({ clave: claveDeRepo(raiz), pid: muerto, inicio: new Date().toISOString() }))

  const r = await verificarAsync(raiz)
  assert.doesNotMatch(r.salida, /esperó/)
  assert.equal(r.salida.trimEnd().split('\n').at(-1), 'RESULTADO: VERDE')
  const marca = JSON.parse(fs.readFileSync(marcaDe(raiz), 'utf8'))
  assert.notEqual(marca.pid, muerto)
  assert.ok(marca.fin)
  assert.ok(marca.salida.includes('RESULTADO: VERDE'))
})

test('verificar: repite la salida y el código de la corrida que esperó', async () => {
  const raiz = repo('ajena', { '.claude/implementador.json': { verificar: [{ nombre: 'x', cmd: 'node -e "process.exit(1)"' }] }, 'src/a.ts': 'a\n' })
  temporales.push(raiz)
  // La corrida «en curso» es este mismo proceso (vivo): termina a mano, con un ROJO.
  const marca = { clave: claveDeRepo(raiz), pid: process.pid, inicio: new Date().toISOString() }
  fs.mkdirSync(path.dirname(marcaDe(raiz)), { recursive: true })
  fs.writeFileSync(marcaDe(raiz), JSON.stringify(marca))

  const espera = verificarAsync(raiz)
  await new Promise((listo) => setTimeout(listo, 1200))
  fs.writeFileSync(marcaDe(raiz), JSON.stringify({ ...marca, fin: new Date().toISOString(), resultado: 'RESULTADO: ROJO (x)', salida: ['x          FALLÓ', 'RESULTADO: ROJO (x)'] }))
  const r = await espera
  assert.match(r.salida, /^\(esperó la corrida en curso de las /m)
  assert.match(r.salida, /^x {10}FALLÓ$/m)
  assert.equal(r.salida.trimEnd().split('\n').at(-1), 'RESULTADO: ROJO (x)')
  assert.equal(r.codigo, 1)
})

test.after(() => limpiar())
