#!/usr/bin/env node
// Guardia lite de /qcc-implementador-odd (nivel usuario: sirve para cualquier proyecto).
//
// Hook PreToolUse que declaran en su frontmatter `qcc-odd-ejecutor` (argumento `ejecutor`) y `qcc-odd-revisor`
// (argumento `revisor`): Claude Code lo corre solo mientras ese agente trabaja. Niega lo que un subagente odd
// no hace nunca: git que modifica, instalar o quitar dependencias, red, borrados recursivos, secretos (`.env*`),
// servidores y modos watch que no terminan, y archivos protegidos. Al revisor, además, escribir fuera del temporal.
//
// El skill lo declara con el argumento `orquestador`. Un hook de skill sigue activo el resto de la sesión, así que
// este rol solo niega mientras hay una corrida abierta en el repo (la marca que deja `odd.mjs --inicio` y borra
// `--cierre`, que vence a las 12 h) y nunca dentro de un subagente. Niega escribir en el repo por Bash o PowerShell
// (que edite con Edit o Write) y leer archivos del repo con `cat`, `head`, `sed -n`… (que lea con Read o Grep), más
// lo del ejecutor salvo las dependencias, que las instala el orquestador. Si `--plan` anotó `grande` en la marca,
// además niega Edit y Write en el repo fuera de `odd/tasks/`: el código lo editan los ejecutores.
//
// Las reglas del proyecto (`guardia.protegidos`, `guardia.inmutables` y `guardia.scriptsNegados` de la config) valen
// para los tres roles.
//
// Lite a propósito: parte el comando en tramos (`&&`, `||`, `;`, `|`, saltos de línea y `$(…)`), expande las
// variables asignadas en el mismo comando y mira el programa de cada tramo. Ante la duda deja pasar, y un error
// propio nunca niega: un guardia que castra al ejecutor cuesta la tarea entera.
//
//   echo '<evento JSON>' | node ~/.claude/flujos-odd/guardia.mjs ejecutor|revisor|orquestador

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const WIN = process.platform === 'win32'
const DIR = path.dirname(fileURLToPath(import.meta.url))
const CONFIG_ODD = '.claude/qcc-implementador-odd.json'
// La config de /qcc-implementador: la nueva y, si no existe, la vieja.
const CONFIGS_NORMALES = ['.claude/qcc-implementador.json', '.claude/implementador.json']
const VIDA_MARCA = 12 * 3600_000
const TAREAS = 'odd/tasks'

