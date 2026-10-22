// Casos de las herramientas de /qcc-implementador-odd: guardia, verificar, odd, costo e instalar.
// Correr: node --test ~/.claude/flujos-odd/odd.test.mjs
//
// Los repos de prueba, los registros y la config de Claude Code van al temporal: no tocan el historial real.
// La guardia se prueba con la raíz de este repo, fuera del temporal (dentro de él, todo sería escribible).

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { evaluar, motivoComando, tramosDe, raizDe, marcaDe, reglasDelProyecto } from './guardia.mjs'
import { pasosDe, colaDe } from './verificar.mjs'
import { opcionesDe, criticosLegibles, tareasDe, sumaNumstat, recortar, filaDeCorrida, lineaDeCorrida, riesgoDe, lineasDePlan, lineaDeContexto, cuentaCodigo, explorarDe } from './odd.mjs'
import { costoDelFlujo, costoDePedido, hallazgosDe, contextoActual, finDeCorrida } from './costo.mjs'
import { procesoDe, lineaDeProceso } from './proceso.mjs'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const ODD = path.join(DIR, 'odd.mjs')
const VERIFICAR = path.join(DIR, 'verificar.mjs')
const GUARDIA = path.join(DIR, 'guardia.mjs')
const RAIZ = raizDe(DIR)
const PRUEBAS = fs.mkdtempSync(path.join(os.tmpdir(), 'odd-pruebas-'))
const GIT_ENV = { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' }
const TMP = path.join(os.tmpdir(), 'odd-x').replaceAll('\\', '/')

test.after(() => fs.rmSync(PRUEBAS, { recursive: true, force: true }))
// La marca de corrida abierta que mira la guardia del orquestador va a los registros de prueba, como en `correr`.
process.env.ODD_REGISTROS = path.join(PRUEBAS, 'registros')

/** Repo de prueba con un commit; `archivos` es `{ ruta: contenido }`. */
function repo(nombre, archivos) {
  const raiz = path.join(PRUEBAS, nombre)
  fs.mkdirSync(raiz, { recursive: true })
  for (const [ruta, texto] of Object.entries(archivos)) {
    fs.mkdirSync(path.dirname(path.join(raiz, ruta)), { recursive: true })
    fs.writeFileSync(path.join(raiz, ruta), texto)
  }
  const git = (...args) => execFileSync('git', args, { cwd: raiz, env: { ...process.env, ...GIT_ENV }, stdio: 'pipe' })
  git('init', '-q')
  git('add', '-A')
  git('commit', '-qm', 'inicio')
  return raiz
}

function correr(script, raiz, ...args) {
  const r = spawnSync(process.execPath, [script, ...args], {
    cwd: raiz,
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: raiz, ODD_REGISTROS: path.join(PRUEBAS, 'registros'), CLAUDE_CONFIG_DIR: path.join(PRUEBAS, 'claude') },
  })
  return { salida: r.stdout, codigo: r.status }
}

const linea = (salida, prefijo) => salida.split('\n').find((l) => l.startsWith(prefijo))?.slice(prefijo.length)

const jsonl = (filas) => filas.map((f) => JSON.stringify(f)).join('\n') + '\n'
const usoCon = (contexto) => ({ input_tokens: 10, cache_read_input_tokens: contexto - 510, cache_creation_input_tokens: 500, output_tokens: 100 })

/**
 * Transcript de juguete del orquestador: el `/qcc-implementador-odd`, el `--inicio` con `ODD_BASE=<base>` y un pedido
 * por cada uso `[herramienta, entrada, contexto?, resultado?]`, dos segundos después del anterior.
 */
function transcript(usos, { base = 'b0de', desde = Date.now() - 600_000 } = {}) {
  const en = (s) => new Date(desde + s * 1000).toISOString()
  const pedido = (id, s, contexto, nombre, input) => ({ type: 'assistant', timestamp: en(s), message: { id, model: 'claude-sonnet-5-5', usage: usoCon(contexto), content: [{ type: 'tool_use', id: `u-${id}`, name: nombre, input }] } })
  const resultado = (id, s, texto) => ({ type: 'user', timestamp: en(s), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: `u-${id}`, content: texto }] } })
  const filas = [
    { type: 'user', timestamp: en(0), message: { role: 'user', content: '<command-name>/qcc-implementador-odd</command-name>\n<command-args> x </command-args>' } },
    pedido('p0', 1, 40_000, 'Bash', { command: 'node ~/.claude/flujos-odd/odd.mjs --inicio' }),
    resultado('p0', 2, `ODD_BASE=${base}\nRAMA: …`),
  ]
  usos.forEach(([nombre, input, contexto = 50_000, texto = ''], k) => filas.push(pedido(`p${k + 1}`, 10 + 2 * k, contexto, nombre, input), resultado(`p${k + 1}`, 11 + 2 * k, texto)))
  return { filas, inicio: en(0), hasta: en(12 + 2 * usos.length), en }
}

const PLAN = ['Bash', { command: 'node ~/.claude/flujos-odd/odd.mjs --plan --base b0de --tamano chico --reglas 2 --riesgo "1:no;2:no;3:no;4:no;5:no;6:no"' }]
const VERIFICAR_ODD = ['Bash', { command: 'node ~/.claude/flujos-odd/verificar.mjs' }]
const DIFF = ['Bash', { command: 'node ~/.claude/flujos-odd/odd.mjs --diff b0de' }]

// ── guardia ─────────────────────────────────────────────────────────────────

// Los dos comandos que la guardia le negó al revisor en la ronda 4 (odd-grande), tal cual: tomó `=>` por redirección.
const NEGADOS_RONDA_4 = [
  String.raw`mkdir -p /tmp/odd-revisor-sena && cat > /tmp/odd-revisor-sena/probe.mjs <<'EOF'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
const raiz = process.argv[2]
const imp = (p) => import(pathToFileURL(path.join(raiz, p)).href)
const { fijarAhora } = await imp('src/reloj.js')
const { construirSemilla } = await imp('src/semilla.js')
const { firmar, procesarWebhook } = await imp('src/pagos/pasarela.js')
const R = await imp('src/reservas/reservas.js')
const S = await imp('src/negocio/servicios.js')
const C = await imp('src/comisiones/comisiones.js')
const I = await imp('src/reportes/ingresos.js')
const P = await imp('src/planes/planes.js')
const { migrar } = await imp('src/db/migraciones.js')
const q = (db, id) => db.usuarios.find((u) => u.id === id)
const out = (k, f) => { try { console.log(k, JSON.stringify(f())) } catch (e) { console.log(k, 'ERR', e.codigo ?? e.message) } }
fijarAhora('2026-10-21T12:00:00.000Z')
const db = construirSemilla({ claveHash: 'x' })
const wh = (orden, estado) => procesarWebhook(db, { token: orden.token, estado, monto: String(orden.monto), firma: firmar({ token: orden.token, estado, monto: String(orden.monto) }) })
// seña 33% en corte 12000 -> 3960
out('editar str', () => S.editarServicio(db, q(db, 'usr_dueno'), 'ser_corte', { senaPorcentaje: '30' }).senaPorcentaje)
out('editar 33.5', () => S.editarServicio(db, q(db, 'usr_dueno'), 'ser_corte', { senaPorcentaje: 33.5 }).senaPorcentaje)
out('sp', () => db.servicios.find(s=>s.id==='ser_corte').senaPorcentaje)
out('editar camila', () => S.editarServicio(db, q(db, 'pro_camila') ?? db.usuarios.find(u=>u.rol==='profesional'), 'ser_corte', { senaPorcentaje: 30 }))
out('editar 33', () => S.editarServicio(db, q(db, 'usr_dueno'), 'ser_corte', { senaPorcentaje: 33 }).senaPorcentaje)
// reserva A: dia 23, pay, then mark no_asistio later
const a = R.crearReserva(db, q(db, 'usr_ana'), { servicioId: 'ser_corte', profesionalId: 'pro_camila', inicio: '2026-10-23T13:00:00.000Z' })
console.log('A', a.estado, a.sena, a.urlPago?.slice(0, 30))
const oa = db.ordenes.find(o => o.id === a.sena.ordenId)
out('pagoA', () => wh(oa, 'pagada').repetido)
out('pagoA repetido', () => wh(oa, 'pagada').repetido)
out('A estado', () => db.reservas.find(r=>r.id===a.id).estado)
// reprogramar A to 26th then cancel by client >24h
out('reprog', () => R.reprogramarReserva(db, q(db, 'usr_ana'), a.id, { inicio: '2026-10-26T13:00:00.000Z' }).inicio)
out('cancel A', () => R.cancelarReserva(db, q(db, 'usr_ana'), a.id).estado)
out('oa', () => [oa.estado, oa.reembolsado])
// B: pay, then no_asistio
const b = R.crearReserva(db, q(db, 'usr_ana'), { servicioId: 'ser_corte', profesionalId: 'pro_diego', inicio: '2026-10-21T14:00:00.000Z' })
const ob = db.ordenes.find(o => o.id === b.sena.ordenId)
wh(ob, 'pagada')
fijarAhora('2026-10-21T15:00:00.000Z')
out('noasist', () => R.marcarAsistencia(db, q(db, 'usr_dueno'), b.id, false).estado)
// C: pending expires; check counts
const c = R.crearReserva(db, q(db, 'usr_ana'), { servicioId: 'ser_corte', profesionalId: 'pro_camila', inicio: '2026-10-22T14:00:00.000Z' })
fijarAhora('2026-10-21T15:20:00.000Z')
out('cupo', () => P.reservasDelMes(db, db.empresas[0]))
out('vencer', () => R.vencerReservas(db))
out('cupo2', () => P.reservasDelMes(db, db.empresas[0]))
out('com', () => C.calcularComisiones(db, 'emp_norte', '2026-10'))
out('res', () => { const x = I.resumenDelMes(db, q(db, 'usr_dueno'), { sucursalId: 'suc_providencia', periodo: '2026-10' }); return [x.porEstado, x.ingresos, x.tasaInasistencia] })
// migración idempotente con valor no-cero
const d3 = { version: 3, servicios: [{ id: 's', precio: 1, senaPorcentaje: 50 }, { id: 't', precio: 2 }], reservas: [{ id: 'r', estado: 'confirmada' }] }
out('mig', () => [migrar(d3), d3.servicios, d3.reservas])
out('mig2', () => [migrar(d3), d3.servicios])
EOF
cd /d/GitHub-Personal/prueba-flujos/odd-grande && node /tmp/odd-revisor-sena/probe.mjs . 2>&1`,
  String.raw`B=C:/Users/x/AppData/Local/Temp/qcc-odd-base-gvnsZv; N=D:/GitHub-Personal/prueba-flujos/odd-grande; for t in base nuevo; do if [ $t = base ]; then R=$B; else R=$N; fi; export AGENDA_DB=/tmp/odd-revisor-sena/$t.json AGENDA_AHORA=2026-10-21T12:00:00.000Z; echo "== $t"; for c in "semilla --forzar" "recordatorios" "outbox" "liquidar emp_norte 2026-09" "liquidar emp_norte 2026-10" "liquidar emp_norte" "vencer" "migrar"; do node $R/src/cli.js $c 2>&1 | tr '\n' ' '; echo " [$?] <- $c"; done; done; node -e "const a=require('/tmp/odd-revisor-sena/base.json'),b=require('/tmp/odd-revisor-sena/nuevo.json');const s=x=>JSON.stringify({...x,outbox:x.outbox.map(m=>({...m,id:0})),auditoria:x.auditoria.map(m=>({...m,id:0})),liquidaciones:x.liquidaciones.map(m=>({...m,id:0}))});console.log(a.version,b.version);for(const k of Object.keys(b)) if(JSON.stringify(a[k])!==JSON.stringify(b[k])) console.log('dif',k)"`,
]

