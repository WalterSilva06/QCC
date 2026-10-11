#!/usr/bin/env node
// Guardia de los subagentes de /implementador y /implementador-ligero (nivel usuario: sirve
// para cualquier proyecto).
//
// Hook PreToolUse que declaran en su frontmatter `ejecutor` (argumento `ejecutor`) y
// `revisor` (argumento `revisor`): Claude Code lo corre solo mientras ese agente trabaja.
// Niega lo que un subagente no hace nunca —git que modifica, servicios externos y despliegues,
// dependencias, secretos, borrados recursivos, servidores que no terminan, archivos
// protegidos; y al revisor, escribir— y deja cada llamada en el registro del proyecto
// (`registros/<proyecto>-<hash>.jsonl`), que `estado.mjs --cambios` cruza con el árbol para el
// chequeo de alcance (cubre rutas que git ignora).
//
// Lo propio de cada proyecto va en `<raíz>/.claude/implementador.json`, clave `guardia`
// (ver `config.ejemplo.md`). Sin ese archivo rigen los valores por defecto.
//
// Ante la duda, deja pasar: un guardia que castra al ejecutor cuesta la tarea entera.
// Un error de parseo nunca niega.
//
// Casos: `node --test ~/.claude/flujos/guardia.test.mjs`.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const TOPE_REGISTRO = 2 * 1024 * 1024
const WIN = process.platform === 'win32'

// ── Proyecto ────────────────────────────────────────────────────────────────

/** Raíz del repo git que contiene `dir` (o `dir` si no es un repo). */
export function raizDe(dir) {
  const d = path.resolve(rutaNativa(dir || process.cwd()))
  try {
    const top = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: d, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    if (top) return path.resolve(rutaNativa(top))
  } catch {
    // No es un repo, o git no responde.
  }
  return d
}

/** Proyecto actual: CLAUDE_PROJECT_DIR (hooks) o el cwd, subido a la raíz del repo. */
export const RAIZ = raizDe(process.env.CLAUDE_PROJECT_DIR || process.cwd())

/** Registro de llamadas de los subagentes, uno por proyecto. */
export function registroDe(raiz) {
  const norma = path.resolve(raiz)
  const clave = WIN ? norma.toLowerCase() : norma
  const hash = crypto.createHash('sha1').update(clave).digest('hex').slice(0, 10)
  const nombre = (path.basename(norma) || 'raiz').replace(/[^\w.-]+/g, '_')
  return path.join(DIR, 'registros', `${nombre}-${hash}.jsonl`)
}

// ── Globs ───────────────────────────────────────────────────────────────────

