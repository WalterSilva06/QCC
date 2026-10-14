// Casos de la guardia, del chequeo de alcance, de estado y de verificar de /implementador.
// Correr: node --test ~/.claude/flujos/guardia.test.mjs
//
// Arma dos repos de prueba en el temporal: uno con `.claude/implementador.json` estricto
// (pnpm, migraciones inmutables, scripts negados, secretos) y uno npm sin config, para
// comprobar los valores por defecto.

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { evaluar, analizar, raizDe, registroDe, configDe, coincide } from './guardia.mjs'
import { listaPermitidos, enAlcance, opcionesDe } from './estado.mjs'
import { pasosDe, detalleTipos, resumenTest, detalleTest, conDetalle } from './verificar.mjs'

const WIN = process.platform === 'win32'

function repo(nombre, archivos) {
  const raiz = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `guardia-${nombre}-`)))
  for (const [rel, contenido] of Object.entries(archivos)) {
    fs.mkdirSync(path.dirname(path.join(raiz, rel)), { recursive: true })
    fs.writeFileSync(path.join(raiz, rel), typeof contenido === 'string' ? contenido : JSON.stringify(contenido))
  }
  const git = (...a) => execFileSync('git', a, { cwd: raiz, stdio: 'ignore' })
  git('init', '-q')
  git('add', '-A')
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'base')
  return raiz
}

const ESTRICTO = repo('estricto', {
  'package.json': {
    scripts: {
      dev: 'vite', 'dev:sin-tunel': 'vite', build: 'vite build', test: 'vitest run', typecheck: 'tsc --noEmit',
      'db:push': 'supabase db push', 'flow:planes:sandbox': 'node scripts/flow/x.mjs', 'preflight:schema': 'node x', format: 'prettier -w .',
    },
  },
  'pnpm-lock.yaml': '',
  'supabase/migrations/20261010000001_citas_precio.sql': '-- x',
  'src/server/citas.ts': '',
  '.gitignore': '/.claude\n',
  '.claude/implementador.json': {
    verificar: [{ nombre: 'test', cmd: 'pnpm run test' }],
    guardia: {
      protegidos: { 'src/routeTree.gen.ts': 'lo regenera el build', 'scripts/flow/.evidence/': 'evidencia local' },
      secretos: ['CUENTAS_PRUEBA.md'],
      externos: { deno: 'a mano' },
      scriptsPermitidos: ['typecheck', 'build', 'test'],
      scriptsNegados: ['db:*', 'flow:*', 'preflight:*'],
      nodeNegado: ['scripts/'],
    },
  },
})

const GENERICO = repo('generico', {
  'package.json': { scripts: { dev: 'next dev', build: 'next build', lint: 'eslint .', test: 'jest', format: 'prettier -w .' } },
  'package-lock.json': '{}',
  'prisma/migrations/0001_init/migration.sql': '-- x',
  'src/app.ts': '',
})

const ev = (raiz, tool_name, tool_input) => ({ tool_name, tool_input, cwd: raiz })
const bash = (raiz, command) => ev(raiz, 'Bash', { command })
const ps = (raiz, command) => ev(raiz, 'PowerShell', { command })
const edita = (raiz, file_path, tool_name = 'Edit') => ev(raiz, tool_name, { file_path })
const etiqueta = (e) => `${e.tool_name} ${JSON.stringify(e.tool_input)}`

function niega(e, rol = 'ejecutor') {
  const { motivo } = evaluar(e, rol, e.cwd)
  assert.ok(motivo, `debía negar (${rol}): ${etiqueta(e)}`)
}
function deja(e, rol = 'ejecutor') {
  const { motivo } = evaluar(e, rol, e.cwd)
  assert.equal(motivo, null, `debía dejar (${rol}): ${etiqueta(e)} → ${motivo}`)
}