// `=>`, `->` y `>=` no son redirecciones, ni lo de dentro de comillas o del cuerpo de un heredoc.
const SIN_REDIRECCION = [
  'node -e "const f = (x) => x; console.log(f(1))"',
  `node --input-type=module -e "import('node:fs').then((m) => m.statSync('.'))"`,
  "node - <<'EOF'\nconst f = (a, b) => a >= b\nconsole.log(f(2, 1))\na > b\nEOF",
  ...NEGADOS_RONDA_4,
]

const PASAN = {
  ejecutor: [
    'git status --short',
    'git -c core.quotePath=false diff -- a.js',
    'git log -5 --format=%s | head -3',
    'node --test flujos-odd/herramientas/odd.test.mjs 2>&1 | tail -20',
    'npm test -- --reporter=dot',
    'pnpm run typecheck',
    'npx tsc --noEmit',
    'rm flujos-odd/viejo.txt',
    'Remove-Item -Force flujos-odd/viejo.txt',
    `mkdir -p ${TMP}/a && cp flujos-odd/x.js ${TMP}/a/`,
    // Por Bash solo escribe en el temporal; en el repo edita con Edit o Write.
    `echo x > ${TMP}/salida.txt`,
    `sed -i s/a/b/ ${TMP}/a`,
    `cat > ${TMP}/s.mjs <<'EOF'\nconsole.log(1)\nEOF`,
    `node -e "require('fs').writeFileSync('${TMP}/x.txt', 'x')"`,
    `node -e "const fs=require('fs'),os=require('os'),p=require('path');fs.copyFileSync('AGENTS.md', p.join(os.tmpdir(),'a.md'))"`,
    'node flujos-odd/instalar.mjs --revisar',
    `node ~/.claude/flujos-odd/odd.mjs --limpiar -- ${TMP}/x`,
    'mkdir -p flujos-odd/nuevo',
    'cat .env.example',
    'cargo test',
  ],
  revisor: [
    'node ~/.claude/flujos-odd/odd.mjs --diff abc123',
    `mkdir -p ${TMP}/base && git archive abc123 | tar -x -C ${TMP}/base`,
    `T=${TMP}; mkdir -p "$T/base" && git archive abc123 | tar -x -C "$T/base"`,
    `node script.js > ${TMP}/salida.txt 2>&1`,
    'node --test flujos-odd/herramientas/odd.test.mjs',
    'git diff abc123 -- flujos-odd/',
    `tee ${TMP}/x <<'EOF'\nhola\nEOF`,
    ...SIN_REDIRECCION,
  ],
  orquestador: [
    'npm test',
    'npm install lodash',
    'pnpm add -D vitest',
    'npx -y cowsay',
    'pip install requests',
    'node ~/.claude/flujos-odd/verificar.mjs',
    'node ~/.claude/flujos-odd/odd.mjs --diff abc123',
    'node --test flujos-odd/herramientas/odd.test.mjs 2>&1 | tail -5',
    'node -e "console.log(1)"',
    'git diff abc123 -- AGENTS.md',
    'git show HEAD:AGENTS.md | head -20',
    'git ls-files | head -100',
    'grep -n "x" AGENTS.md',
    'wc -l AGENTS.md',
    'rm flujos-odd/viejo.txt',
    'mkdir -p flujos-odd/nuevo',
    `echo x > ${TMP}/a && sed -i s/a/b/ ${TMP}/a && cat ${TMP}/a`,
    `node ${TMP.replace('odd-x', 'qcc-odd-base-AbC')}/src/cli.js semilla`,
    // Las herramientas del flujo, por su ruta absoluta (PowerShell no expande `~`), aunque escriban archivos.
    `node "${ODD.replaceAll('\\', '/')}" --cierre --base abc --resultado COMPLETO`,
    `node ${path.join(os.homedir(), '.claude', 'flujos-odd', 'odd.mjs').replaceAll('\\', '/')} --diff abc`,
    `node ${path.join(os.homedir(), '.claude-cuenta1', 'flujos-odd', 'odd.mjs').replaceAll('\\', '/')} --inicio`,
    'patch --dry-run -p1 < x.diff',
    'New-Item -ItemType Directory -Force odd/tasks',
    `python -c "print(open('a').read())"`,
    `node -e "console.log(\\"x > y\\")"`,
    `Set-Content -Path ${TMP}/x.txt -Value 'hola'`,
    `"hola" | Out-File -FilePath ${TMP}/x.txt -Encoding utf8`,
    'grep -rn "writeFileSync(" flujos-odd/herramientas && node -e "console.log(1)"',
    'echo $((1<<2))',
    'echo x 2>&1 | tail -1',
    ...SIN_REDIRECCION,
  ],
}

// Revisión independiente: escrituras al repo que se escapaban.
const ESCAPES = [
  'bash -c "echo x > AGENTS.md"',
  'sh -c \'sed -i s/a/b/ AGENTS.md\'',
  'cmd /c "echo x > AGENTS.md"',
  'powershell -Command "Set-Content AGENTS.md hola"',
  'echo x >| AGENTS.md',
  'echo x >& AGENTS.md',
  `echo it\\'s > ${TMP}/x; echo x > AGENTS.md`,
  'echo $((1<<2))\necho x > AGENTS.md',
  'Set-Content -Path AGENTS.md -Value hola',
  "perl -pi -e 's/a/b/' AGENTS.md",
  "perl -i -pe 's/a/b/' AGENTS.md",
  'git diff --output=AGENTS.md',
  "[IO.File]::WriteAllText('AGENTS.md', 'x')",
  'patch -p1 -o AGENTS.md < x.diff',
  // En PowerShell la barra no escapa: una ruta entre comillas que termina en `\` cierra la comilla.
  'Get-ChildItem "C:\\Users\\x\\AppData\\Local\\Temp\\" ; echo x > AGENTS.md',
]

const NIEGAN = {
  ejecutor: [
    ['git commit -m x', /git commit/],
    ['git status && git push', /git push/],
    ['git stash', /git stash/],
    ['npm install lodash', /dependencias/],
    ['pnpm add -D vitest', /dependencias/],
    ['pip install requests', /dependencias/],
    ['npx -y cowsay', /dependencias/],
    ['curl https://x.dev', /red/],
    ['Invoke-WebRequest https://x.dev', /red/],
    ['echo $(curl -s https://x.dev)', /red/],
    ['rm -rf dist', /recursivo/],
    ['Remove-Item -Recurse -Force dist', /recursivo/],
    ['cat .env', /secretos/],
    ['cp config .env.local', /secretos/],
    ['npm run dev', /no termina/],
    ['vitest --watch', /watch/],
    ['echo x > ../fuera.txt', /fuera del repo/],
    ['echo x > pnpm-lock.yaml', /lockfile/],
    ['cat <<EOF\n$(git push)\nEOF', /git push/],
    ['echo "process.env.FOO" > flujos-odd/nota.txt', /edita con Edit o Write/],
    ['sed -i s/a/b/ AGENTS.md', /edita con Edit o Write/],
    ["cat > flujos-odd/x.test.mjs <<'EOF'\nx\nEOF", /edita con Edit o Write/],
    ['echo x | tee AGENTS.md', /edita con Edit o Write/],
    ['cp a.js flujos-odd/b.js', /edita con Edit o Write/],
    ['Set-Content -Path AGENTS.md -Value x', /edita con Edit o Write/],
    ...ESCAPES.map((cmd) => [cmd, /edita con Edit o Write/]),
    ["node -e \"require('fs').writeFileSync('AGENTS.md', 'x')\"", /script que escribe archivos del repo/],
    [`node -e "const fs=require('fs');const f='AGENTS.md';fs.writeFileSync(f, 'x')"`, /script que escribe archivos del repo/],
    [`python3 - <<'EOF'\nopen('AGENTS.md', 'w').write('x')\nEOF`, /script que escribe archivos del repo/],
    [`cat > ${TMP}/s.mjs <<'EOF'\nrequire('fs').writeFileSync('AGENTS.md', 'x')\nEOF\nnode ${TMP}/s.mjs`, /script que escribe archivos del repo/],
  ],
  revisor: [
    ['echo x > flujos-odd/nota.txt', /solo escribe en el temporal/],
    ['echo x >"flujos-odd/n"', /solo escribe en el temporal/],
    ['node -e "const f = (x) => x" > flujos-odd/x', /solo escribe en el temporal/],
    ['cat <<EOF > flujos-odd/x\na => b\nEOF', /solo escribe en el temporal/],
    ["tee flujos-odd/x <<'EOF'\nhola\nEOF", /solo escribe en el temporal/],
    ['sed -i s/a/b/ flujos-odd/x.js', /solo escribe en el temporal/],
    [`T=$(mktemp -d) && git archive abc | tar -x -C "$T"`, /no se ve a dónde escribe/],
    ['git archive abc | tar -x', /tar -x sin -C/],
    ['cp a.js b.js', /solo escribe en el temporal/],
    ['git checkout -- a.js', /git checkout/],
  ],
  orquestador: [
    ['echo x > flujos-odd/nota.txt', /edita con Edit o Write, no por Bash \(flujos-odd\/nota\.txt\)/],
    ['sed -i s/a/b/ AGENTS.md', /edita con Edit o Write/],
    ['echo x | tee AGENTS.md', /edita con Edit o Write/],
    ['cp a.js flujos-odd/b.js', /edita con Edit o Write/],
    ['Set-Content -Path AGENTS.md -Value x', /edita con Edit o Write/],
    ['"x" | Out-File AGENTS.md', /edita con Edit o Write/],
    ["cat >> AGENTS.md <<'EOF'\nx\nEOF", /edita con Edit o Write/],
    ["node - <<'EOF'\nrequire('fs').writeFileSync('AGENTS.md', 'x')\nEOF", /script que escribe archivos/],
    [`python3 - <<'EOF'\nopen('AGENTS.md', 'w').write('x')\nEOF`, /script que escribe archivos/],
    [`node -e "require('fs').appendFileSync('a', 'b')"`, /script que escribe archivos/],
    ['cat AGENTS.md', /lee con Read \(offset\/limit\) o Grep, no con cat/],
    ['head -50 flujos-odd/herramientas/odd.mjs', /lee con Read/],
    ['git status && sed -n 1,20p AGENTS.md', /lee con Read/],
    ['Get-Content AGENTS.md', /lee con Read/],
    ['git push', /git push/],
    ['curl https://x.dev', /red/],
    ['rm -rf dist', /recursivo/],
    ['cat .env', /secretos/],
    ['npm run dev', /no termina/],
    ...ESCAPES.map((cmd) => [cmd, /edita con Edit o Write/]),
    [`cat > ${TMP}/s.mjs <<'EOF'\nrequire('fs').writeFileSync('AGENTS.md', 'x')\nEOF\nnode ${TMP}/s.mjs`, /script que escribe archivos/],
    [`node -e "require('fs').createWriteStream('AGENTS.md')"`, /script que escribe archivos/],
    [`python -c "open('AGENTS.md', 'w').write('x')"`, /script que escribe archivos/],
    // Solo las herramientas del flujo se libran, no cualquier script de su carpeta.
    [`node ${path.join(os.homedir(), '.claude', 'flujos-odd', 'z.mjs').replaceAll('\\', '/')} <<'EOF'\nrequire('fs').writeFileSync('AGENTS.md', 'x')\nEOF`, /script que escribe archivos/],
  ],
}

test('guardia: el revisor tampoco escribe por un shell anidado, escapes ni >| / >&', () => {
  for (const cmd of ESCAPES) assert.match(motivoComando(cmd, { rol: 'revisor', raiz: RAIZ }) ?? 'pasó', /solo escribe en el temporal/, cmd)
  assert.equal(motivoComando(`Set-Content -Path ${TMP}/x.txt -Value 'hola'`, { rol: 'revisor', raiz: RAIZ }), null)
  assert.match(motivoComando('bash -c "git push"', { rol: 'ejecutor', raiz: RAIZ }) ?? 'pasó', /git push/)
})

