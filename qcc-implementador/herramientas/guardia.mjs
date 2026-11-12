#!/usr/bin/env node
// Guardia de los subagentes de /impl (sirve para cualquier proyecto).
//
// Hook PreToolUse del plugin (`hooks/hooks.json`): Claude Code lo corre en cada llamada de herramienta de la
// sesión, y la guardia decide por el `agent_type` del evento (`impl:qcc-ejecutor`…) a quién
// vigila. Los agentes de un plugin ignoran `hooks:` en su frontmatter, por eso no se declara allí. Sin
// `agent_type` (la sesión principal) o con el de otro agente, no hace nada: ni niega, ni anota, ni toca git.
//
// Al `ejecutor` y al `revisor` les niega lo que un subagente no hace nunca —git que modifica, servicios
// externos y despliegues, dependencias, secretos, borrados recursivos, servidores que no terminan, archivos
// protegidos (en `.claude/`, solo settings y agentes); y al revisor, escribir fuera de los temporales— y deja
// cada llamada en el registro del proyecto (`<git-dir>/qcc-impl/registro.jsonl`), que `estado.mjs --cambios`
// cruza con el árbol para el chequeo de alcance (cubre rutas que git ignora).
// `explorador` y `planificador` (solo lectura) anotan sus Read, Glob y Grep con decision `lectura`; solo
// al explorador, con el contexto de su subagente sobre 90k (fijo: Haiku cobra 5× el pedido de más de 100k), se los niega para que reporte ya. Al ejecutor,
// con su contexto sobre 100k, también se le niegan Read, Glob y Grep (sin anotar las que pasan) para que termine.
//
// Lo propio de cada proyecto va en `<raíz>/.claude/qcc-implementador.json` (o, de respaldo, el
// nombre viejo `.claude/implementador.json`), clave `guardia` (ver `config.ejemplo.md`).
// Sin ese archivo rigen los valores por defecto.
//
// En una copia solo cuenta el destino; las variables asignadas en el mismo comando (`S=/tmp/x; mkdir "$S"`) se
// expanden; el ejecutor escribe en temporales y el revisor, además, edita en sitio (`sed -i`) solo ahí.
//
// Ante la duda, deja pasar: un guardia que castra al ejecutor cuesta la tarea entera.
// Un error de parseo nunca niega.
//
// Casos: `node --test qcc-implementador/herramientas/guardia.test.mjs`.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

/** Carpeta de Claude Code del usuario (`CLAUDE_CONFIG_DIR` o `~/.claude`). */
const CLAUDE = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')
const TOPE_REGISTRO = 2 * 1024 * 1024
/** Contexto del explorador (tokens) desde el que se le niegan Read, Glob y Grep. */
export const TOPE_CONTEXTO_EXPLORADOR = 90_000
/** Contexto del ejecutor (tokens) desde el que se le niegan Read, Glob y Grep. */
export const TOPE_CONTEXTO_EJECUTOR = 100_000
const COLA_TRANSCRIPT = 256 * 1024
const WIN = process.platform === 'win32'

// ── Proyecto ────────────────────────────────────────────────────────────────

/**
 * Raíz del repo git que contiene `dir` (o `dir` si no es un repo): la primera carpeta hacia arriba con `.git` (carpeta, o
 * archivo de un worktree o submódulo), sin lanzar `git`, que corre en cada herramienta de cada subagente. Sin `.git`, pregunta a git.
 */
export function raizDe(dir) {
  const d = path.resolve(rutaNativa(dir || process.cwd()))
  for (let c = d; ; c = path.dirname(c)) {
    if (fs.existsSync(path.join(c, '.git'))) return c
    if (path.dirname(c) === c) break
  }
  try {
    const top = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: d, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }).trim()
    if (top) return path.resolve(rutaNativa(top))
  } catch {
    // No es un repo, o git no responde.
  }
  return d
}

/**
 * Proyecto actual: CLAUDE_PROJECT_DIR (hooks) o el cwd, subido a la raíz del repo. Como hook no se usa (`main` calcula la
 * suya con el `cwd` del evento), y ahorra un `git` por cada llamada de herramienta de la sesión.
 */
export const RAIZ = esPrincipal() ? '' : raizDe(process.env.CLAUDE_PROJECT_DIR || process.cwd())

/** Nombre del proyecto en las rutas de los flujos: `<carpeta>-<hash de la ruta>`. */
export function nombreDe(raiz) {
  const norma = path.resolve(raiz)
  const clave = WIN ? norma.toLowerCase() : norma
  const hash = crypto.createHash('sha1').update(clave).digest('hex').slice(0, 10)
  const nombre = (path.basename(norma) || 'raiz').replace(/[^\w.-]+/g, '_')
  return `${nombre}-${hash}`
}

/**
 * Carpeta git de `raiz`, leída de `<raiz>/.git` sin lanzar `git`: la carpeta misma, o la que apunta el archivo
 * `.git` de un worktree (línea `gitdir:`, relativa a `raiz`). Null si falta el `.git`, la línea o la carpeta.
 */
export function gitDirDe(raiz) {
  try {
    const punto = path.join(path.resolve(raiz), '.git')
    if (fs.statSync(punto).isDirectory()) return punto
    const linea = fs.readFileSync(punto, 'utf8').split(/\r?\n/).find((l) => l.startsWith('gitdir:'))
    if (!linea) return null
    const destino = path.resolve(path.resolve(raiz), linea.slice(7).trim())
    return fs.statSync(destino).isDirectory() ? destino : null
  } catch {
    return null
  }
}

/** Carpeta global de los flujos (`flujos.jsonl`, `historial/`): `FLUJOS_REGISTROS` o `<CLAUDE>/flujos/registros`. */
export function carpetaGlobal() {
  return process.env.FLUJOS_REGISTROS || path.join(CLAUDE, 'flujos', 'registros')
}

/**
 * Registro de llamadas de los subagentes, uno por proyecto. Junto a él viven la carpeta del flujo y la caché de
 * verificar. Está en `<git-dir>/qcc-impl/registro.jsonl`: sigue al repo (y a su worktree) y fuera de la carpeta del
 * plugin, así que sobrevive a las actualizaciones. Sin git dir, o con `FLUJOS_REGISTROS` (los tests la llevan a un
 * temporal), queda en `<carpetaGlobal>/<proyecto>-<hash>.jsonl`.
 */
export function registroDe(raiz) {
  const gitDir = process.env.FLUJOS_REGISTROS ? null : gitDirDe(raiz)
  if (gitDir) return path.join(gitDir, 'qcc-impl', 'registro.jsonl')
  return path.join(carpetaGlobal(), `${nombreDe(raiz)}.jsonl`)
}

/** Carpeta del flujo en curso del proyecto (estado, plan y subtareas), junto a su registro. */
export function flujoDe(raiz) {
  return registroDe(raiz).replace(/\.jsonl$/, '-flujo')
}

/**
 * Hash del árbol de trabajo: versionados más nuevos no ignorados (y `forzar`, rutas permitidas que git
 * ignora), armado con un índice temporal, así que no toca el índice ni los archivos del usuario.
 */
