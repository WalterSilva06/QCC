#!/usr/bin/env node
// Guardia PreToolUse del explorador de /impl-l: con el contexto de su subagente sobre 90k (el tope del explorador de
// /impl) le niega Read, Glob y Grep para que reporte ya. Hook del plugin (`hooks/hooks.json`): corre en cada lectura de
// la sesión y solo actúa cuando el `agent_type` es `impl-l:qcc-explorador-largo`. Con otro agente, sin él (la sesión
// principal) o ante cualquier error, deja pasar. No escribe registros.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** Contexto del explorador (tokens) desde el que se le niegan Read, Glob y Grep. */
export const TOPE_CONTEXTO = 90_000
const COLA_TRANSCRIPT = 256 * 1024

/** Si `agentType` es el explorador de /impl-l, con o sin el prefijo del plugin. */
export function esExplorador(agentType) {
  return typeof agentType === 'string' && /^(?:impl-l:)?qcc-explorador-largo$/.test(agentType.trim())
}

/**
 * Contexto (tokens) del subagente del evento, según el `usage` de su último mensaje del asistente en
 * `<transcript_path sin .jsonl>/subagents/agent-<id>.jsonl`. Lee solo la cola. `null` si falta algo o no se entiende.
 * Copia de `contextoDelAgente` de qcc-implementador/herramientas/guardia.mjs: impl-l no depende de los otros plugins.
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

/** El deny del hook para el evento, o null si deja pasar. */
export function decision(evento) {
  if (!esExplorador(evento?.agent_type) || !['Read', 'Glob', 'Grep'].includes(evento?.tool_name)) return null
  const contexto = contextoDelAgente(evento)
  if (contexto === null || contexto <= TOPE_CONTEXTO) return null
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: `Guardia /impl-l: contexto del explorador en ${Math.round(contexto / 1000)}k (tope ${TOPE_CONTEXTO / 1000}k): reporta ya con lo que tienes; lo que falte va a DUDAS como \`no explorado: <ruta> — <por qué>\`.`,
    },
  }
}

async function main() {
  let crudo = ''
  for await (const trozo of process.stdin) crudo += trozo
  try {
    const r = decision(JSON.parse(crudo))
    if (r) process.stdout.write(JSON.stringify(r))
  } catch {
    // Un evento que no se entiende pasa.
  }
}

if (process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) await main()
