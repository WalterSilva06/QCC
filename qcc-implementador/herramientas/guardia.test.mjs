// Casos de la guardia, del chequeo de alcance, de estado y de verificar de /qcc-implementador.
// Correr: node --test qcc-implementador/herramientas/guardia.test.mjs
//
// Arma dos repos de prueba en el temporal: uno con `.claude/implementador.json` estricto (nombre viejo, que se
// lee de respaldo; los casos de `.claude/qcc-implementador.json` crean sus propios repos)
// (pnpm, migraciones inmutables, scripts negados, secretos) y uno npm sin config, para
// comprobar los valores por defecto.

import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { evaluar, rolDeAgente, analizar, raizDe, registroDe, flujoDe, arbolDe, configDe, coincide } from './guardia.mjs'
import { listaPermitidos, enAlcance, opcionesDe, tokensDe, anotarFlujo, filaDelFlujo, permitidosDe, criticosDe, fusionarPlanes, partesDelPlan, agruparPorCarpeta, mapaDelRepo, decisionesDelPlan, contextoDelProyecto } from './estado.mjs'
import { pasosDe, detalleTipos, resumenTest, detalleTest, conDetalle, claveDe, marcaDe, esBuild, salidasDe } from './verificar.mjs'
import { costoDelFlujo, costoDePedido, metricasDelFlujo, precioDe, problemasDe } from './costos.mjs'

const WIN = process.platform === 'win32'

// Registros, carpetas de flujo, caché y flujos.jsonl de las pruebas van a un temporal: corridas desde la carpeta
// del plugin, las pruebas no tocan el historial real de ~/.claude/flujos/registros.
const PRUEBAS = fs.mkdtempSync(path.join(os.tmpdir(), 'flujos-pruebas-'))
process.env.FLUJOS_REGISTROS = path.join(PRUEBAS, 'registros')
// El preflight no lanza la verificación inicial en segundo plano: un proceso suelto impediría borrar los temporales
// (en Windows). Los tests que la prueban quitan esta variable de su entorno.
process.env.FLUJOS_INICIAL = '0'

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
    'node ~/.claude/plugins/cache/qcc/qcc-implementador/0.1.0/herramientas/verificar.mjs',
    'node "$HOME/.claude/plugins/cache/qcc/qcc-implementador/0.1.0/herramientas/estado.mjs" --diff abc --permitidos "src/x.ts"',
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
    'node ~/.claude/plugins/cache/qcc/qcc-implementador/0.1.0/herramientas/verificar.mjs > $TEMP/v.txt 2>&1',
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
    path.join(os.homedir(), 'otro-repo', 'x.ts'),
    path.join(os.homedir(), 'x.txt'),
    '.env',
    'pnpm-lock.yaml',
    'node_modules/x/index.js',
    'CUENTAS_PRUEBA.md',
    'scripts/flow/.evidence/x.json',
  ]) niega(edita(R, r, 'Write'))
})

