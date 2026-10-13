// Casos de la guardia y del chequeo de alcance de /implementador.
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
import { evaluar, analizar, raizDe, registroDe, configDe } from './guardia.mjs'
import { coincide, listaPermitidos, alcanceDe } from './estado.mjs'
import { pasosDe, pasosRapidos } from './verificar.mjs'

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
})

test('verificar: pasosRapidos', () => {
  const todos = [{ nombre: 'typecheck', cmd: 'a' }, { nombre: 'test', cmd: 'b' }, { nombre: 'build', cmd: 'c' }]
  assert.deepEqual(pasosRapidos(todos, null), { pasos: todos, faltan: [] })
  assert.deepEqual(pasosRapidos(todos, []), { pasos: todos, faltan: [] })
  assert.deepEqual(pasosRapidos(todos, ['test']), { pasos: [todos[1]], faltan: [] })
  assert.deepEqual(pasosRapidos(todos, ['build', 'typecheck']), { pasos: [todos[0], todos[2]], faltan: [] })
  assert.deepEqual(pasosRapidos(todos, ['x']), { pasos: [], faltan: ['x'] })
  assert.deepEqual(pasosRapidos(todos, ['test', 'x']), { pasos: [todos[1]], faltan: ['x'] })
})

const VERIFICAR = fileURLToPath(new URL('./verificar.mjs', import.meta.url))
const pasosAB = [{ nombre: 'a', cmd: 'node -e 0' }, { nombre: 'b', cmd: 'node -e "process.exit(1)"' }]
const temporales = []

/** Corre verificar.mjs con las banderas dadas en un repo temporal con esta config. */
function corre(config, ...args) {
  const raiz = repo('rapido', { '.claude/implementador.json': JSON.stringify(config) })
  temporales.push(raiz)
  const env = { ...process.env, CLAUDE_PROJECT_DIR: raiz }
  const r = spawnSync(process.execPath, [VERIFICAR, ...args], { cwd: raiz, encoding: 'utf8', env })
  return { salida: r.stdout ?? '', codigo: r.status }
}

test('verificar: --rapido en un repo temporal', () => {
  const rapida = { verificar: pasosAB, verificarRapido: ['a'] }
  const completa = corre(rapida)
  assert.match(completa.salida, /^RESULTADO: ROJO \(b\)$/m)
  assert.equal(completa.codigo, 1)
  assert.doesNotMatch(completa.salida, /rápida/)

  const verde = corre(rapida, '--rapido')
  assert.match(verde.salida, /^RESULTADO: VERDE$/m)
  assert.match(verde.salida, /^verificar \(.*, rápida\): /m)
  assert.equal(verde.codigo, 0)

  const roto = corre({ verificar: pasosAB, verificarRapido: ['x'] }, '--rapido')
  assert.match(roto.salida, /^ERROR: verificarRapido nombra pasos que no existen: x \(pasos: a, b\)/)
  assert.equal(roto.codigo, 2)
  assert.doesNotMatch(roto.salida, /RESULTADO/)

  const sinClave = corre({ verificar: pasosAB }, '--rapido')
  assert.match(sinClave.salida, /^RESULTADO: ROJO \(b\)$/m)
  assert.doesNotMatch(sinClave.salida, /rápida/)
  assert.equal(sinClave.codigo, 1)
})

test('config: verificarRapido y generados por defecto', () => {
  assert.equal(configDe(ESTRICTO).verificarRapido, null)
  assert.deepEqual(configDe(ESTRICTO).generados, [])
})

test('guardia: --rapido permitido', () => {
  const R = ESTRICTO
  deja(bash(R, 'node ~/.claude/flujos/verificar.mjs --rapido'))
  deja(bash(R, 'node ~/.claude/flujos/verificar.mjs --rapido 2>&1 | tail -n 40'), 'revisor')
  deja(bash(R, 'node ~/.claude/flujos/verificar.mjs --rapido'), 'revisor')
})