test('guardia: el orquestador no corre un script del temporal que escribe archivos', () => {
  const escribe = path.join(PRUEBAS, 'aplicar.cjs')
  fs.writeFileSync(escribe, "require('fs').writeFileSync('src/a.js', t)")
  const lee = path.join(PRUEBAS, 'leer.mjs')
  fs.writeFileSync(lee, 'console.log(1)')
  assert.match(motivoComando(`node "${escribe.replaceAll('\\', '/')}" && npm test`, { rol: 'orquestador', raiz: RAIZ }) ?? 'pasó', /script que escribe archivos/)
  assert.equal(motivoComando(`node "${lee.replaceAll('\\', '/')}"`, { rol: 'orquestador', raiz: RAIZ }), null)
  // Un script del proyecto corre, escriba o no: es un comando del proyecto.
  assert.equal(motivoComando('node flujos-odd/instalar.mjs --revisar', { rol: 'orquestador', raiz: RAIZ }), null)
})

test('guardia: el ejecutor no corre un script del temporal que escribe en el repo', () => {
  const escribe = path.join(PRUEBAS, 'ejecutor-aplicar.cjs')
  fs.writeFileSync(escribe, "require('fs').writeFileSync('src/a.js', t)")
  const aTemporal = path.join(PRUEBAS, 'ejecutor-salida.cjs')
  fs.writeFileSync(aTemporal, `require('fs').writeFileSync('${TMP}/salida.txt', t)`)
  assert.match(motivoComando(`node "${escribe.replaceAll('\\', '/')}" && npm test`, { rol: 'ejecutor', raiz: RAIZ }) ?? 'pasó', /script que escribe archivos del repo/)
  assert.equal(motivoComando(`node "${aTemporal.replaceAll('\\', '/')}"`, { rol: 'ejecutor', raiz: RAIZ }), null)
  // Un script del proyecto corre, escriba o no: es un comando del proyecto.
  assert.equal(motivoComando('node flujos-odd/instalar.mjs --revisar', { rol: 'ejecutor', raiz: RAIZ }), null)
  // El hook explica qué hacer con la herramienta o con BLOQUEOS.
  const hook = spawnSync(process.execPath, [GUARDIA, 'ejecutor'], { input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'sed -i s/a/b/ AGENTS.md' } }), encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: RAIZ } }).stdout
  assert.match(JSON.parse(hook).hookSpecificOutput.permissionDecisionReason, /edita con Edit o Write.*usa la herramienta que dice.*BLOQUEOS/)
})

test('guardia: el orquestador solo se guarda con una corrida abierta y fuera de los subagentes', () => {
  const bash = (command, extra = {}) => evaluar({ tool_name: 'Bash', tool_input: { command }, ...extra }, 'orquestador', RAIZ)
  const editar = (ruta) => evaluar({ tool_name: 'Edit', tool_input: { file_path: ruta } }, 'orquestador', RAIZ)
  const marca = marcaDe(RAIZ)
  fs.rmSync(marca, { force: true })
  assert.equal(bash('cat AGENTS.md'), null)
  fs.mkdirSync(path.dirname(marca), { recursive: true })
  fs.writeFileSync(marca, '{}')
  try {
    assert.match(bash('cat AGENTS.md') ?? 'pasó', /lee con Read/)
    assert.equal(bash('cat AGENTS.md', { agent_type: 'qcc-odd-revisor', agent_id: 'a1' }), null)
    assert.equal(editar(path.join(RAIZ, 'flujos-odd', 'x.js')), null)
    assert.equal(editar(path.join(RAIZ, 'package-lock.json')), null)
    assert.equal(editar(path.join(path.dirname(RAIZ), 'otro.js')), null)
    assert.match(editar(path.join(RAIZ, '.env')) ?? 'pasó', /secretos/)
    const hook = spawnSync(process.execPath, [GUARDIA, 'orquestador'], { input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'sed -i s/a/b/ AGENTS.md' } }), encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: RAIZ } }).stdout
    assert.match(JSON.parse(hook).hookSpecificOutput.permissionDecisionReason, /edita con Edit o Write.*usa la herramienta que dice/)
    // Una marca de más de 12 h ya no cuenta.
    const viejo = new Date(Date.now() - 13 * 3600_000)
    fs.utimesSync(marca, viejo, viejo)
    assert.equal(bash('cat AGENTS.md'), null)
  } finally {
    fs.rmSync(marca, { force: true })
  }
})

test('guardia: en una tarea grande el orquestador solo edita odd/tasks/', () => {
  const raiz = repo('grande', { 'src/a.js': 'x\n', 'odd/tasks/.gitkeep': '' })
  const editar = (ruta, extra = {}) => evaluar({ tool_name: 'Edit', tool_input: { file_path: path.join(raiz, ruta) }, ...extra }, 'orquestador', raiz)
  const escribir = (rol, ruta) => evaluar({ tool_name: 'Write', tool_input: { file_path: path.join(raiz, ruta) } }, rol, raiz)
  const base = linea(correr(ODD, raiz, '--inicio').salida, 'ODD_BASE=')
  const plan = (tamano) => correr(ODD, raiz, '--plan', '--base', base, '--tamano', tamano, '--reglas', '9', '--riesgo', '1:no;2:no;3:no;4:no;5:no;6:no')
  try {
    // Sin --plan, ni chico: edita como siempre.
    assert.equal(editar('src/a.js'), null)
    assert.equal(plan('chico').codigo, 0)
    assert.equal(editar('src/a.js'), null)

    const grande = plan('grande')
    assert.equal(grande.codigo, 0, grande.salida)
    assert.match(grande.salida, /^TAMAÑO: grande · 9 reglas\nGRANDE: el código lo edita qcc-odd-ejecutor/)
    assert.equal(JSON.parse(fs.readFileSync(marcaDe(raiz), 'utf8')).tamano, 'grande')
    assert.match(editar('src/a.js') ?? 'pasó', /tarea grande: el código lo edita qcc-odd-ejecutor, tú solo odd\/tasks\/ \(src\/a\.js\)/)
    assert.match(escribir('orquestador', 'test/nuevo.test.js') ?? 'pasó', /tarea grande/)
    assert.equal(escribir('orquestador', 'odd/tasks/sena.md'), null)
    // Fuera del repo (el temporal) sigue pudiendo, y las reglas de siempre mandan primero.
    assert.equal(escribir('orquestador', path.relative(raiz, path.join(os.tmpdir(), 'odd-x.txt'))), null)
    assert.match(escribir('orquestador', '.env') ?? 'pasó', /secretos/)
    // Los subagentes no: el ejecutor edita el código, y dentro de un subagente el hook del orquestador no niega.
    assert.equal(escribir('ejecutor', 'src/a.js'), null)
    assert.equal(editar('src/a.js', { agent_type: 'qcc-odd-ejecutor', agent_id: 'a1' }), null)
    // Por Bash ya lo negaba antes.
    assert.match(motivoComando('echo x > src/a.js', { rol: 'orquestador', raiz }) ?? 'pasó', /edita con Edit o Write/)
    // Un --plan posterior con chico lo vuelve a habilitar; --cierre borra la marca.
    plan('chico')
    assert.equal(editar('src/a.js'), null)
    plan('grande')
    correr(ODD, raiz, '--cierre', '--base', base, '--resultado', 'COMPLETO')
    assert.equal(editar('src/a.js'), null)
  } finally {
    fs.rmSync(marcaDe(raiz), { force: true })
  }
  // Una marca sin tamaño o ilegible no niega.
  fs.mkdirSync(path.dirname(marcaDe(raiz)), { recursive: true })
  try {
    for (const contenido of ['{}', 'no es json']) {
      fs.writeFileSync(marcaDe(raiz), contenido)
      assert.equal(editar('src/a.js'), null, contenido)
    }
  } finally {
    fs.rmSync(marcaDe(raiz), { force: true })
  }
})

test('guardia: en una tarea grande el orquestador lee el código del repo solo con limit <= 120', () => {
  const raiz = repo('lectura-grande', { 'src/a.js': 'x\n', 'odd/tasks/f.md': 'x\n' })
  const afuera = path.join(PRUEBAS, 'afuera.txt')
  const leer = (ruta, entrada = {}, { rol = 'orquestador', ...extra } = {}) =>
    evaluar({ tool_name: 'Read', tool_input: { file_path: ruta, ...entrada }, ...extra }, rol, raiz)
  const src = path.join(raiz, 'src', 'a.js')
  const marcar = (contenido) => {
    fs.mkdirSync(path.dirname(marcaDe(raiz)), { recursive: true })
    fs.writeFileSync(marcaDe(raiz), contenido)
  }
  try {
    marcar(JSON.stringify({ tamano: 'grande' }))
    // Niegan: sin limit, con offset y sin limit, o con limit mayor que 120. El motivo manda a los tramos del explorador.
    for (const entrada of [{}, { offset: 50 }, { limit: 200 }, { limit: 121 }, { limit: '500' }]) {
      assert.match(leer(src, entrada) ?? 'pasó', /tarea grande: no leas código.*tramos del explorador.*limit/s, JSON.stringify(entrada))
    }
    // Pasan: limit acotado, el documento de la feature, fuera del repo y los demás roles.
    for (const limit of [120, 40, '60']) assert.equal(leer(src, { limit }), null, `limit ${limit}`)
    assert.equal(leer(path.join(raiz, 'odd', 'tasks', 'f.md')), null)
    assert.equal(leer(afuera), null)
    assert.equal(leer(src, {}, { rol: 'ejecutor' }), null)
    assert.equal(leer(src, {}, { rol: 'revisor' }), null)
    assert.equal(leer(src, {}, { agent_type: 'qcc-odd-explorador' }), null)
    assert.equal(leer(src, {}, { agent_id: 'a1' }), null)
    // Ante la duda pasa: un Read de PDF con pages, sin tool_input o con limit que no es un número.
    assert.equal(leer(src, { pages: '1-3' }), null)
    assert.equal(evaluar({ tool_name: 'Read' }, 'orquestador', raiz), null)
    assert.equal(leer(src, { limit: 'mucho' }), null)
    assert.match(leer(src, { limit: null }) ?? 'pasó', /tarea grande/)
    // Una ruta relativa se resuelve contra el cwd del evento.
    assert.match(leer('src/a.js', {}, { cwd: raiz }) ?? 'pasó', /tarea grande/)
    // Con marca chico, sin tamaño, ilegible o sin corrida abierta no niega.
    for (const contenido of [JSON.stringify({ tamano: 'chico' }), '{}', 'no es json']) {
      marcar(contenido)
      assert.equal(leer(src), null, contenido)
    }
    marcar(JSON.stringify({ tamano: 'grande' }))
    fs.rmSync(marcaDe(raiz), { force: true })
    assert.equal(leer(src), null)
  } finally {
    fs.rmSync(marcaDe(raiz), { force: true })
  }
})