test('ejecutor: copias desde lo protegido, variables y temporales (casos de los flujos del 16 oct)', () => {
  const R = ESTRICTO
  const tmp = os.tmpdir().replace(/\\/g, '/')
  for (const c of [
    // Copiar un artefacto protegido a un temporal solo lo lee: cuenta el destino.
    'cp dist/index.html /tmp/antes.html',
    'pnpm run build 2>&1 | tail -5; S="/tmp/medir"; cp dist/index.html "$S/antes.html"',
    'cp -t /tmp dist/a.js dist/b.js',
    `S="${tmp}/m"; mkdir -p "$S/c" && cp dist/x.js "\${S}/c/x.js"`,
    'git archive HEAD src > /tmp/base.tar',
    'git archive -o /tmp/base.tar HEAD src',
  ]) deja(bash(R, c))
  deja(edita(R, path.join(os.tmpdir(), 'medir.mjs'), 'Write'))
  for (const c of [
    'cp /tmp/a dist/x.js',
    'cp -t dist /tmp/a.js',
    'cp /tmp/a.js /tmp/b.js node_modules/',
    'cp --target-directory=node_modules/x /tmp/a.js',
    'S=dist; echo x > "$S/a.js"',
    'F=.env; cat $F',
    'git archive -o dist/base.tar HEAD',
    'git archive --remote=git@x:y.git HEAD',
  ]) niega(bash(R, c))
  niega(ps(R, 'Copy-Item -Destination dist\\x.js -Path a.js'))
  niega(ps(R, '$S = "dist"; Set-Content -Path "$S/x.js" -Value 1'))
  // npx se niega, pero el motivo nombra el gestor del proyecto.
  assert.match(evaluar(bash(R, 'npx astro build'), 'ejecutor', R).motivo, /usa `pnpm exec astro`/)
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
    'node ~/.claude/plugins/cache/qcc/qcc-implementador/0.1.0/herramientas/verificar.mjs',
    'node ~/.claude/plugins/cache/qcc/qcc-implementador/0.1.0/herramientas/verificar.mjs 2>&1 | tail -n 40',
    'node ~/.claude/plugins/cache/qcc/qcc-implementador/0.1.0/herramientas/estado.mjs --diff abc --permitidos "src/x.ts" -- src/x.ts',
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
    // Variables asignadas en el mismo comando, la base con git archive y edición en sitio de temporales.
    'S="/tmp/rev"; mkdir -p "$S/exp"',
    'export B=/tmp/base; mkdir -p "$B" && git archive HEAD src | tar -x -C "$B"',
    `T="${tmp}/sim"; mkdir -p "$T" && cd "$T" && git -C "${R.replace(/\\/g, '/')}" archive --format=tar HEAD src > base.tar`,
    'git archive -o /tmp/base.tar HEAD',
    "sed -i 's/a/b/' /tmp/rev/x.mjs",
    `cd "$TEMP" && sed -i "s/.slice(0,6)/.slice(0,8)/" desborde.mjs && node desborde.mjs`,
    "sed -i -e 's/a/b/' -e 's/c/d/' /tmp/x",
    "perl -pi -e 's/a/b/' /tmp/x.txt",
    'git diff --output-indicator-new=+ abc',
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
    'S="$(pwd)"; mkdir "$S/x"',
    'S=src; mkdir -p "$S/x"',
    "sed -i -e 's/a/b/' /tmp/x src/y.ts",
    'sed -i /tmp/solo-script.sed',
    "sed -i -- 's/a/b/' src/x.ts",
    'git archive -o base.tar HEAD',
    'git archive --output base.tar HEAD',
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
    resultado: undefined, agente: undefined, tipo: undefined, ajuste: false, forzar: false,
  })
  assert.equal(opcionesDe(['--cambios', 'abc', '--paso', '7', '--resultado', 'DETENIDO:3']).resultado, 'DETENIDO:3')
  assert.equal(opcionesDe(['--cambios', 'abc', '--resultado']).resultado, '')
  const g = opcionesDe(['--guardar', 'a86c3e', 'plan', '--ajuste', '--paso', '2'])
  assert.deepEqual([g.modo, g.agente, g.tipo, g.ajuste, g.paso], ['guardar', 'a86c3e', 'plan', true, 2])
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

test('config: .claude/qcc-implementador.json manda sobre .claude/implementador.json', () => {
  const raiz = repo('config-nueva', {
    '.claude/qcc-implementador.json': { verificar: [{ nombre: 'nuevo', cmd: 'echo nuevo' }], guardia: { secretos: ['nuevo.key'] } },
    '.claude/implementador.json': { verificar: [{ nombre: 'viejo', cmd: 'echo viejo' }], guardia: { secretos: ['viejo.key'] } },
  })
  temporales.push(raiz)
  const config = configDe(raiz)
  assert.equal(config.nombre, '.claude/qcc-implementador.json')
  assert.equal(config.archivo, path.join(raiz, '.claude', 'qcc-implementador.json'))
  // Nunca se mezclan: solo valen los valores del nuevo.
  assert.deepEqual(config.secretos, ['nuevo.key'])
  assert.deepEqual(config.verificar, [{ nombre: 'nuevo', cmd: 'echo nuevo' }])
  const { pasos, origen } = pasosDe(raiz)
  assert.equal(origen, '.claude/qcc-implementador.json')
  assert.deepEqual(pasos.map((p) => p.cmd), ['echo nuevo'])

  // Un nuevo inválido no cae al viejo: se avisa y rigen los valores por defecto.
  const rota = repo('config-rota', {
    '.claude/qcc-implementador.json': '{ no es json',
    '.claude/implementador.json': { guardia: { secretos: ['viejo.key'] } },
  })
  temporales.push(rota)
  const c = configDe(rota)
  assert.equal(c.invalido, true)
  assert.equal(c.archivo, null)
  assert.deepEqual(c.secretos, [])
})

