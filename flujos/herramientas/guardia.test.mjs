// Casos de la guardia, del chequeo de alcance, de estado y de verificar de /implementador.
// Correr: node --test ~/.claude/flujos/guardia.test.mjs
//
// Arma dos repos de prueba en el temporal: uno con `.claude/implementador.json` estricto
// (pnpm, migraciones inmutables, scripts negados, secretos) y uno npm sin config, para
// comprobar los valores por defecto.

import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { evaluar, analizar, raizDe, registroDe, flujoDe, configDe, coincide } from './guardia.mjs'
import { listaPermitidos, enAlcance, opcionesDe, tokensDe, anotarFlujo, permitidosDe, criticosDe, fusionarPlanes, partesDelPlan, agruparPorCarpeta } from './estado.mjs'
import { pasosDe, detalleTipos, resumenTest, detalleTest, conDetalle } from './verificar.mjs'
import { costoDePedido, precioDe } from './costos.mjs'

const WIN = process.platform === 'win32'

// Registros, carpetas de flujo, caché y flujos.jsonl de las pruebas van a un temporal: corridas desde la copia
// instalada, las pruebas no tocan el historial real de ~/.claude/flujos/registros.
const PRUEBAS = fs.mkdtempSync(path.join(os.tmpdir(), 'flujos-pruebas-'))
process.env.FLUJOS_REGISTROS = path.join(PRUEBAS, 'registros')

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
    'node ~/.claude/flujos/verificar.mjs > $TEMP/v.txt 2>&1',
    '# comentario sobre .env y git push\npnpm test',
    'for f in src/lib/*.ts; do wc -l "$f"; done',
  ]) deja(bash(R, c))
  deja(edita(R, 'src/server/citas.ts'))
  deja(edita(R, path.join(R, 'src', 'server', 'citas.ts')))
  deja(edita(R, 'supabase/migrations/20991231000001_prueba.sql', 'Write'))
  deja(edita(R, '.env.example'))
  deja(edita(R, '.claude/implementador.md'))
  deja(edita(R, '.claude/implementador/planificar.md'))
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

