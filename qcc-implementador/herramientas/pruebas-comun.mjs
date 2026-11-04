// Ayudas comunes de los tests de /impl (guardia, estado, costos y verificar). Cada archivo de test la importa primero:
// fija FLUJOS_REGISTROS y FLUJOS_INICIAL antes de que corra cualquier prueba.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { registroDe, flujoDe } from './guardia.mjs'

// Registros, carpetas de flujo, caché y flujos.jsonl de las pruebas van a un temporal: corridas desde la carpeta
// del plugin, las pruebas no tocan el historial real de ~/.claude/flujos/registros.
export const PRUEBAS = fs.mkdtempSync(path.join(os.tmpdir(), 'flujos-pruebas-'))
process.env.FLUJOS_REGISTROS = path.join(PRUEBAS, 'registros')
// El preflight no lanza la verificación inicial en segundo plano: un proceso suelto impediría borrar los temporales
// (en Windows). Los tests que la prueban quitan esta variable de su entorno.
process.env.FLUJOS_INICIAL = '0'

export function repo(nombre, archivos) {
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

export const ev = (raiz, tool_name, tool_input) => ({ tool_name, tool_input, cwd: raiz })

export const ESTADO = fileURLToPath(new URL('./estado.mjs', import.meta.url))
export const temporales = []

/** Corre estado.mjs en `raiz` con esos argumentos (y variables de entorno extra). */
export function estadoEn(raiz, args, entorno = {}) {
  const env = { ...process.env, CLAUDE_PROJECT_DIR: raiz, ...entorno }
  const r = spawnSync(process.execPath, [ESTADO, ...args], { cwd: raiz, encoding: 'utf8', env })
  return { salida: r.stdout ?? '', codigo: r.status }
}

/** Repo temporal con `src/a.ts` y `dist/x.js` versionados y luego modificados; corre estado.mjs con `args(sha)`. */
export function estadoCon(config, args, extra = {}, entorno = {}) {
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

export const VERIFICAR = fileURLToPath(new URL('./verificar.mjs', import.meta.url))

/** Comando de un paso que escribe `contenido` en `rel` (relativo a la raíz del repo de prueba). */
export const escribirCmd = (rel, contenido) => `node -e "require('fs').writeFileSync('${rel}', '${contenido}')"`

export const GUARDIA = fileURLToPath(new URL('./guardia.mjs', import.meta.url))

/** Corre guardia.mjs como hook del agente `rol` (su `agent_type` de plugin va en el evento), con `evento` por stdin, en el proyecto `raiz`. */
export function hook(raiz, rol, evento) {
  const env = { ...process.env, CLAUDE_PROJECT_DIR: raiz }
  return spawnSync(process.execPath, [GUARDIA], { cwd: raiz, encoding: 'utf8', env, input: JSON.stringify({ agent_type: `impl:qcc-${rol}`, ...evento }) })
}

/** Filas del registro del proyecto (vacío si no hay). */
export function filasDe(raiz) {
  try {
    return fs.readFileSync(registroDe(raiz), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
  } catch {
    return []
  }
}

/** Borra el registro del repo temporal (y su rotación). */
export function borrarRegistro(raiz) {
  const registro = registroDe(raiz)
  fs.rmSync(registro, { force: true })
  fs.rmSync(registro.replace(/\.jsonl$/, '.1.jsonl'), { force: true })
}

/** `CLAUDE_CONFIG_DIR` falso con un transcript por agente: `{ id: texto final }`. */
export function transcripts(agentes) {
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

/**
 * Sesión falsa con el transcript del subagente `id` y `lineas` (objetos o texto crudo) tal cual. Devuelve el `transcript_path`
 * de la sesión principal (donde el hook lo busca: `<sesión>/subagents/agent-<id>.jsonl`).
 */
export function transcriptConLineas(id, lineas) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-sesion-'))
  temporales.push(dir)
  const sub = path.join(dir, 'sesion-1', 'subagents')
  fs.mkdirSync(sub, { recursive: true })
  fs.writeFileSync(path.join(sub, `agent-${id}.jsonl`), lineas.map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n') + '\n')
  return path.join(dir, 'sesion-1.jsonl')
}

/** Mensaje del asistente con `usage` de `tokens` de contexto (todo como input_tokens). */
export const turnoConUso = (tokens) => ({ type: 'assistant', message: { id: 'm', usage: { input_tokens: tokens, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 10 } } })

/** Una subtarea de plan con `extra` (líneas `- Campo: …\n`) antes de «Hecho cuando» y ese texto como «Hecho cuando». */
export const subtareaDePlan = (n, permitidos, { extra = '', hecho = 'x' } = {}) =>
  `S${n} · Tarea ${n}\n- Crítica: no\n- Archivos permitidos: ${permitidos}\n${extra}- Hecho cuando: ${hecho}\n- Tests: t\n- Riesgos: r\n- Reversión: v`

/** Un repo con el flujo abierto (preflight) y ese plan guardado; devuelve `{ raiz, entorno, salida, estadoJson }`. */
export function repoConPlanGuardado(nombre, subtareas, ajuste) {
  const plan = `PLAN · Externo\nClasificación: sin criterios\nObjetivo: probar\n\n${subtareas.join('\n\n')}`
  const entorno = { CLAUDE_CONFIG_DIR: transcripts({ plano: plan, ...(ajuste ? { ajuste } : {}) }) }
  const raiz = repo(nombre, { 'src/a.ts': 'a\n', 'src/b.ts': 'b\n', 'src/c.ts': 'c\n' })
  temporales.push(raiz)
  estadoEn(raiz, ['--paso', '0'], entorno)
  const salida = estadoEn(raiz, ['--guardar', 'plano', 'plan'], entorno).salida
  const estadoJson = () => JSON.parse(fs.readFileSync(path.join(flujoDe(raiz), 'estado.json'), 'utf8'))
  return { raiz, entorno, salida, estadoJson }
}

/** Borra los repos de `extra`, los `temporales` y la carpeta PRUEBAS (cada archivo de test lo llama en su `test.after`). */
export function limpiar(...extra) {
  for (const r of [...extra, ...temporales, PRUEBAS]) fs.rmSync(r, { recursive: true, force: true })
}