const GIT_LECTURA = new Set(['status', 'diff', 'log', 'show', 'blame', 'grep', 'ls-files', 'ls-tree', 'rev-parse', 'rev-list', 'cat-file', 'archive', 'describe', 'shortlog', 'merge-base', 'name-rev', 'version', 'help'])
const GESTORES = new Set(['npm', 'pnpm', 'yarn', 'bun'])
const DEPENDENCIAS = new Set(['install', 'i', 'ci', 'add', 'remove', 'rm', 'uninstall', 'un', 'update', 'up', 'upgrade', 'link', 'publish', 'dlx'])
const DEPENDENCIAS_OTROS = { pip: ['install', 'uninstall', 'download'], pip3: ['install', 'uninstall', 'download'], cargo: ['add', 'remove', 'install', 'uninstall', 'publish', 'update'], go: ['get', 'install'], uv: ['add', 'remove', 'pip', 'sync', 'tool'], poetry: ['add', 'remove', 'install', 'update', 'publish'], gem: ['install', 'uninstall'], brew: ['install', 'uninstall', 'upgrade'], winget: ['install', 'uninstall', 'upgrade'], choco: ['install', 'uninstall', 'upgrade'], apt: ['install', 'remove'], 'apt-get': ['install', 'remove'] }
const RED = new Set(['curl', 'wget', 'ssh', 'scp', 'sftp', 'rsync', 'ftp', 'telnet', 'nc', 'ncat', 'gh', 'invoke-webrequest', 'iwr', 'invoke-restmethod', 'irm', 'start-bitstransfer'])
const SERVIDORES = new Set(['vite', 'nodemon', 'live-server', 'http-server', 'serve'])
const SCRIPTS_SIN_FIN = /^(dev|start|serve|watch|preview)(:|$)/
const ESCRIBEN = new Set(['cp', 'mv', 'touch', 'tee', 'ln', 'install'])
// Cmdlets de PowerShell (y `copy`/`move` de cmd) que escriben: la ruta va en -Path, -FilePath, -Destination o suelta.
const PS_ESCRIBEN = new Set(['set-content', 'add-content', 'out-file', 'new-item', 'tee-object', 'clear-content', 'copy-item', 'move-item', 'rename-item', 'sc', 'ac', 'ni', 'cpi', 'mi', 'rni', 'copy', 'move'])
const PS_RUTA = /^-(path|filepath|literalpath|destination)$/i
const PS_CON_VALOR = /^-(value|encoding|inputobject|itemtype|name|newname|width|delimiter|variable)$/i
const BORRAN = new Set(['rm', 'remove-item', 'ri', 'del', 'erase', 'rmdir', 'rd'])
const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh'])
const HERRAMIENTAS = new Set(['odd.mjs', 'verificar.mjs', 'guardia.mjs', 'costo.mjs', 'proceso.mjs'])
const LEEN = new Set(['cat', 'head', 'tail', 'less', 'more', 'get-content', 'gc', 'type'])
const LOCKFILES = new Set(['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lockb', 'bun.lock', 'cargo.lock', 'go.sum', 'poetry.lock', 'uv.lock', 'composer.lock', 'gemfile.lock'])
const INTERPRETES = new Set(['node', 'python', 'python3', 'py', 'deno', 'bun', 'ruby', 'perl'])
const CODIGO_EN_LINEA = new Set(['-e', '-p', '-c', '--eval', '--print'])
/** Un script que escribe archivos: `writeFileSync`, `open(…, 'w')`… */
export const ESCRIBE_FS = /\b(writeFileSync|appendFileSync|writeFile|appendFile|renameSync|copyFileSync|createWriteStream)\s*\(|\bopen\([^)]*,\s*(mode\s*=\s*)?['"][wax][bt]?\+?['"]|\.write_(text|bytes)\(/

// ── Reglas del proyecto ─────────────────────────────────────────────────────

function leerJson(archivo) {
  try {
    const j = JSON.parse(fs.readFileSync(archivo, 'utf8'))
    return j && typeof j === 'object' && !Array.isArray(j) ? j : null
  } catch {
    return null
  }
}

const cacheReglas = new Map()

/**
 * Las reglas del proyecto, de `guardia` en `.claude/qcc-implementador-odd.json`: `protegidos` ({ ruta, carpeta/ o
 * glob: motivo }), `inmutables` (carpetas o globs cuyos archivos versionados no se editan) y `scriptsNegados` (globs de
 * scripts del gestor JS). Una clave que no está ahí se toma de la config de /qcc-implementador, si existe. `origen`
 * dice de qué archivo salió cada una.
 */
export function reglasDelProyecto(raiz) {
  if (cacheReglas.has(raiz)) return cacheReglas.get(raiz)
  const odd = leerJson(path.join(raiz, CONFIG_ODD))?.guardia ?? {}
  const nombreNormal = CONFIGS_NORMALES.find((n) => fs.existsSync(path.join(raiz, n)))
  const normal = (nombreNormal && leerJson(path.join(raiz, nombreNormal))?.guardia) || {}
  const esMapa = (v) => v && typeof v === 'object' && !Array.isArray(v)
  const tomar = (clave, valida) => (valida(odd[clave]) ? [odd[clave], CONFIG_ODD] : valida(normal[clave]) ? [normal[clave], nombreNormal] : [null, null])
  const [protegidos, deProtegidos] = tomar('protegidos', esMapa)
  const [inmutables, deInmutables] = tomar('inmutables', Array.isArray)
  const [negados, deNegados] = tomar('scriptsNegados', Array.isArray)
  const reglas = {
    protegidos: Object.fromEntries(Object.entries(protegidos ?? {}).map(([k, v]) => [String(k), String(v)])),
    inmutables: (inmutables ?? []).map(String),
    scriptsNegados: (negados ?? []).map(String),
    origen: { protegidos: deProtegidos, inmutables: deInmutables, scriptsNegados: deNegados },
  }
  cacheReglas.set(raiz, reglas)
  return reglas
}

/** Glob → RegExp: `**` cruza carpetas, `*` y `?` no; un patrón que termina en `/` es la carpeta entera. */
function aRegex(patron) {
  let p = String(patron).replace(/\\/g, '/').replace(/^\.\//, '')
  if (p.endsWith('/')) p += '**'
  let re = ''
  for (let i = 0; i < p.length; i++) {
    const c = p[i]
    if (c === '*' && p[i + 1] === '*') {
      i++
      if (p[i + 1] === '/') {
        i++
        re += '(?:.*/)?'
      } else re += '.*'
    } else if (c === '*') re += '[^/]*'
    else if (c === '?') re += '[^/]'
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${re}$`, WIN ? 'i' : '')
}

/** Si `ruta` (posix) coincide con alguno de los globs. */
export const coincide = (ruta, patrones) => patrones.some((p) => aRegex(p).test(String(ruta).replace(/\\/g, '/')))

/** Si `rel` está versionado en el repo; ante la duda (git no responde), no. */
function versionado(rel, raiz) {
  try {
    execFileSync('git', ['ls-files', '--error-unmatch', '--', rel], { cwd: raiz, stdio: 'ignore', windowsHide: true })
    return true
  } catch {
    return false
  }
}

// ── Marca de corrida ────────────────────────────────────────────────────────

/** El archivo que marca una corrida abierta de odd en `raiz`: lo crea `--inicio` y lo borra `--cierre`. */
export const marcaDe = (raiz) => path.join(process.env.ODD_REGISTROS || path.join(DIR, 'registros'), 'activas', `${normal(raiz).replace(/[^a-zA-Z0-9]/g, '-')}.json`)

/** Si hay una corrida abierta en `raiz` con menos de 12 h. */
export function corridaAbierta(raiz) {
  try {
    return Date.now() - fs.statSync(marcaDe(raiz)).mtimeMs < VIDA_MARCA
  } catch {
    return false
  }
}

/** El tamaño que `--plan` anotó en la marca de la corrida abierta: `chico`, `grande` o null. */
export function tamanoDeCorrida(raiz) {
  if (!corridaAbierta(raiz)) return null
  return leerJson(marcaDe(raiz))?.tamano ?? null
}

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
/** Si `hijo` es `padre` o está dentro de él. */
export const dentro = (hijo, padre) => {
  const h = normal(hijo)
  const p = normal(padre)
  return h === p || h.startsWith(p.endsWith(path.sep) ? p : p + path.sep)
}

/** Si `abs` está en un temporal: el del sistema, `/tmp` o `TEMP`/`TMP`/`TMPDIR`. */
export function enTemporal(abs) {
  const temporales = [os.tmpdir(), process.env.TEMP, process.env.TMP, process.env.TMPDIR, WIN ? null : '/tmp'].filter(Boolean)
  return temporales.some((t) => dentro(abs, t))
}

/**
 * Por qué no se escribe en `ruta` (relativa a `cwd`) con Edit o Write; null si se puede. `soloTemporal`: el revisor.
 * `orquestador`: fuera del repo puede, y los lockfiles los escribe su gestor de paquetes.
 */
export function motivoRuta(ruta, { raiz, cwd = raiz, soloTemporal = false, orquestador = false }) {
  const abs = path.resolve(cwd, rutaNativa(ruta))
  // Lo del repo se mira aunque el repo esté en el temporal.
  if (!dentro(abs, raiz) && enTemporal(abs)) return null
  if (soloTemporal) return `el revisor solo escribe en el temporal (${ruta})`
  if (!dentro(abs, raiz)) return orquestador ? null : `fuera del repo (${ruta})`
  const rel = path.relative(raiz, abs).split(path.sep).join('/')
  const nombre = path.basename(abs).toLowerCase()
  if (/^\.env(\.|$)/.test(nombre) && !/\.(example|sample|template)$/.test(nombre)) return `secretos (${rel})`
  if (rel === '.git' || rel.startsWith('.git/')) return `.git (${rel})`
  if (/^\.claude\/(settings[^/]*\.json|agents\/)/.test(rel)) return `configuración de Claude Code (${rel})`
  if (LOCKFILES.has(nombre) && !orquestador) return `lockfile (${rel}): las dependencias las cambia el orquestador`
  const reglas = reglasDelProyecto(raiz)
  for (const [patron, motivo] of Object.entries(reglas.protegidos)) if (coincide(rel, [patron])) return `protegido por el proyecto (${rel}): ${motivo}`
  if (coincide(rel, reglas.inmutables) && versionado(rel, raiz)) return `inmutable en el proyecto (${rel}): crea uno nuevo en vez de editar el versionado`
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
// El delimitador sin comillas empieza con letra o `_`: `$((1<<2))` no es un heredoc.
const HEREDOC = /^<<(-?)[ \t]*(?:'([^'\n]+)'|"([^"\n]+)"|(\\?)([A-Za-z_][A-Za-z0-9_.-]*))/

/**
 * Si en `texto[k]` hay un escape de barra invertida, que se salta entero: `\'` fuera de comillas, `\"` dentro de dobles.
 * Un `\"` seguido de espacio, `;`, `|`, `&`, `>` o el final cierra la comilla: es una ruta de Windows (`"C:\dir\"`),
 * donde la barra no escapa.
 */
const escape = (texto, k, comilla) => {
  if (texto[k] !== '\\' || k + 1 >= texto.length) return false
  if (!comilla) return true
  if (comilla !== '"' || !/["\\$`]/.test(texto[k + 1])) return false
  return texto[k + 1] !== '"' || !/^([\s;|&>]|$)/.test(texto.slice(k + 2, k + 3))
}

/**
 * El comando sin el cuerpo de sus heredocs (`<<WORD`, `<<'WORD'`, `<<"WORD"`, `<<-WORD`) ni su operador: el cuerpo
 * son datos, no comandos. `sustituciones`: lo de `$(…)` y comillas invertidas de los cuerpos sin comillas, que el
 * shell sí corre.
 */
function sinHeredocs(cmd) {
  let texto = ''
  const sustituciones = []
  const cuerpos = []
  const pendientes = []
  let comilla = null
  for (let k = 0; k < cmd.length; k++) {
    const c = cmd[k]
    if (escape(cmd, k, comilla)) {
      texto += c + cmd[++k]
      continue
    }
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
      cuerpos.push(cuerpo.join('\n'))
    }
  }
  return { texto, sustituciones, cuerpos }
}

/** El texto de los cuerpos de los heredocs de `cmd`, juntos. */
export const cuerposDe = (cmd) => sinHeredocs(String(cmd)).cuerpos.join('\n')

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
    if (escape(sinSustituciones, k, comilla)) {
      actual += c + sinSustituciones[++k]
      continue
    }
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
    // `>|` y `>&` son redirecciones, no separadores.
    if (c === ';' || c === '\n' || ((c === '|' || c === '&') && sinSustituciones[k - 1] !== '>')) {
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
    if (escape(tramo, k, comilla)) {
      resto += c + tramo[++k]
      continue
    }
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
    // `>|` fuerza la escritura; `>&` con un archivo (no `>&1` ni `>&-`) también escribe.
    if (tramo[j] === '|' || (tramo[j] === '&' && !/[\d-]/.test(tramo[j + 1] ?? ''))) j++
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

/**
 * Las partes de un tramo ya expandido: `destinos` de sus redirecciones, `prog` (en minúsculas, sin ruta ni `.exe`; ''
 * si el tramo no corre nada), `args` y `libres` (los args que no son opciones).
 */
export function partesDe(tramo) {
  const { destinos, resto } = redireccionesDe(tramo)
  const palabras = palabrasDe(resto)
  while (palabras.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(palabras[0])) palabras.shift()
  while (['sudo', 'env', 'command', 'exec', 'time', 'nohup', '&'].includes(palabras[0])) palabras.shift()
  const prog = palabras.length ? path.basename(palabras[0].replaceAll('\\', '/')).toLowerCase().replace(/\.(exe|cmd|bat|ps1)$/, '') : ''
  const args = palabras.slice(1)
  return { destinos, prog, args, libres: args.filter((a) => !a.startsWith('-')) }
}

/** El comando de un shell anidado (`bash -c "…"`, `cmd /c …`, `powershell -Command …`); null si no es uno. */
function comandoAnidado({ prog, args }) {
  let k = -1
  if (SHELLS.has(prog)) k = args.findIndex((a) => /^-[a-z]*c$/.test(a))
  else if (prog === 'cmd') k = args.findIndex((a) => /^\/[ck]$/i.test(a))
  else if (prog === 'powershell' || prog === 'pwsh') k = args.findIndex((a) => /^-(c|command)$/i.test(a))
  return k >= 0 ? args.slice(k + 1).join(' ') : null
}

/** Las rutas que escribe un cmdlet de PowerShell: `-Path`, `-FilePath`, `-Destination`… o el argumento suelto que va ahí. */
function rutasDePowerShell(prog, args) {
  const nombradas = {}
  const sueltas = []
  for (let k = 0; k < args.length; k++) {
    const a = args[k]
    if (PS_RUTA.test(a)) nombradas[a.slice(1).toLowerCase()] = args[++k]
    else if (PS_CON_VALOR.test(a)) k++
    else if (!a.startsWith('-')) sueltas.push(a)
  }
  const origen = nombradas.path ?? nombradas.literalpath
  if (['copy-item', 'move-item', 'cpi', 'mi', 'copy', 'move'].includes(prog)) return [nombradas.destination ?? sueltas[origen ? 0 : 1]].filter(Boolean)
  return [origen ?? nombradas.filepath ?? sueltas[0]].filter(Boolean)
}

/**
 * Las rutas que escribe un tramo ya expandido: redirecciones, `sed -i`, `perl -i`, `git … --output`, `dd of=`, `cp`,
 * `mv`, `tee`, `Set-Content`, `Out-File`… y lo de un shell anidado. `conBorrados`: también `rm`, `Remove-Item` y `mkdir`.
 */
export function rutasEscritas(tramo, { conBorrados = false, profundidad = 0 } = {}) {
  const partes = partesDe(tramo)
  const { destinos, prog, args, libres } = partes
  const rutas = [...destinos]
  const anidado = profundidad < 3 ? comandoAnidado(partes) : null
  if (anidado) for (const t of tramosExpandidos(anidado)) rutas.push(...rutasEscritas(t, { conBorrados, profundidad: profundidad + 1 }))
  if (prog === 'sed' && args.some((a) => /^-[a-zA-Z]*i/.test(a) || a === '--in-place')) rutas.push(...libres.slice(1))
  // `perl -pi -e 's/a/b/' x` y `perl -i -pe …`: con -e, el primer argumento suelto es el script.
  if ((prog === 'perl' || prog === 'ruby') && args.some((a) => /^-[a-zA-Z]*i/.test(a))) rutas.push(...libres.slice(args.some((a) => /^-[a-zA-Z]*e$/.test(a)) ? 1 : 0))
  if (prog === 'patch' && !args.includes('--dry-run')) {
    const k = args.findIndex((a) => a === '-o' || a === '--output')
    rutas.push(k >= 0 && args[k + 1] ? args[k + 1] : '.')
  }
  const io = /\[(?:system\.)?io\.file\]::(?:write|append)all\w*\(\s*['"]([^'"]+)['"]/i.exec(tramo)
  if (io) rutas.push(io[1])
  if (prog === 'git') {
    const k = args.findIndex((a) => a === '--output' || a === '-o')
    if (k >= 0 && args[k + 1]) rutas.push(args[k + 1])
    for (const a of args) if (a.startsWith('--output=')) rutas.push(a.slice('--output='.length))
  }
  if (prog === 'dd') for (const a of libres) if (a.startsWith('of=')) rutas.push(a.slice(3))
  const carpeta = prog === 'mkdir' || ((prog === 'new-item' || prog === 'ni') && /^directory$/i.test(args[args.findIndex((a) => /^-itemtype$/i.test(a)) + 1] ?? ''))
  if (BORRAN.has(prog) || carpeta) {
    if (conBorrados) rutas.push(...libres)
  } else if (PS_ESCRIBEN.has(prog)) rutas.push(...rutasDePowerShell(prog, args))
  else if (ESCRIBEN.has(prog)) rutas.push(...(['cp', 'mv', 'ln', 'install'].includes(prog) ? libres.slice(-1) : libres))
  return rutas
}

/**
 * Si el tramo corre un script que escribe archivos: código en línea (`node -e`, un heredoc por stdin) con
 * `writeFileSync`… o un script de fuera del repo que lo tiene (ya escrito, o escrito por un heredoc del mismo
 * comando). Los scripts del proyecto, los de este flujo y los de una copia de la BASE no cuentan.
 */
export function scriptQueEscribe(tramo, { raiz, cwd = raiz, cmd = tramo }) {
  const { prog, args, libres } = partesDe(tramo)
  if (!INTERPRETES.has(prog)) return false
  if (args.some((a) => CODIGO_EN_LINEA.has(a))) return ESCRIBE_FS.test(tramo)
  const cuerpos = cuerposDe(cmd)
  if (args.includes('-') || !libres.length) return ESCRIBE_FS.test(cuerpos)
  if (/qcc-odd-base-/.test(libres[0])) return false
  const abs = path.resolve(cwd, rutaNativa(libres[0]))
  // Las herramientas de este flujo, instaladas en cualquier cuenta (`~/.claude*/flujos-odd/`), escriben lo suyo.
  const herramienta = HERRAMIENTAS.has(path.basename(abs).toLowerCase()) && (dentro(path.dirname(abs), DIR) || /[\\/]\.claude[^\\/]*[\\/]flujos-odd$/i.test(path.dirname(abs)))
  if (dentro(abs, raiz) || herramienta) return false
  try {
    return fs.statSync(abs).size < 1e6 && ESCRIBE_FS.test(fs.readFileSync(abs, 'utf8'))
  } catch {
    return ESCRIBE_FS.test(cuerpos) && cmd.includes(path.basename(abs))
  }
}

/** Si el tramo lee archivos del repo con `cat`, `head`, `tail`, `sed -n`, `Get-Content` o `type`, en vez de con Read. */
export function leeDelRepo(tramo, { raiz, cwd = raiz }) {
  const { prog, args, libres } = partesDe(tramo)
  const sedN = prog === 'sed' && args.includes('-n')
  if (!LEEN.has(prog) && !sedN) return false
  return (sedN ? libres.slice(1) : libres).some((a) => {
    const abs = path.resolve(cwd, rutaNativa(a))
    try {
      return dentro(abs, raiz) && fs.statSync(abs).isFile()
    } catch {
      return false
    }
  })
}

/** Por qué el orquestador no escribe en `ruta` por Bash: dentro del repo, edita con Edit o Write. */
function escrituraDelOrquestador(ruta, { raiz, cwd }) {
  if (ruta.includes(SUST) || /\$/.test(ruta)) return null
  const abs = path.resolve(cwd, rutaNativa(ruta))
  if (!dentro(abs, raiz)) return null
  return `edita con Edit o Write, no por Bash (${path.relative(raiz, abs).split(path.sep).join('/') || ruta})`
}

/** En una tarea grande el orquestador solo escribe el documento de la feature; el código lo editan los ejecutores. */
function edicionEnGrande(ruta, { raiz, cwd }) {
  const abs = path.resolve(cwd, rutaNativa(ruta))
  if (!dentro(abs, raiz) || dentro(abs, path.join(raiz, TAREAS))) return null
  return `tarea grande: el código lo edita qcc-odd-ejecutor, tú solo ${TAREAS}/ (${path.relative(raiz, abs).split(path.sep).join('/')})`
}

/** Por qué se niega un tramo ya expandido; null si pasa. `cmd`: el comando entero, con los cuerpos de los heredocs. */
function motivoTramo(tramo, ctx) {
  const { rol, raiz, cwd, profundidad = 0 } = ctx
  const revisor = rol === 'revisor'
  const orquestador = rol === 'orquestador'
  const escritura = (ruta) =>
    orquestador
      ? escrituraDelOrquestador(ruta, ctx)
      : ruta.includes(SUST) || /\$/.test(ruta)
        ? revisor
          ? `no se ve a dónde escribe (${ruta}): usa una ruta escrita a mano`
          : null
        : motivoRuta(ruta, { raiz, cwd, soloTemporal: revisor })
  const partes = partesDe(tramo)
  const { prog, args, libres } = partes
  // El orquestador puede borrar archivos sueltos y crear carpetas: Edit y Write no lo hacen.
  for (const ruta of rutasEscritas(tramo, { conBorrados: !orquestador, profundidad: 3 })) {
    const m = escritura(ruta)
    if (m) return m
  }
  if (!prog) return null
  const anidado = profundidad < 3 ? comandoAnidado(partes) : null
  if (anidado) {
    const m = motivoComando(anidado, { rol, raiz, cwd, profundidad: profundidad + 1 })
    if (m) return m
  }
  if (orquestador) {
    if (leeDelRepo(tramo, { raiz, cwd })) return `lee con Read (offset/limit) o Grep, no con ${prog}`
    if (scriptQueEscribe(tramo, ctx)) return 'edita con Edit o Write, no con un script que escribe archivos (writeFileSync…); para el temporal, redirige la salida'
  }
  if (tramo.match(/(^|[\s"'=/\\])\.env(\.[\w-]+)?(?=$|[\s"'/\\])/m) && !/\.env\.(example|sample|template)\b/.test(tramo)) return 'secretos: .env no se lee ni se escribe'
  if (prog === 'git') {
    let k = 0
    while (k < args.length && args[k].startsWith('-')) k += ['-C', '-c', '--git-dir', '--work-tree'].includes(args[k]) ? 2 : 1
    const sub = args[k]
    if (!sub) return null
    if (!GIT_LECTURA.has(sub)) return `git ${sub} modifica el repositorio o habla con el remoto: git es solo de lectura`
    if (sub === 'archive' && args.some((a) => a.startsWith('--remote'))) return 'git archive --remote habla con el remoto: red'
    return null
  }
  if (RED.has(prog)) return `${prog}: red, los subagentes no llaman servicios`
  if (GESTORES.has(prog)) {
    const sub = libres[0]
    if (DEPENDENCIAS.has(sub)) {
      if (!orquestador) return `${prog} ${sub}: las dependencias las cambia el orquestador`
    } else {
      const script = sub === 'run' ? libres[1] : sub
      if (script && SCRIPTS_SIN_FIN.test(script)) return `${prog} ${script}: no termina, no en un subagente`
      const reglas = reglasDelProyecto(raiz)
      if (script && coincide(script, reglas.scriptsNegados)) return `${prog} ${script}: script negado por el proyecto (${reglas.origen.scriptsNegados})`
    }
  }
  if (!orquestador && prog === 'npx' && args.includes('-y')) return 'npx -y descarga paquetes: dependencias'
  if (!orquestador && DEPENDENCIAS_OTROS[prog]?.includes(libres[0])) return `${prog} ${libres[0]}: las dependencias las cambia el orquestador`
  if (SERVIDORES.has(prog) && !['build', 'preview'].includes(libres[0])) return `${prog}: levanta un servidor que no termina`
  if (prog === 'next' && libres[0] === 'dev') return 'next dev: levanta un servidor que no termina'
  if (args.some((a) => a === '--watch' || a === '--watchAll') || (['vitest', 'jest'].includes(prog) && libres[0] === 'watch')) return 'modo watch: no termina, no en un subagente'
  // Banderas cortas combinadas (`-r`, `-rf`, `-Rf`), no las de PowerShell que solo contienen una r (`-Force`).
  const recursivo = args.some((a) => (/^-[a-zA-Z]{1,3}$/.test(a) && /[rR]/.test(a)) || /^--recursive$/i.test(a) || /^-recurse$/i.test(a) || /^\/s$/i.test(a))
  if (BORRAN.has(prog) && recursivo) return `${prog} recursivo: los borrados en bloque quedan para el usuario`
  if (prog === 'tar' && revisor) {
    const k = args.findIndex((a) => a === '-C' || a === '--directory')
    if (args.some((a) => /^-?[a-zA-Z]*x/.test(a))) return k >= 0 && args[k + 1] ? escritura(args[k + 1]) : 'tar -x sin -C escribe en el directorio actual'
  }
  return null
}

/** Los tramos de `cmd` con las variables asignadas antes en el mismo comando ya expandidas; sin las asignaciones. */
export function tramosExpandidos(cmd) {
  const variables = {}
  const tramos = []
  for (const crudo of tramosDe(cmd)) {
    const tramo = crudo.replace(/\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/g, (todo, n) => variables[n] ?? todo)
    const asignacion = /^([A-Za-z_][A-Za-z0-9_]*)=("[^"]*"|'[^']*'|\S*)$/.exec(tramo)
    if (asignacion) variables[asignacion[1]] = asignacion[2].replace(/^["']|["']$/g, '')
    else tramos.push(tramo)
  }
  return tramos
}

/** Por qué se niega `cmd` para `rol`; null si pasa. */
export function motivoComando(cmd, { rol, raiz, cwd = raiz, profundidad = 0 }) {
  for (const tramo of tramosExpandidos(cmd)) {
    const motivo = motivoTramo(tramo, { rol, raiz, cwd, cmd: String(cmd), profundidad })
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
    // El hook del skill sigue activo toda la sesión: el orquestador solo se guarda durante una corrida y fuera de los subagentes.
    if (rol === 'orquestador' && (evento?.agent_type || evento?.agent_id || !corridaAbierta(raiz))) return null
    if (herramienta === 'Bash' || herramienta === 'PowerShell') return motivoComando(String(entrada.command ?? ''), { rol, raiz, cwd })
    if (['Edit', 'Write', 'NotebookEdit', 'MultiEdit'].includes(herramienta)) {
      if (rol === 'revisor') return 'el revisor no edita archivos'
      const ruta = String(entrada.file_path ?? entrada.notebook_path ?? '')
      const motivo = motivoRuta(ruta, { raiz, cwd, orquestador: rol === 'orquestador' })
      if (motivo || rol !== 'orquestador') return motivo
      return tamanoDeCorrida(raiz) === 'grande' ? edicionEnGrande(ruta, { raiz, cwd }) : null
    }
    return null
  } catch {
    return null
  }
}

function main() {
  const rol = ['revisor', 'orquestador'].includes(process.argv[2]) ? process.argv[2] : 'ejecutor'
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
      permissionDecisionReason: `Guardia /qcc-implementador-odd: ${motivo}. No lo rodees: ${rol === 'orquestador' ? 'usa la herramienta que dice, o anótalo en «Para decidir»' : 'anótalo en BLOQUEOS de tu reporte'}.`,
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