test('guardia: reglas del proyecto para los tres roles, con respaldo en la config de /qcc-implementador', () => {
  const raiz = repo('reglas', {
    '.claude/qcc-implementador-odd.json': JSON.stringify({ guardia: { protegidos: { 'src/gen.ts': 'lo genera el build' }, scriptsNegados: ['db:*'] } }),
    '.claude/qcc-implementador.json': JSON.stringify({ guardia: { inmutables: ['migraciones/'], scriptsNegados: ['otro'] } }),
    'migraciones/001.sql': 'x',
    'src/gen.ts': 'x',
    'package.json': '{}',
  })
  const reglas = reglasDelProyecto(raiz)
  assert.deepEqual(reglas.scriptsNegados, ['db:*'])
  assert.deepEqual(reglas.inmutables, ['migraciones/'])
  assert.deepEqual(reglas.origen, { protegidos: '.claude/qcc-implementador-odd.json', inmutables: '.claude/qcc-implementador.json', scriptsNegados: '.claude/qcc-implementador-odd.json' })
  const editar = (rol, ruta) => evaluar({ tool_name: 'Write', tool_input: { file_path: path.join(raiz, ruta) } }, rol, raiz)
  fs.mkdirSync(path.dirname(marcaDe(raiz)), { recursive: true })
  fs.writeFileSync(marcaDe(raiz), '{}')
  try {
    for (const rol of ['ejecutor', 'orquestador']) {
      assert.match(editar(rol, 'src/gen.ts') ?? 'pasó', /protegido por el proyecto \(src\/gen\.ts\): lo genera el build/, rol)
      assert.match(editar(rol, 'migraciones/001.sql') ?? 'pasó', /inmutable en el proyecto/, rol)
      // Una migración nueva, sin versionar, sí se escribe.
      assert.equal(editar(rol, 'migraciones/002.sql'), null, rol)
    }
    for (const rol of ['ejecutor', 'revisor', 'orquestador']) {
      assert.match(motivoComando('pnpm run db:push', { rol, raiz }) ?? 'pasó', /script negado por el proyecto \(\.claude\/qcc-implementador-odd\.json\)/, rol)
      assert.equal(motivoComando('npm run otro', { rol, raiz }), null, rol)
    }
  } finally {
    fs.rmSync(marcaDe(raiz), { force: true })
  }

  const ini = correr(ODD, raiz, '--inicio')
  assert.match(ini.salida, /REGLAS DEL PROYECTO: \n- protegido: src\/gen\.ts — lo genera el build \(\.claude\/qcc-implementador-odd\.json\)\n- inmutables \(los versionados\): migraciones\/ \(\.claude\/qcc-implementador\.json\)\n- scripts negados: db:\* \(\.claude\/qcc-implementador-odd\.json\)\n/)
  assert.ok(fs.existsSync(marcaDe(raiz)))
  correr(ODD, raiz, '--cierre', '--base', linea(ini.salida, 'ODD_BASE='), '--resultado', 'COMPLETO')
  assert.ok(!fs.existsSync(marcaDe(raiz)))
  assert.match(correr(ODD, repo('sin-reglas', { 'a.txt': '' }), '--inicio').salida, /REGLAS DEL PROYECTO: ninguna/)
})

for (const [rol, comandos] of Object.entries(PASAN)) {
  test(`guardia: ${rol} pasa lo habitual`, () => {
    for (const cmd of comandos) assert.equal(motivoComando(cmd, { rol, raiz: RAIZ }), null, cmd)
  })
}

for (const [rol, casos] of Object.entries(NIEGAN)) {
  test(`guardia: ${rol} niega lo prohibido`, () => {
    for (const [cmd, motivo] of casos) assert.match(motivoComando(cmd, { rol, raiz: RAIZ }) ?? 'pasó', motivo, cmd)
  })
}

test('guardia: Edit y Write', () => {
  const editar = (rol, ruta) => evaluar({ tool_name: 'Edit', tool_input: { file_path: ruta } }, rol, RAIZ)
  assert.equal(editar('ejecutor', path.join(RAIZ, 'flujos-odd', 'x.js')), null)
  assert.equal(editar('ejecutor', path.join(os.tmpdir(), 'x.js')), null)
  assert.match(editar('ejecutor', path.join(RAIZ, '.env')), /secretos/)
  assert.match(editar('ejecutor', path.join(RAIZ, '.claude', 'settings.json')), /configuración/)
  assert.match(editar('ejecutor', path.join(RAIZ, '.git', 'config')), /\.git/)
  assert.match(editar('ejecutor', path.join(path.dirname(RAIZ), 'otro.js')), /fuera del repo/)
  assert.match(editar('revisor', path.join(RAIZ, 'flujos-odd', 'x.js')), /no edita/)
  assert.equal(evaluar({ tool_name: 'Read', tool_input: { file_path: '.env' } }, 'ejecutor', RAIZ), null)
})

test('guardia: tramos con comillas y sustituciones', () => {
  assert.deepEqual(tramosDe('a && b | c; d'), ['a', 'b', 'c', 'd'])
  assert.deepEqual(tramosDe('echo "a && b"'), ['echo "a && b"'])
  assert.deepEqual(tramosDe('echo $(git push)'), ['echo  __SUST__', 'git push'])
  // El cuerpo de un heredoc no se parte ni se evalúa; la cabecera sí, sin el operador.
  assert.deepEqual(tramosDe("cat <<'EOF' > x\na && b | c\nEOF\necho fin"), ['cat   > x', 'echo fin'])
  assert.deepEqual(tramosDe('cat <<-FIN\n\ta; b\n\tFIN\nls'), ['cat', 'ls'])
  assert.deepEqual(tramosDe('cat <<<"a; b"'), ['cat <<<"a; b"'])
})

test('guardia: el ejecutor tampoco ve redirecciones en =>, comillas ni heredocs', () => {
  for (const cmd of SIN_REDIRECCION) assert.equal(motivoComando(cmd, { rol: 'ejecutor', raiz: RAIZ }), null, cmd)
})

test('guardia: el hook imprime deny solo cuando niega', () => {
  const hook = (rol, evento) => spawnSync(process.execPath, [GUARDIA, rol], { input: JSON.stringify(evento), encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: RAIZ } }).stdout
  const negado = JSON.parse(hook('ejecutor', { tool_name: 'Bash', tool_input: { command: 'git push' } }))
  assert.equal(negado.hookSpecificOutput.permissionDecision, 'deny')
  assert.match(negado.hookSpecificOutput.permissionDecisionReason, /Guardia \/qcc-implementador-odd: git push/)
  assert.equal(hook('ejecutor', { tool_name: 'Bash', tool_input: { command: 'git status' } }), '')
  assert.equal(spawnSync(process.execPath, [GUARDIA, 'ejecutor'], { input: 'no es json', encoding: 'utf8' }).stdout, '')
})

// ── verificar ───────────────────────────────────────────────────────────────

test('verificar: pasos de la config, detectados o ninguno', () => {
  const conConfig = repo('v-config', { '.claude/qcc-implementador-odd.json': JSON.stringify({ verificar: [{ nombre: 'a', cmd: 'x', timeoutSeg: 5 }, { cmd: '' }] }) })
  assert.deepEqual(pasosDe(conConfig).pasos, [{ nombre: 'a', cmd: 'x', timeoutSeg: 5 }])
  const js = repo('v-js', { 'package.json': JSON.stringify({ scripts: { test: 'vitest run', lint: 'eslint .', tsc: 'tsc', dev: 'vite' } }), 'pnpm-lock.yaml': '' })
  assert.deepEqual(pasosDe(js).pasos.map((p) => p.cmd), ['pnpm run tsc', 'pnpm run lint', 'pnpm run test'])
  const sinTest = repo('v-sin-test', { 'package.json': JSON.stringify({ scripts: { test: 'echo "Error: no test specified" && exit 1' } }) })
  assert.deepEqual(pasosDe(sinTest).pasos, [])
  assert.deepEqual(pasosDe(repo('v-go', { 'go.mod': 'module x' })).pasos.map((p) => p.nombre), ['build', 'test'])
  assert.equal(pasosDe(repo('v-nada', { 'a.txt': '' })).origen, 'ninguno')
})

test('verificar: colaDe quita colores y corta', () => {
  assert.deepEqual(colaDe('\x1b[31ma\x1b[0m\n\nb\nc\n', 2), { lineas: ['b', 'c'], cortadas: 1 })
})

test('verificar: corre todos los pasos y resume', () => {
  const raiz = repo('v-corre', {
    '.claude/qcc-implementador-odd.json': JSON.stringify({
      verificar: [
        { nombre: 'bien', cmd: 'node -e "console.log(\'ok\')"' },
        { nombre: 'mal', cmd: 'node -e "console.error(\'falla clave\'); process.exit(2)"' },
        { nombre: 'despues', cmd: 'node -e "0"' },
      ],
    }),
  })
  const r = correr(VERIFICAR, raiz)
  assert.equal(r.codigo, 1)
  assert.match(r.salida, /^RESULTADO: ROJO \(mal\)/)
  assert.match(r.salida, /✓ bien/)
  assert.match(r.salida, /✗ mal · \d+ s · exit 2/)
  assert.match(r.salida, /✓ despues/)
  assert.match(r.salida, /falla clave/)
  assert.doesNotMatch(r.salida, /^ok$/m)
  const verde = repo('v-verde', { '.claude/qcc-implementador-odd.json': JSON.stringify({ verificar: [{ nombre: 'bien', cmd: 'node -e "0"' }] }) })
  assert.match(correr(VERIFICAR, verde).salida, /RESULTADO: VERDE/)
  const nada = correr(VERIFICAR, repo('v-sin-pasos', { 'a.txt': '' }))
  assert.equal(nada.codigo, 3)
  assert.match(nada.salida, /RESULTADO: SIN PASOS/)
})

test('verificar: corta un paso que pasa su tope', () => {
  const raiz = repo('v-tope', { '.claude/qcc-implementador-odd.json': JSON.stringify({ verificar: [{ nombre: 'lento', cmd: 'node -e "setTimeout(() => {}, 60000)"', timeoutSeg: 1 }] }) })
  const r = correr(VERIFICAR, raiz)
  assert.equal(r.codigo, 1)
  assert.match(r.salida, /✗ lento · \d+ s · cortado a los 1 s/)
})

// ── odd ─────────────────────────────────────────────────────────────────────

test('odd: opcionesDe', () => {
  assert.deepEqual(opcionesDe(['--diff', 'abc', '--', 'a.js', 'b.js']).rutas, ['a.js', 'b.js'])
  assert.equal(opcionesDe(['--diff', 'abc']).base, 'abc')
  assert.equal(opcionesDe(['--diff', 'abc']).stat, false)
  assert.deepEqual([opcionesDe(['--diff', 'abc', '--stat', '--', 'a.js']).stat, opcionesDe(['--diff', 'abc', '--stat']).base], [true, 'abc'])
  const o = opcionesDe(['--cierre', '--base', 'abc', '--resultado', 'COMPLETO', '--riesgo', 'ítem 3 (parser compartido)'])
  assert.equal(o.modo, 'cierre')
  assert.equal(o.riesgo, 'ítem 3 (parser compartido)')
  assert.equal(opcionesDe(['--cierre', '--base', '--resultado', 'x']).base, undefined)
  assert.equal(opcionesDe(['--ultimos', '3']).ultimos, 3)
  assert.equal(opcionesDe(['--ultimos']).ultimos, 10)
  assert.equal(opcionesDe(['--copia-base', 'abc']).base, 'abc')
  assert.deepEqual(opcionesDe(['--limpiar', '--', '/tmp/x']), { ...opcionesDe(['--limpiar']), rutas: ['/tmp/x'] })
  assert.equal(opcionesDe(['--limpiar']).modo, 'limpiar')
  assert.equal(opcionesDe([]).modo, null)
  // --previsto lleva su valor propio, como --diff <BASE>; sin valor queda undefined.
  assert.deepEqual([opcionesDe(['--previsto', 'grande']).modo, opcionesDe(['--previsto', 'grande']).tamano], ['previsto', 'grande'])
  assert.equal(opcionesDe(['--previsto', '--base', 'abc']).tamano, undefined)
  assert.equal(opcionesDe(['--previsto']).tamano, undefined)
  assert.equal(opcionesDe(['--plan', '--tamano', 'chico']).tamano, 'chico')
  assert.equal(opcionesDe(['--cancelar']).modo, 'cancelar')
})