test('proyecto: raíz, registro por proyecto, config y verificación', () => {
  assert.equal(raizDe(path.join(ESTRICTO, 'src', 'server')), ESTRICTO)
  assert.notEqual(registroDe(ESTRICTO), registroDe(GENERICO))
  assert.match(registroDe(ESTRICTO), /registros[\\/]guardia-estricto-[^\\/]+-[0-9a-f]{10}\.jsonl$/)
  assert.equal(configDe(ESTRICTO).pm, 'pnpm')
  assert.equal(configDe(GENERICO).pm, 'npm')
  assert.equal(configDe(GENERICO).archivo, null)
  assert.deepEqual(pasosDe(ESTRICTO).pasos.map((p) => p.cmd), ['pnpm run test'])
  assert.deepEqual(pasosDe(GENERICO).pasos.map((p) => p.cmd), ['npm run lint', 'npm run build', 'npm run test'])
})

test('ejecutor: verificación, lectura y edición dentro del alcance pasan', () => {
  const R = ESTRICTO
  for (const c of [
    'pnpm typecheck',
    'pnpm build 2>&1 | tail -n 30',
    'pnpm test',
    'pnpm run test',
    'pnpm vitest run src/server/slots.test.ts',
    'pnpm exec vitest run src/lib',
    'pnpm exec tsc --noEmit',
    'pnpm tsc --noEmit',
    'pnpm why zod',
    'git status --porcelain',
    'git diff HEAD -- src/server/citas.ts',
    'git --no-pager log --oneline -5',
    'git -C . show HEAD:package.json',
    'git branch --show-current',
    'node ~/.claude/flujos/verificar.mjs',
    'node "$HOME/.claude/flujos/estado.mjs" --diff abc --permitidos "src/x.ts"',
    'node -e "console.log(process.env.HOME)"',
    'rm src/server/viejo.ts',
    'rm -f src/server/viejo.ts',
    'grep -rn "git push" src/',
    'grep -rn ".env" src/',
    'rg "\\.env" src',
    'ls -la src/server | head -20',
    'echo listo > /dev/null',
    'cat src/lib/slug.ts | head -n 20',
    'mkdir -p src/server/nuevo && cp src/lib/slug.ts src/server/nuevo/slug.ts',
    "cat <<'EOF' > /tmp/nota.txt\ngit push origin main\nEOF",
    '# comentario sobre .env y git push\npnpm test',
    'for f in src/lib/*.ts; do wc -l "$f"; done',
  ]) deja(bash(R, c))
  deja(edita(R, 'src/server/citas.ts'))
  deja(edita(R, path.join(R, 'src', 'server', 'citas.ts')))
  deja(edita(R, 'supabase/migrations/20991231000001_prueba.sql', 'Write'))
  deja(edita(R, '.env.example'))
  deja(edita(R, '.claude/implementador.md'))
  deja(edita(R, '.claude/implementador.json'))
  if (WIN) deja(edita(R, `/${R[0].toLowerCase()}${R.slice(2).replace(/\\/g, '/')}/src/x.ts`))
})

