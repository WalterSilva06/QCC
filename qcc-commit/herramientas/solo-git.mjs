#!/usr/bin/env node
// Guardia PreToolUse del agente qcc-generador-commit: solo deja pasar git status, diff, log y show simples.
// La única opción global permitida es `-c core.quotePath=false`, para ver las rutas con tildes sin escapar.
// Acepta además un `2>/dev/null` final (solo en Bash) y un `cd <ruta> &&` (o `;`) inicial si <ruta> es el cwd
// del evento: ninguno cambia lo que corre git, y el resto se valida igual.
// Hook del plugin (`hooks/hooks.json`): corre en cada Bash y PowerShell de la sesión, y solo vigila cuando el `agent_type`
// del evento es `commit:qcc-generador-commit` (los agentes de un plugin ignoran `hooks:` en su frontmatter). Con otro
// agente, o sin él (la sesión principal), no hace nada: si no, bloquearía todo Bash.
// Lee el evento por stdin y, si el comando no se permite, imprime un deny. No escribe registros.
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const WIN = process.platform === 'win32'
const SUBCOMANDOS = ['status', 'diff', 'log', 'show']
const SIN_ESCAPAR = /^core\.quotepath=false$/i
// Saltos de línea, operadores de shell, llaves (bash las expande) y comodines (globs).
const METACARACTERES = /[\n\r;&|<>`$(){}*?[]/
// Opciones largas que escriben archivos o ejecutan programas.
const LARGAS_PROHIBIDAS = ['--output', '--ext-diff', '--exec']
// En PowerShell, `2>/dev/null` escribiría un archivo: el sufijo solo se acepta en Bash.
const SIN_STDERR = /\s+2>\/dev\/null\s*$/
const CD = /^\s*cd\s+(?:'([^']*)'|"([^"]*)"|([^\s'"]+))\s*(?:&&|;)\s*/

/**
 * Dice si un token (ya sin comillas ni barras) es una opción prohibida.
 * Cubre `--output`, `-o`, `--ext-diff`, `--exec`, sus formas con `=` y las abreviaturas que git acepta.
 * @param {string} token
 * @returns {boolean}
 */
function esOpcionProhibida(token) {
  if (token.startsWith('--')) {
    const nombre = token.split('=')[0]
    if (nombre.length < 3) return false
    if (nombre.startsWith('--output')) return true
    return LARGAS_PROHIBIDAS.some((larga) => larga.startsWith(nombre))
  }
  return token.startsWith('-o')
}

/**
 * Si `agentType` es el agente de commits: `commit:qcc-generador-commit`, o `qcc-generador-commit` sin plugin.
 * @param {unknown} agentType
 * @returns {boolean}
 */
export function esAgenteDeCommit(agentType) {
  return typeof agentType === 'string' && /^(?:commit:)?qcc-generador-commit$/.test(agentType.trim())
}

/**
 * Normaliza una ruta para compararla: barras `/`, sin barra final y, en Windows, `/d/x` como `d:/x` y en minúsculas.
 * @param {string} ruta
 * @param {boolean} [win]
 * @returns {string}
 */
export function normalizarRuta(ruta, win = WIN) {
  const r = ruta.replace(/\\/g, '/').replace(/\/+$/, '')
  return win ? r.replace(/^\/([a-zA-Z])(?=\/|$)/, '$1:').toLowerCase() : r
}

/**
 * Quita el `2>/dev/null` final (solo en Bash) y el `cd <ruta> &&` o `cd <ruta>;` inicial si <ruta> es `cwd`.
 * @param {string} comando
 * @param {unknown} cwd
 * @param {string} herramienta
 * @returns {string}
 */
function sinEnvoltura(comando, cwd, herramienta) {
  const resto = herramienta === 'Bash' ? comando.replace(SIN_STDERR, '') : comando
  const cd = resto.match(CD)
  if (!cd || typeof cwd !== 'string' || cwd === '') return resto
  const ruta = cd[1] ?? cd[2] ?? cd[3]
  if (METACARACTERES.test(ruta) || normalizarRuta(ruta) !== normalizarRuta(cwd)) return resto
  return resto.slice(cd[0].length)
}

/**
 * Decide si un comando se permite.
 * @param {unknown} comando
 * @param {unknown} [cwd] el cwd del evento, para aceptar un `cd` a él
 * @param {string} [herramienta] `Bash` o `PowerShell`
 * @returns {string | null} null si se permite; si no, el motivo del rechazo
 */
export function motivoDe(comando, cwd, herramienta = 'Bash') {
  if (typeof comando !== 'string' || comando.trim() === '') return 'comando vacío o no es texto'
  comando = sinEnvoltura(comando, cwd, herramienta)
  if (METACARACTERES.test(comando)) return 'el comando tiene saltos de línea o metacaracteres de shell'
  const tokens = comando.trim().split(/\s+/)
  if (tokens[0] !== 'git') return 'solo se permite el programa git'
  const sub = tokens[1] === '-c' && SIN_ESCAPAR.test(tokens[2] ?? '') ? 3 : 1
  if (!SUBCOMANDOS.includes(tokens[sub])) return 'solo se permiten los subcomandos status, diff, log y show, sin más opción antes del subcomando que -c core.quotePath=false'
  for (const crudo of tokens.slice(sub + 1)) {
    const token = crudo.replace(/['"\\]/g, '')
    if (esOpcionProhibida(token)) return `la opción ${token} no se permite`
  }
  return null
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
  if (!esAgenteDeCommit(evento?.agent_type)) return
  if (evento?.tool_name !== 'Bash' && evento?.tool_name !== 'PowerShell') return
  const motivo = motivoDe(evento.tool_input?.command, evento.cwd, evento.tool_name)
  if (!motivo) return
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: `Guardia /commit: ${motivo}. Solo se permiten git status, diff, log y show simples, con -c core.quotePath=false como única opción global; como mucho, un cd al cwd antes y un 2>/dev/null al final (en Bash).`,
    },
  }))
}

function esPrincipal() {
  if (!process.argv[1]) return false
  const a = path.resolve(process.argv[1])
  const b = fileURLToPath(import.meta.url)
  return WIN ? a.toLowerCase() === b.toLowerCase() : a === b
}

if (esPrincipal()) await main()