test('odd: criticosLegibles, tareasDe, sumaNumstat y recortar', () => {
  assert.deepEqual(
    criticosLegibles([{ rutas: ['src/auth/'], excepto: ['src/auth/textos.ts'], riesgo: [2], motivo: 'auth' }, { rutas: ['a/*.md'], si: 'cambia su frontmatter' }, { rutas: [] }, null]),
    ['- src/auth/ (excepto src/auth/textos.ts) · ítem 2 — auth', '- a/*.md si cambia su frontmatter'],
  )
  assert.deepEqual(tareasDe('# X\n## Specs\n- [ ] no\n## Tasks\n- [x] T1\n- [ ] T2\n  - [ ] T3\n## Log\n- [ ] no\n'), { abiertas: 2, total: 3 })
  assert.deepEqual(tareasDe('sin tareas'), { abiertas: 0, total: 0 })
  assert.deepEqual(sumaNumstat('3\t1\ta.js\n-\t-\timg.png\n10\t0\tb.md\n'), { archivos: 3, mas: 13, menos: 1 })
  assert.deepEqual(recortar('a\nb\nc\n', 2), { texto: 'a\nb', sobran: 1 })
})

test('odd: fila y línea del listado', () => {
  const fila = filaDeCorrida({ t: '2026-10-20T10:00:00.000Z', raiz: '/x/repo', base: 'B', resultado: 'COMPLETO', tamano: 'chico', riesgo: 'ninguno', revision: 'omitida', cambios: { archivos: 1, mas: 2, menos: 0 } })
  assert.deepEqual(fila, { v: 1, t: '2026-10-20T10:00:00.000Z', raiz: '/x/repo', base: 'B', resultado: 'COMPLETO', tamano: 'chico', riesgo: 'ninguno', revision: 'omitida', cambios: { archivos: 1, mas: 2, menos: 0 } })
  assert.equal(lineaDeCorrida(fila), '2026-10-20 10:00 · repo · sin costo · chico · Riesgo: ninguno · revisión omitida · COMPLETO · +2 −0')
  const costo = {
    usd: 0.38,
    minutos: 1.7,
    tokens: { entrada: 36, leidos: 564338, escritos: 66891, salida: 1756 },
    roles: { orquestador: { pedidos: 10, usd: 0.2, agentes: 0 }, revisor: { pedidos: 6, usd: 0.18, agentes: 2 } },
    hallazgos: { revisor: [{ problemas: 2, observaciones: 1 }, { problemas: 0, observaciones: 0 }] },
  }
  assert.equal(
    lineaDeCorrida({ ...fila, riesgo: 'ítem 2 (auth)', revision: 'APROBADO', costo }),
    '2026-10-20 10:00 · repo · $0,38 · 1,7 min · orquestador $0,20 (10 pedidos) · revisor $0,18 (×2) · 564k leídos · 67k escritos · 1,8k salida · chico · Riesgo: ítem 2 (auth) · revisión APROBADO · hallazgos 2p/1o → 0p/0o · COMPLETO · +2 −0',
  )
  const real = { ...costo, usd: 0.4, minutos: 2 }
  assert.equal(
    lineaDeCorrida({ ...fila, costo, costoReal: real, proceso: 'sin --diff' }),
    '2026-10-20 10:00 · repo · $0,40 real · $0,38 al cierre · 2,0 min · orquestador $0,20 (10 pedidos) · revisor $0,18 (×2) · 564k leídos · 67k escritos · 1,8k salida · chico · Riesgo: ninguno · revisión omitida · hallazgos 2p/1o → 0p/0o · PROCESO: sin --diff · COMPLETO · +2 −0',
  )
  assert.equal(filaDeCorrida({ t: 'x', proceso: 'ok', sesion: '/s.jsonl' }).sesion, '/s.jsonl')
})

test('odd: --inicio, --diff, --cierre y --ultimos sobre un repo real', () => {
  const raiz = repo('modos', {
    'a.txt': 'uno\n',
    '.claude/qcc-implementador-odd.json': JSON.stringify({ verificar: [{ nombre: 'test', cmd: 'x' }], criticos: [{ rutas: ['src/auth/'], riesgo: [2], motivo: 'auth' }] }),
    'odd/tasks/f.md': '# F\n## Tasks\n- [x] T1\n- [ ] T2\n## Log\n',
  })
  fs.writeFileSync(path.join(raiz, 'sucio.txt'), 'previo\n')

  const ini = correr(ODD, raiz, '--inicio')
  assert.equal(ini.codigo, 0, ini.salida)
  const base = linea(ini.salida, 'ODD_BASE=')
  assert.match(base, /^[0-9a-f]{40}$/)
  assert.match(ini.salida, /sucios previos: 1 \(sucio\.txt\)/)
  assert.match(ini.salida, /\nCÓDIGO: 0 archivos · EXPLORAR: auto\n/)
  assert.equal(cuentaCodigo('src/a.js\nsrc/b.TS\nREADME.md\nx.mjs\nestilos.css\nmigra.sql\n'), 4)
  assert.deepEqual([explorarDe({ explorar: 'siempre' }), explorarDe({ explorar: 'nunca' }), explorarDe({ explorar: 'a veces' }), explorarDe({})], ['siempre', 'nunca', 'auto', 'auto'])
  assert.match(ini.salida, /- src\/auth\/ · ítem 2 — auth/)
  assert.match(ini.salida, /VERIFICAR: test/)
  assert.match(ini.salida, /TAREAS ABIERTAS: odd\/tasks\/f\.md \(1 de 2 abiertas\)/)

  // El sucio previo está en la BASE: el diff muestra solo lo nuevo, archivos sin versionar incluidos.
  assert.match(correr(ODD, raiz, '--diff', base).salida, /DIFF: sin cambios/)
  fs.writeFileSync(path.join(raiz, 'a.txt'), 'uno\ndos\n')
  fs.writeFileSync(path.join(raiz, 'nuevo.txt'), 'hola\n')
  const d = correr(ODD, raiz, '--diff', base)
  assert.match(d.salida, /a\.txt/)
  assert.match(d.salida, /nuevo\.txt/)
  assert.doesNotMatch(d.salida, /sucio\.txt/)
  assert.doesNotMatch(correr(ODD, raiz, '--diff', base, '--', 'a.txt').salida, /nuevo\.txt/)
  // Con --stat, solo el resumen: ni el diff entero ni el contenido.
  const s = correr(ODD, raiz, '--diff', base, '--stat', '--', 'a.txt')
  assert.match(s.salida, /^CONTEXTO: sin datos\na\.txt \| 1 \+\n 1 file changed, 1 insertion\(\+\)\n$/)
  assert.match(d.salida, /\+dos/)

  const c = correr(ODD, raiz, '--cierre', '--base', base, '--resultado', 'COMPLETO', '--tamano', 'chico', '--riesgo', 'ninguno', '--revision', 'omitida', '--titulo', 'Prueba')
  assert.equal(c.codigo, 0, c.salida)
  assert.match(c.salida, /CAMBIOS: 2 archivo\(s\) · \+2 −0/)
  assert.match(c.salida, /COSTO: sin datos/)
  const fila = JSON.parse(fs.readFileSync(path.join(PRUEBAS, 'registros', 'odd.jsonl'), 'utf8').trim().split('\n').at(-1))
  assert.equal(fila.titulo, 'Prueba')
  assert.equal(fila.tamano, 'chico')
  assert.deepEqual(fila.cambios, { archivos: 2, mas: 2, menos: 0 })
  // Repetir --cierre de la misma corrida reemplaza su fila.
  const filas = () => fs.readFileSync(path.join(PRUEBAS, 'registros', 'odd.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  const antes = filas().length
  correr(ODD, raiz, '--cierre', '--base', base, '--resultado', 'COMPLETO', '--tamano', 'chico', '--riesgo', 'ninguno', '--revision', 'omitida', '--titulo', 'Prueba')
  assert.equal(filas().length, antes)
  assert.equal(filas().filter((f) => f.base === base).length, 1)
  assert.match(correr(ODD, raiz, '--ultimos', '5').salida, /CORRIDAS \(últimas \d+ de \d+\):\n(?: {2}.*\n)* {2}.* · modos · sin costo · chico · Riesgo: ninguno · revisión omitida · COMPLETO · \+2 −0 · Prueba/)
  // La foto no toca el índice: nada quedó preparado.
  assert.equal(execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: raiz, encoding: 'utf8' }).trim(), '')
})

test('odd: --cancelar cierra la marca sin anotar la corrida', () => {
  const raiz = repo('cancelar', { 'a.txt': 'uno\n' })
  const registro = path.join(PRUEBAS, 'registros', 'odd.jsonl')
  const leerRegistro = () => (fs.existsSync(registro) ? fs.readFileSync(registro, 'utf8') : '')
  const antes = leerRegistro()
  const ini = correr(ODD, raiz, '--inicio')
  assert.equal(ini.codigo, 0, ini.salida)
  assert.equal(fs.existsSync(marcaDe(raiz)), true)

  const c = correr(ODD, raiz, '--cancelar')
  assert.equal(c.codigo, 0, c.salida)
  assert.equal(c.salida.trim(), 'CANCELADA: corrida cerrada sin anotar')
  assert.equal(fs.existsSync(marcaDe(raiz)), false)
  assert.equal(leerRegistro(), antes)

  const otra = correr(ODD, raiz, '--cancelar')
  assert.equal(otra.codigo, 0, otra.salida)
  assert.equal(otra.salida.trim(), 'CANCELADA: no había corrida abierta')
  assert.equal(leerRegistro(), antes)
})

test('odd: --copia-base copia la BASE y --limpiar borra solo dentro del temporal', () => {
  const raiz = repo('copia', { 'a.txt': 'uno\n', 'sub/b.txt': 'b\n' })
  fs.writeFileSync(path.join(raiz, 'nuevo.txt'), 'sin versionar\n')
  const base = linea(correr(ODD, raiz, '--inicio').salida, 'ODD_BASE=')
  fs.writeFileSync(path.join(raiz, 'a.txt'), 'cambiado\n')

  const c = correr(ODD, raiz, '--copia-base', base)
  assert.equal(c.codigo, 0, c.salida)
  const copia = linea(c.salida, 'ODD_COPIA=')
  const leer = (ruta) => fs.readFileSync(path.join(copia, ruta), 'utf8').replaceAll('\r\n', '\n')
  assert.equal(leer('a.txt'), 'uno\n')
  assert.equal(leer('sub/b.txt'), 'b\n')
  assert.equal(leer('nuevo.txt'), 'sin versionar\n')
  assert.equal(fs.readFileSync(path.join(raiz, 'a.txt'), 'utf8'), 'cambiado\n')
  assert.equal(execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: raiz, encoding: 'utf8' }).trim(), '')

  // Una ruta de Git Bash (`/tmp/…`) cuenta como del temporal; fuera de él, o el temporal mismo, no se borra.
  const suelto = fs.mkdtempSync(path.join(os.tmpdir(), 'odd-limpiar-'))
  const fuera = path.join(RAIZ, 'odd-no-existe')
  const l = correr(ODD, raiz, '--limpiar', '--', copia, `/tmp/${path.basename(suelto)}`, fuera, os.tmpdir(), path.join(os.tmpdir(), 'odd-no-existe'))
  assert.equal(l.codigo, 0, l.salida)
  assert.equal(fs.existsSync(copia), false)
  assert.equal(fs.existsSync(suelto), false)
  assert.match(l.salida, /LIMPIADOS: 2/)
  assert.match(l.salida, /NO BORRADOS: .*odd-no-existe \(fuera del temporal\) · .* \(es el temporal mismo\)/)

  assert.match(correr(ODD, raiz, '--copia-base', 'deadbeef').salida, /ERROR: BASE desconocida/)
  assert.match(correr(ODD, raiz, '--limpiar').salida, /ERROR: faltan las rutas/)
})