test('ejecutor: git que modifica, servicios vivos, dependencias y borrados se niegan', () => {
  const R = ESTRICTO
  for (const c of [
    'git commit -m "x"',
    'git -C . push',
    'git add .',
    'git stash',
    'git stash list',
    'git checkout -- src/a.ts',
    'git reset --hard HEAD',
    'git restore src/a.ts',
    'cd src && git commit -am x',
    'git branch nueva',
    'git branch -D vieja',
    'git pull',
    'git notes list',
    'pnpm db:push',
    'pnpm run db:push',
    'pnpm dev',
    'pnpm dev:sin-tunel --help',
    'pnpm flow:planes:sandbox',
    'pnpm preflight:schema',
    'pnpm format',
    'pnpm add zod',
    'pnpm install',
    'pnpm vitest src/x.test.ts',
    'pnpm exec vite',
    'npx supabase db push --linked',
    'supabase db push --linked',
    'deno deploy',
    'fly deploy',
    'npm i',
    'npm test',
    'curl https://example.com',
    'curl --version',
    'node --env-file=.env scripts/flow/crear-planes.mjs',
    'node scripts/seed-demo.mjs',
    'rm -rf src/old',
    'rm -fr dist',
    'bash -c "git push"',
    "sh -c 'pnpm db:push'",
    'echo $(git push)',
    'x=`git push`',
    'cat .env',
    'cat ./.env.local',
    'grep -n SUPABASE .env',
    'echo x > .claude/settings.json',
    'echo x > ~/.claude/settings.json',
    'echo x >> src/routeTree.gen.ts',
    'cp a.txt .git/config',
    'gh pr create',
    'find . -name "*.tmp" -delete',
    'find src -exec rm {} \\;',
    'nice -n 10 git push',
    'env FOO=1 git commit -m x',
    'timeout 30 git push',
    'xargs -I {} git rm {}',
    'cat CUENTAS_PRUEBA.md',
  ]) niega(bash(R, c))
  for (const r of [
    '.claude/agents/ejecutor.md',
    '.claude/settings.json',
    '.claude/settings.local.json',
    'src/routeTree.gen.ts',
    'supabase/migrations/20261010000001_citas_precio.sql',
    '../otro-repo/x.ts',
    path.join(os.homedir(), 'x.txt'),
    '.env',
    'pnpm-lock.yaml',
    'node_modules/x/index.js',
    'CUENTAS_PRUEBA.md',
    'scripts/flow/.evidence/x.json',
  ]) niega(edita(R, r, 'Write'))
})

test('valores por defecto en un proyecto npm sin config', () => {
  const R = GENERICO
  for (const c of [
    'npm test',
    'npm run build',
    'npm run lint',
    'npm run format',
    'npm exec --no -- tsc --noEmit',
    'npx --no-install jest src',
    'node scripts/algo.mjs',
    'cargo test',
    'go test ./...',
    'python -m pytest -q',
  ]) deja(bash(R, c))
  for (const c of [
    'npm run dev',
    'npm start',
    'npm install lodash',
    'npm ci',
    'npm exec tsc',
    'npx next dev',
    'pnpm test',
    'yarn add x',
    'next dev',
    'jest --watch',
    'tsc -w',
    'pip install requests',
    'python -m pip install requests',
    'uv add httpx',
    'cargo add serde',
    'go get example.com/x',
    'go mod tidy',
    'docker compose up',
    'vercel deploy',
    'terraform apply',
  ]) niega(bash(R, c))
  deja(edita(R, 'src/app.ts'))
  deja(edita(R, 'prisma/migrations/0002_nueva/migration.sql', 'Write'))
  niega(edita(R, 'prisma/migrations/0001_init/migration.sql'))
  niega(edita(R, 'package-lock.json'))
  niega(edita(R, 'dist/app.js', 'Write'))
})

test('revisor: lee y verifica, nunca escribe', () => {
  const R = ESTRICTO
  for (const c of [
    'pnpm test',
    'node ~/.claude/flujos/verificar.mjs',
    'node ~/.claude/flujos/verificar.mjs 2>&1 | tail -n 40',
    'node ~/.claude/flujos/estado.mjs --diff abc --permitidos "src/x.ts" -- src/x.ts',
    'git diff abc def -- src',
    'pnpm build 2>&1 | tail -5',
    "grep -rn \"select('*')\" src/server > /dev/null; echo hecho",
    "sed -n '1,40p' src/server/citas.ts",
  ]) deja(bash(R, c), 'revisor')
  niega(edita(R, 'src/x.ts'), 'revisor')
  niega(edita(R, 'src/x.ts', 'Write'), 'revisor')
  for (const c of [
    "sed -i 's/a/b/' src/x.ts",
    'echo x > src/x.ts',
    'echo x > /tmp/salida.txt',
    'rm src/x.ts',
    'mv a b',
    'cp a b',
    'tee salida.txt',
    'git checkout x',
    "perl -pi -e 's/a/b/' x",
    'git diff --output=x.patch',
  ]) niega(bash(R, c), 'revisor')
})

