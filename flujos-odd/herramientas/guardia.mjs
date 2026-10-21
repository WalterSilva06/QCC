#!/usr/bin/env node
// Guardia lite de los subagentes de /qcc-implementador-odd (nivel usuario: sirve para cualquier proyecto).
//
// Hook PreToolUse que declaran en su frontmatter `qcc-odd-ejecutor` (argumento `ejecutor`) y `qcc-odd-revisor`
// (argumento `revisor`): Claude Code lo corre solo mientras ese agente trabaja. Niega lo que un subagente odd
// no hace nunca: git que modifica, instalar o quitar dependencias, red, borrados recursivos, secretos (`.env*`),
// servidores y modos watch que no terminan, y archivos protegidos. Al revisor, además, escribir fuera del temporal.
//
// Lite a propósito: parte el comando en tramos (`&&`, `||`, `;`, `|`, saltos de línea y `$(…)`), expande las
// variables asignadas en el mismo comando y mira el programa de cada tramo. Ante la duda deja pasar, y un error
// propio nunca niega: un guardia que castra al ejecutor cuesta la tarea entera.
//
//   echo '<evento JSON>' | node ~/.claude/flujos-odd/guardia.mjs ejecutor|revisor

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const WIN = process.platform === 'win32'

const GIT_LECTURA = new Set(['status', 'diff', 'log', 'show', 'blame', 'grep', 'ls-files', 'ls-tree', 'rev-parse', 'rev-list', 'cat-file', 'archive', 'describe', 'shortlog', 'merge-base', 'name-rev', 'version', 'help'])
const GESTORES = new Set(['npm', 'pnpm', 'yarn', 'bun'])
const DEPENDENCIAS = new Set(['install', 'i', 'ci', 'add', 'remove', 'rm', 'uninstall', 'un', 'update', 'up', 'upgrade', 'link', 'publish', 'dlx'])
const DEPENDENCIAS_OTROS = { pip: ['install', 'uninstall', 'download'], pip3: ['install', 'uninstall', 'download'], cargo: ['add', 'remove', 'install', 'uninstall', 'publish', 'update'], go: ['get', 'install'], uv: ['add', 'remove', 'pip', 'sync', 'tool'], poetry: ['add', 'remove', 'install', 'update', 'publish'], gem: ['install', 'uninstall'], brew: ['install', 'uninstall', 'upgrade'], winget: ['install', 'uninstall', 'upgrade'], choco: ['install', 'uninstall', 'upgrade'], apt: ['install', 'remove'], 'apt-get': ['install', 'remove'] }
const RED = new Set(['curl', 'wget', 'ssh', 'scp', 'sftp', 'rsync', 'ftp', 'telnet', 'nc', 'ncat', 'gh', 'invoke-webrequest', 'iwr', 'invoke-restmethod', 'irm', 'start-bitstransfer'])
const SERVIDORES = new Set(['vite', 'nodemon', 'live-server', 'http-server', 'serve'])
const SCRIPTS_SIN_FIN = /^(dev|start|serve|watch|preview)(:|$)/
const ESCRIBEN = new Set(['cp', 'mv', 'mkdir', 'touch', 'tee', 'rm', 'rmdir', 'ln', 'install', 'copy-item', 'move-item', 'new-item', 'set-content', 'add-content', 'out-file', 'remove-item', 'cpi', 'mi', 'ni', 'sc', 'ac'])
const BORRAN = new Set(['rm', 'remove-item', 'ri', 'del', 'erase', 'rmdir', 'rd'])
const LOCKFILES = new Set(['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lockb', 'bun.lock', 'cargo.lock', 'go.sum', 'poetry.lock', 'uv.lock', 'composer.lock', 'gemfile.lock'])

/** Raíz del repo git que contiene `dir`, o `dir` si no está en uno. */
export function raizDe(dir) {
  let actual = path.resolve(dir)
  for (;;) {
    if (fs.existsSync(path.join(actual, '.git'))) return actual
    const padre = path.dirname(actual)
    if (padre === actual) return path.resolve(dir)
    actual = padre
  }
}