test('odd: errores', () => {
  const raiz = repo('errores', { 'a.txt': 'x\n' })
  const sinBase = correr(ODD, raiz, '--diff', 'deadbeef')
  assert.equal(sinBase.codigo, 1)
  assert.match(sinBase.salida, /ERROR: BASE desconocida/)
  const base = linea(correr(ODD, raiz, '--inicio').salida, 'ODD_BASE=')
  assert.match(correr(ODD, raiz, '--cierre', '--base', base, '--resultado', 'TAL').salida, /ERROR: --resultado/)
  assert.match(correr(ODD, raiz, '--cierre', '--resultado', 'COMPLETO').salida, /ERROR: falta la BASE/)
  assert.match(correr(ODD, raiz).salida, /ERROR: uso:/)
})

test('odd: --plan exige los 6 ítems de riesgo, un motivo por cada sí y bordes con riesgo', () => {
  assert.deepEqual(riesgoDe('1:sí migración v3→v4; 2:no;3: si quién edita;4:no;5:NO;6:no'), { 1: 'migración v3→v4', 2: null, 3: 'quién edita', 4: null, 5: null, 6: null })
  assert.throws(() => riesgoDe('1:no;2:no;3:no'), /faltan los ítems 4, 5, 6/)
  assert.throws(() => riesgoDe('1:sí;2:no;3:no;4:no;5:no;6:no'), /ítem 1 dice sí sin motivo/)
  assert.throws(() => riesgoDe('1:no;1:no;2:no;3:no;4:no;5:no;6:no'), /ítem 1 está dos veces/)
  assert.throws(() => riesgoDe('7:no;1:no;2:no;3:no;4:no;5:no;6:no'), /N de 1 a 6/)
  assert.throws(() => riesgoDe('1:quizá;2:no;3:no;4:no;5:no;6:no'), /no es «N:sí <motivo>»/)
  assert.throws(() => riesgoDe(undefined), /faltan los ítems 1, 2, 3, 4, 5, 6/)

  const riesgo = '1:sí migración;2:sí permisos;3:no;4:no;5:no;6:no'
  assert.deepEqual(lineasDePlan({ tamano: 'chico', reglas: '15', riesgo, bordes: 'ausente | v3' }), [
    'AVISO: 15 reglas → grande',
    'TAMAÑO: chico · 15 reglas',
    'RIESGO PREVISTO: ítems 1, 2 (1: migración · 2: permisos)',
    'BORDES: ausente | v3',
  ])
  assert.deepEqual(lineasDePlan({ tamano: 'grande', reglas: '3', riesgo: '1:no;2:no;3:sí parser;4:no;5:no;6:no', bordes: 'vacío' }), [
    'TAMAÑO: grande · 3 reglas',
    'GRANDE: el código lo edita qcc-odd-ejecutor; tú solo odd/tasks/ (la guardia niega lo demás)',
    'RIESGO PREVISTO: ítem 3 (3: parser)',
    'BORDES: vacío',
  ])
  assert.deepEqual(lineasDePlan({ tamano: 'chico', reglas: '8', riesgo: '1:no;2:no;3:no;4:no;5:no;6:no' }), ['TAMAÑO: chico · 8 reglas', 'RIESGO PREVISTO: ninguno', 'BORDES: no aplica'])
  assert.throws(() => lineasDePlan({ tamano: 'chico', reglas: '2', riesgo }), /--bordes es obligatorio/)
  assert.throws(() => lineasDePlan({ tamano: 'mediano', reglas: '2', riesgo, bordes: 'x' }), /--tamano/)
  assert.throws(() => lineasDePlan({ tamano: 'chico', riesgo, bordes: 'x' }), /--reglas/)

  const raiz = repo('plan', { 'a.txt': 'x\n' })
  const base = linea(correr(ODD, raiz, '--inicio').salida, 'ODD_BASE=')
  const ok = correr(ODD, raiz, '--plan', '--base', base, '--tamano', 'chico', '--reglas', '2', '--riesgo', riesgo, '--bordes', 'ausente')
  assert.equal(ok.codigo, 0, ok.salida)
  assert.match(ok.salida, /^TAMAÑO: chico · 2 reglas\nRIESGO PREVISTO: ítems 1, 2 \(1: migración · 2: permisos\)\nBORDES: ausente\nCONTEXTO: sin datos\n$/)
  const sinItem = correr(ODD, raiz, '--plan', '--base', 'b0de', '--tamano', 'chico', '--reglas', '2', '--riesgo', '1:no;2:no;3:no;4:no;5:no', '--bordes', 'x')
  assert.equal(sinItem.codigo, 2)
  assert.match(sinItem.salida, /^ERROR: --riesgo: faltan los ítems 6/)
  assert.equal(correr(ODD, raiz, '--plan', '--tamano', 'chico', '--reglas', '2', '--riesgo', riesgo).codigo, 2)
  assert.match(correr(ODD, raiz, '--plan', '--base', 'basura', '--tamano', 'chico', '--reglas', '2', '--riesgo', riesgo, '--bordes', 'x').salida, /ERROR: BASE desconocida/)
})

test('odd: --previsto anota el tamaño en la marca como --plan, sin exigir base', () => {
  const raiz = repo('previsto', { 'a.txt': 'x\n' })
  const marca = () => JSON.parse(fs.readFileSync(marcaDe(raiz), 'utf8'))
  try {
    // Sin marca (sin --inicio) no hace nada y no falla.
    const sin = correr(ODD, raiz, '--previsto', 'grande')
    assert.equal(sin.codigo, 0, sin.salida)
    assert.equal(fs.existsSync(marcaDe(raiz)), false)

    const base = linea(correr(ODD, raiz, '--inicio').salida, 'ODD_BASE=')
    const grande = correr(ODD, raiz, '--previsto', 'grande')
    assert.equal(grande.codigo, 0, grande.salida)
    assert.match(grande.salida, /^PREVISTO: grande\n.*Read.*Edit/)
    assert.equal(marca().tamano, 'grande')
    assert.equal(marca().base, base)
    // Igual que --plan --tamano grande.
    const previsto = marca()
    correr(ODD, raiz, '--plan', '--base', base, '--tamano', 'chico', '--reglas', '2', '--riesgo', '1:no;2:no;3:no;4:no;5:no;6:no')
    assert.equal(marca().tamano, 'chico')
    correr(ODD, raiz, '--plan', '--base', base, '--tamano', 'grande', '--reglas', '2', '--riesgo', '1:no;2:no;3:no;4:no;5:no;6:no')
    assert.equal(marca().tamano, previsto.tamano)

    const chico = correr(ODD, raiz, '--previsto', 'chico')
    assert.equal(chico.codigo, 0, chico.salida)
    assert.equal(chico.salida, 'PREVISTO: chico\n')
    assert.equal(marca().tamano, 'chico')

    // Un valor que no es chico|grande da el mismo ERROR que --plan y no toca la marca.
    const antes = fs.readFileSync(marcaDe(raiz), 'utf8')
    for (const args of [['--previsto'], ['--previsto', ''], ['--previsto', 'mediano'], ['--previsto', '--base', base]]) {
      const r = correr(ODD, raiz, ...args)
      assert.equal(r.codigo, 2, args.join(' '))
      assert.equal(r.salida, 'ERROR: --tamano tiene que ser chico o grande\n', args.join(' '))
      assert.equal(fs.readFileSync(marcaDe(raiz), 'utf8'), antes, args.join(' '))
    }
  } finally {
    fs.rmSync(marcaDe(raiz), { force: true })
  }
})

test('odd: CONTEXTO, PROCESO y costo real con un transcript de juguete', () => {
  const raiz = repo('contexto', { 'src/a.js': 'uno\n' })
  const base = linea(correr(ODD, raiz, '--inicio').salida, 'ODD_BASE=')
  const carpeta = path.join(PRUEBAS, 'claude', 'projects', path.resolve(raiz).replace(/[^a-zA-Z0-9]/g, '-'))
  fs.mkdirSync(carpeta, { recursive: true })
  const archivo = path.join(carpeta, 's1.jsonl')
  const { filas } = transcript([PLAN, ['Edit', { file_path: path.join(raiz, 'src', 'a.js') }, 160_000]], { base })
  fs.writeFileSync(archivo, jsonl(filas))

  const plan = correr(ODD, raiz, '--plan', '--base', base, '--tamano', 'grande', '--reglas', '2', '--riesgo', '1:no;2:no;3:no;4:no;5:no;6:no')
  assert.match(plan.salida, /CONTEXTO: 160k · > 150k: lo que falta va a qcc-odd-ejecutor\n$/)
  fs.writeFileSync(path.join(raiz, 'src', 'a.js'), 'dos\n')
  assert.match(correr(ODD, raiz, '--diff', base).salida, /^CONTEXTO: 160k · > 150k/)

  const c = correr(ODD, raiz, '--cierre', '--base', base, '--resultado', 'COMPLETO', '--tamano', 'grande', '--riesgo', 'ninguno', '--revision', 'omitida')
  assert.equal(c.codigo, 0, c.salida)
  // --cierre le pasa el tamaño a proceso.mjs: con grande, también los desvíos de una tarea grande.
  const esperado = 'sin verificar.mjs · sin --diff · contexto máx. 160k sin ejecutor · grande sin explorador · grande sin ejecutor · grande: editó código inline: 1'
  assert.match(c.salida, new RegExp(`PROCESO: ${esperado.replaceAll('.', '\\.')}\n`))
  assert.match(c.salida, /CONTEXTO: 160k/)
  const fila = JSON.parse(fs.readFileSync(path.join(PRUEBAS, 'registros', 'odd.jsonl'), 'utf8').trim().split('\n').at(-1))
  assert.equal(fila.proceso, esperado)
  assert.equal(path.resolve(fila.sesion), path.resolve(archivo))

  // El reporte, después de --cierre y antes del siguiente mensaje del usuario, entra en el costo real.
  const despues = (s) => new Date(Date.parse(fila.t) + s * 1000).toISOString()
  const reporte = { type: 'assistant', timestamp: despues(1), message: { id: 'reporte', model: 'claude-sonnet-5-5', usage: usoCon(100_000), content: [{ type: 'text', text: 'Reporte' }] } }
  const otro = { type: 'assistant', timestamp: despues(3), message: { id: 'otro', model: 'claude-sonnet-5-5', usage: usoCon(100_000), content: [{ type: 'text', text: 'otra cosa' }] } }
  fs.appendFileSync(archivo, jsonl([reporte, { type: 'user', timestamp: despues(2), message: { role: 'user', content: 'gracias' } }, otro]))
  const u = correr(ODD, raiz, '--ultimos', '1').salida
  const alCierre = fila.costo.usd
  const real = alCierre + costoDePedido(usoCon(100_000), 'claude-sonnet-5-5')
  assert.match(u, new RegExp(`\\$${real.toFixed(2).replace('.', ',')} real · \\$${alCierre.toFixed(2).replace('.', ',')} al cierre · `))
  assert.match(u, /PROCESO: sin verificar\.mjs/)

  // --cierre le pasa el riesgo a proceso.mjs: una grande con riesgo no exige el --diff entero.
  const conRiesgo = correr(ODD, raiz, '--cierre', '--base', base, '--resultado', 'COMPLETO', '--tamano', 'grande', '--riesgo', 'ítem 2 (x)', '--revision', 'omitida')
  assert.equal(conRiesgo.codigo, 0, conRiesgo.salida)
  assert.match(conRiesgo.salida, /PROCESO: sin verificar\.mjs · contexto máx\./)
  assert.doesNotMatch(conRiesgo.salida, /sin --diff/)
})