test('alcance: generados', () => {
  assert.equal(alcanceDe('dist/server/server.js', ['src/a.ts'], ['dist/**']), 'generado')
  assert.equal(alcanceDe('dist/server/server.js', ['src/a.ts']), 'fuera')
  assert.equal(alcanceDe('dist/server/server.js', ['src/a.ts'], []), 'fuera')
  assert.equal(alcanceDe('src/a.ts', ['src/a.ts'], ['src/**']), 'permitido')
  assert.equal(alcanceDe('dist/x.js', ['dist/x.js'], ['dist/**']), 'permitido')
  assert.equal(alcanceDe('dist/x.js', [], ['dist/**']), 'permitido')
  assert.equal(alcanceDe('src/b.ts', ['src/a.ts'], ['dist/**']), 'fuera')
  assert.equal(alcanceDe('dist/x.js', ['src/a.ts'], ['./dist/**']), 'generado')
})

const ESTADO = fileURLToPath(new URL('./estado.mjs', import.meta.url))

/** Repo temporal con `src/a.ts` y `dist/x.js` versionados y luego modificados; corre estado.mjs con `args(sha)`. */
function estadoCon(config, args) {
  const raiz = repo('generados', {
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

test('estado: --cambios y --diff con generados', () => {
  const con = { generados: ['dist/**'] }
  const cambios = (sha) => ['--cambios', sha, '--permitidos', 'src/a.ts']
  const diffDe = (...extra) => (sha) => ['--diff', sha, '--permitidos', 'src/a.ts', ...extra]

  const ok = estadoCon(con, cambios)
  assert.match(ok.salida, /^ {2}~ M dist\/x\.js/m)
  assert.match(ok.salida, /^ {2}✓ M src\/a\.ts$/m)
  assert.match(ok.salida, /^CAMBIOS desde \w+ \(2\):$/m)
  assert.match(ok.salida, /ALCANCE: OK\s*$/)
  assert.equal(ok.codigo, 0)

  const sin = estadoCon({}, cambios)
  assert.match(sin.salida, /^ {2}✗ M dist\/x\.js {3}← FUERA DE ALCANCE$/m)
  assert.match(sin.salida, /ALCANCE: FUERA \(1\)\s*$/)

  const recortado = estadoCon(con, diffDe())
  assert.match(recortado.salida, /GENERADOS \(omitidos/)
  assert.match(recortado.salida, /dist\/x\.js/)
  assert.doesNotMatch(recortado.salida, /diff --git a\/dist\/x\.js/)
  assert.match(recortado.salida, /diff --git a\/src\/a\.ts/)

  const explicito = estadoCon(con, diffDe('--', 'dist/x.js'))
  assert.match(explicito.salida, /diff --git a\/dist\/x\.js/)
  assert.doesNotMatch(explicito.salida, /GENERADOS \(omitidos/)

  const sinClave = estadoCon({}, diffDe())
  assert.match(sinClave.salida, /diff --git a\/dist\/x\.js/)
  assert.doesNotMatch(sinClave.salida, /GENERADOS/)
})

test('estado: el preflight avisa solo si existen las claves', () => {
  const pre = (config) => estadoCon(config, () => [])
  const con = pre({ verificar: pasosAB, verificarRapido: ['a'], generados: ['dist/**', 'x.gen.ts'] })
  assert.match(con.salida, /^VERIFICACIÓN RÁPIDA \(--rapido\): node -e 0$/m)
  assert.match(con.salida, /^GENERADOS \(no cuentan para el alcance\): dist\/\*\*, x\.gen\.ts$/m)

  const roto = pre({ verificar: pasosAB, verificarRapido: ['x'] })
  assert.match(roto.salida, /^VERIFICACIÓN RÁPIDA: ERROR \(pasos inexistentes: x\)$/m)

  const sin = pre({ verificar: pasosAB })
  assert.doesNotMatch(sin.salida, /VERIFICACIÓN RÁPIDA|GENERADOS/)
})

test.after(() => {
  for (const r of [ESTRICTO, GENERICO, ...temporales]) fs.rmSync(r, { recursive: true, force: true })
})