/** Glob → RegExp: `**` cruza carpetas, `*` y `?` no; una ruta que termina en `/` es la carpeta entera. */
export function aRegex(patron) {
  let p = String(patron).replace(/\\/g, '/').replace(/^\.\//, '')
  if (p.endsWith('/')) p += '**'
  let re = ''
  for (let i = 0; i < p.length; i++) {
    const c = p[i]
    if (c === '*') {
      if (p[i + 1] === '*') {
        i++
        if (p[i + 1] === '/') {
          i++
          re += '(?:.*/)?'
        } else re += '.*'
      } else re += '[^/]*'
    } else if (c === '?') re += '[^/]'
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${re}$`, WIN ? 'i' : '')
}

export function coincide(ruta, patrones) {
  const r = String(ruta).replace(/\\/g, '/')
  return patrones.some((p) => aRegex(p).test(r))
}

// ── Configuración del proyecto ──────────────────────────────────────────────

const PROTEGIDOS_BASE = {
  'node_modules/': 'es un artefacto generado (dependencias)',
  'dist/': 'es un artefacto generado (build)',
  'pnpm-lock.yaml': 'lo escribe el gestor de paquetes (una dependencia nueva la instala el orquestador, si el plan lo dice)',
  'package-lock.json': 'lo escribe el gestor de paquetes',
  'npm-shrinkwrap.json': 'lo escribe el gestor de paquetes',
  'yarn.lock': 'lo escribe el gestor de paquetes',
  'bun.lock': 'lo escribe el gestor de paquetes',
  'bun.lockb': 'lo escribe el gestor de paquetes',
  'poetry.lock': 'lo escribe el gestor de paquetes',
  'uv.lock': 'lo escribe el gestor de paquetes',
  'Pipfile.lock': 'lo escribe el gestor de paquetes',
  'composer.lock': 'lo escribe el gestor de paquetes',
  'Gemfile.lock': 'lo escribe el gestor de paquetes',
}
const INMUTABLES_BASE = ['supabase/migrations/', 'prisma/migrations/', 'db/migrate/']
const SCRIPTS_NEGADOS_BASE = [
  'dev', 'dev:*', 'start', 'start:*', 'serve', 'serve:*', 'preview', 'preview:*', 'watch', 'watch:*',
  'deploy', 'deploy:*', 'release', 'release:*', 'publish', 'publish:*',
]

const RED = 'red: los subagentes no llaman servicios'
const EXTERNO = 'servicio externo, nube o despliegue: queda para el usuario'
const EXTERNOS_BASE = {
  supabase: 'la CLI de Supabase toca el proyecto vivo (db push, types, secrets, functions…): queda para el usuario',
  fly: 'fly despliega o toca producción', flyctl: 'fly despliega o toca producción',
  gh: 'gh publica en GitHub', glab: 'glab publica en GitLab',
  cloudflared: 'el túnel es del usuario', ngrok: 'el túnel es del usuario',
  aws: EXTERNO, gcloud: EXTERNO, gsutil: EXTERNO, az: EXTERNO, docker: EXTERNO, 'docker-compose': EXTERNO,
  podman: EXTERNO, kubectl: EXTERNO, helm: EXTERNO, terraform: EXTERNO, tofu: EXTERNO, pulumi: EXTERNO,
  vercel: EXTERNO, netlify: EXTERNO, wrangler: EXTERNO, heroku: EXTERNO, firebase: EXTERNO, railway: EXTERNO,
  serverless: EXTERNO, cdk: EXTERNO, sam: EXTERNO, stripe: EXTERNO,
  curl: RED, wget: RED, 'invoke-webrequest': RED, iwr: RED, 'invoke-restmethod': RED, irm: RED,
  ssh: RED, scp: RED, sftp: RED, ftp: RED, rsync: RED, nc: RED, ncat: RED, telnet: RED,
  npx: 'npx puede descargar y ejecutar paquetes: usa `<gestor> exec <bin>` (o `npx --no-install`)',
  pnpx: 'pnpx descarga y ejecuta paquetes: usa `pnpm exec <bin>`',
  bunx: 'bunx descarga y ejecuta paquetes',
  brew: 'instala software del sistema', apt: 'instala software del sistema', 'apt-get': 'instala software del sistema',
  choco: 'instala software del sistema', winget: 'instala software del sistema', scoop: 'instala software del sistema',
}

const cacheConfig = new Map()

function leerJson(archivo) {
  try {
    return JSON.parse(fs.readFileSync(archivo, 'utf8'))
  } catch {
    return null
  }
}

/** Gestor de paquetes JS del proyecto, por lockfile o `packageManager`; null si no se sabe. */
export function gestorDe(raiz, pkg = leerJson(path.join(raiz, 'package.json'))) {
  const hay = (f) => fs.existsSync(path.join(raiz, f))
  if (hay('pnpm-lock.yaml')) return 'pnpm'
  if (hay('yarn.lock')) return 'yarn'
  if (hay('bun.lockb') || hay('bun.lock')) return 'bun'
  if (hay('package-lock.json') || hay('npm-shrinkwrap.json')) return 'npm'
  const pm = /^(npm|pnpm|yarn|bun)@/.exec(String(pkg?.packageManager ?? ''))?.[1]
  return pm ?? null
}

/** Configuración efectiva del proyecto: valores por defecto + `.claude/implementador.json`. */
export function configDe(raiz) {
  if (cacheConfig.has(raiz)) return cacheConfig.get(raiz)
  const archivo = path.join(raiz, '.claude', 'implementador.json')
  const crudo = leerJson(archivo)
  const g = crudo?.guardia ?? {}
  const pkg = leerJson(path.join(raiz, 'package.json'))
  const externos = { ...EXTERNOS_BASE, ...(g.externos ?? {}) }
  for (const p of g.permitir ?? []) delete externos[String(p).toLowerCase()]
  const config = {
    archivo: crudo ? archivo : null,
    invalido: fs.existsSync(archivo) && !crudo,
    verificar: Array.isArray(crudo?.verificar) ? crudo.verificar : null,
    protegidos: { ...PROTEGIDOS_BASE, ...(g.protegidos ?? {}) },
    secretos: (g.secretos ?? []).map(String),
    inmutables: [...INMUTABLES_BASE, ...(g.inmutables ?? [])],
    externos,
    scriptsNegados: [...SCRIPTS_NEGADOS_BASE, ...(g.scriptsNegados ?? [])],
    scriptsPermitidos: Array.isArray(g.scriptsPermitidos) ? g.scriptsPermitidos.map(String) : null,
    nodeNegado: (g.nodeNegado ?? []).map(String),
    pm: gestorDe(raiz, pkg),
    scripts: pkg?.scripts && typeof pkg.scripts === 'object' ? pkg.scripts : {},
  }
  cacheConfig.set(raiz, config)
  return config
}

// ── Rutas ───────────────────────────────────────────────────────────────────

/** `~` y `$HOME` → carpeta del usuario; `/d/x` de Git Bash → `d:/x` en Windows; lo demás, igual. */
export function rutaNativa(p) {
  const s = String(p).replace(/^(~|\$HOME|\$\{HOME\}|\$env:USERPROFILE|%USERPROFILE%)(?=$|[\\/])/i, () => os.homedir())
  if (WIN) {
    const m = /^\/([a-zA-Z])(\/.*)?$/.exec(s)
    if (m) return `${m[1]}:${m[2] ?? '/'}`
  }
  return s
}

/** Ruta relativa a la raíz en formato posix; `null` si queda fuera del repo. */
export function relativaAlRepo(abs, raiz = RAIZ) {
  const rel = path.relative(raiz, abs)
  if (rel === '') return ''
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null
  return rel.split(path.sep).join('/')
}

function esTemporal(cruda, abs) {
  if (/^\/tmp(\/|$)/.test(cruda)) return true
  const tmp = path.resolve(os.tmpdir())
  const a = WIN ? abs.toLowerCase() : abs
  const t = WIN ? tmp.toLowerCase() : tmp
  return a === t || a.startsWith(t + path.sep)
}

const versionados = new Map()
function versionado(rel, raiz) {
  const clave = `${raiz}|${rel}`
  if (!versionados.has(clave)) {
    let si = false
    try {
      execFileSync('git', ['ls-files', '--error-unmatch', '--', rel], { cwd: raiz, stdio: 'ignore' })
      si = true
    } catch {
      // No versionado, o git no responde: ante la duda, deja pasar.
    }
    versionados.set(clave, si)
  }
  return versionados.get(clave)
}

const ARCHIVO_ENV = /(^|\/)\.env(\.[^/]+)?$/i
const ENV_PLANTILLA = /\.env\.(example|sample|template|dist)$/i

/** ¿`rel` (posix, relativa a la raíz) es uno de los secretos declarados por el proyecto? */
function esSecreto(rel, config) {
  return config.secretos.length > 0 && coincide(rel, config.secretos.map((s) => (/[*?/]/.test(s) ? s : `**/${s}`)))
}

/**
 * Motivo para negar una escritura en `cruda` (Edit/Write, o destino de un comando), o null.
 * `base`: directorio contra el que se resuelve una ruta relativa.
 */
export function motivoRuta(cruda, { raiz = RAIZ, base = raiz, permitirTemporal = false } = {}) {
  if (!cruda) return null
  const config = configDe(raiz)
  const texto = String(cruda)
  const abs = path.resolve(base, rutaNativa(texto))
  const rel = relativaAlRepo(abs, raiz)
  if (rel === null) return permitirTemporal && esTemporal(texto, abs) ? null : `${texto} queda fuera del repo`
  const r = rel.toLowerCase()
  if (r === '.git' || r.startsWith('.git/')) return '.git/ es de git'
  if (r === '.claude' || r.startsWith('.claude/')) return '.claude/ es la configuración de Claude Code y de los flujos: un subagente no la toca'
  if (ARCHIVO_ENV.test(r) && !ENV_PLANTILLA.test(r)) return `${rel} guarda secretos`
  if (/\.(pem|key|p12|pfx)$/.test(r)) return `${rel} es una credencial`
  if (esSecreto(rel, config)) return `${rel} guarda secretos o claves (secreto del proyecto)`
  for (const [patron, motivo] of Object.entries(config.protegidos)) {
    if (coincide(rel, [patron])) return `${rel}: ${motivo}`
  }
  if (coincide(rel, config.inmutables) && versionado(rel, raiz)) {
    return `${rel} es una migración versionada: es inmutable; crea una nueva con el siguiente número`
  }
  return null
}

// ── Comandos ────────────────────────────────────────────────────────────────

/**
 * Parte un comando en comandos simples `{ palabras, redirs }`: comillas, escapes,
 * comentarios, separadores (; && || | & salto de línea), subshells, $(…), `…`, <(…),
 * heredocs y redirecciones. Lo anidado se analiza aparte y se agrega al final. No es bash:
 * alcanza para que un comando escrito por un modelo no esconda lo que hace.
 */
export function analizar(cmd, { powershell = false, profundidad = 0 } = {}) {
  const comandos = []
  if (!cmd || profundidad > 4) return comandos
  const ESC = powershell ? '`' : '\\'
  const anidados = []
  let palabras = []
  let redirs = []
  let palabra = ''
  let hay = false
  let pendiente = null
  let heredocs = []
  const n = cmd.length
  let i = 0

  const cerrarPalabra = () => {
    if (!hay) return
    if (pendiente === '<<' || pendiente === '<<-') heredocs.push({ fin: palabra, tabs: pendiente === '<<-' })
    else if (pendiente) redirs.push({ op: pendiente, objetivo: palabra })
    else palabras.push(palabra)
    pendiente = null
    palabra = ''
    hay = false
  }
  const cerrarComando = () => {
    cerrarPalabra()
    pendiente = null
    if (palabras.length || redirs.length) comandos.push({ palabras, redirs })
    palabras = []
    redirs = []
  }
  // Desde el '(' en `desde` hasta su ')' balanceado: [interior, índice siguiente].
  const balanceado = (desde) => {
    let prof = 0
    let simple = false
    let doble = false
    for (let j = desde; j < n; j++) {
      const ch = cmd[j]
      if (simple) {
        if (ch === "'") simple = false
        continue
      }
      if (ch === ESC) {
        j++
        continue
      }
      if (doble) {
        if (ch === '"') doble = false
        continue
      }
      if (ch === "'") simple = true
      else if (ch === '"') doble = true
      else if (ch === '(') prof++
      else if (ch === ')' && --prof === 0) return [cmd.slice(desde + 1, j), j + 1]
    }
    return [cmd.slice(desde + 1), n]
  }
  const hastaBacktick = (desde) => {
    const fin = cmd.indexOf('`', desde + 1)
    return fin === -1 ? [cmd.slice(desde + 1), n] : [cmd.slice(desde + 1, fin), fin + 1]
  }
  const saltarHeredocs = (desde) => {
    let j = desde
    for (const h of heredocs) {
      while (j < n) {
        const salto = cmd.indexOf('\n', j)
        const fin = salto === -1 ? n : salto
        let linea = cmd.slice(j, fin).replace(/\r$/, '')
        if (h.tabs) linea = linea.replace(/^\t+/, '')
        j = fin + 1
        if (linea === h.fin) break
      }
    }
    heredocs = []
    return j
  }

  while (i < n) {
    const c = cmd[i]
    if (c === "'") {
      const fin = cmd.indexOf("'", i + 1)
      const f = fin === -1 ? n : fin
      palabra += cmd.slice(i + 1, f)
      hay = true
      i = f + 1
      continue
    }
    if (c === '"') {
      hay = true
      i++
      while (i < n && cmd[i] !== '"') {
        const d = cmd[i]
        if (d === ESC && i + 1 < n) {
          const e = cmd[i + 1]
          // bash: dentro de comillas dobles, \ solo escapa " \ $ ` y el salto de línea
          if (powershell || '"\\$`\n'.includes(e)) {
            if (e !== '\n') palabra += e
          } else palabra += d + e
          i += 2
          continue
        }
        if (d === '$' && cmd[i + 1] === '(') {
          const [dentro, sig] = balanceado(i + 1)
          anidados.push(dentro)
          palabra += '\u0000'
          i = sig
          continue
        }
        if (!powershell && d === '`') {
          const [dentro, sig] = hastaBacktick(i)
          anidados.push(dentro)
          palabra += '\u0000'
          i = sig
          continue
        }
        palabra += d
        i++
      }
      i++
      continue
    }
    if (c === ESC) {
      if (i + 1 < n && cmd[i + 1] !== '\n' && cmd[i + 1] !== '\r') {
        palabra += cmd[i + 1]
        hay = true
      }
      i += 2
      continue
    }
    if (c === '#' && !hay) {
      const salto = cmd.indexOf('\n', i)
      i = salto === -1 ? n : salto
      continue
    }
    if (c === '$' && cmd[i + 1] === '(') {
      const [dentro, sig] = balanceado(i + 1)
      anidados.push(dentro)
      palabra += '\u0000'
      hay = true
      i = sig
      continue
    }
    if (!powershell && c === '`') {
      const [dentro, sig] = hastaBacktick(i)
      anidados.push(dentro)
      palabra += '\u0000'
      hay = true
      i = sig
      continue
    }
    if ((c === '<' || c === '>') && cmd[i + 1] === '(' && !hay) {
      const [dentro, sig] = balanceado(i + 1)
      anidados.push(dentro)
      i = sig
      continue
    }
    if (c === '\n' || c === '\r') {
      cerrarComando()
      i += c === '\r' && cmd[i + 1] === '\n' ? 2 : 1
      if (heredocs.length) i = saltarHeredocs(i)
      continue
    }
    if (c === ';') {
      cerrarComando()
      i++
      continue
    }
    if (c === '|') {
      cerrarComando()
      i += cmd[i + 1] === '|' || cmd[i + 1] === '&' ? 2 : 1
      continue
    }
    if (c === '&' && cmd[i + 1] === '&') {
      cerrarComando()
      i += 2
      continue
    }
    if (c === '>' || c === '<' || (c === '&' && cmd[i + 1] === '>')) {
      if (hay && !pendiente && /^\d+$/.test(palabra)) {
        palabra = ''
        hay = false
      } else cerrarPalabra()
      const op = /^(&>>|&>|>>|>\||>&|<<<|<<-|<<|<&|<>|>|<)/.exec(cmd.slice(i, i + 3))?.[1] ?? c
      i += op.length
      pendiente = op
      continue
    }
    if (c === '&') {
      cerrarComando()
      i++
      continue
    }
    if ((c === '(' || c === ')') && !hay) {
      cerrarComando()
      i++
      continue
    }
    if (c === ' ' || c === '\t') {
      cerrarPalabra()
      i++
      continue
    }
    palabra += c
    hay = true
    i++
  }
  cerrarComando()
  for (const a of anidados) comandos.push(...analizar(a, { powershell, profundidad: profundidad + 1 }))
  return comandos
}

// `.env`, `.env.local`, `./.env`… pero no `.env.example`, `process.env` ni `.envrc`.
const SECRETO = /(^|[^\w.-])\.env(?!\.(example|sample|template|dist)(?![\w.-]))(\.[\w-]+)*(?![\w.-])/i
const ASIGNACION = /^[A-Za-z_][A-Za-z0-9_]*=/
const PREFIJOS = new Set([
  'do', 'then', 'else', 'elif', 'if', 'while', 'until', '!', '{', '}', 'time', 'exec', 'command',
  'builtin', 'nohup', 'nice', 'sudo', 'env', 'xargs', 'timeout', 'stdbuf', 'unbuffer', 'watch',
])
const XARGS_CON_VALOR = new Set(['-I', '-i', '-n', '-P', '-L', '-l', '-d', '-E', '-e', '-s', '-a'])

export function nombreProg(palabra) {
  const base = String(palabra).split(/[\\/]/).pop() ?? ''
  return base.toLowerCase().replace(/\.(exe|cmd|bat|ps1)$/, '')
}

function sinPrefijos(palabras) {
  let ws = palabras
  for (;;) {
    while (ws.length && ASIGNACION.test(ws[0])) ws = ws.slice(1)
    if (!ws.length) return ws
    const p = nombreProg(ws[0])
    if (!PREFIJOS.has(p)) return ws
    ws = ws.slice(1)
    while (ws.length && (ws[0].startsWith('-') || (p === 'env' && ASIGNACION.test(ws[0])))) {
      const f = ws[0]
      ws = ws.slice(1)
      if (p === 'xargs' && XARGS_CON_VALOR.has(f) && ws.length) ws = ws.slice(1)
    }
    while (ws.length && /^\d+[smhd]?$/.test(ws[0])) ws = ws.slice(1)
  }
}

// ── git ──

const GIT_LECTURA = new Set([
  'status', 'diff', 'log', 'show', 'blame', 'annotate', 'ls-files', 'ls-tree', 'rev-parse', 'grep',
  'cat-file', 'check-ignore', 'check-attr', 'describe', 'shortlog', 'merge-base', 'name-rev',
  'rev-list', 'whatchanged', 'diff-tree', 'diff-files', 'diff-index', 'for-each-ref', 'show-ref',
  'version', 'help', 'count-objects', 'var', 'cherry', 'range-diff', 'show-branch',
])
const GIT_OPC_CON_VALOR = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--super-prefix', '--config-env', '--exec-path'])
const GIT_RAMA_PELIGRO = /^(-d|-D|-m|-M|-c|-C|-f|-u|-t|--delete|--move|--copy|--force|--set-upstream-to.*|--unset-upstream|--track.*|--edit-description|--create-reflog)$/
const GIT_RAMA_CON_VALOR = /^--(contains|no-contains|merged|no-merged|points-at|sort|format)$/

function evaluarGit(args, ctx) {
  let k = 0
  while (k < args.length && args[k].startsWith('-')) k += GIT_OPC_CON_VALOR.has(args[k]) ? 2 : 1
  const sub = (args[k] ?? '').toLowerCase()
  const resto = args.slice(k + 1)
  if (!sub) return null
  if (GIT_LECTURA.has(sub)) {
    if (ctx.rol === 'revisor' && resto.some((a) => a.startsWith('--output'))) return 'el revisor no escribe archivos (git --output)'
    return null
  }
  if (sub === 'branch') {
    const peligro = resto.some((a) => GIT_RAMA_PELIGRO.test(a))
    const posicional = resto.some((a, j) => !a.startsWith('-') && !GIT_RAMA_CON_VALOR.test(resto[j - 1] ?? ''))
    if (!peligro && !posicional) return null
    return 'git branch crea, mueve o borra ramas: lo decide el usuario'
  }
  if (sub === 'remote' && resto.every((a) => a === '-v' || a === '--verbose')) return null
  return `git ${sub} modifica el repositorio o habla con el remoto: en los flujos git es solo de lectura (commits, ramas y deshacer los decide el usuario)`
}

// ── Gestores de paquetes JS ──

const GESTORES = new Set(['npm', 'pnpm', 'yarn', 'bun'])
const PM_OPC_CON_VALOR = new Set(['-C', '--dir', '--prefix', '--filter', '-F', '--reporter', '--loglevel', '--workspace-dir', '--cwd', '--workspace'])
const PM_DEPENDENCIAS = new Set([
  'add', 'install', 'i', 'ci', 'remove', 'rm', 'un', 'uninstall', 'update', 'up', 'upgrade', 'dlx', 'create',
  'init', 'link', 'ln', 'unlink', 'patch', 'patch-commit', 'prune', 'store', 'rebuild', 'rb', 'import',
  'publish', 'pack', 'deploy', 'setup', 'env', 'config', 'approve-builds', 'self-update', 'fetch',
  'install-test', 'it', 'audit', 'outdated', 'dedupe', 'set', 'login', 'logout', 'adduser', 'unpublish',
  'deprecate', 'dist-tag', 'version', 'x',
])
const PM_LECTURA = new Set(['why', 'ls', 'list', 'll', 'la', 'explain', 'bin', 'root', 'help', '--version', '-v', '--help', '-h'])

function motivoVitest(resto) {
  if (resto.some((a) => ['run', '--run', 'bench', 'list', '--version', '-v', '--help', '-h'].includes(a))) return null
  return 'vitest sin `run` puede quedar en modo watch: usa `vitest run <archivo>`'
}

function motivoVite(resto) {
  if (resto.some((a) => ['build', 'optimize', '--version', '-v', '--help', '-h'].includes(a))) return null
  return 'vite sin `build` levanta un servidor: usa el build del proyecto'
}

const SERVIDORES = new Set(['nodemon', 'serve', 'http-server', 'live-server', 'webpack-dev-server', 'browser-sync', 'json-server'])
const CON_DEV = new Set(['next', 'nuxt', 'nuxi', 'astro', 'remix', 'react-router', 'react-scripts', 'ng', 'svelte-kit', 'gatsby', 'expo', 'parcel', 'webpack', 'wrangler', 'vinxi', 'turbo'])
const SUB_SERVIDOR = new Set(['dev', 'start', 'serve', 'preview', 'develop'])

/** Un binario ejecutado directo o con `<gestor> exec`: servidores, watch, scripts negados. */
function evaluarBinario(prog, args, ctx) {
  if (prog === 'node') return evaluarNode(args, ctx)
  if (prog === 'vitest') return motivoVitest(args)
  if (prog === 'vite') return motivoVite(args)
  if (SERVIDORES.has(prog)) return `${prog} levanta un servidor que no termina: no en un subagente`
  if (CON_DEV.has(prog) && SUB_SERVIDOR.has(args.find((a) => !a.startsWith('-')) ?? '')) {
    return `${prog} ${args.find((a) => !a.startsWith('-'))} levanta un servidor que no termina: no en un subagente`
  }
  if (['tsx', 'ts-node', 'jest', 'tsc', 'esbuild', 'rollup', 'mocha', 'ava'].includes(prog)) {
    if (args.includes('--watch') || args[0] === 'watch' || (prog === 'tsc' && args.includes('-w'))) return `${prog} en modo watch no termina`
    if (prog === 'tsx' || prog === 'ts-node') return motivoArchivoScript(args, ctx)
  }
  return null
}

function motivoScript(nombre, ctx) {
  const config = configDe(ctx.raiz)
  const pm = ctx.pmUsado
  if (coincide(nombre, config.scriptsNegados)) {
    return `${pm} run ${nombre}: script negado a los subagentes (servidor, despliegue o servicio vivo): queda para el usuario`
  }
  if (config.scriptsPermitidos && !config.scriptsPermitidos.includes(nombre)) {
    return `${pm} run ${nombre}: en este proyecto los subagentes solo corren ${config.scriptsPermitidos.join(', ')} (.claude/implementador.json)`
  }
  return null
}

function evaluarGestor(prog, args, ctx) {
  const config = configDe(ctx.raiz)
  if (config.pm && prog !== config.pm) return `este proyecto usa ${config.pm}, no ${prog}`
  const c = { ...ctx, pmUsado: prog }
  let k = 0
  while (k < args.length && args[k].startsWith('-') && !PM_LECTURA.has(args[k])) k += PM_OPC_CON_VALOR.has(args[k]) ? 2 : 1
  const sub = args[k]
  const resto = args.slice(k + 1)
  if (sub === undefined) return prog === 'yarn' ? 'yarn sin argumentos instala dependencias' : null
  if (PM_LECTURA.has(sub)) return null
  if (prog === 'bun' && sub === 'test') return null
  if (prog === 'bun' && sub === 'x') return 'bun x descarga y ejecuta paquetes'
  if (PM_DEPENDENCIAS.has(sub)) {
    return `${prog} ${sub}: dependencias, publicación y red quedan fuera de los subagentes (si el plan lo pide, lo hace el orquestador)`
  }
  if (sub === 'run' || sub === 'run-script' || sub === 'rs') {
    const j = resto.findIndex((a) => !a.startsWith('-'))
    if (j < 0) return null
    const s = resto[j]
    if (prog === 'bun' && !(s in config.scripts)) return motivoArchivoScript(resto.slice(j), ctx)
    return motivoScript(s, c)
  }
  if (sub === 'test' || sub === 't' || sub === 'tst') return motivoScript('test', c)
  if (sub === 'exec') {
    if (prog === 'npm' && !resto.some((a) => a === '--no' || a === '--no-install' || a === '--offline')) {
      return 'npm exec puede descargar paquetes: usa `npm exec --no -- <bin>`'
    }
    const j = resto.findIndex((a) => !a.startsWith('-'))
    return j >= 0 ? evaluarBinario(nombreProg(resto[j]), resto.slice(j + 1), ctx) : null
  }
  if (sub in config.scripts || ['start', 'restart', 'stop'].includes(sub)) return motivoScript(sub, c)
  if (prog === 'npm') return null
  if (prog === 'bun') return motivoArchivoScript([sub, ...resto], ctx)
  // pnpm/yarn: un nombre que no es script ejecuta el binario local.
  return evaluarBinario(nombreProg(sub), resto, ctx)
}

// ── Otros ecosistemas: solo se niegan dependencias y publicación ──

const DEPENDENCIAS_OTROS = {
  pip: ['install', 'uninstall', 'download', 'wheel'],
  pip3: ['install', 'uninstall', 'download', 'wheel'],
  uv: ['add', 'remove', 'sync', 'lock', 'pip', 'tool', 'publish', 'python', 'self'],
  poetry: ['add', 'remove', 'install', 'update', 'lock', 'publish', 'self', 'source'],
  pipenv: ['install', 'uninstall', 'update', 'lock', 'sync', 'upgrade'],
  pdm: ['add', 'remove', 'install', 'update', 'lock', 'sync', 'publish'],
  cargo: ['add', 'remove', 'rm', 'install', 'uninstall', 'update', 'publish', 'login', 'logout', 'yank', 'owner'],
  go: ['get', 'install'],
  bundle: ['install', 'add', 'update', 'remove'],
  gem: ['install', 'uninstall', 'update', 'push'],
  composer: ['require', 'install', 'update', 'remove'],
  dotnet: ['add', 'remove', 'restore', 'publish', 'nuget', 'tool', 'workload'],
}

function evaluarOtros(prog, args, ctx) {
  if (prog === 'python' || prog === 'python3' || prog === 'py') {
    const m = args.indexOf('-m')
    if (m >= 0 && ['pip', 'pip3'].includes(args[m + 1])) return evaluarOtros('pip', args.slice(m + 2), ctx)
    return motivoArchivoScript(args.filter((a) => a !== '-u'), ctx)
  }
  const subs = DEPENDENCIAS_OTROS[prog]
  if (!subs) return null
  const sub = args.find((a) => !a.startsWith('-'))
  if (prog === 'go' && sub === 'mod') {
    const accion = args[args.indexOf('mod') + 1]
    if (['tidy', 'download', 'vendor', 'edit'].includes(accion)) return `go mod ${accion} cambia dependencias: queda para el orquestador o el usuario`
    return null
  }
  if (sub && subs.includes(sub)) return `${prog} ${sub}: dependencias y publicación quedan fuera de los subagentes (si el plan lo pide, lo hace el orquestador)`
  return null
}

// ── node y scripts ──

const NODE_OPC_CON_VALOR = new Set(['-r', '--require', '--import', '--input-type', '--loader', '--experimental-loader', '-C', '--conditions', '--stack-size', '--max-old-space-size'])
const NODE_CODIGO = new Set(['-e', '--eval', '-p', '--print', '-c'])

/** Primer argumento que es un archivo: niega si cae en una carpeta `nodeNegado` del proyecto. */
function motivoArchivoScript(args, ctx) {
  const config = configDe(ctx.raiz)
  if (!config.nodeNegado.length) return null
  for (let k = 0; k < args.length; k++) {
    const a = args[k]
    if (NODE_CODIGO.has(a)) return null
    if (NODE_OPC_CON_VALOR.has(a)) {
      k++
      continue
    }
    if (a.startsWith('-')) continue
    const rel = relativaAlRepo(path.resolve(ctx.cwd, rutaNativa(a)), ctx.raiz)
    if (rel !== null && coincide(rel, config.nodeNegado)) {
      return `${a}: los scripts de ${config.nodeNegado.join(', ')} pegan a servicios vivos o datos reales: quedan para el usuario`
    }
    return null
  }
  return null
}

function evaluarNode(args, ctx) {
  if (args.some((a) => a.startsWith('--env-file'))) return 'node --env-file carga secretos y suele pegar a servicios vivos: queda para el usuario'
  if (args.some((a) => a === '--watch' || a.startsWith('--watch-path'))) return 'node --watch no termina'
  return motivoArchivoScript(args, ctx)
}

const BUSCAN = new Set(['grep', 'egrep', 'fgrep', 'rg', 'ag', 'ack', 'findstr', 'select-string', 'sls'])

/** Índice (en `args`) del patrón de una búsqueda: lo que sigue a -e/--regexp, o el primer argumento suelto. */
function indicePatron(args) {
  for (let k = 0; k < args.length; k++) {
    if (['-e', '--regexp', '-pattern'].includes(args[k].toLowerCase())) return k + 1
    if (args[k].startsWith('--regexp=')) return k
  }
  return args.findIndex((a) => !a.startsWith('-'))
}

/** ¿La palabra nombra un secreto declarado por el proyecto? */
function nombraSecreto(palabra, ctx) {
  const config = configDe(ctx.raiz)
  if (!config.secretos.length) return false
  const w = String(palabra).toLowerCase()
  for (const s of config.secretos) {
    if (!/[*?]/.test(s) && w.includes(s.split('/').pop().toLowerCase())) return true
  }
  const rel = relativaAlRepo(path.resolve(ctx.cwd, rutaNativa(palabra)), ctx.raiz)
  return rel !== null && rel !== '' && esSecreto(rel, config)
}

const recursivo = (a) => a === '--recursive' || /^-rec/i.test(a) || (/^-[a-zA-Z]{1,5}$/.test(a) && /r/i.test(a))
const EDITA_EN_SITIO = (a) => /^-[a-zA-Z]*i/.test(a) || a.startsWith('--in-place')
const ESCRIBEN = new Set([
  'mv', 'cp', 'rm', 'touch', 'mkdir', 'ln', 'truncate', 'install', 'patch', 'tee', 'dd', 'unzip', 'tar',
  '7z', 'zip', 'gzip', 'gunzip', 'set-content', 'sc', 'add-content', 'ac', 'out-file', 'new-item', 'ni',
  'copy-item', 'cpi', 'copy', 'move-item', 'mi', 'move', 'rename-item', 'rni', 'ren', 'remove-item', 'ri',
  'del', 'erase', 'clear-content', 'clc', 'export-csv', 'set-itemproperty',
])
const CON_DESTINO = new Set([
  'mv', 'cp', 'rm', 'touch', 'mkdir', 'ln', 'truncate', 'tee', 'install', 'set-content', 'add-content',
  'out-file', 'new-item', 'copy-item', 'move-item', 'rename-item', 'remove-item', 'del', 'erase',
])

function evaluarSimple({ palabras, redirs }, ctx) {
  const config = configDe(ctx.raiz)
  for (const r of redirs) {
    if (SECRETO.test(r.objetivo)) return 'toca un .env (secretos)'
    if (!['>', '>>', '>|', '&>', '&>>'].includes(r.op)) {
      if (nombraSecreto(r.objetivo, ctx)) return `${r.objetivo} guarda secretos o claves (secreto del proyecto)`
      continue
    }
    if (/^(\/dev\/(null|stdout|stderr)|nul|\$null)$/i.test(r.objetivo)) continue
    if (ctx.rol === 'revisor') return `el revisor no escribe archivos (redirección a ${r.objetivo})`
    const m = motivoRuta(r.objetivo, { raiz: ctx.raiz, base: ctx.cwd, permitirTemporal: true })
    if (m) return m
  }
  const ws = sinPrefijos(palabras)
  const prog = ws.length ? nombreProg(ws[0]) : ''
  const args = ws.slice(1)
  // El patrón de una búsqueda no es un archivo: `grep -rn ".env" src` busca el texto, no lo lee.
  const ip = BUSCAN.has(prog) ? indicePatron(args) : -1
  const patron = ip >= 0 ? ip + (palabras.length - args.length) : -1
  for (const [j, w] of palabras.entries()) {
    if (j === patron) continue
    if (SECRETO.test(w)) return 'toca un .env (secretos); para buscar el texto en el código, usa la herramienta Grep'
    if (j > 0 && nombraSecreto(w, ctx)) return `${w} guarda secretos o claves (secreto del proyecto)`
  }
  if (!ws.length) return null

  if (['bash', 'sh', 'zsh', 'dash', 'ksh'].includes(prog)) {
    const j = args.findIndex((a) => /^-[a-z]*c[a-z]*$/.test(a))
    return j >= 0 && args[j + 1] !== undefined ? evaluarCadena(args[j + 1], ctx) : null
  }
  if (prog === 'powershell' || prog === 'pwsh') {
    const j = args.findIndex((a) => /^-(c|command|encodedcommand|ec|e)$/i.test(a))
    if (j < 0) return null
    if (/^-(encodedcommand|ec|e)$/i.test(args[j])) return 'PowerShell codificado: no se puede revisar'
    return evaluarCadena(args.slice(j + 1).join(' '), { ...ctx, powershell: true })
  }
  if (prog === 'cmd') {
    const j = args.findIndex((a) => /^\/[ck]$/i.test(a))
    return j >= 0 ? evaluarCadena(args.slice(j + 1).join(' '), { ...ctx, powershell: true }) : null
  }
  if (prog === 'eval') return evaluarCadena(args.join(' '), ctx)
  if (['cd', 'pushd', 'set-location', 'sl', 'chdir'].includes(prog)) {
    const destino = args.find((a) => !a.startsWith('-'))
    if (destino) ctx.cwd = path.resolve(ctx.cwd, rutaNativa(destino))
    return null
  }

  if (prog === 'npx' && args.some((a) => a === '--no-install' || a === '--no')) {
    const j = args.findIndex((a) => !a.startsWith('-'))
    return j >= 0 ? evaluarBinario(nombreProg(args[j]), args.slice(j + 1), ctx) : null
  }
  if (Object.hasOwn(config.externos, prog)) return config.externos[prog]
  if (prog === 'git') return evaluarGit(args, ctx)
  if (GESTORES.has(prog)) return evaluarGestor(prog, args, ctx)
  const otro = evaluarOtros(prog, args, ctx)
  if (otro) return otro
  const bin = evaluarBinario(prog, args, ctx)
  if (bin) return bin

  if (prog === 'rm' && args.some(recursivo)) return 'borrado recursivo: no en un subagente'
  if (prog === 'rmdir' || prog === 'rd') return 'borrar carpetas: no en un subagente'
  if (['remove-item', 'ri', 'del', 'erase'].includes(prog) && args.some((a) => /^-rec/i.test(a) || /^\/s$/i.test(a))) {
    return 'borrado recursivo: no en un subagente'
  }
  if (['dd', 'mkfs', 'format', 'shred', 'diskpart', 'cipher'].includes(prog)) return `${prog}: destructivo`
  if ((prog === 'chmod' || prog === 'chown') && args.some((a) => /^-[a-zA-Z]*R/.test(a))) return 'cambio de permisos recursivo'
  if (prog === 'find') {
    const borra = args.some((a, j) => a === '-delete' || (['-exec', '-execdir', '-ok'].includes(a) && ['rm', 'rmdir', 'mv', 'shred'].includes(nombreProg(args[j + 1] ?? ''))))
    if (borra) return 'find que borra o mueve: no en un subagente'
  }

  if (ctx.rol === 'revisor') {
    if (ESCRIBEN.has(prog)) return `el revisor no modifica archivos (${prog})`
    if ((prog === 'sed' || prog === 'perl') && args.some(EDITA_EN_SITIO)) return 'el revisor no modifica archivos (edición en sitio)'
    if ((prog === 'awk' || prog === 'gawk') && args.some((a, j) => a === '-i' && /inplace/.test(args[j + 1] ?? ''))) {
      return 'el revisor no modifica archivos (awk inplace)'
    }
    return null
  }
  if (CON_DESTINO.has(prog) || ((prog === 'sed' || prog === 'perl') && args.some(EDITA_EN_SITIO))) {
    for (const a of args) {
      if (a.startsWith('-')) continue
      const m = motivoRuta(a, { raiz: ctx.raiz, base: ctx.cwd, permitirTemporal: true })
      if (m) return m
    }
  }
  return null
}

/** Motivo para negar el comando completo, o null. `ctx`: { rol, raiz, cwd, powershell }. */
export function evaluarCadena(cmd, ctx) {
  for (const simple of analizar(cmd, { powershell: ctx.powershell })) {
    const m = evaluarSimple(simple, ctx)
    if (m) return m
  }
  return null
}

// ── Entrada del hook ────────────────────────────────────────────────────────

/** `{ motivo, objetivo }`: motivo para negar (o null) y qué anotar en el registro. */
export function evaluar(evento, rol, raiz = RAIZ) {
  const herramienta = evento?.tool_name ?? ''
  const entrada = evento?.tool_input ?? {}
  const cwd = typeof evento?.cwd === 'string' && evento.cwd ? path.resolve(rutaNativa(evento.cwd)) : raiz
  if (herramienta === 'Bash' || herramienta === 'PowerShell') {
    const comando = String(entrada.command ?? '')
    const motivo = evaluarCadena(comando, { rol, raiz, cwd, powershell: herramienta === 'PowerShell' })
    return { motivo, objetivo: comando.replace(/\s*\r?\n\s*/g, ' ⏎ ').slice(0, 300) }
  }
  if (['Edit', 'Write', 'NotebookEdit', 'MultiEdit'].includes(herramienta)) {
    const ruta = String(entrada.file_path ?? entrada.notebook_path ?? '')
    const motivo = rol === 'revisor' ? 'el revisor no edita archivos' : motivoRuta(ruta, { raiz, base: cwd })
    const abs = path.resolve(cwd, rutaNativa(ruta))
    return { motivo, objetivo: relativaAlRepo(abs, raiz) ?? abs }
  }
  return { motivo: null, objetivo: null }
}

function registrar(raiz, fila) {
  const registro = registroDe(raiz)
  try {
    fs.mkdirSync(path.dirname(registro), { recursive: true })
    try {
      if (fs.statSync(registro).size > TOPE_REGISTRO) fs.renameSync(registro, registro.replace(/\.jsonl$/, '.1.jsonl'))
    } catch {
      // Todavía no existe.
    }
    fs.appendFileSync(registro, JSON.stringify({ ...fila, raiz }) + '\n')
  } catch {
    // El registro nunca rompe el hook.
  }
}

async function main() {
  const rol = process.argv[2] === 'revisor' ? 'revisor' : 'ejecutor'
  let crudo = ''
  for await (const trozo of process.stdin) crudo += trozo
  let evento
  try {
    evento = JSON.parse(crudo)
  } catch {
    return
  }
  const raiz = raizDe(process.env.CLAUDE_PROJECT_DIR || evento?.cwd || process.cwd())
  let resultado
  try {
    resultado = evaluar(evento, rol, raiz)
  } catch (e) {
    registrar(raiz, { t: new Date().toISOString(), rol, herramienta: evento?.tool_name ?? null, error: String(e?.message ?? e) })
    return
  }
  if (!resultado.objetivo && !resultado.motivo) return
  registrar(raiz, {
    t: new Date().toISOString(),
    rol,
    agente: evento.agent_id ?? null,
    esfuerzo: evento.effort?.level ?? evento.effort ?? null,
    herramienta: evento.tool_name,
    objetivo: resultado.objetivo,
    decision: resultado.motivo ? 'negado' : 'permitido',
    ...(resultado.motivo ? { motivo: resultado.motivo } : {}),
  })
  if (resultado.motivo) {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: `Guardia /implementador: ${resultado.motivo}. No lo rodees: anótalo en BLOQUEOS de tu reporte.`,
      },
    }))
  }
}

function esPrincipal() {
  if (!process.argv[1]) return false
  const a = path.resolve(process.argv[1])
  const b = fileURLToPath(import.meta.url)
  return WIN ? a.toLowerCase() === b.toLowerCase() : a === b
}

if (esPrincipal()) await main()