/** Ruta de Git Bash (`/c/x`, `/tmp/x`) a ruta nativa en Windows; igual en el resto. */
export function rutaNativa(p) {
  const r = String(p)
  if (!WIN) return r
  const unidad = /^\/([a-zA-Z])(\/|$)(.*)/.exec(r)
  if (unidad) return `${unidad[1].toUpperCase()}:\\${unidad[3].replaceAll('/', '\\')}`
  if (r === '/tmp' || r.startsWith('/tmp/')) return path.join(os.tmpdir(), r.slice(4))
  return r
}

const normal = (p) => (WIN ? path.resolve(p).toLowerCase() : path.resolve(p))
const dentro = (hijo, padre) => {
  const h = normal(hijo)
  const p = normal(padre)
  return h === p || h.startsWith(p.endsWith(path.sep) ? p : p + path.sep)
}

/** Si `abs` está en un temporal: el del sistema, `/tmp` o `TEMP`/`TMP`/`TMPDIR`. */
export function enTemporal(abs) {
  const temporales = [os.tmpdir(), process.env.TEMP, process.env.TMP, process.env.TMPDIR, WIN ? null : '/tmp'].filter(Boolean)
  return temporales.some((t) => dentro(abs, t))
}

/** Por qué no se escribe en `ruta` (relativa a `cwd`); null si se puede. `soloTemporal`: el revisor. */
export function motivoRuta(ruta, { raiz, cwd = raiz, soloTemporal = false }) {
  const abs = path.resolve(cwd, rutaNativa(ruta))
  if (enTemporal(abs)) return null
  if (soloTemporal) return `el revisor solo escribe en el temporal (${ruta})`
  if (!dentro(abs, raiz)) return `fuera del repo (${ruta})`
  const rel = path.relative(raiz, abs).split(path.sep).join('/')
  const nombre = path.basename(abs).toLowerCase()
  if (/^\.env(\.|$)/.test(nombre) && !/\.(example|sample|template)$/.test(nombre)) return `secretos (${rel})`
  if (rel === '.git' || rel.startsWith('.git/')) return `.git (${rel})`
  if (/^\.claude\/(settings[^/]*\.json|agents\/)/.test(rel)) return `configuración de Claude Code (${rel})`
  if (LOCKFILES.has(nombre)) return `lockfile (${rel}): las dependencias las cambia el orquestador`
  return null
}

/** Parte un tramo en palabras, con comillas simples y dobles. */
function palabrasDe(texto) {
  const palabras = []
  const re = /"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/g
  for (const m of texto.matchAll(re)) palabras.push(m[1] ?? m[2] ?? m[3])
  return palabras
}