// ── costo ───────────────────────────────────────────────────────────────────

test('costo: precio por pedido con caché de 1 h y de 5 min', () => {
  const uso = { input_tokens: 1e6, cache_read_input_tokens: 0, cache_creation_input_tokens: 2e6, output_tokens: 1e6, cache_creation: { ephemeral_5m_input_tokens: 1e6, ephemeral_1h_input_tokens: 1e6 } }
  assert.equal(costoDePedido(uso, 'claude-sonnet-5-5'), 2 + 2.5 + 4 + 10)
  assert.equal(costoDePedido(uso, 'otro-modelo'), null)
})

test('costo: encuentra la sesión por ODD_BASE y suma por rol', () => {
  const raiz = path.join(os.tmpdir(), 'repo-odd-costo')
  const proyectos = path.join(PRUEBAS, 'claude-costo', 'projects')
  const sesion = path.join(proyectos, path.resolve(raiz).replace(/[^a-zA-Z0-9]/g, '-'))
  const subagentes = path.join(sesion, 's1', 'subagents')
  fs.mkdirSync(subagentes, { recursive: true })
  const inicio = Date.now() - 600_000
  const en = (s) => new Date(inicio + s * 1000).toISOString()
  const jsonl = (filas) => filas.map((f) => JSON.stringify(f)).join('\n') + '\n'
  const uso = { input_tokens: 10, cache_read_input_tokens: 1000, cache_creation_input_tokens: 500, output_tokens: 100 }
  const turno = (id, s, texto) => ({ type: 'assistant', timestamp: en(s), message: { id, model: 'claude-sonnet-5-5', usage: uso, content: [{ type: 'text', text: texto }] } })
  fs.writeFileSync(path.join(sesion, 's1.jsonl'), jsonl([
    turno('antes', -50, 'de otra corrida'),
    { type: 'user', timestamp: en(0), message: { role: 'user', content: '<command-name>/qcc-implementador-odd</command-name>\n<command-args> x </command-args>' } },
    { type: 'user', timestamp: en(5), message: { role: 'user', content: [{ type: 'tool_result', content: 'ODD_BASE=b0de\nRAMA: …' }] } },
    turno('o1', 10, 'sigo'),
    turno('o1', 11, 'sigo'),
  ]))
  const agente = (nombre, tipo, desde, texto) => {
    fs.writeFileSync(path.join(subagentes, `${nombre}.meta.json`), JSON.stringify({ agentType: tipo }))
    fs.writeFileSync(path.join(subagentes, `${nombre}.jsonl`), jsonl([{ type: 'user', timestamp: en(desde), message: { role: 'user', content: 'DOC: x' } }, turno(`${nombre}-1`, desde + 30, texto)]))
  }
  agente('agent-x', 'qcc-odd-ejecutor', 20, 'ESTADO: HECHO')
  agente('agent-r', 'qcc-odd-revisor', 100, 'VEREDICTO: APROBADO\nPRUEBAS: ninguna\nOBSERVACIONES:\n- src/a.js:3 — clave ausente — login a\n- src/a.js:9 — tiempo — (sin reproducción)')
  agente('agent-viejo', 'qcc-odd-revisor', -40, 'VEREDICTO: RECHAZADO')

  const c = costoDelFlujo(raiz, 'b0de', { proyectos, hasta: en(300) })
  assert.equal(c.inicio, en(0))
  assert.deepEqual(Object.keys(c.roles).sort(), ['ejecutor', 'orquestador', 'revisor'])
  assert.equal(c.roles.orquestador.pedidos, 1)
  assert.deepEqual(c.veredictos, { ejecutor: ['HECHO'], revisor: ['APROBADO'] })
  assert.deepEqual(c.hallazgos, { revisor: [{ problemas: 0, observaciones: 2 }] })
  assert.deepEqual(c.roles.orquestador.tokens, { entrada: 10, leidos: 1000, escritos: 500, salida: 100 })
  assert.deepEqual(c.tokens, { entrada: 30, leidos: 3000, escritos: 1500, salida: 300 })
  assert.equal(costoDelFlujo(raiz, 'otra', { proyectos }), null)
})

test('costo: cuenta PROBLEMAS y OBSERVACIONES del informe del revisor', () => {
  const rechazo = 'VEREDICTO: RECHAZADO\nS#: PEDIDO → no\nPROBLEMAS: (solo si RECHAZADO; uno por línea)\nsrc/a.js:3 — m — r — e\nsrc/b.js:4 — m — r — e\nOBSERVACIONES: ninguna'
  assert.deepEqual(hallazgosDe(rechazo), { problemas: 2, observaciones: 0 })
  assert.deepEqual(hallazgosDe('VEREDICTO: APROBADO\nOBSERVACIONES: una sola, en la línea del campo'), { problemas: 0, observaciones: 1 })
  assert.deepEqual(hallazgosDe('VEREDICTO: APROBADO\nOBSERVACIONES:\n- a\n- b\nBLOQUEOS: la guardia negó algo'), { problemas: 0, observaciones: 2 })
  assert.deepEqual(hallazgosDe(''), { problemas: 0, observaciones: 0 })
  const conRutas = 'VEREDICTO: APROBADO\nOBSERVACIONES:\n- `D:/repo/src/a.js:38`: crear sin clave\n- D:\\repo\\src\\a.js:57 — otro\n- C:/x.js — PEDIDO: algo\n\nUna nota sobre la guardia.'
  assert.deepEqual(hallazgosDe(conRutas), { problemas: 0, observaciones: 3 })
})

test('costo: los informes del revisor van en el orden en que empezaron, no por nombre de archivo', () => {
  const raiz = path.join(os.tmpdir(), 'repo-odd-orden')
  const proyectos = path.join(PRUEBAS, 'claude-orden', 'projects')
  const sesion = path.join(proyectos, path.resolve(raiz).replace(/[^a-zA-Z0-9]/g, '-'))
  const subagentes = path.join(sesion, 's1', 'subagents')
  fs.mkdirSync(subagentes, { recursive: true })
  const { filas, en } = transcript([])
  fs.writeFileSync(path.join(sesion, 's1.jsonl'), jsonl(filas))
  const revisor = (nombre, desde, informe) => {
    fs.writeFileSync(path.join(subagentes, `${nombre}.meta.json`), JSON.stringify({ agentType: 'qcc-odd-revisor' }))
    fs.writeFileSync(path.join(subagentes, `${nombre}.jsonl`), jsonl([{ type: 'user', timestamp: en(desde), message: { role: 'user', content: 'x' } }, { type: 'assistant', timestamp: en(desde + 1), message: { id: nombre, model: 'claude-sonnet-5-5', usage: usoCon(1000), content: [{ type: 'text', text: informe }] } }]))
  }
  revisor('agent-b', 20, 'VEREDICTO: RECHAZADO\nPROBLEMAS:\n- a\n- b\nOBSERVACIONES: ninguna')
  revisor('agent-a', 100, 'VEREDICTO: APROBADO\nOBSERVACIONES: ninguna')
  const c = costoDelFlujo(raiz, 'b0de', { proyectos, hasta: en(300) })
  assert.deepEqual(c.veredictos.revisor, ['RECHAZADO', 'APROBADO'])
  assert.deepEqual(c.hallazgos.revisor, [{ problemas: 2, observaciones: 0 }, { problemas: 0, observaciones: 0 }])
})

test('costo: contextoActual y finDeCorrida', () => {
  const raiz = path.join(os.tmpdir(), 'repo-odd-contexto')
  const proyectos = path.join(PRUEBAS, 'claude-contexto', 'projects')
  const carpeta = path.join(proyectos, path.resolve(raiz).replace(/[^a-zA-Z0-9]/g, '-'))
  fs.mkdirSync(carpeta, { recursive: true })
  const { filas, en } = transcript([PLAN, DIFF, ['Bash', { command: 'git status' }, 90_000]])
  // Un subagente con más contexto no cuenta: es del orquestador.
  filas.push({ type: 'assistant', isSidechain: true, timestamp: en(30), message: { id: 'sub', usage: usoCon(300_000), content: [] } })
  const archivo = path.join(carpeta, 's1.jsonl')
  fs.writeFileSync(archivo, jsonl(filas))
  assert.equal(contextoActual(raiz, 'b0de', { proyectos }), 90_000)
  assert.equal(contextoActual(raiz, 'otra', { proyectos }), null)
  assert.equal(lineaDeContexto(90_000), 'CONTEXTO: 90k')
  assert.equal(lineaDeContexto(150_001), 'CONTEXTO: 150k · > 150k: lo que falta va a qcc-odd-ejecutor')
  assert.equal(lineaDeContexto(null), 'CONTEXTO: sin datos')

  // Hasta el último pedido del orquestador antes del siguiente mensaje del usuario; los tool_result y los isMeta no
  // lo son, y una fila system posterior no estira la corrida.
  assert.equal(finDeCorrida(archivo, en(12)), en(14))
  fs.appendFileSync(archivo, jsonl([{ type: 'user', timestamp: en(40), isMeta: true, message: { content: 'meta' } }, { type: 'assistant', timestamp: en(41), message: { id: 'r', content: [] } }, { type: 'system', timestamp: en(45) }, { type: 'user', timestamp: en(50), message: { content: [{ type: 'text', text: 'hola' }] } }, { type: 'assistant', timestamp: en(51), message: { id: 's', content: [] } }]))
  assert.equal(finDeCorrida(archivo, en(12)), en(41))
  assert.equal(finDeCorrida(archivo, en(60)), en(60))
  assert.equal(finDeCorrida(path.join(carpeta, 'no-existe.jsonl'), en(12)), en(12))
})

// ── proceso ─────────────────────────────────────────────────────────────────

test('proceso: una corrida limpia da ok', () => {
  const raiz = repo('proceso-ok', { 'src/a.js': 'x\n' })
  const { filas, inicio, hasta } = transcript([
    ['Grep', { pattern: 'x' }],
    ['Read', { file_path: path.join(raiz, 'src', 'a.js') }],
    PLAN,
    ['Edit', { file_path: path.join(raiz, 'src', 'a.js') }],
    ['Write', { file_path: path.join(raiz, 'test', 'a.test.js'), content: 'test()' }],
    ['Bash', { command: 'git diff --stat && git log -1 | head -5' }],
    ['Bash', { command: `cat ${TMP}/salida.txt && echo x > ${TMP}/y` }],
    // Lo que negó la guardia no corrió.
    ['Bash', { command: 'sed -i s/a/b/ src/a.js && cat src/a.js' }, 50_000, 'PreToolUse:Bash hook error: Guardia /qcc-implementador-odd: edita con Edit o Write, no por Bash (src/a.js).'],
    ['Agent', { subagent_type: 'qcc-odd-ejecutor', prompt: 'DOC: x' }, 170_000],
    VERIFICAR_ODD,
    DIFF,
    ['Agent', { subagent_type: 'qcc-odd-revisor', prompt: 'BASE: b0de' }],
  ])
  const p = procesoDe(filas, { raiz, inicio, hasta })
  assert.deepEqual(p.desvios, [])
  assert.equal(lineaDeProceso(p), 'ok')
  assert.equal(p.contextoMax, 170_000)

  // Revisión independiente: un test del repo que escribe en el temporal, un grep de writeFileSync y Set-Content al temporal.
  const despues = transcript([
    PLAN,
    ['Write', { file_path: path.join(raiz, 'test', 'x.test.mjs'), content: "fs.writeFileSync(tmp, 'x')" }],
    VERIFICAR_ODD,
    DIFF,
    ['Bash', { command: 'node --test test/x.test.mjs' }],
    ['Bash', { command: 'grep -rn "writeFileSync(" src ; node -p "1+1"' }],
    ['PowerShell', { command: `Set-Content -Path ${TMP}/x.txt -Value 'hola'` }],
  ])
  assert.deepEqual(procesoDe(despues.filas, { raiz, inicio: despues.inicio, hasta: despues.hasta }).desvios, [])
})

