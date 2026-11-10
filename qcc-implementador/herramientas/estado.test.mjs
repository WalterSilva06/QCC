// Casos de estado.mjs (preflight, planes, fotos, cierre), de la config del flujo y de instalar.mjs.
// Correr: node --test qcc-implementador/herramientas/estado.test.mjs

import { PRUEBAS, repo, ESTADO, temporales, estadoEn, estadoCon, limpiar } from './pruebas-comun.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { flujoDe } from './guardia.mjs'
import { listaPermitidos, opcionesDe, tokensDe, anotarFlujo, permitidosDe, mapaDelRepo, contextoDelProyecto, colapsarMovidos } from './estado.mjs'

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

test('estado: --diff colapsa el código movido sin cambios y deja a la vista lo editado', () => {
  const bloque = Array.from({ length: 12 }, (_, i) => `  const valor${i} = calcularAlgoLargo(${i})`)
  const raiz = repo('movido', { 'src/a.ts': ['inicio', ...bloque, 'fin', ''].join('\n') })
  temporales.push(raiz)
  const sha = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: raiz, encoding: 'utf8' }).stdout.trim()
  fs.writeFileSync(path.join(raiz, 'src/a.ts'), 'inicio\nfin\n')
  const movido = [...bloque]
  movido[6] = '  const editada = 1'
  fs.writeFileSync(path.join(raiz, 'src/b.ts'), movido.join('\n') + '\n')
  const { salida } = estadoEn(raiz, ['--diff', sha, '--permitidos', 'src/a.ts,src/b.ts'])
  assert.match(salida, /^MOVIDO SIN CAMBIOS: \d+ líneas colapsadas/m)
  assert.match(salida, /^~ 6 líneas quitadas aquí, movidas sin cambios/m)
  assert.match(salida, /^~ 6 líneas agregadas aquí, movidas sin cambios/m)
  assert.match(salida, /^- {2}const valor6 = calcularAlgoLargo\(6\)$/m)
  assert.match(salida, /^\+ {2}const editada = 1$/m)
  assert.doesNotMatch(salida, /\x1b/)
})