const SUSTITUCION = /\$\(([^()]*)\)|`([^`]*)`/g
const HEREDOC = /^<<(-?)[ \t]*(?:'([^'\n]+)'|"([^"\n]+)"|(\\?)([A-Za-z0-9_.-]+))/

/**
 * El comando sin el cuerpo de sus heredocs (`<<WORD`, `<<'WORD'`, `<<"WORD"`, `<<-WORD`) ni su operador: el cuerpo
 * son datos, no comandos. `sustituciones`: lo de `$(…)` y comillas invertidas de los cuerpos sin comillas, que el
 * shell sí corre.
 */
function sinHeredocs(cmd) {
  let texto = ''
  const sustituciones = []
  const pendientes = []
  let comilla = null
  for (let k = 0; k < cmd.length; k++) {
    const c = cmd[k]
    if (comilla) {
      texto += c
      if (c === comilla) comilla = null
      continue
    }
    if (c === '"' || c === "'") {
      comilla = c
      texto += c
      continue
    }
    const op = c === '<' && cmd[k - 1] !== '<' && cmd[k + 2] !== '<' ? HEREDOC.exec(cmd.slice(k)) : null
    if (op) {
      pendientes.push({ fin: op[2] ?? op[3] ?? op[5], tabs: op[1] === '-', expande: op[5] !== undefined && !op[4] })
      texto += ' '
      k += op[0].length - 1
      continue
    }
    texto += c
    if (c !== '\n') continue
    // Los cuerpos empiezan en la línea que sigue a la cabecera, uno tras otro.
    for (const h of pendientes.splice(0)) {
      const cuerpo = []
      while (k + 1 < cmd.length) {
        const salto = cmd.indexOf('\n', k + 1)
        const linea = cmd.slice(k + 1, salto < 0 ? cmd.length : salto)
        k = salto < 0 ? cmd.length : salto
        if ((h.tabs ? linea.replace(/^\t+/, '') : linea).replace(/\r$/, '') === h.fin) break
        cuerpo.push(linea)
      }
      if (h.expande) for (const m of cuerpo.join('\n').matchAll(SUSTITUCION)) sustituciones.push(m[1] ?? m[2])
    }
  }
  return { texto, sustituciones }
}

/**
 * Los tramos de un comando: lo de `$(…)` y de comillas invertidas va como tramo propio, y el resto se parte por
 * `&&`, `||`, `;`, `|`, `&` y saltos de línea, fuera de comillas. El cuerpo de un heredoc no cuenta.
 */
export function tramosDe(cmd) {
  const { texto, sustituciones: internos } = sinHeredocs(String(cmd))
  const sinSustituciones = texto.replace(SUSTITUCION, (_, a, b) => {
    internos.push(a ?? b)
    return ' __SUST__ '
  })
  const tramos = []
  let actual = ''
  let comilla = null
  for (let k = 0; k < sinSustituciones.length; k++) {
    const c = sinSustituciones[k]
    if (comilla) {
      actual += c
      if (c === comilla) comilla = null
      continue
    }
    if (c === '"' || c === "'") {
      comilla = c
      actual += c
      continue
    }
    if (c === ';' || c === '\n' || c === '|' || c === '&') {
      tramos.push(actual)
      actual = ''
      continue
    }
    actual += c
  }
  tramos.push(actual)
  return [...tramos, ...internos.flatMap(tramosDe)].map((t) => t.trim()).filter(Boolean)
}

const SUST = '__SUST__'

/**
 * Redirecciones de un tramo: `destinos` (`> x`, `>> x`, `2> x`, `>x`, `> "x"`), sin `/dev/null`, `&1` ni `$null`, y
 * `resto`, el tramo sin ellas. Solo cuenta un `>` fuera de comillas que no sea parte de `=>`, `->` ni `>=`.
 */
function redireccionesDe(tramo) {
  const destinos = []
  let resto = ''
  let comilla = null
  for (let k = 0; k < tramo.length; k++) {
    const c = tramo[k]
    if (comilla) {
      resto += c
      if (c === comilla) comilla = null
      continue
    }
    if (c === '"' || c === "'") {
      comilla = c
      resto += c
      continue
    }
    if (c !== '>' || tramo[k - 1] === '=' || tramo[k - 1] === '-' || tramo[k + 1] === '=') {
      resto += c
      continue
    }
    // El descriptor (`2>`) es parte de la redirección.
    resto = resto.replace(/(^|\s)\d$/, '$1')
    let j = k + (tramo[k + 1] === '>' ? 2 : 1)
    while (j < tramo.length && /\s/.test(tramo[j])) j++
    let destino
    if (tramo[j] === '"' || tramo[j] === "'") {
      const cierre = tramo.indexOf(tramo[j], j + 1)
      destino = tramo.slice(j + 1, cierre < 0 ? tramo.length : cierre)
      k = cierre < 0 ? tramo.length : cierre
    } else {
      let fin = j
      while (fin < tramo.length && !/[\s;|<>]/.test(tramo[fin])) fin++
      destino = tramo.slice(j, fin)
      k = fin - 1
    }
    resto += ' '
    if (destino && !destino.startsWith('&') && !/^(\/dev\/null|nul|\$null)$/i.test(destino)) destinos.push(destino)
  }
  return { destinos, resto }
}

/** Por qué se niega un tramo ya expandido; null si pasa. */
function motivoTramo(tramo, ctx) {
  const { rol, raiz, cwd } = ctx
  const revisor = rol === 'revisor'
  const escritura = (ruta) => (ruta.includes(SUST) || /\$/.test(ruta) ? (revisor ? `no se ve a dónde escribe (${ruta}): usa una ruta escrita a mano` : null) : motivoRuta(ruta, { raiz, cwd, soloTemporal: revisor }))
  const { destinos, resto } = redireccionesDe(tramo)
  for (const destino of destinos) {
    const m = escritura(destino)
    if (m) return m
  }
  const palabras = palabrasDe(resto)
  while (palabras.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(palabras[0])) palabras.shift()
  while (['sudo', 'env', 'command', 'exec', 'time', 'nohup', '&'].includes(palabras[0])) palabras.shift()
  if (!palabras.length) return null
  const prog = path.basename(palabras[0].replaceAll('\\', '/')).toLowerCase().replace(/\.(exe|cmd|bat|ps1)$/, '')
  const args = palabras.slice(1)
  const libres = args.filter((a) => !a.startsWith('-'))
  if (tramo.match(/(^|[\s"'=/\\])\.env(\.[\w-]+)?(?=$|[\s"'/\\])/m) && !/\.env\.(example|sample|template)\b/.test(tramo)) return 'secretos: .env no se lee ni se escribe'
  if (prog === 'git') {
    let k = 0
    while (k < args.length && args[k].startsWith('-')) k += ['-C', '-c', '--git-dir', '--work-tree'].includes(args[k]) ? 2 : 1
    const sub = args[k]
    if (!sub) return null
    if (!GIT_LECTURA.has(sub)) return `git ${sub} modifica el repositorio o habla con el remoto: git es solo de lectura`
    if (sub === 'archive' && args.some((a) => a.startsWith('--remote'))) return 'git archive --remote habla con el remoto: red'
    const salida = args.findIndex((a) => a === '--output' || a === '-o')
    if (salida >= 0 && args[salida + 1]) return escritura(args[salida + 1])
    return null
  }
  if (RED.has(prog)) return `${prog}: red, los subagentes no llaman servicios`
  if (GESTORES.has(prog)) {
    const sub = libres[0]
    if (DEPENDENCIAS.has(sub)) return `${prog} ${sub}: las dependencias las cambia el orquestador`
    const script = sub === 'run' ? libres[1] : sub
    if (script && SCRIPTS_SIN_FIN.test(script)) return `${prog} ${script}: no termina, no en un subagente`
  }
  if (prog === 'npx' && args.includes('-y')) return 'npx -y descarga paquetes: dependencias'
  if (DEPENDENCIAS_OTROS[prog]?.includes(libres[0])) return `${prog} ${libres[0]}: las dependencias las cambia el orquestador`
  if (SERVIDORES.has(prog) && !['build', 'preview'].includes(libres[0])) return `${prog}: levanta un servidor que no termina`
  if (prog === 'next' && libres[0] === 'dev') return 'next dev: levanta un servidor que no termina'
  if (args.some((a) => a === '--watch' || a === '--watchAll') || (['vitest', 'jest'].includes(prog) && libres[0] === 'watch')) return 'modo watch: no termina, no en un subagente'
  // Banderas cortas combinadas (`-r`, `-rf`, `-Rf`), no las de PowerShell que solo contienen una r (`-Force`).
  const recursivo = args.some((a) => (/^-[a-zA-Z]{1,3}$/.test(a) && /[rR]/.test(a)) || /^--recursive$/i.test(a) || /^-recurse$/i.test(a) || /^\/s$/i.test(a))
  if (BORRAN.has(prog) && recursivo) return `${prog} recursivo: los borrados en bloque quedan para el usuario`
  if (prog === 'sed' && args.some((a) => /^-[a-zA-Z]*i/.test(a) || a === '--in-place')) {
    for (const archivo of libres.slice(1)) {
      const m = escritura(archivo)
      if (m) return m
    }
    return null
  }
  if (prog === 'tar' && revisor) {
    const k = args.findIndex((a) => a === '-C' || a === '--directory')
    if (args.some((a) => /^-?[a-zA-Z]*x/.test(a))) return k >= 0 && args[k + 1] ? escritura(args[k + 1]) : 'tar -x sin -C escribe en el directorio actual'
  }
  if (ESCRIBEN.has(prog)) {
    const valores = libres.filter((a) => !/^-(path|destination|literalpath|value|encoding)$/i.test(a))
    const destinos = ['cp', 'mv', 'ln', 'install', 'copy-item', 'move-item', 'cpi', 'mi'].includes(prog) ? valores.slice(-1) : valores
    for (const d of destinos) {
      const m = escritura(d)
      if (m) return m
    }
  }
  return null
}

/** Por qué se niega `cmd` para `rol`; null si pasa. Expande las variables asignadas antes en el mismo comando. */
export function motivoComando(cmd, { rol, raiz, cwd = raiz }) {
  const variables = {}
  for (const crudo of tramosDe(cmd)) {
    const tramo = crudo.replace(/\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/g, (todo, n) => variables[n] ?? todo)
    const asignacion = /^([A-Za-z_][A-Za-z0-9_]*)=("[^"]*"|'[^']*'|\S*)$/.exec(tramo)
    if (asignacion) {
      variables[asignacion[1]] = asignacion[2].replace(/^["']|["']$/g, '')
      continue
    }
    const motivo = motivoTramo(tramo, { rol, raiz, cwd })
    if (motivo) return motivo
  }
  return null
}

/** Decisión para un evento PreToolUse: el motivo del rechazo, o null si pasa. Un error propio nunca niega. */
export function evaluar(evento, rol, raiz = raizDe(process.env.CLAUDE_PROJECT_DIR || process.cwd())) {
  try {
    const herramienta = evento?.tool_name ?? ''
    const entrada = evento?.tool_input ?? {}
    const cwd = typeof evento?.cwd === 'string' && evento.cwd ? path.resolve(rutaNativa(evento.cwd)) : raiz
    if (herramienta === 'Bash' || herramienta === 'PowerShell') return motivoComando(String(entrada.command ?? ''), { rol, raiz, cwd })
    if (['Edit', 'Write', 'NotebookEdit', 'MultiEdit'].includes(herramienta)) {
      if (rol === 'revisor') return 'el revisor no edita archivos'
      return motivoRuta(String(entrada.file_path ?? entrada.notebook_path ?? ''), { raiz, cwd })
    }
    return null
  } catch {
    return null
  }
}

function main() {
  const rol = process.argv[2] === 'revisor' ? 'revisor' : 'ejecutor'
  let texto = ''
  try {
    texto = fs.readFileSync(0, 'utf8')
  } catch {
    return
  }
  let evento
  try {
    evento = JSON.parse(texto)
  } catch {
    return
  }
  const motivo = evaluar(evento, rol)
  if (!motivo) return
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: `Guardia /qcc-implementador-odd: ${motivo}. No lo rodees: anótalo en BLOQUEOS de tu reporte.`,
    },
  }))
}

function esPrincipal() {
  if (!process.argv[1]) return false
  const a = path.resolve(process.argv[1])
  const b = fileURLToPath(import.meta.url)
  return WIN ? a.toLowerCase() === b.toLowerCase() : a === b
}

if (esPrincipal()) main()