test('proceso: marca cada desvío', () => {
  const raiz = repo('proceso-desvios', { 'src/a.js': 'x\n', 'test/a.test.js': 'y\n' })
  const copia = 'C:/Users/x/AppData/Local/Temp/qcc-odd-base-AbC123'
  const { filas, inicio, hasta } = transcript([
    ['Bash', { command: 'cat src/a.js && sed -n 1,5p test/a.test.js' }],
    ['Bash', { command: 'git ls-files | head -100; head -c 400 src/a.js' }],
    ['Edit', { file_path: path.join(raiz, 'src', 'a.js') }],
    PLAN,
    ['Bash', { command: 'sed -i s/a/b/ src/a.js' }],
    VERIFICAR_ODD,
    ['Bash', { command: 'node ~/.claude/flujos-odd/odd.mjs --copia-base b0de' }, 50_000, `ODD_COPIA=${copia}`],
    ['Bash', { command: `node ${copia}/src/a.js > ${TMP}/base.txt; node src/a.js > ${TMP}/nuevo.txt` }],
    ['Bash', { command: "cat >> test/a.test.js <<'EOF'\ntest('x', () => {})\nEOF" }, 160_000],
  ])
  assert.deepEqual(procesoDe(filas, { raiz, inicio, hasta }).desvios, [
    '--plan después de editar',
    'editó por Bash: 2',
    'editó después del último verificar.mjs',
    'sin --diff',
    'editó después del diferencial',
    'contexto máx. 160k sin ejecutor',
    'exploró con cat/head: 2',
  ])
})

test('proceso: sin --plan, ediciones por script y --diff viejo', () => {
  const raiz = repo('proceso-scripts', { 'src/a.js': 'x\n' })
  const script = path.join(os.tmpdir(), 'scratch', 'aplicar.cjs')
  const { filas, inicio, hasta } = transcript([
    ['Write', { file_path: script, content: "require('fs').writeFileSync('src/a.js', t)" }],
    ['Bash', { command: `node "${script.replaceAll('\\', '/')}" && node ~/.claude/flujos-odd/verificar.mjs` }],
    DIFF,
    ['Bash', { command: "node - <<'EOF'\nconst fs = require('fs')\nfs.writeFileSync('src/a.js', 'y')\nEOF" }],
    ['Bash', { command: `cat > ${TMP}/doc.cjs <<'EOF'\nrequire('fs').appendFileSync('CLAUDE.md', 'z')\nEOF` }],
    ['Bash', { command: `node ${TMP}/doc.cjs` }],
    ['Write', { file_path: path.join(os.tmpdir(), 'scratch', 'leer.mjs'), content: 'console.log(1)' }],
    ['Bash', { command: `node ${TMP}/leer.mjs` }],
    VERIFICAR_ODD,
  ])
  // Escribir el script no edita; correrlo sí: aplicar.cjs, el heredoc de node y doc.cjs. leer.mjs no escribe.
  assert.deepEqual(procesoDe(filas, { raiz, inicio, hasta }).desvios, ['sin --plan', 'editó por Bash: 3', 'editó después del último --diff'])
  // Sin ediciones, nada que verificar.
  const vacio = transcript([PLAN])
  assert.deepEqual(procesoDe(vacio.filas, { raiz, inicio: vacio.inicio, hasta: vacio.hasta }).desvios, [])
})

test('proceso: una tarea grande pide explorador y ejecutor, y nada de código inline', () => {
  const raiz = repo('proceso-grande', { 'src/a.js': 'x\n', 'src/b.js': 'y\n', 'src/c.js': 'z\n' })
  const leer = (ruta, extra = {}) => ['Read', { file_path: path.join(raiz, ruta), ...extra }]
  const doc = ['Write', { file_path: path.join(raiz, 'odd', 'tasks', 'sena.md'), content: '# Seña' }]
  const ejecutor = ['Agent', { subagent_type: 'qcc-odd-ejecutor', prompt: 'DOC: odd/tasks/sena.md · T1' }]
  const limpia = transcript([
    ['Agent', { subagent_type: 'qcc-odd-explorador', prompt: 'PEDIDO: x' }],
    leer('src/a.js', { offset: 10, limit: 30 }),
    leer('src/b.js'),
    PLAN,
    doc,
    ejecutor,
    VERIFICAR_ODD,
    DIFF,
    // Cerrar las casillas del documento después de verificar no es editar el cambio.
    ['Edit', { file_path: path.join(raiz, 'odd', 'tasks', 'sena.md') }],
  ])
  assert.deepEqual(procesoDe(limpia.filas, { raiz, inicio: limpia.inicio, hasta: limpia.hasta, tamano: 'grande' }).desvios, [])

  const desvios = transcript([
    leer('src/a.js'),
    leer('src/b.js'),
    leer('src/c.js'),
    leer('src/a.js'),
    PLAN,
    ['Edit', { file_path: path.join(raiz, 'src', 'a.js') }],
    ['Write', { file_path: path.join(raiz, 'test', 'a.test.js'), content: 'test()' }],
    VERIFICAR_ODD,
    DIFF,
  ])
  const opciones = { raiz, inicio: desvios.inicio, hasta: desvios.hasta }
  assert.deepEqual(procesoDe(desvios.filas, { ...opciones, tamano: 'grande' }).desvios, [
    'grande sin explorador',
    'grande sin ejecutor',
    'grande: editó código inline: 2',
    'leyó 3 archivos enteros antes de --plan',
  ])
  // Con explorar: nunca no se pide explorador; en una chica, nada de esto.
  assert.deepEqual(procesoDe(desvios.filas, { ...opciones, tamano: 'grande', explorar: 'nunca' }).desvios, ['grande sin ejecutor', 'grande: editó código inline: 2', 'leyó 3 archivos enteros antes de --plan'])
  assert.deepEqual(procesoDe(desvios.filas, { ...opciones, tamano: 'chico' }).desvios, [])

  // Un ejecutor despachado después del último verificar.mjs y --diff deja su cambio sin verificar.
  const tarde = transcript([PLAN, VERIFICAR_ODD, DIFF, ejecutor])
  assert.deepEqual(procesoDe(tarde.filas, { raiz, inicio: tarde.inicio, hasta: tarde.hasta }).desvios, ['editó después del último verificar.mjs', 'editó después del último --diff'])

  // El --stat tras un despacho no cuenta como el --diff del autochequeo; uno entero en otro tramo del comando, sí.
  const stat = ['Bash', { command: 'git status --short && node ~/.claude/flujos-odd/odd.mjs --diff b0de --stat -- src/a.js' }]
  const soloStat = transcript([PLAN, ejecutor, VERIFICAR_ODD, stat])
  assert.deepEqual(procesoDe(soloStat.filas, { raiz, inicio: soloStat.inicio, hasta: soloStat.hasta }).desvios, ['sin --diff'])
  const conEntero = transcript([PLAN, ejecutor, VERIFICAR_ODD, ['Bash', { command: 'node ~/.claude/flujos-odd/odd.mjs --diff b0de --stat && node ~/.claude/flujos-odd/odd.mjs --diff b0de' }]])
  assert.deepEqual(procesoDe(conEntero.filas, { raiz, inicio: conEntero.inicio, hasta: conEntero.hasta }).desvios, [])
})

test('proceso: una grande con riesgo no exige el --diff entero', () => {
  const raiz = repo('proceso-previsto', { 'src/a.js': 'x\n' })
  const ejecutor = ['Agent', { subagent_type: 'qcc-odd-ejecutor', prompt: 'DOC: odd/tasks/sena.md · T1' }]
  const explorador = ['Agent', { subagent_type: 'qcc-odd-explorador', prompt: 'PEDIDO: x' }]
  const base = { raiz, tamano: 'grande' }
  const sinDiff = transcript([explorador, PLAN, ejecutor, VERIFICAR_ODD])
  const con = (t, extra) => procesoDe(t.filas, { ...base, inicio: t.inicio, hasta: t.hasta, ...extra }).desvios
  // Con riesgo: ni «sin --diff» ni «editó después del último --diff».
  assert.deepEqual(con(sinDiff, { riesgo: 'ítem 2 (x)' }), [])
  const diffViejo = transcript([explorador, PLAN, VERIFICAR_ODD, DIFF, ejecutor, VERIFICAR_ODD])
  assert.deepEqual(con(diffViejo, { riesgo: 'ítem 2 (x)' }), [])
  // Sin riesgo real, o chica: se sigue exigiendo.
  for (const riesgo of ['ninguno', 'Ninguno', undefined, '']) assert.deepEqual(con(sinDiff, { riesgo }), ['sin --diff'], String(riesgo))
  assert.deepEqual(con(sinDiff, { riesgo: 'ítem 2 (x)', tamano: 'chico' }), ['sin --diff'])
  assert.deepEqual(con(diffViejo, { riesgo: 'ninguno' }), ['editó después del último --diff'])
  // Lo demás sigue igual con riesgo: sin verificar.mjs, verificar viejo y el diferencial.
  const sinVerificar = transcript([explorador, PLAN, ejecutor])
  assert.deepEqual(con(sinVerificar, { riesgo: 'ítem 2 (x)' }), ['sin verificar.mjs'])
  assert.deepEqual(con(sinVerificar, { riesgo: 'ninguno' }), ['sin verificar.mjs', 'sin --diff'])
  const verificarViejo = transcript([explorador, PLAN, VERIFICAR_ODD, ejecutor])
  assert.deepEqual(con(verificarViejo, { riesgo: 'ítem 2 (x)' }), ['editó después del último verificar.mjs'])
  const copia = 'C:/Users/x/AppData/Local/Temp/qcc-odd-base-AbC123'
  const diferencial = transcript([
    explorador,
    PLAN,
    ejecutor,
    ['Bash', { command: 'node ~/.claude/flujos-odd/odd.mjs --copia-base b0de' }, 50_000, `ODD_COPIA=${copia}`],
    VERIFICAR_ODD,
    ejecutor,
  ])
  assert.deepEqual(con(diferencial, { riesgo: 'ítem 2 (x)' }), ['editó después del último verificar.mjs', 'editó después del diferencial'])
})

// ── instalar ────────────────────────────────────────────────────────────────

test('instalar: copia, no pisa lo editado en ~/.claude y --traer no corre sin edición', () => {
  const claude = path.join(PRUEBAS, 'claude-instalar')
  const instalar = (...args) => spawnSync(process.execPath, [path.join(RAIZ, 'flujos-odd', 'instalar.mjs'), ...args], { encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: claude } })
  const revisar = instalar('--revisar')
  assert.match(revisar.stdout, /nuevo .*skills\/qcc-implementador-odd\/SKILL\.md/)
  assert.ok(!fs.existsSync(path.join(claude, 'flujos-odd')))
  assert.equal(instalar().status, 0)
  const odd = path.join(claude, 'flujos-odd', 'odd.mjs')
  assert.ok(fs.existsSync(odd))
  assert.ok(fs.existsSync(path.join(claude, 'agents', 'qcc-odd-revisor.md')))
  assert.match(instalar().stdout, /RESULTADO: 0 copiado\(s\)/)
  fs.appendFileSync(odd, '\n// editado\n')
  const frenado = instalar()
  assert.equal(frenado.status, 1)
  assert.match(frenado.stdout, /FRENADO .*flujos-odd\/odd\.mjs/)
  assert.match(instalar('--traer', '--revisar').stdout, /cambia .*odd\.mjs → .*flujos-odd[\\/]herramientas[\\/]odd\.mjs|cambia .*→ herramientas\/odd\.mjs/)
})