test('estado: colapsarMovidos solo junta tiradas largas del mismo signo', () => {
  const m = (s, t) => `\x1b[${s === '-' ? 35 : 36}m${s}${t}\x1b[m`
  const { lineas, colapsadas } = colapsarMovidos([' ctx', m('-', 'a'), m('-', 'b'), m('+', 'c'), m('+', 'd'), m('+', 'e'), m('+', 'f'), '\x1b[31m-g\x1b[m'])
  assert.deepEqual(lineas, [' ctx', '-a', '-b', '~ 4 líneas agregadas aquí, movidas sin cambios desde otro lugar del diff', '-g'])
  assert.equal(colapsadas, 4)
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

test('estado: mapaDelRepo con líneas cuenta por carpeta y lista los documentos largos', () => {
  const rutas = ['README.md', 'docs/grande.md', 'docs/justo.md', 'src/a/x.ts', 'src/b/y.ts', 'src/b/z.md', 'src/w.ts']
  const lineas = { 'README.md': 10, 'docs/grande.md': 301, 'docs/justo.md': 300, 'src/a/x.ts': 9000, 'src/b/y.ts': 90, 'src/w.ts': 10 }

  // Un .md de 301 líneas entra, uno de 300 no; el vacío (sin entrada) cuenta 0.
  assert.deepEqual(mapaDelRepo(rutas, 3, lineas), [
    'MAPA · 7 archivos · 9.711 líneas (git ls-files: versionados y nuevos, sin ignorados) · 3 carpeta(s)',
    'Las carpetas resumidas se exploran con Glob; lo ignorado por git no aparece.',
    'Documentos de más de 300 líneas: docs/grande.md (301)',
    './ — 1 archivos · 10 líneas: README.md',
    'docs/ — 2 archivos · 601 líneas: grande.md, justo.md',
    'src/ — 4 archivos en 2 subcarpetas · 9.100 líneas (.ts 3, .md 1)',
  ])

  // Sin documentos largos no hay línea; con la cola se cuentan las líneas de lo que falta.
  const raices = Array.from({ length: 4 }, (_, i) => `d${i}/f.ts`)
  const cola = mapaDelRepo(raices, 3, Object.fromEntries(raices.map((r) => [r, 1500])))
  assert.ok(!cola.some((l) => l.startsWith('Documentos')))
  assert.equal(cola.at(-1), '… y 2 carpetas más (2 archivos · 3.000 líneas)')

  // Con el tamaño, el documento lleva también sus KB (redondeados hacia arriba, con miles).
  const conKb = (bytes) => mapaDelRepo(rutas, 3, lineas, () => bytes)[2]
  assert.equal(conKb(315_000), 'Documentos de más de 300 líneas: docs/grande.md (301 · 308 KB)')
  assert.equal(conKb(1_048_576), 'Documentos de más de 300 líneas: docs/grande.md (301 · 1.024 KB)')
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
  assert.match(mapa, /^docs\/ — 1 archivos · 1 líneas: canción\.md$/m)
  assert.doesNotMatch(mapa, /"|\\\d{3}/)
  assert.doesNotMatch(mapa, /ignorado\.txt/)

  // Con la carpeta ocupada no se toca el mapa.
  fs.writeFileSync(path.join(raiz, 'nuevo.ts'), 'n\n')
  assert.match(estadoEn(raiz, ['--paso', '0']).salida, /^MAPA: ninguno/m)
  assert.doesNotMatch(fs.readFileSync(linea[1], 'utf8'), /nuevo\.ts/)

  // Con --forzar se rehace e incluye lo nuevo sin commit.
  const forzado = estadoEn(raiz, ['--paso', '0', '--forzar'])
  assert.match(forzado.salida, /^MAPA: .*mapa\.md \(\d+ archivos\)$/m)
  assert.match(fs.readFileSync(linea[1], 'utf8'), /^\.\/ — \d+ archivos · \d+ líneas: .*nuevo\.ts/m)
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
  // comun.md en dos partes, cortada en «## 5.»: cada una bajo los 30.000 caracteres que Claude Code inyecta sin guardar aparte, y juntas, la guía entera.
  const guia = (...args) => spawnSync(process.execPath, [ESTADO, '--guia', ...args], { encoding: 'utf8' })
  const [entera, uno, dos] = [guia('comun'), guia('comun', '--parte', '1'), guia('comun', '--parte', '2')]
  for (const r of [uno, dos]) {
    assert.equal(r.status, 0)
    assert.ok(r.stdout.length < 30_000, `parte de ${r.stdout.length} caracteres`)
  }
  assert.match(dos.stdout, /^## 5\./)
  assert.equal(uno.stdout + dos.stdout, entera.stdout)
  assert.equal(opcionesDe(['--guia', 'comun', '--parte', '2']).parte, '2')
  for (const mala of [['comun', '--parte', '3'], ['pasos', '--parte', '1']]) {
    assert.equal(guia(...mala).status, 2)
    assert.match(guia(...mala).stdout, /^ERROR: --parte vale solo con --guia comun y es 1 o 2/)
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

test('estado: listaPermitidos no parte en comas entre paréntesis', () => {
  assert.deepEqual(listaPermitidos("src/a.ts (nuevo, sin 'use server', cliente inyectado)"), ['src/a.ts'])
  assert.deepEqual(listaPermitidos("src/a.ts (nuevo, sin 'use server'), b/*.ts, c.md (doc, corto)"), ['src/a.ts', 'b/*.ts', 'c.md'])
  assert.deepEqual(permitidosDe('`src/a.ts` (nuevo, sin x), README.md — índice'), ['src/a.ts', 'README.md'])
})

test('estado: preflight avisa el contexto del proyecto por encima de 10k tokens', () => {
  const grande = estadoCon({}, () => [], { 'CLAUDE.md': '# Reglas\n' + 'x'.repeat(40_000) })
  assert.match(grande.salida, /^CONTEXTO DEL PROYECTO: ~11\d{3} tokens por agente \(CLAUDE\.md\)$/m)
  assert.match(grande.salida, /^AVISO: contexto del proyecto pesado: ~\d+ tokens por flujo solo en escribirlo en caché \(7 agentes típicos\); /m)
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