test('PowerShell y herramientas que la guardia no vigila', () => {
  const R = ESTRICTO
  niega(ps(R, 'git push; Get-ChildItem'))
  niega(ps(R, 'Remove-Item -Recurse src\\x'))
  deja(ps(R, 'Get-ChildItem src'))
  deja(ps(R, 'Write-Output "a`nb"'))
  deja(ev(R, 'Read', { file_path: '.env' }))
  deja(ev(R, 'Grep', { pattern: 'x' }))
})

test('el parser no revienta con entradas rotas', () => {
  for (const c of ['echo "sin cerrar', '$(', "'", '`', 'a &&', '| |', '<<', '2>', '((((']) {
    assert.doesNotThrow(() => analizar(c))
    assert.doesNotThrow(() => evaluar(bash(ESTRICTO, c), 'ejecutor', ESTRICTO))
  }
})

test('alcance: globs y lista de permitidos', () => {
  assert.deepEqual(listaPermitidos('a.ts, src/routeTree.gen.ts (generado) ,b/*.ts,'), ['a.ts', 'src/routeTree.gen.ts', 'b/*.ts'])
  assert.ok(coincide('src/server/x.ts', ['src/server/x.ts']))
  assert.ok(coincide('src/server/x.test.ts', ['src/server/*.ts']))
  assert.ok(!coincide('src/server/sub/x.ts', ['src/server/*.ts']))
  assert.ok(coincide('src/server/sub/x.ts', ['src/server/**']))
  assert.ok(coincide('src/server/sub/x.ts', ['src/server/']))
  assert.ok(coincide('supabase/migrations/20261011000001_x.sql', ['supabase/migrations/20261011*_*.sql']))
  assert.ok(!coincide('src/lib/otra.ts', ['src/server/**', 'src/lib/slug.ts']))
  if (WIN) assert.ok(coincide('SRC/x.ts', ['src/x.ts']))
  assert.ok(enAlcance('src/a.ts', ['src/a.ts']))
  assert.ok(!enAlcance('dist/x.js', ['src/a.ts']))
  assert.ok(enAlcance('dist/x.js', []))
})

const ESTADO = fileURLToPath(new URL('./estado.mjs', import.meta.url))
const temporales = []

/** Repo temporal con `src/a.ts` y `dist/x.js` versionados y luego modificados; corre estado.mjs con `args(sha)`. */
function estadoCon(config, args) {
  const raiz = repo('estado', {
    '.claude/implementador.json': JSON.stringify(config),
    'src/a.ts': 'a\n',
    'dist/x.js': 'x\n',
  })
  temporales.push(raiz)
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: raiz, encoding: 'utf8' }).trim()
  fs.writeFileSync(path.join(raiz, 'src/a.ts'), 'a2\n')
  fs.writeFileSync(path.join(raiz, 'dist/x.js'), 'x2\n')
  const env = { ...process.env, CLAUDE_PROJECT_DIR: raiz }
  const r = spawnSync(process.execPath, [ESTADO, ...args(sha)], { cwd: raiz, encoding: 'utf8', env })
  return { salida: r.stdout ?? '', codigo: r.status }
}

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

  assert.deepEqual(opcionesDe([]), { modo: 'preflight', base: undefined, desde: undefined, permitidos: [], rutas: [], paso: null, aviso: undefined })

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

const GUARDIA = fileURLToPath(new URL('./guardia.mjs', import.meta.url))

/** Corre guardia.mjs como hook de `rol` con `evento` por stdin, en el proyecto `raiz`. */
function hook(raiz, rol, evento) {
  const env = { ...process.env, CLAUDE_PROJECT_DIR: raiz }
  return spawnSync(process.execPath, [GUARDIA, rol], { cwd: raiz, encoding: 'utf8', env, input: JSON.stringify(evento) })
}