export function arbolDe(raiz, forzar = []) {
  const git = (args, env = process.env) => {
    try {
      return execFileSync('git', args, { cwd: raiz, encoding: 'utf8', env, maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    } catch (e) {
      throw new Error(`git ${args.join(' ')}: ${String(e.stderr || e.message).trim()}`)
    }
  }
  const indiceReal = path.resolve(raiz, git(['rev-parse', '--git-path', 'index']).trim())
  const tmp = path.join(os.tmpdir(), `qcc-implementador-indice-${process.pid}-${Date.now()}`)
  try {
    fs.copyFileSync(indiceReal, tmp)
  } catch {
    // Repo sin índice todavía: el árbol parte vacío.
  }
  const env = { ...process.env, GIT_INDEX_FILE: tmp }
  try {
    git(['add', '-A', '--', '.'], env)
    const extra = forzar.filter((p) => !/[*?]/.test(p) && fs.existsSync(path.join(raiz, p)))
    if (extra.length) git(['add', '-f', '--', ...extra], env)
    return git(['write-tree'], env).trim()
  } finally {
    fs.rmSync(tmp, { force: true })
  }
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

// Los subagentes no llaman servicios. Excepción: el ejecutor lee http(s) con curl, wget, iwr e irm (evaluarLecturaRed).
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

/** Config del proyecto: el nombre nuevo y, solo si no existe, el viejo (nunca se mezclan). */
const CONFIG_NUEVA = '.claude/qcc-implementador.json'
const CONFIG_VIEJA = '.claude/implementador.json'

/**
 * Configuración efectiva del proyecto: valores por defecto + `.claude/qcc-implementador.json`
 * o, si no existe, `.claude/implementador.json`. `nombre` es el archivo que rige (el nuevo si no hay ninguno).
 */
export function configDe(raiz) {
  if (cacheConfig.has(raiz)) return cacheConfig.get(raiz)
  const nombre = fs.existsSync(path.join(raiz, CONFIG_NUEVA)) || !fs.existsSync(path.join(raiz, CONFIG_VIEJA)) ? CONFIG_NUEVA : CONFIG_VIEJA
  const archivo = path.join(raiz, nombre)
  const crudo = leerJson(archivo)
  const g = crudo?.guardia ?? {}
  const pkg = leerJson(path.join(raiz, 'package.json'))
  const config = {
    nombre,
    archivo: crudo ? archivo : null,
    invalido: fs.existsSync(archivo) && !crudo,
    verificar: Array.isArray(crudo?.verificar) ? crudo.verificar : null,
    protegidos: { ...PROTEGIDOS_BASE, ...(g.protegidos ?? {}) },
    secretos: (g.secretos ?? []).map(String),
    inmutables: [...INMUTABLES_BASE, ...(g.inmutables ?? [])],
    externos: { ...EXTERNOS_BASE, ...(g.externos ?? {}) },
    scriptsNegados: [...SCRIPTS_NEGADOS_BASE, ...(g.scriptsNegados ?? [])],
    scriptsPermitidos: Array.isArray(g.scriptsPermitidos) ? g.scriptsPermitidos.map(String) : null,
    nodeNegado: (g.nodeNegado ?? []).map(String),
    criticos: Array.isArray(crudo?.criticos) ? crudo.criticos.filter((r) => r && typeof r === 'object') : [],
    pm: gestorDe(raiz, pkg),
    scripts: pkg?.scripts && typeof pkg.scripts === 'object' ? pkg.scripts : {},
  }
  cacheConfig.set(raiz, config)
  return config
}

// ── Rutas ───────────────────────────────────────────────────────────────────

/** `~` y `$HOME` → carpeta del usuario; `$TEMP` y similares → temporal; `/d/x` de Git Bash → `d:/x` en Windows; lo demás, igual. */
export function rutaNativa(p) {
  const s = String(p)
    .replace(/^(~|\$HOME|\$\{HOME\}|\$env:USERPROFILE|%USERPROFILE%)(?=$|[\\/])/i, () => os.homedir())
    .replace(/^\$\{?(TMPDIR|TEMP|TMP)\}?(?=$|[\\/])/, () => os.tmpdir())
    .replace(/^(\$env:(TEMP|TMP)|%(TEMP|TMP)%)(?=$|[\\/])/i, () => os.tmpdir())
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

/** ¿`cruda` (destino de un comando, relativo a `ctx.cwd`) cae en un temporal fuera del repo? (Un repo puede vivir dentro del temporal.) */
function temporal(cruda, ctx) {
  const abs = path.resolve(ctx.cwd, rutaNativa(cruda))
  return relativaAlRepo(abs, ctx.raiz) === null && esTemporal(String(cruda), abs)
}

const versionados = new Map()
function versionado(rel, raiz) {
  const clave = `${raiz}|${rel}`
  if (!versionados.has(clave)) {
    let si = false
    try {
      execFileSync('git', ['ls-files', '--error-unmatch', '--', rel], { cwd: raiz, stdio: 'ignore', windowsHide: true })
      si = true
    } catch {
      // No versionado, o git no responde: ante la duda, deja pasar.
    }
    versionados.set(clave, si)
  }
  return versionados.get(clave)
}

// El resto de `.claude/` (reglas y config de /impl) se edita si el plan lo permite.
const CLAUDE_BLINDADO = /^\.claude\/(settings(\.local)?\.json$|agents(\/|$))/i
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
  if (CLAUDE_BLINDADO.test(r)) return `${rel}: con settings o agentes del proyecto se apaga la guardia; lo edita el usuario`
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
  'version', 'help', 'count-objects', 'var', 'cherry', 'range-diff', 'show-branch', 'archive',
])
const GIT_OPC_CON_VALOR = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--super-prefix', '--config-env', '--exec-path'])
const GIT_RAMA_PELIGRO = /^(-d|-D|-m|-M|-c|-C|-f|-u|-t|--delete|--move|--copy|--force|--set-upstream-to.*|--unset-upstream|--track.*|--edit-description|--create-reflog)$/
const GIT_RAMA_CON_VALOR = /^--(contains|no-contains|merged|no-merged|points-at|sort|format)$/

/** Archivo que escribe un git de lectura (`--output`, y `-o` en `git archive`); '' si falta el valor, null si no escribe. */
function salidaGit(sub, resto) {
  for (let k = 0; k < resto.length; k++) {
    const a = resto[k]
    if (a === '--output' || (sub === 'archive' && a === '-o')) return resto[k + 1] ?? ''
    if (a.startsWith('--output=')) return a.slice('--output='.length)
    if (sub === 'archive' && /^-o./.test(a)) return a.slice(2)
  }
  return null
}

function evaluarGit(args, ctx) {
  let k = 0
  while (k < args.length && args[k].startsWith('-')) k += GIT_OPC_CON_VALOR.has(args[k]) ? 2 : 1
  const sub = (args[k] ?? '').toLowerCase()
  const resto = args.slice(k + 1)
  if (!sub) return null
  if (GIT_LECTURA.has(sub)) {
    if (sub === 'archive' && resto.some((a) => a.startsWith('--remote'))) return 'git archive --remote habla con el remoto: red'
    const destino = salidaGit(sub, resto)
    if (destino === null) return null
    if (ctx.rol === 'revisor') return destino && temporal(destino, ctx) ? null : `el revisor solo escribe en temporales (git ${sub} a ${destino || '?'})`
    return motivoRuta(destino, { raiz: ctx.raiz, base: ctx.cwd, permitirTemporal: true })
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
    return `${pm} run ${nombre}: en este proyecto los subagentes solo corren ${config.scriptsPermitidos.join(', ')} (${config.nombre})`
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

/** Opciones de `estado.mjs` que escriben el estado del flujo: son del orquestador, no de un subagente. */
const ESTADO_ESCRIBE = /^--(permiso|permiso-nuevo|base|cambios|guardar|cancelar|tanda|aprobado|reanudar)(=|$)/

/** Índice (en `args`, de `node`) del script que corre; -1 si corre código en línea (`-e`…) o ninguno. */
function indiceScript(args) {
  for (let k = 0; k < args.length; k++) {
    if (NODE_CODIGO.has(args[k])) return -1
    if (NODE_OPC_CON_VALOR.has(args[k])) k++
    else if (!args[k].startsWith('-')) return k
  }
  return -1
}

const nombreScript = (args, k) => (k < 0 ? '' : args[k].split(/[\\/]/).pop().toLowerCase())

/** Motivo si `args` (de `node`) corre `estado.mjs` con una opción que escribe estado; `null` si no. */
function motivoEstadoEscribe(args) {
  const k = indiceScript(args)
  if (nombreScript(args, k) !== 'estado.mjs') return null
  const opcion = args.slice(k + 1).find((a) => ESTADO_ESCRIBE.test(a))
  return opcion ? `estado.mjs ${opcion.split('=')[0]} escribe el estado del flujo (aprobaciones, fotos, cierre): solo el orquestador` : null
}

/** ¿El flujo del proyecto tiene una fase en paralelo (lote o tanda) abierta, sin `hasta`? Un error de lectura es «no». */
function hayParaleloAbierto(raiz) {
  try {
    const paralelos = leerJson(path.join(flujoDe(raiz), 'estado.json'))?.paralelos
    return Array.isArray(paralelos) && paralelos.some((p) => p && (p.tipo === 'lote' || p.tipo === 'tanda') && Number.isFinite(Date.parse(p.desde)) && p.hasta === undefined)
  } catch {
    return false
  }
}

function evaluarNode(args, ctx) {
  const m = motivoEstadoEscribe(args)
  if (m) return m
  if (ctx.rol === 'ejecutor' && nombreScript(args, indiceScript(args)) === 'verificar.mjs' && hayParaleloAbierto(ctx.raiz)) {
    return 'verificar.mjs con un lote o una tanda en paralelo abierto falsea la medición (otros agentes editan a la vez): en un lote corre solo tus tests puntuales y reporta «VERIFICACIÓN: puntual (lote)»; verificar.mjs lo corre el orquestador'
  }
  if (ctx.rol === 'revisor' && nombreScript(args, indiceScript(args)) === 'mover.mjs') return 'mover.mjs escribe en el repo: el revisor no edita'
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
const COPIAN = new Set(['cp', 'copy', 'copy-item', 'cpi', 'install'])

/**
 * Las rutas que escribe `prog`. En una copia solo el destino (el origen solo se lee): `-t <dir>`,
 * `--target-directory`, `-Destination` de PowerShell o, si no, el último argumento suelto. Si el destino es una
 * carpeta (`-t`, termina en `/` o ya existe como carpeta), cuenta cada archivo que cae dentro. `install -d` crea todas.
 */
function destinosDe(prog, args, ctx) {
  const rutas = args.filter((a) => !a.startsWith('-'))
  if (!COPIAN.has(prog) || (prog === 'install' && args.some((a) => a === '-d' || a === '--directory'))) return rutas
  let destino = null
  let carpeta = false
  for (let k = 0; k < args.length && destino === null; k++) {
    const a = args[k]
    const pegado = /^(?:--target-directory=|-dest(?:ination)?:)(.+)$/i.exec(a)
    if (a === '-t' || a === '--target-directory' || /^-dest(ination)?$/i.test(a)) {
      if (args[k + 1] === undefined) return []
      destino = args[k + 1]
      carpeta = !/^-dest/i.test(a)
    } else if (pegado) {
      destino = pegado[1]
      carpeta = !/^-dest/i.test(a)
    }
  }
  const origenes = destino === null ? rutas.slice(0, -1) : rutas.filter((r) => r !== destino)
  destino ??= rutas.at(-1)
  if (destino === undefined) return []
  if (!carpeta) {
    try {
      carpeta = /[\\/]$/.test(destino) || fs.statSync(path.resolve(ctx.cwd, rutaNativa(destino))).isDirectory()
    } catch {
      // No existe: es el archivo de destino.
    }
  }
  if (!carpeta || !origenes.length) return [destino]
  return [destino, ...origenes.map((o) => `${destino.replace(/[\\/]+$/, '')}/${path.basename(rutaNativa(o))}`)]
}

/** ¿Todo lo que `prog` escribe cae en temporales? */
function soloTemporales(prog, args, ctx) {
  const destinos = destinosDe(prog, args, ctx)
  return destinos.length > 0 && destinos.every((a) => temporal(a, ctx))
}

/**
 * Archivos que edita en sitio un `sed -i` o `perl -i`: sin el script ni los valores de `-e`/`-f` (sed) o
 * `-e`/`-E` (perl, también al final de un grupo como `-pie`). Sin `-e`, el primer argumento suelto es el script.
 */
function archivosEnSitio(prog, args) {
  const archivos = []
  let script = false
  const conValor = prog === 'sed' ? /^(-[a-zA-Z]*[ef]|--expression|--file)$/ : /^-[a-zA-Z0-9]*[eE]$/
  for (let k = 0; k < args.length; k++) {
    const a = args[k]
    if (a === '--') {
      archivos.push(...args.slice(k + 1).slice(script ? 0 : 1))
      break
    }
    if (a.startsWith('-') && a.length > 1) {
      if (conValor.test(a)) {
        k++
        script = true
      } else if (/^--(expression|file)=/.test(a)) script = true
      continue
    }
    if (script) archivos.push(a)
    else script = true
  }
  return archivos
}

const NOMBRE_VARIABLE = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g

/** `texto` con las variables que el mismo comando asignó antes (`S="/tmp/x"; mkdir "$S/a"`); las demás quedan igual. */
function expandir(texto, ctx) {
  if (!ctx.variables?.size) return texto
  return String(texto).replace(NOMBRE_VARIABLE, (todo, llaves, suelta) => ctx.variables.get(llaves ?? suelta) ?? todo)
}

/**
 * Anota las variables de un comando que solo asigna (`S=…`, `export S=…`, `$S = …` en PowerShell) para expandirlas en
 * los comandos siguientes. Un valor con `$(…)` o comillas invertidas no se conoce: la variable se olvida.
 */
function anotarVariables({ palabras, redirs }, ctx) {
  if (redirs.length || !palabras.length) return
  let ws = palabras
  if (['export', 'declare', 'typeset', 'local', 'readonly'].includes(ws[0])) ws = ws.slice(1).filter((w) => !w.startsWith('-'))
  if (ctx.powershell && ws.length === 3 && /^\$[A-Za-z_]\w*$/.test(ws[0]) && ws[1] === '=') ws = [`${ws[0].slice(1)}=${ws[2]}`]
  if (!ws.length || !ws.every((w) => ASIGNACION.test(w))) return
  ctx.variables ??= new Map()
  for (const w of ws) {
    const k = w.indexOf('=')
    const valor = expandir(w.slice(k + 1), ctx)
    if (valor.includes('\u0000')) ctx.variables.delete(w.slice(0, k))
    else ctx.variables.set(w.slice(0, k), valor)
  }
}

const PLAYWRIGHT_BINARIOS = new Set(['playwright', 'playwright-cli', '@playwright/test', '@playwright/cli'])

/** Opciones de `npx`/`exec`/`dlx` que no cambian qué paquete se ejecuta. Cualquier otra (`-p`, `--package`, `-c`, `--call`…) anula la regla. */
const PLAYWRIGHT_OPCIONES = new Set(['-y', '--yes', '--no', '--no-install', '--', '--bun'])

/**
 * El primer argumento que no es opción, sin su `@versión` final, es un binario o paquete de Playwright (comparación exacta).
 * Antes del binario solo valen las opciones de PLAYWRIGHT_OPCIONES, y la versión no puede llevar `:` (`@npm:otro`, `@github:…`).
 */
function primeroEsPlaywright(args) {
  for (const a of args) {
    if (a.startsWith('-')) {
      if (!PLAYWRIGHT_OPCIONES.has(a)) return false
      continue
    }
    return PLAYWRIGHT_BINARIOS.has(a.toLowerCase().replace(/(?<=.)@[^@/:]*$/, ''))
  }
  return false
}

const NPX_OPCIONES_CON_VALOR = new Set(['--prefix', '-p', '--package', '-c', '--call', '--cache', '--registry', '--userconfig', '-w', '--workspace'])

/** Índice del binario en los args de `npx` (-1 si no hay): salta las opciones y el valor aparte de las que lo llevan (`--prefix D:/x`). */
function binDeNpx(args) {
  for (let k = 0; k < args.length; k++) {
    if (!args[k].startsWith('-')) return k
    if (NPX_OPCIONES_CON_VALOR.has(args[k])) k++
  }
  return -1
}

/** Variables que cambian el paquete o el registro con que npx, `exec` o `dlx` bajan el binario. */
const CONFIG_PAQUETES = /^(\$env:)?(npm_config_|pnpm_config_|bun_config_|yarn_)/i

/**
 * `playwright …`, `npx|pnpx|bunx playwright …` o `<gestor> exec|dlx|x playwright …` (también `@playwright/test` y `@playwright/cli`).
 * npm queda fuera: está prohibido, solo se usa pnpm. Del gestor no se admite ninguna opción antes del subcomando (`--package`, `--registry`…).
 */
function esPlaywright(prog, args) {
  if (prog === 'playwright' || prog === 'playwright-cli') return true
  if (['npx', 'pnpx', 'bunx'].includes(prog)) return primeroEsPlaywright(args)
  if (prog === 'npm' || !GESTORES.has(prog) || !['exec', 'dlx', 'x'].includes(args[0])) return false
  return primeroEsPlaywright(args.slice(1))
}

// ── Red de solo lectura: curl, wget, iwr e irm (solo el ejecutor) ──

const RED_PROGS = new Set(['curl', 'wget', 'iwr', 'irm', 'invoke-webrequest', 'invoke-restmethod'])
const INTERPRETES = new Set([
  'bash', 'sh', 'zsh', 'dash', 'ksh', 'pwsh', 'powershell', 'cmd', 'node', 'python', 'python3', 'py', 'perl', 'ruby', 'php',
  'deno', 'bun', 'eval', 'source', '.', 'iex', 'invoke-expression',
])
const RE_IEX = /(^|[\s(;|&{'"`])(iex|invoke-expression)(?![\w-])/i
const RE_RED = /(^|[\s(;|&{'"`$])(curl|wget|iwr|irm|invoke-webrequest|invoke-restmethod)(?![\w-])/i
const URL_HTTP = /^https?:\/\/\S+$/i
const motivoRed = (por) => `red: el ejecutor solo lee (GET/HEAD a http(s), sin cuerpo, subida ni escritura fuera de un temporal): ${por}`

/** ¿Un comando de red convive con un intérprete (`curl … | sh`, `iex (irm …)`, `iex(irm …)`)? Solo el ejecutor puede leer de la red. */
function bajaYEjecuta(cmd, simples, ctx) {
  if (ctx.rol !== 'ejecutor') return false
  const progs = simples.map((s) => nombreProg(sinPrefijos(s.palabras)[0] ?? ''))
  const red = progs.some((p) => RED_PROGS.has(p))
  return (red && progs.some((p) => INTERPRETES.has(p))) || (RE_IEX.test(cmd) && (red || RE_RED.test(cmd)))
}

/** Destino de una descarga: el dispositivo nulo, `-` (stdout, si `stdout`) o un temporal fuera del repo. */
function salidaRed(ruta, ctx, stdout) {
  if (/^(\/dev\/null|nul|\$null)$/i.test(ruta) || (stdout && ruta === '-')) return null
  if (ruta && !ruta.includes('\u0000') && temporal(ruta, ctx)) return null
  return motivoRed(`escribir en ${ruta || '?'} (solo a un temporal; al repo, con Edit o Write)`)
}

const CURL = {
  cortas: new Set('sSLIikfgNv46Vh'),
  cortasValor: { H: 'header', A: 'user-agent', e: 'referer', m: 'max-time', w: 'write-out', X: 'request', r: 'range', o: 'output', D: 'dump-header' },
  largas: new Set([
    'silent', 'show-error', 'location', 'head', 'include', 'insecure', 'fail', 'fail-with-body', 'globoff', 'no-buffer', 'ipv4',
    'ipv6', 'verbose', 'version', 'help', 'compressed', 'http1.1', 'http2', 'no-progress-meter', 'progress-bar', 'raw',
  ]),
  largasValor: new Set([
    'header', 'user-agent', 'referer', 'max-time', 'connect-timeout', 'retry', 'retry-delay', 'retry-max-time', 'write-out',
    'request', 'range', 'max-redirs', 'url', 'output', 'dump-header',
  ]),
}
const WGET = {
  cortas: new Set('qvSh46V'),
  cortasValor: { O: 'output-document', T: 'timeout', t: 'tries', U: 'user-agent' },
  largas: new Set(['quiet', 'verbose', 'no-verbose', 'server-response', 'spider', 'no-check-certificate', 'no-cache', 'no-cookies', 'version', 'help']),
  largasValor: new Set(['output-document', 'timeout', 'tries', 'user-agent', 'header', 'max-redirect']),
}

/**
 * Recorre los args de curl o wget con la lista blanca `spec`: solo opciones conocidas (lo dudoso se niega), las cortas juntas
 * letra a letra (`-sSLo f`, `-XPOST`: la letra que toma valor se lleva el resto del grupo o la palabra siguiente) y solo URL http(s).
 * Anota en `vistas` las opciones con valor y las largas que vio. Devuelve el motivo para negar, o null.
 */
function recorrerRed(args, ctx, spec, vistas) {
  const toma = (nombre, valor) => {
    vistas.add(nombre)
    if (valor === undefined) return motivoRed(`${nombre} sin valor`)
    if (nombre === 'request' && !/^(GET|HEAD)$/i.test(valor)) return motivoRed(`-X ${valor}`)
    if (['output', 'dump-header', 'output-document'].includes(nombre)) return salidaRed(valor, ctx, true)
    if (nombre === 'url' && !URL_HTTP.test(valor)) return motivoRed(`${valor}: solo URL http(s)`)
    return null
  }
  let soloUrls = false
  for (let k = 0; k < args.length; k++) {
    const a = args[k]
    let m = null
    if (soloUrls || a === '-' || !a.startsWith('-')) m = URL_HTTP.test(a) ? null : motivoRed(`${a}: solo URL http(s)`)
    else if (a === '--') soloUrls = true
    else if (a.startsWith('--')) {
      const i = a.indexOf('=')
      const nombre = i < 0 ? a.slice(2) : a.slice(2, i)
      if (spec.largas.has(nombre)) vistas.add(nombre)
      else if (spec.largasValor.has(nombre)) m = toma(nombre, i < 0 ? args[++k] : a.slice(i + 1))
      else m = motivoRed(`--${nombre} no está permitida`)
    } else {
      for (let j = 1; j < a.length; j++) {
        if (spec.cortas.has(a[j])) continue
        const nombre = Object.hasOwn(spec.cortasValor, a[j]) ? spec.cortasValor[a[j]] : null
        m = nombre ? toma(nombre, a.length > j + 1 ? a.slice(j + 1) : args[++k]) : motivoRed(`-${a[j]} no está permitida`)
        break
      }
    }
    if (m) return m
  }
  return null
}

// Parámetros de Invoke-WebRequest e Invoke-RestMethod: los comunes, para que una abreviatura ambigua se niegue.
const PS_INTERRUPTORES = ['UseBasicParsing', 'SkipCertificateCheck', 'SkipHttpErrorCheck', 'AllowInsecureRedirect', 'DisableKeepAlive', 'NoProxy', 'SkipHeaderValidation', 'PassThru', 'Verbose', 'Debug']
const PS_VALOR = ['Uri', 'Method', 'OutFile', 'Headers', 'UserAgent', 'TimeoutSec', 'MaximumRedirection', 'MaximumRetryCount', 'RetryIntervalSec', 'ErrorAction']
const PS_PELIGRO = [
  'Body', 'InFile', 'Form', 'Resume', 'CustomMethod', 'Credential', 'Authentication', 'Token', 'Proxy', 'ProxyCredential', 'ProxyUseDefaultCredentials',
  'WebSession', 'SessionVariable', 'ContentType', 'TransferEncoding', 'AllowUnencryptedAuthentication', 'Certificate', 'CertificateThumbprint',
  'SslProtocol', 'PreserveAuthorizationOnRedirect', 'UseDefaultCredentials', 'HttpVersion', 'ResponseHeadersVariable', 'StatusCodeVariable',
  'WarningAction', 'InformationAction', 'ProgressAction', 'ErrorVariable', 'WarningVariable', 'InformationVariable', 'OutVariable', 'OutBuffer',
  'PipelineVariable', 'WhatIf', 'Confirm', 'Key',
]
const PS_TODOS = [...PS_INTERRUPTORES, ...PS_VALOR, ...PS_PELIGRO]

/** `iwr`, `irm` e `Invoke-*`: parámetros sin mayúsculas y por prefijo (`-Meth`); una abreviatura ambigua o desconocida se niega. */
function evaluarWebPS(args, ctx) {
  for (let k = 0; k < args.length; k++) {
    const a = args[k]
    if (!/^-[A-Za-z]/.test(a)) {
      if (!URL_HTTP.test(a)) return motivoRed(`${a}: solo URL http(s)`)
      continue
    }
    const c = a.indexOf(':')
    const p = (c < 0 ? a.slice(1) : a.slice(1, c)).toLowerCase()
    const prefijados = PS_TODOS.filter((n) => n.toLowerCase().startsWith(p))
    const nombre = PS_TODOS.find((n) => n.toLowerCase() === p) ?? (prefijados.length === 1 ? prefijados[0] : null)
    if (!nombre) return motivoRed(`${a}: parámetro desconocido o ambiguo`)
    if (PS_INTERRUPTORES.includes(nombre)) continue
    if (!PS_VALOR.includes(nombre)) return motivoRed(`-${nombre} puede enviar, subir o escribir`)
    const valor = c < 0 ? args[++k] : a.slice(c + 1)
    if (valor === undefined) return motivoRed(`-${nombre} sin valor`)
    if (nombre === 'Method' && !/^(get|head)$/i.test(valor)) return motivoRed(`-Method ${valor}`)
    if (nombre === 'Uri' && !URL_HTTP.test(valor)) return motivoRed(`${valor}: solo URL http(s)`)
    if (nombre === 'OutFile') {
      const m = salidaRed(valor, ctx, false)
      if (m) return m
    }
  }
  return null
}

/** Motivo para negar un curl, wget, iwr o irm del ejecutor, o null si solo lee. */
function evaluarLecturaRed(prog, args, ctx) {
  if (prog === 'curl') return recorrerRed(args, ctx, CURL, new Set())
  if (prog === 'wget') {
    const vistas = new Set()
    const m = recorrerRed(args, ctx, WGET, vistas)
    if (m) return m
    return vistas.has('spider') || vistas.has('output-document') ? null : motivoRed('wget sin -O ni --spider escribe en la carpeta actual')
  }
  return evaluarWebPS(args, ctx)
}

const ENV_FILE = /^--env-file=\.env(\.[\w-]+)?$/

/** ¿Un permiso vigente (`ctx.permisos`, solo del ejecutor) cubre estas palabras, unidas por un espacio? */
function permitido(palabras, ctx) {
  if (ctx.rol !== 'ejecutor' || !ctx.permisos?.length || palabras.some((w) => w.includes('\u0000'))) return false
  const texto = palabras.join(' ').replace(/\s+/g, ' ')
  return ctx.permisos.some((re) => re.test(texto))
}

/**
 * Lo que ningún permiso levanta, ni aprobado: git que modifica, `estado.mjs` que escribe el estado, comandos
 * destructivos y destinos protegidos (fuera del repo, `.git/`, settings, secretos, lockfiles, artefactos).
 */
function motivoFijo(prog, args, ctx) {
  if (prog === 'git') return evaluarGit(args, ctx)
  if (prog === 'node') return motivoEstadoEscribe(args)
  if (['format', 'diskpart', 'mkfs'].includes(prog)) return `${prog}: destructivo`
  if (CON_DESTINO.has(prog) || COPIAN.has(prog) || ((prog === 'sed' || prog === 'perl') && args.some(EDITA_EN_SITIO))) {
    // sed/perl: solo los archivos, no el script (`/a/,/b/c\…` parecería una ruta absoluta).
    const rutas = COPIAN.has(prog) ? destinosDe(prog, args, ctx) : prog === 'sed' || prog === 'perl' ? archivosEnSitio(prog, args) : args
    for (const a of rutas) {
      if (a.startsWith('-')) continue
      const m = motivoRuta(a, { raiz: ctx.raiz, base: ctx.cwd, permitirTemporal: true })
      if (m) return m
    }
  }
  return null
}

/** `motivoFijo` de cada comando simple de `comando` (como lo correría el ejecutor en `raiz`); null si ninguno lo tiene. */
export function motivoFijoDe(comando, { raiz = RAIZ } = {}) {
  const ctx = { rol: 'ejecutor', raiz, cwd: raiz }
  for (const simple of analizar(sinEnvoltura(comando))) {
    const ws = sinPrefijos(simple.palabras)
    const m = ws.length ? motivoFijo(nombreProg(ws[0]), ws.slice(1), ctx) : null
    if (m) return m
  }
  return null
}

function evaluarSimple(simple, ctx) {
  const palabras = simple.palabras.map((w) => expandir(w, ctx))
  const redirs = simple.redirs.map((r) => ({ ...r, objetivo: expandir(r.objetivo, ctx) }))
  const config = configDe(ctx.raiz)
  // Una variable npm_config_* (en el comando, tras `env`, `export`, `$env:`…) vale para el resto del comando: Playwright deja de ser libre.
  if (palabras.some((w) => CONFIG_PAQUETES.test(w))) ctx.configPaquetes = true
  for (const r of redirs) {
    if (SECRETO.test(r.objetivo)) return 'toca un .env (secretos)'
    if (!['>', '>>', '>|', '&>', '&>>'].includes(r.op)) {
      if (nombraSecreto(r.objetivo, ctx)) return `${r.objetivo} guarda secretos o claves (secreto del proyecto)`
      continue
    }
    if (/^(\/dev\/(null|stdout|stderr)|nul|\$null)$/i.test(r.objetivo)) continue
    if (ctx.rol === 'revisor') {
      if (temporal(r.objetivo, ctx)) continue
      return `el revisor solo escribe en temporales (redirección a ${r.objetivo})`
    }
    const m = motivoRuta(r.objetivo, { raiz: ctx.raiz, base: ctx.cwd, permitirTemporal: true })
    if (m) return m
  }
  const ws = sinPrefijos(palabras)
  const prog = ws.length ? nombreProg(ws[0]) : ''
  const args = ws.slice(1)
  // El patrón de una búsqueda no es un archivo: `grep -rn ".env" src` busca el texto, no lo lee.
  const ip = BUSCAN.has(prog) ? indicePatron(args) : -1
  const patron = ip >= 0 ? ip + (palabras.length - args.length) : -1
  const iScript = prog === 'node' ? indiceScript(args) : -1
  for (const [j, w] of palabras.entries()) {
    if (j === patron) continue
    if (SECRETO.test(w)) {
      // Única excepción: `node --env-file=.env <script>` si un permiso vigente cubre el comando entero.
      const k = j - (palabras.length - args.length)
      if (!(ENV_FILE.test(w) && k >= 0 && k < iScript && permitido(palabras, ctx))) {
        return 'toca un .env (secretos); para buscar el texto en el código, usa la herramienta Grep'
      }
    }
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

  // Permiso aprobado: solo el ejecutor, solo el comando aprobado de una subtarea en curso. Antes ya se negaron los
  // `.env`, los secretos del proyecto, las redirecciones fuera de alcance y lo que ningún permiso levanta (`motivoFijo`);
  // los shells (`bash -c`…) volvieron arriba.
  const fijo = motivoFijo(prog, args, ctx)
  if (fijo) return fijo
  if (permitido(palabras, ctx)) return null

  // Playwright y playwright-cli: libres para el ejecutor, con cualquier subcomando. Va después de los `.env`, los secretos y
  // las redirecciones fuera de alcance (que ya se negaron) y antes de la regla de `npx`. Los servidores directos siguen negados.
  if (ctx.rol === 'ejecutor' && !ctx.configPaquetes && esPlaywright(prog, args)) return null

  if (prog === 'npx' && args.some((a) => a === '--no-install' || a === '--no')) {
    const j = binDeNpx(args)
    return j >= 0 ? evaluarBinario(nombreProg(args[j]), args.slice(j + 1), ctx) : null
  }
  if (prog === 'npx' && config.pm && config.externos.npx === EXTERNOS_BASE.npx) {
    const bin = args[binDeNpx(args)]
    return `npx puede descargar y ejecutar paquetes: usa \`${config.pm === 'npm' ? 'npm exec --no --' : `${config.pm} exec`} ${bin ?? '<bin>'}\``
  }
  // Red de solo lectura: solo el ejecutor y solo si el proyecto no redefinió el programa (como `npx`).
  if (ctx.rol === 'ejecutor' && RED_PROGS.has(prog) && config.externos[prog] === RED) return evaluarLecturaRed(prog, args, ctx)
  if (Object.hasOwn(config.externos, prog)) return config.externos[prog]
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
    // Se saltan las opciones iniciales (-H, -L, -P, -O<n>, -D <valor>); las rutas son los args hasta el primer `-`, `(` o `!`.
    let ini = 0
    while (ini < args.length && /^-([HLP]|O\d*|D)$/.test(args[ini])) ini += args[ini] === '-D' ? 2 : 1
    const resto = args.slice(ini)
    const fin = resto.findIndex((a) => /^[-(!]/.test(a))
    const raices = fin < 0 ? resto : resto.slice(0, fin)
    if (raices.map((a) => path.resolve(ctx.cwd, rutaNativa(a))).some((abs) => abs === path.parse(abs).root)) {
      return 'find desde la raíz del disco: no en un subagente (busca dentro del repo)'
    }
    const borra = args.some((a, j) => a === '-delete' || (['-exec', '-execdir', '-ok'].includes(a) && ['rm', 'rmdir', 'mv', 'shred'].includes(nombreProg(args[j + 1] ?? ''))))
    if (borra) return 'find que borra o mueve: no en un subagente'
  }

  if (ctx.rol === 'revisor') {
    if (ESCRIBEN.has(prog) && !soloTemporales(prog, args, ctx)) return `el revisor solo escribe en temporales (${prog})`
    if ((prog === 'sed' || prog === 'perl') && args.some(EDITA_EN_SITIO)) {
      const archivos = archivosEnSitio(prog, args)
      if (!archivos.length || !archivos.every((a) => temporal(a, ctx))) return 'el revisor no modifica archivos del repo (edición en sitio; en temporales sí)'
    }
    if ((prog === 'awk' || prog === 'gawk') && args.some((a, j) => a === '-i' && /inplace/.test(args[j + 1] ?? ''))) {
      return 'el revisor no modifica archivos (awk inplace)'
    }
    return null
  }
  return null
}

/**
 * Comandos de los permisos aprobados del flujo del proyecto (`permisos` y `en_curso` de `estado.json`, que escribe
 * `estado.mjs`): `{ P1: { rol, sub, comando, … , aprobado } }`. Un comando vale solo con `aprobado`, `rol` `ejecutor` y su
 * `sub` (número) en `en_curso`. Un lote puede tener varias en curso: la guardia no liga el agente a una subtarea. Ante
 * cualquier error, `[]` (la guardia sigue negando).
 */
export function permisosAprobados(raiz) {
  try {
    const estado = leerJson(path.join(flujoDe(raiz), 'estado.json'))
    if (!estado || !Array.isArray(estado.en_curso) || !estado.permisos || typeof estado.permisos !== 'object' || Array.isArray(estado.permisos)) return []
    return Object.values(estado.permisos)
      .filter((p) => p && p.rol === 'ejecutor' && typeof p.aprobado === 'string' && p.aprobado && estado.en_curso.includes(p.sub) && typeof p.comando === 'string' && p.comando.trim())
      .map((p) => p.comando)
  } catch {
    return []
  }
}

/** El plan escribe los comandos entre comillas invertidas: un par que envuelve todo el comando se quita. */
function sinEnvoltura(comando) {
  const envuelto = /^(`+)([^`]+)\1$/.exec(String(comando).trim())
  return envuelto ? envuelto[2] : String(comando)
}

/** Índice (en `ws`) de la primera palabra que no es opción desde `desde`, saltando el valor de las de `conValor`; la última si no hay. */
function sinOpcion(ws, desde, conValor = new Set()) {
  for (let k = desde; k < ws.length; k++) {
    if (!ws[k].startsWith('-')) return k
    if (conValor.has(ws[k])) k++
  }
  return ws.length - 1
}

/**
 * Índice de la última palabra de `ws` que no admite comodín: el programa y su primer argumento no-opción; con `exec`, `dlx`,
 * `x` o `run` de un gestor, también el siguiente; en `node`, hasta el script (sin script, todo el comando).
 */
function ultimoLiteral(ws) {
  const prog = nombreProg(ws[0])
  if (prog === 'node') {
    const i = indiceScript(ws.slice(1))
    return i < 0 ? ws.length - 1 : i + 1
  }
  const gestor = GESTORES.has(prog)
  const k = sinOpcion(ws, 1, gestor ? PM_OPC_CON_VALOR : undefined)
  return gestor && ['exec', 'dlx', 'x', 'run'].includes(ws[k]) ? sinOpcion(ws, k + 1) : k
}

/**
 * Un permiso aprobado → RegExp sobre las palabras de un comando simple (unidas por un espacio): texto exacto con espacios
 * normalizados y `*` como comodín. `null` si no es un comando simple (varios comandos, redirecciones, sustituciones) o si el
 * comodín cae en el programa, en su primer argumento (o los que fija `ultimoLiteral`) o tras un prefijo (`timeout 5 *`).
 */
export function regexDePermiso(comando) {
  const simples = analizar(sinEnvoltura(comando))
  if (simples.length !== 1 || simples[0].redirs.length) return null
  const ws = simples[0].palabras
  if (!ws.length || ws.some((w) => w.includes('\u0000'))) return null
  if (ws.some((w) => w.includes('*')) && (sinPrefijos(ws).length !== ws.length || ws.slice(0, ultimoLiteral(ws) + 1).some((w) => w.includes('*')))) return null
  const texto = ws.join(' ').replace(/\s+/g, ' ')
  return new RegExp(`^${[...texto].map((c) => (c === '*' ? '[^\\u0000]*' : c.replace(/[.+^${}()|[\]\\?]/g, '\\$&'))).join('')}$`)
}

/** Motivo para negar el comando completo, o null. `ctx`: { rol, raiz, cwd, powershell, permisos }. */
export function evaluarCadena(cmd, ctx) {
  const simples = analizar(cmd, { powershell: ctx.powershell })
  if (bajaYEjecuta(cmd, simples, ctx)) return 'red: bajar algo y ejecutarlo en el mismo comando no se permite (`curl … | sh`, `iex (irm …)`)'
  for (const simple of simples) {
    const m = evaluarSimple(simple, ctx)
    if (m) return m
    anotarVariables(simple, ctx)
  }
  return null
}

// ── Entrada del hook ────────────────────────────────────────────────────────

/**
 * Motivo para negar un `Read` de un `.env` (salvo plantillas) o de un secreto del proyecto, o un `Grep` con `path` o `glob`
 * que los nombre; null si no. El `pattern` de un Grep es libre y `Glob` no se revisa.
 */
export function motivoLectura(evento, raiz = RAIZ) {
  const herramienta = evento?.tool_name ?? ''
  const entrada = evento?.tool_input ?? {}
  const cwd = typeof evento?.cwd === 'string' && evento.cwd ? path.resolve(rutaNativa(evento.cwd)) : raiz
  const nombrados = herramienta === 'Read' ? [entrada.file_path] : herramienta === 'Grep' ? [entrada.path, entrada.glob] : []
  for (const n of nombrados) {
    if (typeof n !== 'string' || !n) continue
    if (SECRETO.test(n)) return `${n} es un .env (secretos)`
    if (nombraSecreto(n, { raiz, cwd })) return `${n} guarda secretos o claves (secreto del proyecto)`
  }
  return null
}

/** `{ motivo, objetivo, permiso }`: motivo para negar (o null), qué anotar en el registro y si un permiso aprobado lo levantaría. */
export function evaluar(evento, rol, raiz = RAIZ) {
  const herramienta = evento?.tool_name ?? ''
  const entrada = evento?.tool_input ?? {}
  const cwd = typeof evento?.cwd === 'string' && evento.cwd ? path.resolve(rutaNativa(evento.cwd)) : raiz
  if (herramienta === 'Bash' || herramienta === 'PowerShell') {
    const comando = String(entrada.command ?? '')
    const powershell = herramienta === 'PowerShell'
    const permisos = rol === 'ejecutor' ? permisosAprobados(raiz).map(regexDePermiso).filter(Boolean) : []
    const motivo = evaluarCadena(comando, { rol, raiz, cwd, powershell, permisos })
    // Con un permiso que lo cubra todo, ¿pasaría? Entonces el ejecutor puede pedirlo (NECESITA_PERMISO).
    const permiso = Boolean(motivo) && rol === 'ejecutor' && evaluarCadena(comando, { rol, raiz, cwd, powershell, permisos: [/^[^]*$/] }) === null
    return { motivo, objetivo: comando.replace(/\s*\r?\n\s*/g, ' ⏎ ').slice(0, 300), permiso }
  }
  if (herramienta === 'Read' || herramienta === 'Grep') {
    const motivo = motivoLectura(evento, raiz)
    return { motivo, objetivo: motivo ? lecturaDe(evento, raiz)?.objetivo ?? null : null }
  }
  if (['Edit', 'Write', 'NotebookEdit', 'MultiEdit'].includes(herramienta)) {
    const ruta = String(entrada.file_path ?? entrada.notebook_path ?? '')
    // El ejecutor puede escribir en temporales (scripts de medición); `--cambios` no los cuenta.
    const motivo = rol === 'revisor' ? 'el revisor no edita archivos' : motivoRuta(ruta, { raiz, base: cwd, permitirTemporal: true })
    const abs = path.resolve(cwd, rutaNativa(ruta))
    return { motivo, objetivo: relativaAlRepo(abs, raiz) ?? abs }
  }
  return { motivo: null, objetivo: null }
}

/** Roles de solo lectura: la guardia anota lo que leen (y solo al explorador le pone el tope de contexto; el ejecutor tiene el suyo aparte). */
export const ROLES_LECTURA = ['explorador', 'planificador']

/** Los agentes de /impl y su rol. */
const ROLES = new Set([...ROLES_LECTURA, 'ejecutor', 'revisor'])

/**
 * El rol del agente que hizo la llamada, según el `agent_type` del evento: `impl:qcc-ejecutor` → `ejecutor`.
 * Acepta también el nombre sin plugin (`qcc-ejecutor`, de una copia en `~/.claude/agents`). `null` si no es un agente de
 * este flujo: la sesión principal (sin `agent_type`), uno de otro plugin o uno del usuario.
 */
export function rolDeAgente(agentType) {
  if (typeof agentType !== 'string') return null
  const m = /^(?:impl:)?qcc-([a-z]+)$/.exec(agentType.trim())
  return m && ROLES.has(m[1]) ? m[1] : null
}

/** `{ objetivo }` de una lectura (Read, Glob, Grep) o null si la herramienta es otra o no trae objetivo. */
export function lecturaDe(evento, raiz = RAIZ) {
  const herramienta = evento?.tool_name ?? ''
  const entrada = evento?.tool_input ?? {}
  if (herramienta === 'Read') {
    const ruta = String(entrada.file_path ?? '')
    if (!ruta) return null
    const cwd = typeof evento?.cwd === 'string' && evento.cwd ? path.resolve(rutaNativa(evento.cwd)) : raiz
    const abs = path.resolve(cwd, rutaNativa(ruta))
    return { objetivo: relativaAlRepo(abs, raiz) ?? abs }
  }
  if (herramienta === 'Glob' || herramienta === 'Grep') {
    const patron = String(entrada.pattern ?? '')
    if (!patron) return null
    const donde = entrada.path ? ` en ${entrada.path}` : ''
    return { objetivo: `${patron}${donde}`.replace(/\s*\r?\n\s*/g, ' ⏎ ').slice(0, 300) }
  }
  return null
}

/**
 * Contexto (tokens) del subagente del evento, según el `usage` de su último mensaje del asistente en
 * `<transcript_path sin .jsonl>/subagents/agent-<id>.jsonl`. Lee solo la cola. `null` si falta algo o no se entiende.
 */
export function contextoDelAgente(evento) {
  const id = String(evento?.agent_id ?? '')
  const sesion = String(evento?.transcript_path ?? '')
  if (!/^[\w-]+$/.test(id) || !sesion.endsWith('.jsonl')) return null
  const archivo = path.join(sesion.slice(0, -'.jsonl'.length), 'subagents', `agent-${id}.jsonl`)
  let fd
  try {
    fd = fs.openSync(archivo, 'r')
    const { size } = fs.fstatSync(fd)
    const desde = Math.max(0, size - COLA_TRANSCRIPT)
    const buf = Buffer.alloc(size - desde)
    fs.readSync(fd, buf, 0, buf.length, desde)
    const lineas = buf.toString('utf8').split('\n')
    // Si la lectura empezó a mitad del archivo, la primera línea puede venir cortada.
    if (desde > 0) lineas.shift()
    for (let i = lineas.length - 1; i >= 0; i--) {
      if (!lineas[i].trim()) continue
      const f = JSON.parse(lineas[i])
      const u = f?.type === 'assistant' ? f.message?.usage : null
      if (u) return (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0)
    }
  } catch {
    // Sin transcript o con una línea rota: no se sabe, así que no se niega.
  } finally {
    if (fd !== undefined) fs.closeSync(fd)
  }
  return null
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
  let crudo = ''
  for await (const trozo of process.stdin) crudo += trozo
  let evento
  try {
    evento = JSON.parse(crudo)
  } catch {
    return
  }
  const rol = rolDeAgente(evento?.agent_type)
  // Este hook corre en toda la sesión: lo que no es de un agente del flujo pasa sin tocarlo.
  if (!rol) return
  const lectura = ROLES_LECTURA.includes(rol)
  const raiz = raizDe(process.env.CLAUDE_PROJECT_DIR || evento?.cwd || process.cwd())
  if (lectura) {
    // Anota; niega un .env o un secreto del proyecto y, al explorador, el pasar el tope de contexto. Cualquier error deja pasar.
    let excedido = null
    let secreto = null
    try {
      secreto = motivoLectura(evento, raiz)
      const l = lecturaDe(evento, raiz)
      if (!l && !secreto) return
      const contexto = rol === 'explorador' ? contextoDelAgente(evento) : null
      excedido = contexto !== null && contexto > TOPE_CONTEXTO_EXPLORADOR ? Math.round(contexto / 1000) : null
      registrar(raiz, {
        t: new Date().toISOString(),
        rol,
        agente: evento.agent_id ?? null,
        esfuerzo: evento.effort?.level ?? evento.effort ?? null,
        herramienta: evento.tool_name,
        objetivo: l?.objetivo ?? null,
        ...(secreto ? { decision: 'negado', motivo: secreto } : excedido !== null ? { decision: 'negado', motivo: `contexto ${excedido}k` } : { decision: 'lectura' }),
      })
    } catch {
      // Una lectura nunca se frena por un error.
    }
    if (secreto) {
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: `Guardia /impl: ${secreto}. No lo rodees: para buscar el texto en el código, usa Grep sin ese path; si no, anótalo en tu reporte.`,
        },
      }))
      return
    }
    if (excedido !== null) {
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: `Guardia /impl: contexto del explorador en ${excedido}k (tope ${TOPE_CONTEXTO_EXPLORADOR / 1000}k): reporta ya con lo que tienes; lo que falte va a DUDAS como \`no explorado: <ruta> — <por qué>\`.`,
        },
      }))
    }
    return
  }
  if (rol === 'ejecutor' && ['Read', 'Glob', 'Grep'].includes(evento?.tool_name)) {
    // Con el contexto sobre el tope se le niegan las lecturas para que termine. Cualquier error deja pasar.
    let excedido = null
    try {
      const contexto = contextoDelAgente(evento)
      excedido = contexto !== null && contexto > TOPE_CONTEXTO_EJECUTOR ? Math.round(contexto / 1000) : null
      if (excedido !== null) {
        registrar(raiz, {
          t: new Date().toISOString(),
          rol,
          agente: evento.agent_id ?? null,
          esfuerzo: evento.effort?.level ?? evento.effort ?? null,
          herramienta: evento.tool_name,
          objetivo: lecturaDe(evento, raiz)?.objetivo ?? null,
          decision: 'negado',
          motivo: `contexto ${excedido}k`,
        })
      }
    } catch {
      // Una lectura nunca se frena por un error al medir.
    }
    if (excedido !== null) {
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: `Guardia /impl: contexto del ejecutor en ${excedido}k (tope ${TOPE_CONTEXTO_EJECUTOR / 1000}k): no leas más; termina con lo que ya leíste, corre verificar.mjs y reporta; si no alcanzas, BLOQUEADO con lo que falta.`,
        },
      }))
      return
    }
  }
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
        permissionDecisionReason: resultado.permiso
          ? `Guardia /impl: ${resultado.motivo}. No lo rodees: si tu subtarea necesita ese comando, pide en BLOQUEOS de tu reporte \`NECESITA_PERMISO: <comando exacto> · <servicio> · reversible: sí|no · Qué hace: … · Para qué: …\` (ESTADO: BLOQUEADO); el usuario lo aprueba en el plan.`
          : `Guardia /impl: ${resultado.motivo}. No lo rodees: anótalo en BLOQUEOS de tu reporte.`,
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
