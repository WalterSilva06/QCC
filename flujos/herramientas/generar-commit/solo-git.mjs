#!/usr/bin/env node
// Guardia PreToolUse del agente generador-commit: solo deja pasar git status, diff, log y show simples.
// Lee el evento por stdin y, si el comando no se permite, imprime un deny. No escribe registros.
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const WIN = process.platform === 'win32'
const SUBCOMANDOS = ['status', 'diff', 'log', 'show']
// Saltos de línea, operadores de shell, llaves (bash las expande) y comodines (globs).
const METACARACTERES = /[\n\r;&|<>`$(){}*?[]/
// Opciones largas que escriben archivos o ejecutan programas.
const LARGAS_PROHIBIDAS = ['--output', '--ext-diff', '--exec']

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
 * Decide si un comando se permite.
 * @param {unknown} comando
 * @returns {string | null} null si se permite; si no, el motivo del rechazo
 */
export function motivoDe(comando) {
  if (typeof comando !== 'string' || comando.trim() === '') return 'comando vacío o no es texto'
  if (METACARACTERES.test(comando)) return 'el comando tiene saltos de línea o metacaracteres de shell'
  const tokens = comando.trim().split(/\s+/)
  if (tokens[0] !== 'git') return 'solo se permite el programa git'
  if (!SUBCOMANDOS.includes(tokens[1])) return 'solo se permiten los subcomandos status, diff, log y show, sin opciones antes del subcomando'
  for (const crudo of tokens.slice(2)) {
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
  if (evento?.tool_name !== 'Bash' && evento?.tool_name !== 'PowerShell') return
  const motivo = motivoDe(evento.tool_input?.command)
  if (!motivo) return
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: `Guardia /generar-commit: ${motivo}. Solo se permiten git status, diff, log y show simples.`,
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