test('revisor: lee y verifica, y solo escribe en temporales', () => {
  const R = ESTRICTO
  const tmp = os.tmpdir().replace(/\\/g, '/')
  for (const c of [
    'pnpm test',
    'node ~/.claude/flujos/verificar.mjs',
    'node ~/.claude/flujos/verificar.mjs 2>&1 | tail -n 40',
    'node ~/.claude/flujos/estado.mjs --diff abc --permitidos "src/x.ts" -- src/x.ts',
    'git diff abc def -- src',
    'pnpm build 2>&1 | tail -5',
    "grep -rn \"select('*')\" src/server > /dev/null; echo hecho",
    "sed -n '1,40p' src/server/citas.ts",
    // En temporales sí: comparar con la base o simular sin tocar el repo.
    'echo x > /tmp/salida.txt',
    'git show abc:src/x.ts > "$TEMP/viejo.ts"',
    `git diff abc -- src > "${tmp}/claude/d.diff"`,
    'mkdir -p /tmp/rev/m1 && cp -r src /tmp/rev/m1/',
    'cp src/x.ts /tmp/x.ts',
    'git diff abc | tee /tmp/t.txt',
    'git diff --output=/tmp/x.patch abc',
    'rm /tmp/x.ts',
  ]) deja(bash(R, c), 'revisor')
  niega(edita(R, 'src/x.ts'), 'revisor')
  niega(edita(R, 'src/x.ts', 'Write'), 'revisor')
  for (const c of [
    "sed -i 's/a/b/' src/x.ts",
    'echo x > src/x.ts',
    'echo x > "$S/x.txt"',
    'echo x > $temp/x.txt',
    'rm src/x.ts',
    'rm -rf /tmp/rev',
    'mv a b',
    'mv /tmp/a src/b',
    'cp a b',
    'cp /tmp/a src/b',
    'mkdir src/nuevo',
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

/** Corre estado.mjs en `raiz` con esos argumentos (y variables de entorno extra). */
function estadoEn(raiz, args, entorno = {}) {
  const env = { ...process.env, CLAUDE_PROJECT_DIR: raiz, ...entorno }
  const r = spawnSync(process.execPath, [ESTADO, ...args], { cwd: raiz, encoding: 'utf8', env })
  return { salida: r.stdout ?? '', codigo: r.status }
}

/** Repo temporal con `src/a.ts` y `dist/x.js` versionados y luego modificados; corre estado.mjs con `args(sha)`. */
function estadoCon(config, args, extra = {}, entorno = {}) {
  const raiz = repo('estado', {
    '.claude/implementador.json': JSON.stringify(config),
    'src/a.ts': 'a\n',
    'dist/x.js': 'x\n',
    ...extra,
  })
  temporales.push(raiz)
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: raiz, encoding: 'utf8' }).trim()
  fs.writeFileSync(path.join(raiz, 'src/a.ts'), 'a2\n')
  fs.writeFileSync(path.join(raiz, 'dist/x.js'), 'x2\n')
  return { ...estadoEn(raiz, args(sha), entorno), raiz }
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

  assert.deepEqual(opcionesDe([]), {
    modo: 'preflight', base: undefined, desde: undefined, permitidos: [], rutas: [], paso: null, aviso: undefined, tokens: undefined,
    agente: undefined, tipo: undefined, ajuste: false, forzar: false,
  })
  const g = opcionesDe(['--guardar', 'a86c3e', 'plan', '--ajuste', '--paso', '2'])
  assert.deepEqual([g.modo, g.agente, g.tipo, g.ajuste, g.paso], ['guardar', 'a86c3e', 'plan', true, 2])
  assert.equal(opcionesDe(['--estado', '--paso', '5']).modo, 'estado')

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

test('estado: preflight informa las reglas del proyecto', () => {
  const reglas = (extra) => /^REGLAS DEL PROYECTO: (.*)$/m.exec(estadoCon({}, () => [], extra).salida)?.[1]

  assert.equal(reglas({ '.claude/implementador/clasificacion.md': 'x\n' }), '.claude/implementador/')
  assert.equal(reglas({ '.claude/implementador.md': 'x\n' }), '.claude/implementador.md')
  assert.equal(
    reglas({}),
    'ninguna (no hay .claude/implementador/ ni .claude/implementador.md; rigen CLAUDE.md y las reglas comunes)',
  )
  assert.equal(
    reglas({ '.claude/implementador/clasificacion.md': 'x\n', '.claude/implementador.md': 'x\n' }),
    '.claude/implementador/',
  )
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

const VERIFICAR = fileURLToPath(new URL('./verificar.mjs', import.meta.url))

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

test('estado: --reglas da las reglas del orquestador, sin avisos falsos', () => {
  const reglas = (extra) => estadoCon({}, () => ['--reglas'], extra).salida.trimEnd()
  const carpeta = (archivos) => Object.fromEntries(Object.entries(archivos).map(([a, t]) => [`.claude/implementador/${a}`, t]))

  const carpetaUno = 'REGLAS DEL PROYECTO: .claude/implementador/\n\n'
  assert.equal(reglas(carpeta({ 'clasificacion.md': 'C\n', 'buscar.md': 'B\n', 'planificar.md': 'P\n', 'ejecutor.md': 'E\n' })), `${carpetaUno}C\n\nB\n\nP`)
  // Con la carpeta y un archivo faltante va lo que hay, sin decir que el proyecto no tiene reglas.
  assert.equal(reglas(carpeta({ 'clasificacion.md': 'C\n', 'planificar.md': 'P\n' })), `${carpetaUno}C\n\nP`)
  assert.match(reglas(carpeta({ 'ejecutor.md': 'E\n' })), /^REGLAS DEL PROYECTO: \.claude\/implementador\/\n\n\(no tiene clasificacion\.md, buscar\.md ni planificar\.md/)
  assert.equal(reglas({ '.claude/implementador.md': 'U\n' }), 'REGLAS DEL PROYECTO: .claude/implementador.md\n\nU')
  assert.match(reglas({}), /^REGLAS DEL PROYECTO: ninguna\n\n\(Este proyecto no tiene \.claude\/implementador\/ ni \.claude\/implementador\.md/)
})

test('estado: la autoprueba falla si el proyecto redefine ejecutor o revisor sin la guardia', (t) => {
  const instalados = ['ejecutor', 'revisor'].every((a) => fs.existsSync(path.join(os.homedir(), '.claude', 'agents', `${a}.md`)))
  if (!instalados) {
    t.skip('sin los agentes instalados en ~/.claude/agents la autoprueba falla antes')
    return
  }
  const guardia = (extra) => /^GUARDIA: (.*)$/m.exec(estadoCon({}, () => [], extra).salida)?.[1] ?? ''

  assert.match(guardia({ '.claude/agents/ejecutor.md': '---\nname: ejecutor\n---\nsin hook\n' }), /^FALLA \(el proyecto redefine ejecutor en \.claude\/agents\/ejecutor\.md sin la guardia\)$/)
  assert.match(guardia({ '.claude/agents/revisor.md': 'command: node "$HOME/.claude/flujos/guardia.mjs" revisor\n' }), /^OK con avisos: el proyecto redefine revisor /)
  assert.match(guardia({ '.claude/agents/revisor-plan.md': 'x\n' }), /^OK con avisos: el proyecto redefine revisor-plan /)
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
  assert.match(candado, /^AVISO: hay otro flujo abierto en este repo \(empezó a las .*, sin cierre, con actividad hace \d+ min\)\./m)
  assert.match(candado, /^FLUJO: \(ocupada por el flujo anterior: repite el preflight con --forzar si ya no corre\)$/m)
  assert.ok(fs.existsSync(path.join(carpeta, 'S9.md')))
  // Con --forzar, o después de un cierre, la vacía: no quedan fotos ni plan del flujo anterior.
  assert.equal(/^FLUJO: (.*)$/m.exec(estadoEn(raiz, ['--paso', '0', '--forzar']).salida)?.[1], carpeta)
  assert.ok(!fs.existsSync(path.join(carpeta, 'S9.md')))
  assert.doesNotMatch(estadoEn(raiz, ['--estado']).salida, /^FOTO/m)
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: raiz, encoding: 'utf8' }).trim()
  estadoEn(raiz, ['--cambios', sha, '--paso', '7'])
  assert.doesNotMatch(estadoEn(raiz, ['--paso', '0']).salida, /^AVISO: hay otro flujo abierto/m)
})

test('estado: --guardar exploracion dice si la exploración toca rutas críticas', () => {
  const claude = transcripts({
    critica: 'ARCHIVOS\n- flujos/herramientas/estado.mjs:12 — modo nuevo\n- src/a.ts:3 — uso',
    tranquila: 'ARCHIVOS\n- src/a.ts:3 — uso\n- README.md — índice',
  })
  const entorno = { CLAUDE_CONFIG_DIR: claude }
  const critica = estadoCon({ criticos: CRITICOS }, () => ['--guardar', 'critica', 'exploracion', '--paso', '2'], {}, entorno)
  assert.match(critica.salida, /^RUTAS CRÍTICAS EN LA EXPLORACIÓN: #1 \(flujos\/herramientas\/estado\.mjs\), #5 \(flujos\/herramientas\/estado\.mjs\)$/m)
  assert.match(estadoEn(critica.raiz, ['--guardar', 'tranquila', 'exploracion'], entorno).salida, /^RUTAS CRÍTICAS EN LA EXPLORACIÓN: ninguna \(planificador con effort medium\)$/m)
  const sinCriticos = estadoCon({}, () => ['--guardar', 'tranquila', 'exploracion'], {}, entorno)
  assert.match(sinCriticos.salida, /^RUTAS CRÍTICAS EN LA EXPLORACIÓN: el proyecto no declara «criticos»/m)
})

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
  // Señuelo: otra sesión del mismo repo cuyo /implementador quedó más cerca del preflight, pero no recibió su BASE_GLOBAL.
  fs.writeFileSync(path.join(sesion, 's0.jsonl'), jsonl([
    { type: 'user', timestamp: en(-0.5), message: { role: 'user', content: '<command-name>/implementador</command-name>' } },
    pedido('x1', en(0.2), 'claude-opus-5-5', { cache_creation_input_tokens: 1_000_000, cache_creation: { ephemeral_1h_input_tokens: 1_000_000 } }),
  ]))
  fs.writeFileSync(path.join(sesion, 's1.jsonl'), jsonl([
    { type: 'user', timestamp: en(-1), message: { role: 'user', content: '<command-name>/implementador</command-name>' } },
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
  assert.match(cierre, /^COSTO: \$0,51 · [\d,]+ min · orquestador \$0,43 \(2 pedidos\) · final \$0,07 · explorador \$0,01 \(sin el mensaje de cierre\)$/m)
  assert.match(cierre, /^VEREDICTOS: final APROBADO$/m)
  assert.match(cierre, /ALCANCE: [^\n]*\s*$/)
  const flujos = path.join(path.dirname(registroDe(raiz)), 'flujos.jsonl')
  const fila = fs.readFileSync(flujos, 'utf8').trimEnd().split('\n').map((l) => JSON.parse(l)).at(-1)
  assert.equal(fila.raiz, raiz)
  assert.equal(Math.round(fila.costo.usd * 1000), 507)
  assert.deepEqual(fila.costo.veredictos, { final: ['APROBADO'] })

  const historial = spawnSync(process.execPath, [fileURLToPath(new URL('./costos.mjs', import.meta.url)), '--archivo', flujos], { encoding: 'utf8' }).stdout
  assert.match(historial, /^FLUJOS \(últimos \d+ de \d+ con costo\):$/m)
  assert.match(historial, /· \$0,51 · [\d,]+ min · orquestador \$0,43 \(2 pedidos\) · final \$0,07 · explorador \$0,01 · final APROBADO$/m)
  assert.match(historial, /^PROMEDIO: \$[\d,]+ · /m)
})

test('verificar: repite un VERDE desde la caché mientras el árbol no cambie', () => {
  const raiz = repo('cache', { '.claude/implementador.json': { verificar: [{ nombre: 'bien', cmd: 'node -e "console.log(1)"' }] }, 'src/a.ts': 'a\n' })
  temporales.push(raiz)
  const correr = (...args) => spawnSync(process.execPath, [VERIFICAR, ...args], { cwd: raiz, encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: raiz } }).stdout

  assert.doesNotMatch(correr(), /caché/)
  const repetida = correr()
  assert.match(repetida, /^\(caché: el árbol \w{9} ya salió VERDE con estos pasos a las .*\)$/m)
  assert.match(repetida, /^bien {7}OK/m)
  assert.equal(repetida.trimEnd().split('\n').at(-1), 'RESULTADO: VERDE')
  assert.doesNotMatch(correr('--sin-cache'), /caché/)
  // Un archivo nuevo (no ignorado) cambia el árbol.
  fs.writeFileSync(path.join(raiz, 'src/b.ts'), 'b\n')
  assert.doesNotMatch(correr(), /caché/)
})

const INSTALAR = fileURLToPath(new URL('../instalar.mjs', import.meta.url))

test('instalar: anota hashes, frena lo editado en el destino aunque sea más viejo y lista huérfanos', (t) => {
  if (!fs.existsSync(INSTALAR)) {
    t.skip('instalar.mjs solo está en el repo, no en la copia instalada')
    return
  }
  const destino = fs.mkdtempSync(path.join(os.tmpdir(), 'instalar-'))
  temporales.push(destino)
  const instalar = (...args) => {
    const r = spawnSync(process.execPath, [INSTALAR, ...args], { encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: destino } })
    return { salida: r.stdout ?? '', codigo: r.status }
  }
  const manifiesto = path.join(destino, 'flujos', '.instalado.json')
  const pasos = path.join(destino, 'flujos', 'pasos.md')

  const primera = instalar()
  assert.equal(primera.codigo, 0)
  assert.match(primera.salida, /^ {2}nuevo {4}herramientas\/pasos\.md → /m)
  assert.ok(fs.existsSync(pasos))
  assert.ok(!fs.existsSync(path.join(destino, 'flujos', 'registros')), 'no copia las bitácoras del repo')
  assert.match(JSON.parse(fs.readFileSync(manifiesto, 'utf8'))['flujos/pasos.md'], /^[0-9a-f]{40}$/)
  assert.match(instalar().salida, /^RESULTADO: 0 copiado\(s\)$/m)

  // Editado en el destino y con fecha vieja: la fecha diría «pisar», el hash lo frena.
  fs.appendFileSync(pasos, '\nedición a mano\n')
  fs.utimesSync(pasos, new Date(2000, 0, 1), new Date(2000, 0, 1))
  const frenada = instalar()
  assert.equal(frenada.codigo, 1)
  assert.match(frenada.salida, /FRENADO .*pasos\.md se editó ahí/)
  assert.equal(instalar('--forzar').codigo, 0)
  assert.doesNotMatch(fs.readFileSync(pasos, 'utf8'), /edición a mano/)

  // Un archivo anotado que ya no está en el repo es huérfano; --limpiar lo borra si nadie lo editó.
  const viejo = path.join(destino, 'agents', 'viejo.md')
  fs.writeFileSync(viejo, 'x\n')
  const m = JSON.parse(fs.readFileSync(manifiesto, 'utf8'))
  m['agents/viejo.md'] = crypto.createHash('sha1').update('x\n').digest('hex')
  fs.writeFileSync(manifiesto, JSON.stringify(m))
  assert.match(instalar('--revisar').salida, /huérfano .*agents\/viejo\.md: ya no está en el repo \(--limpiar lo borra\)/)
  instalar('--limpiar')
  assert.ok(!fs.existsSync(viejo))
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
  for (const r of [ESTRICTO, GENERICO, ...temporales, PRUEBAS]) fs.rmSync(r, { recursive: true, force: true })
})