/** Filas del registro del proyecto (vacío si no hay). */
function filasDe(raiz) {
  try {
    return fs.readFileSync(registroDe(raiz), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
  } catch {
    return []
  }
}

/** Borra el registro del repo temporal (y su rotación). */
function borrarRegistro(raiz) {
  const registro = registroDe(raiz)
  fs.rmSync(registro, { force: true })
  fs.rmSync(registro.replace(/\.jsonl$/, '.1.jsonl'), { force: true })
}

test('guardia: roles de lectura registran sin bloquear', () => {
  const raiz = repo('lectura', { 'src/a.ts': 'a\n' })
  temporales.push(raiz)
  try {
    const ultima = () => filasDe(raiz).at(-1)
    const dato = (fila) => ({ rol: fila.rol, herramienta: fila.herramienta, objetivo: fila.objetivo, decision: fila.decision })

    const leer = hook(raiz, 'explorador', ev(raiz, 'Read', { file_path: path.join(raiz, 'src', 'a.ts') }))
    assert.equal(leer.stdout, '')
    assert.equal(leer.status, 0)
    assert.deepEqual(dato(ultima()), { rol: 'explorador', herramienta: 'Read', objetivo: 'src/a.ts', decision: 'lectura' })

    const buscar = hook(raiz, 'planificador', ev(raiz, 'Grep', { pattern: 'foo', path: 'src' }))
    assert.equal(buscar.stdout, '')
    assert.equal(buscar.status, 0)
    assert.deepEqual(dato(ultima()), { rol: 'planificador', herramienta: 'Grep', objetivo: 'foo en src', decision: 'lectura' })

    const glob = hook(raiz, 'revisor-plan', ev(raiz, 'Glob', { pattern: '**/*.ts' }))
    assert.equal(glob.stdout, '')
    assert.equal(glob.status, 0)
    assert.deepEqual(dato(ultima()), { rol: 'revisor-plan', herramienta: 'Glob', objetivo: '**/*.ts', decision: 'lectura' })

    // Una ruta fuera del repo se anota absoluta y tampoco se niega.
    const fuera = hook(raiz, 'explorador', ev(raiz, 'Read', { file_path: path.join(os.homedir(), '.ssh', 'id_rsa') }))
    assert.equal(fuera.stdout, '')
    assert.equal(fuera.status, 0)
    assert.equal(ultima().decision, 'lectura')

    // Otra herramienta no se anota, y la entrada rota no frena ni imprime.
    const antes = filasDe(raiz).length
    const otra = hook(raiz, 'explorador', ev(raiz, 'Bash', { command: 'git push' }))
    assert.equal(otra.stdout, '')
    assert.equal(otra.status, 0)
    const rota = spawnSync(process.execPath, [GUARDIA, 'explorador'], { cwd: raiz, encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: raiz }, input: '{no es json' })
    assert.equal(rota.stdout, '')
    assert.equal(rota.status, 0)
    assert.equal(filasDe(raiz).length, antes)
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
    assert.match(antes, /^ {2}✓ M src\/a\.ts$/m)
    assert.match(antes, /ALCANCE: OK/)

    hook(raiz, 'explorador', ev(raiz, 'Read', { file_path: path.join(raiz, 'docs', 'leida.md') }))
    assert.equal(filasDe(raiz).at(-1)?.objetivo, 'docs/leida.md')

    const despues = cambios()
    assert.doesNotMatch(despues, /leida\.md/)
    assert.doesNotMatch(despues, /FUERA DE ALCANCE/)
    assert.equal(despues, antes)
  } finally {
    borrarRegistro(raiz)
  }
})

test.after(() => {
  for (const r of [ESTRICTO, GENERICO, ...temporales]) fs.rmSync(r, { recursive: true, force: true })
})