test('config: sin la nueva lee la vieja', () => {
  const vieja = repo('config-vieja', { '.claude/implementador.json': { verificar: [{ nombre: 'viejo', cmd: 'echo viejo' }], guardia: { secretos: ['viejo.key'] } } })
  temporales.push(vieja)
  const config = configDe(vieja)
  assert.equal(config.nombre, '.claude/implementador.json')
  assert.equal(config.archivo, path.join(vieja, '.claude', 'implementador.json'))
  assert.deepEqual(config.secretos, ['viejo.key'])
  assert.equal(pasosDe(vieja).origen, '.claude/implementador.json')

  // Sin ninguna: sin archivo, y el nombre que se sugiere es el nuevo.
  const ninguna = repo('config-ninguna', { 'a.txt': 'a\n' })
  temporales.push(ninguna)
  const sin = configDe(ninguna)
  assert.equal(sin.archivo, null)
  assert.equal(sin.invalido, false)
  assert.equal(sin.nombre, '.claude/qcc-implementador.json')
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

test('hooks.json: la guardia vigila Bash, PowerShell, Edit, Write, NotebookEdit, Read, Glob y Grep, y los agentes no declaran hooks', () => {
  const hooks = JSON.parse(fs.readFileSync(new URL('../hooks/hooks.json', import.meta.url), 'utf8'))
  const entradas = hooks.hooks.PreToolUse.filter((h) => h.hooks.some((x) => /guardia\.mjs/.test(x.command)))
  assert.equal(entradas.length, 1)
  assert.match(entradas[0].hooks[0].command, /^node "\$\{CLAUDE_PLUGIN_ROOT\}\/herramientas\/guardia\.mjs"$/)
  for (const herramienta of ['Bash', 'PowerShell', 'Edit', 'Write', 'NotebookEdit', 'Read', 'Glob', 'Grep']) {
    assert.match(herramienta, new RegExp(`^(?:${entradas[0].matcher})$`), herramienta)
  }
  // Los agentes de un plugin ignoran `hooks:`: declararlo ahí daría una falsa seguridad.
  const agentes = fs.readdirSync(new URL('../agents/', import.meta.url)).filter((a) => a.endsWith('.md'))
  assert.equal(agentes.length, 4)
  for (const a of agentes) {
    const cabecera = fs.readFileSync(new URL(`../agents/${a}`, import.meta.url), 'utf8').split('\n---')[0]
    assert.doesNotMatch(cabecera, /^hooks:/m, a)
  }
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

test('rolDeAgente: el rol sale del agent_type del plugin; la sesión principal y otros agentes no tienen', () => {
  for (const rol of ['explorador', 'planificador', 'ejecutor', 'revisor']) {
    assert.equal(rolDeAgente(`qcc-implementador:qcc-${rol}`), rol)
    assert.equal(rolDeAgente(`qcc-${rol}`), rol, 'el nombre sin plugin también')
  }
  for (const otro of [undefined, null, '', 42, 'general-purpose', 'qcc-implementador:qcc-generador', 'qcc-commit:qcc-generador-commit', 'qcc-implementador-odd:qcc-odd-ejecutor', 'qcc-odd-ejecutor', 'otro:qcc-ejecutor', 'qcc-implementador:ejecutor', 'qcc-implementador:qcc-ejecutor2']) {
    assert.equal(rolDeAgente(otro), null, String(otro))
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
  assert.match(cierre, /^CONTEXTO: 100000 tokens en el último pedido del hilo principal · reescribirlo en Opus con caché de 1 h: \$0,80$/m)
  assert.match(cierre, /ALCANCE: [^\n]*\s*$/)
  const flujos = path.join(path.dirname(registroDe(raiz)), 'flujos.jsonl')
  const fila = fs.readFileSync(flujos, 'utf8').trimEnd().split('\n').map((l) => JSON.parse(l)).at(-1)
  assert.equal(fila.v, 2)
  assert.equal(fila.raiz, raiz)
  assert.equal(Math.round(fila.costo.usd * 1000), 507)
  assert.deepEqual(fila.costo.veredictos, { final: ['APROBADO'] })

  const historial = spawnSync(process.execPath, [fileURLToPath(new URL('./costos.mjs', import.meta.url)), '--archivo', flujos], { encoding: 'utf8' }).stdout
  assert.match(historial, /^FLUJOS \(últimos \d+ de \d+ con costo\):$/m)
  assert.match(historial, /· \$0,51 · [\d,]+ min · orquestador \$0,43 \(2 pedidos\) · final \$0,07 · explorador \$0,01 · final APROBADO$/m)
  assert.match(historial, /^PROMEDIO: \$[\d,]+ · /m)
})

/** Transcript mínimo del flujo de `raiz` (su `/implementador` y un pedido con 100.000 tokens de contexto); devuelve su CLAUDE_CONFIG_DIR. */
function transcriptDelFlujo(raiz) {
  const { inicio, base_global: global } = JSON.parse(fs.readFileSync(path.join(flujoDe(raiz), 'estado.json'), 'utf8'))
  const tramo = Math.max(Date.now() - Date.parse(inicio), 10)
  const en = (f) => new Date(Date.parse(inicio) + Math.floor(tramo * f)).toISOString()
  const claude = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-config-'))
  temporales.push(claude)
  const carpeta = path.join(claude, 'projects', path.resolve(raiz).replace(/[^a-zA-Z0-9]/g, '-'))
  fs.mkdirSync(carpeta, { recursive: true })
  const filas = [
    { type: 'user', timestamp: en(-1), message: { role: 'user', content: '<command-name>/implementador</command-name>\n<command-args>probar el cierre</command-args>' } },
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

test('costos: métricas del flujo desde transcripts armados', () => {
  const raiz = path.join(os.tmpdir(), 'repo-metricas')
  const claude = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-config-'))
  temporales.push(claude)
  const sesion = path.join(claude, 'projects', path.resolve(raiz).replace(/[^a-zA-Z0-9]/g, '-'))
  const subagentes = path.join(sesion, 's1', 'subagents')
  fs.mkdirSync(subagentes, { recursive: true })
  const inicio = Date.parse('2026-01-01T10:00:00.000Z')
  const en = (s) => new Date(inicio + s * 1000).toISOString()
  const jsonl = (filas) => filas.map((f) => JSON.stringify(f)).join('\n') + '\n'
  const uso = (k, salida = 100) => ({ input_tokens: 10 * k, cache_read_input_tokens: 1000 * k, cache_creation_input_tokens: 500 * k, output_tokens: salida, output_tokens_details: { thinking_tokens: 40 } })
  const turno = (id, s, bloques, usage, modelo = 'claude-sonnet-5-5') => ({ type: 'assistant', timestamp: en(s), message: { id, model: modelo, usage, content: bloques } })
  const resultado = (s, id, texto) => ({ type: 'user', timestamp: en(s), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: texto }] } })
  const bash = (id, comando) => ({ type: 'tool_use', id, name: 'Bash', input: { command: comando } })
  const agenteDe = (id, tipo, prompt, effort) => ({ type: 'tool_use', id, name: 'Agent', input: { subagent_type: tipo, prompt, ...(effort ? { effort } : {}) } })
  const texto = (t) => ({ type: 'text', text: t })
  const E1 = 'SUBTAREA 1/2: crear x'
  const E1_CORRECCION = `${E1}\nCORRECCIÓN: arreglar y`
  const E2 = 'SUBTAREA 2/2: otra cosa'
  const ESTADO = 'node ~/.claude/plugins/cache/qcc/qcc-implementador/0.1.0/herramientas/estado.mjs'

  fs.writeFileSync(path.join(sesion, 's1.jsonl'), jsonl([
    { type: 'user', timestamp: en(0), message: { role: 'user', content: '<command-name>/implementador</command-name>\n<command-args>  Mejorar   el flujo\n con métricas </command-args>' } },
    turno('o1', 5, [bash('b0', `${ESTADO} --paso 0`)], uso(1)),
    resultado(10, 'b0', 'FLUJO: x'),
    turno('o2', 60, [agenteDe('a1', 'explorador', 'PEDIDO: x\nMAPA: mapa.md')], uso(1)),
    resultado(120, 'a1', 'ARCHIVOS'),
    turno('o3', 130, [bash('b2', `${ESTADO} --guardar x exploracion --paso 2`)], uso(1)),
    turno('o5', 270, [{ type: 'tool_use', id: 'q1', name: 'AskUserQuestion', input: { questions: [{ header: 'Plan', question: '¿Apruebas?' }] } }], uso(1)),
    resultado(570, 'q1', 'Aprobado'),
    turno('o6', 580, [bash('b5', `${ESTADO} --paso 5`)], uso(1)),
    turno('o7', 585, [agenteDe('x1', 'ejecutor', E1, 'medium'), agenteDe('x2', 'ejecutor', E2)], uso(1)),
    turno('o8', 700, [agenteDe('x3', 'ejecutor', E1_CORRECCION, 'low')], uso(1)),
    turno('o9', 800, [agenteDe('x4', 'revisor', 'QUÉ REVISAR: cambio completo (2 subtarea(s))')], uso(1)),
    resultado(850, 'x4', 'VEREDICTO: RECHAZADO'),
    resultado(860, 'b6', 'ALCANCE: FUERA (a.ts)\nresto'),
    turno('o10', 900, [bash('b7', `${ESTADO} --cambios abc --paso 7`)], uso(2)),
  ]))
  const agente = (nombre, tipo, prompt, desde, filas) => {
    fs.writeFileSync(path.join(subagentes, `${nombre}.meta.json`), JSON.stringify({ agentType: tipo }))
    fs.writeFileSync(path.join(subagentes, `${nombre}.jsonl`), jsonl([{ type: 'user', timestamp: en(desde), message: { role: 'user', content: prompt } }, ...filas]))
  }
  const haiku = 'claude-haiku-5-5'
  agente('agent-e', 'explorador', 'PEDIDO: x\nMAPA: mapa.md (3 archivos)', 62, [
    turno('e1', 70, [{ type: 'tool_use', id: 'g', name: 'Glob', input: {} }, { type: 'tool_use', id: 'r1', name: 'Read', input: {} }, { type: 'tool_use', id: 'r2', name: 'Read', input: {} }], { input_tokens: 100, output_tokens: 50 }, haiku),
    turno('e2', 110, [texto('ARCHIVOS')], { input_tokens: 200, output_tokens: 70 }, haiku),
  ])
  agente('agent-x1', 'ejecutor', E1, 590, [turno('m1', 690, [texto('ESTADO: FALLA')], uso(1))])
  agente('agent-x2', 'ejecutor', E2, 592, [turno('m2', 640, [texto('ESTADO: HECHO')], uso(1))])
  agente('agent-x3', 'ejecutor', E1_CORRECCION, 710, [turno('m3', 790, [texto('ESTADO: HECHO')], uso(1))])
  agente('agent-f', 'revisor', 'QUÉ REVISAR: cambio completo (2 subtarea(s))', 810, [turno('f1', 840, [texto('VEREDICTO: RECHAZADO\nPROBLEMAS:\n1. Falla X\nOBSERVACIONES: ninguna')], uso(1), 'claude-opus-5-5')])

  const opciones = { proyectos: path.join(claude, 'projects'), hasta: en(1200), base: null }
  const m = metricasDelFlujo(raiz, en(0), opciones)
  assert.equal(m.sesion, path.join(sesion, 's1.jsonl'))
  assert.equal(m.pedido, 'Mejorar el flujo con métricas')
  // Tokens: 8 pedidos con uso(1) y uno con uso(2) en el hilo principal; la forma vieja del costo sigue.
  assert.deepEqual(m.costo.roles.orquestador.tokens, { entrada: 100, leidos: 10_000, escritos: 5000, salida: 900, thinking: 360 })
  assert.deepEqual(m.costo.roles.explorador.tokens, { entrada: 300, leidos: 0, escritos: 0, salida: 120, thinking: 0 })
  assert.deepEqual(m.costo.roles.ejecutor.tokens, { entrada: 30, leidos: 3000, escritos: 1500, salida: 300, thinking: 120 })
  assert.equal(m.costo.roles.ejecutor.agentes, 3)
  assert.deepEqual(m.costo.veredictos, { ejecutor: ['FALLA', 'HECHO', 'HECHO'], final: ['RECHAZADO'] })
  assert.deepEqual(Object.keys(m.costo).sort(), ['inicio', 'minutos', 'roles', 'usd', 'veredictos'])
  assert.deepEqual(m.contexto, { primero: 1510, ultimo: 3020 })
  // Tiempos: el preflight a los 60 s es la fase 0; el AskUserQuestion «Plan» tarda 300 s dentro de la fase 4.
  assert.deepEqual(m.tiempos, { fases: { 0: 60, 1: 70, 2: 140, 4: 10, 5: 320, 7: 0 }, espera: 300, activo: 600 })
  assert.equal(Object.values(m.tiempos.fases).reduce((s, n) => s + n, 0), m.tiempos.activo)
  assert.deepEqual(Object.keys(m.ejecutores), ['1', '2'])
  assert.deepEqual({ ...m.ejecutores['1'], usd: undefined }, { usd: undefined, segundos: 180, correcciones: 1, estado: 'HECHO', esfuerzo: 'medium' })
  assert.ok(m.ejecutores['1'].usd > 0)
  assert.deepEqual({ ...m.ejecutores['2'], usd: undefined }, { usd: undefined, segundos: 48, correcciones: 0, estado: 'HECHO', esfuerzo: 'high' })
  assert.deepEqual(m.problemas, { final: [{ veredicto: 'RECHAZADO', items: ['Falla X'] }] })
  assert.deepEqual(m.alcanceFuera, ['ALCANCE: FUERA (a.ts)'])
  assert.deepEqual(m.explorador, { pedidos: 2, glob: 1, read: 2, mapa: true })
  // Sin sesión en ese repo, no hay métricas; el costo sigue siendo el mismo que con costoDelFlujo.
  assert.equal(metricasDelFlujo(path.join(os.tmpdir(), 'repo-sin-sesion'), en(0), opciones), null)
  assert.equal(costoDelFlujo(raiz, en(0), opciones).usd, m.costo.usd)
})

test('costos: reconoce /qcc-implementador y agentType qcc-ejecutor como rol ejecutor', () => {
  const raiz = path.join(os.tmpdir(), 'repo-metricas-qcc')
  const claude = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-config-'))
  temporales.push(claude)
  const sesion = path.join(claude, 'projects', path.resolve(raiz).replace(/[^a-zA-Z0-9]/g, '-'))
  const subagentes = path.join(sesion, 's1', 'subagents')
  fs.mkdirSync(subagentes, { recursive: true })
  const inicio = Date.parse('2026-01-01T10:00:00.000Z')
  const en = (s) => new Date(inicio + s * 1000).toISOString()
  const jsonl = (filas) => filas.map((f) => JSON.stringify(f)).join('\n') + '\n'
  const uso = { input_tokens: 10, cache_read_input_tokens: 1000, cache_creation_input_tokens: 500, output_tokens: 100 }
  const turno = (id, s, bloques) => ({ type: 'assistant', timestamp: en(s), message: { id, model: 'claude-sonnet-5-5', usage: uso, content: bloques } })
  const agenteDe = (id, tipo, prompt) => ({ type: 'tool_use', id, name: 'Agent', input: { subagent_type: tipo, prompt } })
  const texto = (t) => ({ type: 'text', text: t })
  const E1 = 'SUBTAREA 1/1: crear x'

  fs.writeFileSync(path.join(sesion, 's1.jsonl'), jsonl([
    { type: 'user', timestamp: en(0), message: { role: 'user', content: '<command-name>/qcc-implementador</command-name>\n<command-args> Probar el prefijo </command-args>' } },
    turno('o1', 60, [agenteDe('a1', 'qcc-implementador:qcc-explorador', 'PEDIDO: x')]),
    turno('o2', 200, [agenteDe('x1', 'qcc-implementador:qcc-ejecutor', E1)]),
    turno('o3', 300, [agenteDe('x2', 'qcc-implementador:qcc-revisor', 'QUÉ REVISAR: cambio completo (1 subtarea(s))')]),
  ]))
  const agente = (nombre, tipo, prompt, desde, filas) => {
    fs.writeFileSync(path.join(subagentes, `${nombre}.meta.json`), JSON.stringify({ agentType: tipo }))
    fs.writeFileSync(path.join(subagentes, `${nombre}.jsonl`), jsonl([{ type: 'user', timestamp: en(desde), message: { role: 'user', content: prompt } }, ...filas]))
  }
  agente('agent-e', 'qcc-implementador:qcc-explorador', 'PEDIDO: x', 62, [turno('e1', 100, [texto('ARCHIVOS')])])
  agente('agent-x1', 'qcc-implementador:qcc-ejecutor', E1, 205, [turno('m1', 280, [texto('ESTADO: HECHO')])])
  agente('agent-f', 'qcc-implementador:qcc-revisor', 'QUÉ REVISAR: cambio completo (1 subtarea(s))', 305, [turno('f1', 340, [texto('VEREDICTO: APROBADO\nPROBLEMAS: ninguno\nOBSERVACIONES: ninguna')])])

  const m = metricasDelFlujo(raiz, en(0), { proyectos: path.join(claude, 'projects'), hasta: en(500), base: null })
  assert.equal(m.sesion, path.join(sesion, 's1.jsonl'))
  assert.equal(m.pedido, 'Probar el prefijo')
  assert.deepEqual(Object.keys(m.costo.roles).sort(), ['ejecutor', 'explorador', 'final', 'orquestador'])
  assert.equal(m.costo.roles.ejecutor.agentes, 1)
  assert.deepEqual(m.costo.veredictos.ejecutor, ['HECHO'])
  assert.deepEqual(Object.keys(m.ejecutores), ['1'])
  // El explorador lanzado como qcc-explorador marca la fase 1.
  assert.ok('1' in m.tiempos.fases)
})

/** Corre costos.mjs con esos argumentos: `{ salida, codigo }`. */
const costosCon = (...args) => {
  const r = spawnSync(process.execPath, [fileURLToPath(new URL('./costos.mjs', import.meta.url)), ...args], { encoding: 'utf8' })
  return { salida: r.stdout, codigo: r.status }
}

test('costos: lista filas v1 y v2 juntas', () => {
  const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-config-'))
  temporales.push(carpeta)
  const archivo = path.join(carpeta, 'flujos.jsonl')
  const costo = { inicio: '2026-01-01T10:00:00.000Z', minutos: 2, usd: 0.5, roles: { orquestador: { pedidos: 3, usd: 0.5, sinPrecio: 0, agentes: 0 } }, veredictos: { final: ['APROBADO'] } }
  const v1 = { t: '2026-01-01T10:05:00.000Z', raiz: '/x/repo', base: 'abc', costo, clasificacion: 'CRÍTICO (#1) porque sí', subtareas: 2 }
  const t2 = '2026-01-02T11:30:00.000Z'
  const v2 = { v: 2, t: t2, raiz: '/x/otro', base: 'def', costo, resultado: 'HECHO', sesion: '/no/existe.jsonl', subtareas: [{ n: 1 }, { n: 2 }, { n: 3 }] }
  const filas = [v1, v2, { v: 2, tipo: 'defecto', flujo: t2, texto: 'faltó un test', t: '2026-01-02T12:00:00.000Z' }]
  fs.writeFileSync(archivo, filas.map((f) => JSON.stringify(f)).join('\n') + '\n')

  const lineas = costosCon('--archivo', archivo).salida.split('\n')
  assert.equal(lineas[0], 'FLUJOS (últimos 2 de 2 con costo):')
  // La línea v1 queda como siempre: sin resultado ni defectos.
  assert.equal(lineas[1], '  2026-01-01 10:05 · repo · $0,50 · 2,0 min · orquestador $0,50 (3 pedidos) · CRÍTICO (#1) · 2 subtarea(s) · final APROBADO')
  assert.equal(lineas[2], '  2026-01-02 11:30 · otro · $0,50 · 2,0 min · orquestador $0,50 (3 pedidos) · 3 subtarea(s) · final APROBADO · HECHO · defectos: 1')
  assert.match(lineas[3], /^PROMEDIO: \$0,50 · 2,0 min · orquestador 3,0 pedidos$/)
})

test('costos: --anotar suma un defecto y --fuga mide lo gastado después del cierre', () => {
  const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-config-'))
  temporales.push(carpeta)
  const subagentes = path.join(carpeta, 's1', 'subagents')
  fs.mkdirSync(subagentes, { recursive: true })
  const inicio = Date.parse('2026-01-01T10:00:00.000Z')
  const en = (s) => new Date(inicio + s * 1000).toISOString()
  const jsonl = (filas) => filas.map((f) => JSON.stringify(f)).join('\n') + '\n'
  // Cada pedido: 1000 tokens de salida de Sonnet = $0,01.
  const pedido = (id, s) => ({ type: 'assistant', timestamp: en(s), message: { id, model: 'claude-sonnet-5-5', usage: { output_tokens: 1000 }, content: [{ type: 'text', text: '' }] } })
  const comando = (s) => ({ type: 'user', timestamp: en(s), message: { role: 'user', content: '<command-name>/implementador</command-name>' } })
  const sesion = path.join(carpeta, 's1.jsonl')
  fs.writeFileSync(sesion, jsonl([
    comando(0),
    pedido('antes', 50),
    // El cierre es a los 100 s: estos dos pedidos y el subagente de los 130 s son la fuga.
    pedido('d1', 110),
    pedido('d2', 120),
    // El siguiente /implementador corta el tramo: lo que sigue es de otro flujo.
    comando(200),
    pedido('otro', 210),
  ]))
  const agente = (nombre, desde) => {
    fs.writeFileSync(path.join(subagentes, `${nombre}.meta.json`), JSON.stringify({ agentType: 'ejecutor' }))
    fs.writeFileSync(path.join(subagentes, `${nombre}.jsonl`), jsonl([{ type: 'user', timestamp: en(desde), message: { role: 'user', content: 'SUBTAREA 1/1: x' } }, pedido(`m-${nombre}`, desde + 5)]))
  }
  agente('agent-antes', 50)
  agente('agent-despues', 130)
  agente('agent-otro', 250)

  const costo = { inicio: en(0), minutos: 1, usd: 0.1, roles: { orquestador: { pedidos: 1, usd: 0.1, sinPrecio: 0, agentes: 0 } }, veredictos: {} }
  const archivo = path.join(carpeta, 'flujos.jsonl')
  const v2 = (t, extra) => ({ v: 2, t, raiz: '/x/repo', base: 'abc', costo, resultado: 'HECHO', subtareas: [], ...extra })
  fs.writeFileSync(archivo, [
    v2(en(100), { sesion }),
    v2('2026-01-03T09:00:00.000Z', {}),
  ].map((f) => JSON.stringify(f)).join('\n') + '\n')

  // --fuga: solo los flujos v2 con sesión, y el tramo cortado en el siguiente /implementador.
  const fuga = costosCon('--fuga', '--archivo', archivo)
  assert.equal(fuga.codigo, 0)
  assert.equal(fuga.salida.trimEnd(), 'FUGA: 2026-01-01 10:01 · repo · $0,03 (3 pedidos) después del cierre')

  // --anotar: un prefijo con espacio o con T, y exit 2 si no es una sola coincidencia.
  const ok = costosCon('--anotar', '2026-01-01 10:01', 'faltó un test', '--archivo', archivo)
  assert.equal(ok.codigo, 0)
  assert.match(ok.salida, /^ANOTADO: /)
  const defecto = fs.readFileSync(archivo, 'utf8').trimEnd().split('\n').map((l) => JSON.parse(l)).at(-1)
  assert.deepEqual({ ...defecto, t: undefined }, { v: 2, tipo: 'defecto', flujo: en(100), texto: 'faltó un test', t: undefined })
  assert.ok(Number.isFinite(Date.parse(defecto.t)))
  assert.equal(costosCon('--anotar', '2026-01-01T10:01', 'otra', '--archivo', archivo).codigo, 0)
  const varios = costosCon('--anotar', '2026-01', 'x', '--archivo', archivo)
  assert.equal(varios.codigo, 2)
  assert.match(varios.salida, /^ERROR: .*coincide con 2 flujos/)
  const ninguno = costosCon('--anotar', '2027', 'x', '--archivo', archivo)
  assert.equal(ninguno.codigo, 2)
  assert.match(ninguno.salida, /^ERROR: ningún flujo/)
  assert.equal(costosCon('--anotar', '2026-01-01', '--archivo', archivo).codigo, 2)
  const lineas = fs.readFileSync(archivo, 'utf8').trimEnd().split('\n')
  assert.equal(lineas.length, 4)
  // Las filas de defecto no cuentan como flujos y el listado muestra cuántos tiene cada uno.
  const listado = costosCon('--archivo', archivo).salida
  assert.match(listado, /^FLUJOS \(últimos 2 de 2 con costo\):$/m)
  assert.match(listado, /2026-01-01 10:01 · repo · .* · HECHO · defectos: 2$/m)
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

/** Comando de un paso que escribe `contenido` en `rel` (relativo a la raíz del repo de prueba). */
const escribirCmd = (rel, contenido) => `node -e "require('fs').writeFileSync('${rel}', '${contenido}')"`

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

const GUARDIA = fileURLToPath(new URL('./guardia.mjs', import.meta.url))

/** Corre guardia.mjs como hook del agente `rol` (su `agent_type` de plugin va en el evento), con `evento` por stdin, en el proyecto `raiz`. */
function hook(raiz, rol, evento) {
  const env = { ...process.env, CLAUDE_PROJECT_DIR: raiz }
  return spawnSync(process.execPath, [GUARDIA], { cwd: raiz, encoding: 'utf8', env, input: JSON.stringify({ agent_type: `qcc-implementador:qcc-${rol}`, ...evento }) })
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

    const glob = hook(raiz, 'explorador', ev(raiz, 'Glob', { pattern: '**/*.ts' }))
    assert.equal(glob.stdout, '')
    assert.equal(glob.status, 0)
    assert.deepEqual(dato(ultima()), { rol: 'explorador', herramienta: 'Glob', objetivo: '**/*.ts', decision: 'lectura' })

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
    const rota = spawnSync(process.execPath, [GUARDIA], { cwd: raiz, encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: raiz }, input: '{no es json' })
    assert.equal(rota.stdout, '')
    assert.equal(rota.status, 0)
    assert.equal(filasDe(raiz).length, antes)
  } finally {
    borrarRegistro(raiz)
  }
})

test('guardia como hook: niega y anota por el agent_type; la sesión principal y otros agentes pasan sin tocar el registro', () => {
  const raiz = repo('agent-type', { 'src/a.ts': 'a\n' })
  temporales.push(raiz)
  try {
    const push = bash(raiz, 'git commit -m x')
    const ejecutor = hook(raiz, 'ejecutor', push)
    assert.equal(JSON.parse(ejecutor.stdout).hookSpecificOutput.permissionDecision, 'deny')
    assert.equal(filasDe(raiz).at(-1).rol, 'ejecutor')
    assert.equal(filasDe(raiz).at(-1).decision, 'negado')
    const revisor = hook(raiz, 'revisor', edita(raiz, path.join(raiz, 'src', 'a.ts')))
    assert.equal(JSON.parse(revisor.stdout).hookSpecificOutput.permissionDecision, 'deny')
    assert.equal(filasDe(raiz).at(-1).rol, 'revisor')

    const antes = filasDe(raiz).length
    // La sesión principal (sin agent_type) y otros agentes, incluidos los del odd, nunca se niegan ni se anotan.
    for (const agent_type of [undefined, 'qcc-implementador-odd:qcc-odd-ejecutor', 'qcc-commit:qcc-generador-commit', 'general-purpose']) {
      const r = hook(raiz, 'ejecutor', { ...push, agent_type })
      assert.equal(r.stdout, '', String(agent_type))
      assert.equal(r.status, 0)
    }
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

test('costos: problemasDe acepta viñetas y ruta:línea sin numeración', () => {
  assert.deepEqual(problemasDe('VEREDICTO: RECHAZADO\nPROBLEMAS:\n1. uno\n2) dos\nOBSERVACIONES: x'), ['uno', 'dos'])
  assert.deepEqual(problemasDe('PROBLEMAS:\n- a falla\n* b falla\n• c falla\nOBSERVACIONES:\n- no cuenta'), ['a falla', 'b falla', 'c falla'])
  assert.deepEqual(problemasDe('PROBLEMAS:\nsrc/a.ts:12 — mal\nsrc/b.ts:3-5 – peor\n- src/c.ts:9 - otro\n\nOBSERVACIONES: nada'), ['src/a.ts:12 — mal', 'src/b.ts:3-5 – peor', 'src/c.ts:9 - otro'])
  // Con numerados presentes, sus sub-viñetas no se cuentan aparte.
  assert.deepEqual(problemasDe('PROBLEMAS:\n1. src/a.ts:1 — mal\n   - detalle\n   - otro detalle\n2. dos\nOBSERVACIONES: x'), ['src/a.ts:1 — mal', 'dos'])
  assert.deepEqual(problemasDe('PROBLEMAS: ninguno\nOBSERVACIONES: - algo'), [])
  assert.deepEqual(problemasDe('PROBLEMAS:\n- ninguno'), [])
  assert.deepEqual(problemasDe('sin sección'), [])
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

test.after(() => {
  for (const r of [ESTRICTO, GENERICO, ...temporales, PRUEBAS]) fs.rmSync(r, { recursive: true, force: true })
})
