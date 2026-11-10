#!/usr/bin/env node
// Guardia PreToolUse de AskUserQuestion: la pregunta de aprobación del plan de /impl (header «Plan») tiene que mostrar
// el plan en el propio diálogo. El diálogo tapa el texto anterior, y a veces el orquestador ni lo escribía: el usuario
// aprobaba a ciegas. Un hook no ve ese texto (aún no está en el transcript), así que se exige en la llamada: la opción
// «Aprobar» lleva en `preview` las líneas `S<n> · …` del bloque PARA APROBAR. Sin header «Plan», no hace nada.
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const WIN = process.platform === 'win32'

/**
 * Motivo para negar la llamada, o null si pasa: alguna pregunta con header «Plan» sin una opción cuyo `preview` traiga una línea `S<n> · `.
 * @param {unknown} entrada tool_input de AskUserQuestion
 * @returns {string|null}
 */
export function motivoDe(entrada) {
  const preguntas = Array.isArray(entrada?.questions) ? entrada.questions : []
  const sinPlan = preguntas.some((p) => String(p?.header ?? '').trim() === 'Plan'
    && !(Array.isArray(p.options) ? p.options : []).some((o) => /^\s*S\d+ · /m.test(String(o?.preview ?? ''))))
  return sinPlan ? 'la pregunta «Plan» no muestra el plan' : null
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
  if (evento?.tool_name !== 'AskUserQuestion') return
  const motivo = motivoDe(evento.tool_input)
  if (!motivo) return
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: `Guardia /impl: ${motivo}. El diálogo tapa tu texto: escribe en tu texto el bloque PARA APROBAR completo y repite la pregunta con, en la opción «Aprobar», un \`preview\` con las líneas \`S<n> · <título> · Crítica: …\` de cada subtarea y los \`P<n> · <comando>\` de PERMISOS A APROBAR (pasos.md, paso 4).`,
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
