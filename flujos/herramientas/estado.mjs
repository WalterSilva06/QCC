#!/usr/bin/env node
// Estado git del flujo /implementador (nivel usuario: sirve para
// cualquier proyecto con git). El proyecto es el repo que contiene el directorio actual.
//
//   node ~/.claude/flujos/estado.mjs [--paso <n>]          preflight + foto global; abre la carpeta del flujo
//   node ~/.claude/flujos/estado.mjs --base [--paso <n>]   foto nueva: BASE=<sha> DESDE=<iso>
//   node ~/.claude/flujos/estado.mjs --cambios <BASE> --desde <iso> --permitidos "<a,b>" [--paso <n>] [--tokens "<rol>=<n>,…"]
//   node ~/.claude/flujos/estado.mjs --diff <BASE> [--permitidos "<a,b>"] [--paso <n>] [-- <rutas>]
//   node ~/.claude/flujos/estado.mjs --guardar <agentId> plan|exploracion [--ajuste] [--paso <n>]
//   node ~/.claude/flujos/estado.mjs --estado [--paso <n>]  qué lleva el flujo en curso
//   node ~/.claude/flujos/estado.mjs --reglas                reglas del proyecto para el orquestador
//
// `--paso <n>` (0 a 7) anota en qué paso del flujo se llama; la salida no cambia. Otro valor
// se avisa con `AVISO:` y se ignora.
//
// Una "foto" es un commit suelto con todo el árbol (versionados + nuevos no ignorados),
// armado con un índice temporal: no toca el índice ni los archivos del usuario y git lo
// recoge solo. Así el diff de una subtarea sale exacto aunque haya cambios sin commit.
// Los archivos permitidos que viven en rutas ignoradas se fuerzan dentro de la foto; lo que
// el ejecutor escribió en otras rutas ignoradas aparece por el registro de la guardia.
//
// La carpeta del flujo (`registros/<proyecto>-<hash>-flujo/`) guarda `estado.json` (fotos, plan,
// cierre), el informe del explorador, el plan y un `S<n>.md` por subtarea; el preflight la vacía.
// `--guardar` toma el informe de un agente de su transcript, en `projects/*/*/subagents/agent-<id>.jsonl`
// dentro de `CLAUDE_CONFIG_DIR` (o `~/.claude`).

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { evaluar, registroDe, flujoDe, arbolDe, configDe, coincide, relativaAlRepo, rutaNativa, RAIZ } from './guardia.mjs'
import { pasosDe, ultimaVerde } from './verificar.mjs'

const CLAUDE = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')
const AGENTES = path.join(CLAUDE, 'agents')
const WIN = process.platform === 'win32'
const TOPE_DIFF = 1000
const TOPE_SUCIOS = 30
const EDICIONES = new Set(['Edit', 'Write', 'NotebookEdit', 'MultiEdit'])

// ── Permitidos ──────────────────────────────────────────────────────────────

/**
 * `"a.ts, src/routeTree.gen.ts (generado) ,b/*.ts"` → `['a.ts', 'src/routeTree.gen.ts', 'b/*.ts']`.
 * Una ruta absoluta dentro del repo pasa a relativa; una de fuera queda tal cual (y caerá fuera de alcance).
 */
export function listaPermitidos(texto) {
  return String(texto ?? '')
    .split(',')
    .map((s) => s.replace(/\s*\([^)]*\)\s*$/, '').trim().replace(/\\/g, '/').replace(/^\.\//, ''))
    .filter(Boolean)
    .map((p) => {
      const nativa = rutaNativa(p)
      return path.isAbsolute(nativa) ? (relativaAlRepo(path.resolve(nativa), RAIZ) ?? p) : p
    })
}

/** ¿La ruta cambiada cae dentro del alcance? Sin lista de permitidos, todo cae. */
export function enAlcance(ruta, permitidos) {
  return !permitidos.length || coincide(ruta, permitidos)
}

// ── Git ─────────────────────────────────────────────────────────────────────

function git(args, { env, opcional = false } = {}) {
  try {
    return execFileSync('git', args, {
      cwd: RAIZ,
      encoding: 'utf8',
      env: env ?? process.env,
      maxBuffer: 256 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (e) {
    if (opcional) return null
    throw new Error(`git ${args.join(' ')}: ${String(e.stderr || e.message).trim()}`)
  }
}

const corto = (sha) => String(sha).slice(0, 9)

/** Foto del árbol actual como commit suelto. `forzar`: rutas permitidas que git ignora. */
function foto(forzar = []) {
  const arbol = arbolDe(RAIZ, forzar)
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: 'implementador',
    GIT_AUTHOR_EMAIL: 'implementador@local',
    GIT_COMMITTER_NAME: 'implementador',
    GIT_COMMITTER_EMAIL: 'implementador@local',
  }
  const head = git(['rev-parse', '--verify', '-q', 'HEAD'], { opcional: true })?.trim()
  return git(['commit-tree', arbol, ...(head ? ['-p', head] : []), '-m', 'implementador: foto del árbol'], { env }).trim()
}

function exigirBase(base) {
  if (!base || base.startsWith('--')) throw new Error('falta la BASE')
  if (git(['cat-file', '-e', `${base}^{commit}`], { opcional: true }) === null) throw new Error(`BASE desconocida: ${base}`)
  return base
}

function leerRegistro(desde) {
  const filas = []
  const registro = registroDe(RAIZ)
  for (const archivo of [registro.replace(/\.jsonl$/, '.1.jsonl'), registro]) {
    let texto
    try {
      texto = fs.readFileSync(archivo, 'utf8')
    } catch {
      continue
    }
    for (const linea of texto.split('\n')) {
      if (!linea.trim()) continue
      try {
        const fila = JSON.parse(linea)
        if (fila.t && fila.t >= desde) filas.push(fila)
      } catch {
        // Línea cortada: se ignora.
      }
    }
  }
  return filas
}

// ── Flujo en curso ──────────────────────────────────────────────────────────

const FLUJO = flujoDe(RAIZ)
const ESTADO = path.join(FLUJO, 'estado.json')

const leerTexto = (archivo) => {
  try {
    return fs.readFileSync(archivo, 'utf8')
  } catch {
    return null
  }
}

/** Estado del flujo en curso; `{}` si no hay o está roto. */
function leerEstado() {
  try {
    const e = JSON.parse(fs.readFileSync(ESTADO, 'utf8'))
    return e && typeof e === 'object' && !Array.isArray(e) ? e : {}
  } catch {
    return {}
  }
}

/** Mezcla `cambio` en el estado del flujo. Nunca rompe el comando que lo llama: el estado solo sirve para retomar el hilo. */
function anotarEstado(cambio) {
  try {
    fs.mkdirSync(FLUJO, { recursive: true })
    fs.writeFileSync(ESTADO, JSON.stringify({ ...leerEstado(), ...cambio }, null, 2) + '\n')
  } catch {
    // Sin estado el flujo sigue igual.
  }
}

/** Vacía la carpeta del flujo y la abre con `estado`: la llama el preflight. */
function nuevoFlujo(estado) {
  // Solo se borra la carpeta propia del proyecto, nunca otra ruta.
  if (path.basename(FLUJO).endsWith('-flujo') && path.dirname(FLUJO) === path.dirname(registroDe(RAIZ))) {
    fs.rmSync(FLUJO, { recursive: true, force: true })
  }
  fs.mkdirSync(FLUJO, { recursive: true })
  fs.writeFileSync(ESTADO, JSON.stringify(estado, null, 2) + '\n')
}

// ── Informes de los agentes ─────────────────────────────────────────────────

/** Transcript del subagente `id`, buscado primero en el proyecto actual; null si no está. */
export function transcriptDe(id, proyectos = path.join(CLAUDE, 'projects')) {
  if (!/^[\w-]+$/.test(String(id ?? ''))) return null
  const nombre = `agent-${id}.jsonl`
  const propio = RAIZ.replace(/[^a-zA-Z0-9]/g, '-')
  let carpetas = []
  try {
    carpetas = fs.readdirSync(proyectos, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)
  } catch {
    return null
  }
  carpetas.sort((a, b) => (a.toLowerCase() === propio.toLowerCase() ? -1 : b.toLowerCase() === propio.toLowerCase() ? 1 : 0))
  for (const carpeta of carpetas) {
    let sesiones = []
    try {
      sesiones = fs.readdirSync(path.join(proyectos, carpeta), { withFileTypes: true }).filter((e) => e.isDirectory())
    } catch {
      continue
    }
    for (const s of sesiones) {
      const archivo = path.join(proyectos, carpeta, s.name, 'subagents', nombre)
      if (fs.existsSync(archivo)) return archivo
    }
  }
  return null
}

/** Texto del último mensaje del agente en su transcript (cada fila trae un bloque); null si no hay. */
export function textoFinalDe(archivo) {
  const texto = leerTexto(archivo)
  if (texto === null) return null
  const porMensaje = new Map()
  let ultimo = null
  for (const linea of texto.split('\n')) {
    if (!linea.trim()) continue
    let fila
    try {
      fila = JSON.parse(linea)
    } catch {
      continue
    }
    const m = fila?.type === 'assistant' ? fila.message : null
    const partes = Array.isArray(m?.content) ? m.content.filter((c) => c?.type === 'text' && c.text).map((c) => c.text) : []
    if (!partes.length) continue
    const id = m.id ?? fila.uuid ?? String(porMensaje.size)
    porMensaje.set(id, [...(porMensaje.get(id) ?? []), ...partes])
    ultimo = id
  }
  return ultimo === null ? null : porMensaje.get(ultimo).join('\n').trim()
}

// ── Plan ────────────────────────────────────────────────────────────────────

const CAMPOS_SUBTAREA = ['Crítica', 'Archivos permitidos', 'Hecho cuando', 'Tests', 'Riesgos', 'Reversión']
const sinMarcas = (s) => String(s).replace(/\*\*/g, '').replace(/`/g, '').trim()
const RE_SUBTAREA = /^\s*(?:#{1,6}\s+)?(?:\*\*)?S(\d+)\s*·\s*(.*?)(?:\*\*)?\s*$/
const RE_PIE = /^\s*(?:\*\*)?(Verificación final|Queda para ti|Costo)(?:\*\*)?\s*:/i
const RE_SIN_CAMBIOS = /^\s*(?:\*\*)?Sin cambios(?:\*\*)?\s*:/i

/** Valor del campo `nombre` (`- Crítica: …`, con o sin negritas) en esas líneas; null si no está. */
export function campoDe(lineas, nombre) {
  const re = new RegExp(`^\\s*(?:[-*]\\s+)?(?:\\*\\*)?${nombre}(?:\\*\\*)?\\s*:(?:\\*\\*)?\\s*(.*)$`, 'i')
  for (const l of lineas) {
    const m = re.exec(l)
    if (m) return sinMarcas(m[1])
  }
  return null
}

/** Plan en texto → `{ cabecera, subtareas: [{ n, objetivo, lineas }], pie }`, con el formato de plan.md §3. La línea «Sin cambios» de un re-plan se descarta. */
export function partesDelPlan(texto) {
  const cabecera = []
  const subtareas = []
  const pie = []
  let actual = cabecera
  for (const l of String(texto).replace(/\r\n/g, '\n').split('\n')) {
    if (RE_SIN_CAMBIOS.test(l)) continue
    const s = RE_SUBTAREA.exec(l)
    if (s) {
      const nueva = { n: Number(s[1]), objetivo: sinMarcas(s[2]), lineas: [l] }
      subtareas.push(nueva)
      actual = nueva.lineas
    } else {
      if (RE_PIE.test(l)) actual = pie
      actual.push(l)
    }
  }
  for (const s of subtareas) while (s.lineas.length && !s.lineas.at(-1).trim()) s.lineas.pop()
  return { cabecera, subtareas, pie }
}

/** Rutas de «Archivos permitidos», sin comillas, marcas ni explicaciones. */
export function permitidosDe(valor) {
  return listaPermitidos(String(valor ?? '').replace(/`/g, ''))
    .map((p) => p.replace(/\s+[—–]\s+.*$/, '').trim())
    .filter((p) => p && !/^(ninguno|nada)$/i.test(p))
}

/** Criterios que `criticos` (de `.claude/implementador.json`) pide para `ruta`: los fijos y los que dependen de una condición. */
export function criticosDe(ruta, reglas) {
  const fijos = new Set()
  const condicionales = []
  for (const r of reglas) {
    const rutas = Array.isArray(r.rutas) ? r.rutas.map(String) : []
    const excepto = Array.isArray(r.excepto) ? r.excepto.map(String) : []
    if (!rutas.length || !coincide(ruta, rutas) || (excepto.length && coincide(ruta, excepto))) continue
    const ns = (Array.isArray(r.criterios) ? r.criterios : []).map(Number).filter(Number.isInteger)
    if (r.si) condicionales.push({ ns, si: String(r.si) })
    else for (const n of ns) fijos.add(n)
  }
  return { fijos: [...fijos].sort((a, b) => a - b), condicionales }
}

/** Integra un re-plan: sus subtareas reemplazan a las del mismo número; la cabecera y el pie, solo si los trae. */
export function fusionarPlanes(previo, nuevo) {
  const a = partesDelPlan(previo)
  const b = partesDelPlan(nuevo)
  const cabecera = campoDe(b.cabecera, 'Clasificación') !== null ? b.cabecera : a.cabecera
  const porNumero = new Map(a.subtareas.map((s) => [s.n, s]))
  for (const s of b.subtareas) porNumero.set(s.n, s)
  const subtareas = [...porNumero.values()].sort((x, y) => x.n - y.n)
  const pie = b.pie.length ? b.pie : a.pie
  return [...cabecera, ...subtareas.flatMap((s) => [...s.lineas, '']), ...pie].join('\n').trim()
}

/** Escribe un `S<n>.md` por subtarea, revisa campos y rutas críticas, anota el plan en el estado e imprime el resumen. */
function resumirPlan(texto, destino) {
  const { cabecera, subtareas } = partesDelPlan(texto)
  const { criticos } = configDe(RAIZ)
  for (const f of fs.readdirSync(FLUJO)) if (/^S\d+\.md$/.test(f)) fs.rmSync(path.join(FLUJO, f), { force: true })
  const encabezado = cabecera.filter((l) => /^\s*(?:#{1,6}\s+)?(?:\*\*)?(PLAN ·|Objetivo|Fuera de alcance)/i.test(l))
  const clasificacion = campoDe(cabecera, 'Clasificación')
  const avisos = []
  if (clasificacion === null) avisos.push('falta «Clasificación»')
  if (campoDe(cabecera, 'Objetivo') === null) avisos.push('falta «Objetivo»')
  const porCriterio = new Map()
  const resumen = []
  console.log(`GUARDADO: plan → ${destino}`)
  console.log(`PLAN: ${subtareas.length} subtarea(s) · Clasificación: ${clasificacion ?? '(falta)'}`)
  for (const s of subtareas) {
    const archivo = path.join(FLUJO, `S${s.n}.md`)
    fs.writeFileSync(archivo, [...encabezado, '', ...s.lineas].join('\n').trim() + '\n')
    for (const c of CAMPOS_SUBTAREA) if (campoDe(s.lineas, c) === null) avisos.push(`S${s.n} · falta «${c}»`)
    const permitidos = permitidosDe(campoDe(s.lineas, 'Archivos permitidos'))
    const critica = campoDe(s.lineas, 'Crítica')
    const fijos = new Set()
    for (const ruta of permitidos) {
      const { fijos: f, condicionales } = criticosDe(ruta, criticos)
      for (const n of f) {
        fijos.add(n)
        if (!porCriterio.has(n)) porCriterio.set(n, ruta)
      }
      for (const c of condicionales) avisos.push(`S${s.n} · ${ruta}: crítica (#${c.ns.join(', #')}) si ${c.si}`)
    }
    if (fijos.size && critica !== null && /^no\b/i.test(critica)) {
      avisos.push(`S${s.n} · Crítica: no, pero sus rutas críticas piden #${[...fijos].sort((a, b) => a - b).join(', #')}: debe ser sí`)
    }
    resumen.push({ n: s.n, objetivo: s.objetivo, critica, permitidos })
    console.log(`S${s.n} · ${s.objetivo} · Crítica: ${critica ?? '(falta)'} · permitidos: ${permitidos.join(', ') || '(faltan)'} → ${archivo}`)
  }
  const pedidos = [...porCriterio.keys()].sort((a, b) => a - b)
  if (!criticos.length) console.log('RUTAS CRÍTICAS: el proyecto no declara «criticos» en .claude/implementador.json')
  else console.log(`RUTAS CRÍTICAS: ${pedidos.length ? pedidos.map((n) => `#${n} (${porCriterio.get(n)})`).join(', ') : 'ninguna'}`)
  if (pedidos.length && clasificacion !== null) {
    const citados = new Set([...clasificacion.matchAll(/#(\d+)/g)].map((m) => Number(m[1])))
    const faltan = pedidos.filter((n) => !citados.has(n))
    if (/sin criterios/i.test(clasificacion)) avisos.push(`Clasificación: dice «sin criterios», pero las rutas críticas piden #${pedidos.join(', #')}`)
    else if (faltan.length) avisos.push(`Clasificación: no cita ${faltan.map((n) => `#${n} (${porCriterio.get(n)})`).join(', ')}`)
  }
  if (!subtareas.length) avisos.push('no encontré subtareas «S<n> · …»: despacha copiando los campos del plan')
  console.log(avisos.length ? `AVISOS:\n${avisos.map((a) => `  - ${a}`).join('\n')}` : 'AVISOS: ninguno')
  anotarEstado({ plan: destino, subtareas: resumen })
}

/** Guarda en la carpeta del flujo el informe del agente `id`: `plan` (con su resumen) o `exploracion`. */
function guardar(id, tipo, ajuste) {
  if (tipo !== 'plan' && tipo !== 'exploracion') {
    console.log(`AVISO: --guardar <agentId> plan|exploracion: tipo desconocido «${tipo ?? ''}»; no se guardó nada`)
    return
  }
  const archivo = transcriptDe(id)
  const texto = archivo ? textoFinalDe(archivo) : null
  if (!texto) {
    console.log(`AVISO: no encontré el informe del agente ${id ?? '(sin id)'}: despacha copiando su texto, como antes`)
    return
  }
  fs.mkdirSync(FLUJO, { recursive: true })
  const destino = path.join(FLUJO, `${tipo}.md`)
  if (tipo === 'exploracion') {
    fs.writeFileSync(destino, texto + '\n')
    anotarEstado({ exploracion: destino })
    console.log(`GUARDADO: exploración → ${destino}`)
    return
  }
  const previo = ajuste ? leerTexto(destino) : null
  const plan = previo ? fusionarPlanes(previo, texto) : texto
  fs.writeFileSync(destino, plan + '\n')
  resumirPlan(plan, destino)
}

/** Lo que lleva el flujo en curso, para retomar el hilo (por ejemplo, después de una compactación). */
function mostrarEstado() {
  const e = leerEstado()
  if (!e.base_global) {
    console.log('ESTADO: no hay un flujo en curso en este proyecto')
    return
  }
  console.log(`FLUJO: ${FLUJO}${e.cierre ? ` · cerrado ${e.cierre}` : ''}`)
  console.log(`BASE_GLOBAL=${e.base_global} DESDE_GLOBAL=${e.desde_global} · rama ${e.rama ?? '?'}`)
  if (e.exploracion) console.log(`EXPLORACIÓN: ${e.exploracion}`)
  if (e.plan) console.log(`PLAN: ${e.plan}`)
  for (const s of Array.isArray(e.subtareas) ? e.subtareas : []) {
    console.log(`  S${s.n} · ${s.objetivo} · permitidos: ${(s.permitidos ?? []).join(', ')} → ${path.join(FLUJO, `S${s.n}.md`)}`)
  }
  const fotos = Array.isArray(e.fotos) ? e.fotos : []
  fotos.forEach((f, i) => console.log(`FOTO ${i + 1} (--base): BASE=${f.base} DESDE=${f.desde}`))
  const verde = ultimaVerde(RAIZ)
  if (verde) console.log(`ÚLTIMO VERDE: árbol ${corto(verde.arbol)} · ${verde.t}`)
}

// ── Modos ───────────────────────────────────────────────────────────────────

function autoprueba() {
  const avisos = []
  try {
    const casos = [
      [{ tool_name: 'Bash', tool_input: { command: 'git push' } }, 'ejecutor', true],
      [{ tool_name: 'Bash', tool_input: { command: 'git status --short' } }, 'ejecutor', false],
      [{ tool_name: 'Write', tool_input: { file_path: '.claude/settings.json' } }, 'ejecutor', true],
      [{ tool_name: 'Edit', tool_input: { file_path: 'src/x.ts' } }, 'revisor', true],
    ]
    for (const [evento, rol, debeNegar] of casos) {
      if (Boolean(evaluar({ ...evento, cwd: RAIZ }, rol, RAIZ).motivo) !== debeNegar) {
        return `FALLA (${rol} ${evento.tool_name} ${JSON.stringify(evento.tool_input)})`
      }
    }
    for (const agente of ['ejecutor', 'revisor']) {
      const definicion = fs.readFileSync(path.join(AGENTES, `${agente}.md`), 'utf8')
      if (!definicion.includes('guardia.mjs')) return `FALLA (~/.claude/agents/${agente}.md no declara el hook)`
    }
    for (const agente of ['explorador', 'planificador', 'revisor-plan', 'ejecutor', 'revisor']) {
      const propio = path.join(RAIZ, '.claude', 'agents', `${agente}.md`)
      if (!fs.existsSync(propio)) continue
      // La definición del proyecto manda sobre la global: sin el hook, ese agente corre sin guardia.
      if ((agente === 'ejecutor' || agente === 'revisor') && !fs.readFileSync(propio, 'utf8').includes('guardia.mjs')) {
        return `FALLA (el proyecto redefine ${agente} en .claude/agents/${agente}.md sin la guardia)`
      }
      avisos.push(`el proyecto redefine ${agente} (.claude/agents/${agente}.md) y manda sobre el global`)
    }
    if (configDe(RAIZ).invalido) avisos.push('.claude/implementador.json no es JSON válido: rigen los valores por defecto')
    return avisos.length ? `OK con avisos: ${avisos.join(' · ')}` : 'OK'
  } catch (e) {
    return `FALLA (${e.message})`
  }
}

function preflight() {
  const desde = new Date().toISOString()
  const rama = git(['rev-parse', '--abbrev-ref', 'HEAD'], { opcional: true })?.trim() ?? '?'
  const head = git(['log', '-1', '--format=%h %s'], { opcional: true })?.trim() || '(sin commits)'
  const sucios = git(['status', '--porcelain=v1', '--untracked-files=all']).split('\n').filter(Boolean)
  const base = foto()
  const config = configDe(RAIZ)
  const reglas = fs.existsSync(path.join(RAIZ, '.claude', 'implementador'))
    ? '.claude/implementador/'
    : fs.existsSync(path.join(RAIZ, '.claude', 'implementador.md'))
      ? '.claude/implementador.md'
      : null
  const { pasos, origen } = pasosDe(RAIZ)
  let flujo = FLUJO
  try {
    nuevoFlujo({ inicio: desde, raiz: RAIZ, rama, base_global: base, desde_global: desde, fotos: [] })
  } catch (e) {
    flujo = `(no se pudo preparar: ${e.message}; despacha copiando el plan)`
  }
  console.log(`PROYECTO: ${RAIZ}`)
  console.log(`RAMA: ${rama} · HEAD ${head}`)
  if (!sucios.length) console.log('SUCIOS PREVIOS: ninguno')
  else {
    console.log(`SUCIOS PREVIOS (${sucios.length}):`)
    for (const s of sucios.slice(0, TOPE_SUCIOS)) console.log(`  ${s}`)
    if (sucios.length > TOPE_SUCIOS) console.log(`  … y ${sucios.length - TOPE_SUCIOS} más`)
  }
  console.log(`BASE_GLOBAL=${base} DESDE_GLOBAL=${desde}`)
  console.log(`FLUJO: ${flujo}`)
  console.log(`REGLAS DEL PROYECTO: ${reglas ?? 'ninguna (no hay .claude/implementador/ ni .claude/implementador.md; rigen CLAUDE.md y las reglas comunes)'}`)
  console.log(`CONFIG: ${config.archivo ? '.claude/implementador.json' : 'no hay; guardia con valores por defecto'}${config.pm ? ` · gestor JS: ${config.pm}` : ''}`)
  console.log(`VERIFICACIÓN (${origen}): ${pasos.length ? pasos.map((p) => p.cmd).join(' → ') : 'SIN PASOS'}`)
  console.log(`GUARDIA: ${autoprueba()}`)
}

const SIN_REGLAS = '(Este proyecto no tiene .claude/implementador/ ni .claude/implementador.md: rigen las reglas comunes, el CLAUDE.md del proyecto y lo que leas del repo.)'

/**
 * Las reglas del proyecto que lee el orquestador, encabezadas por la línea `REGLAS DEL PROYECTO` que llevan los despachos:
 * los archivos que haya de `.claude/implementador/`, o `.claude/implementador.md`.
 */
function imprimirReglas() {
  const carpeta = path.join(RAIZ, '.claude', 'implementador')
  if (fs.existsSync(carpeta)) {
    const partes = ['clasificacion.md', 'buscar.md', 'planificar.md'].map((a) => leerTexto(path.join(carpeta, a))?.trimEnd()).filter((t) => t !== undefined)
    console.log('REGLAS DEL PROYECTO: .claude/implementador/\n')
    console.log(partes.length ? partes.join('\n\n') : '(no tiene clasificacion.md, buscar.md ni planificar.md: rigen las reglas comunes y el CLAUDE.md del proyecto.)')
    return
  }
  const unico = leerTexto(path.join(RAIZ, '.claude', 'implementador.md'))?.trimEnd()
  console.log(`REGLAS DEL PROYECTO: ${unico === undefined ? 'ninguna' : '.claude/implementador.md'}\n`)
  console.log(unico ?? SIN_REGLAS)
}

function cambios(base, desde, permitidos) {
  const ahora = foto(permitidos)
  const mapa = new Map()
  const clave = (r) => (WIN ? r.toLowerCase() : r)
  for (const linea of git(['diff', '--name-status', '--no-renames', base, ahora]).split('\n')) {
    const m = /^([A-Z])\d*\t(.+)$/.exec(linea.trim())
    if (m) mapa.set(clave(m[2]), { estado: m[1], ruta: m[2], soloRegistro: false })
  }
  const filas = desde ? leerRegistro(desde) : []
  for (const f of filas) {
    if (f.rol !== 'ejecutor' || f.decision !== 'permitido' || !EDICIONES.has(f.herramienta) || !f.objetivo) continue
    if (!mapa.has(clave(f.objetivo))) mapa.set(clave(f.objetivo), { estado: '·', ruta: f.objetivo, soloRegistro: true })
  }
  const lista = [...mapa.values()].sort((a, b) => a.ruta.localeCompare(b.ruta))
  let fuera = 0
  console.log(`CAMBIOS desde ${corto(base)} (${lista.length}):`)
  for (const c of lista) {
    const dentro = enAlcance(c.ruta, permitidos)
    if (!dentro) fuera++
    const marca = permitidos.length ? (dentro ? '✓' : '✗') : ' '
    const nota = [
      dentro ? '' : 'FUERA DE ALCANCE',
      c.soloRegistro ? 'solo en el registro: ruta ignorada por git o edición sin efecto' : '',
    ]
      .filter(Boolean)
      .join(' · ')
    console.log(`  ${marca} ${c.estado} ${c.ruta}${nota ? `   ← ${nota}` : ''}`)
  }
  const negados = filas.filter((f) => f.decision === 'negado')
  if (negados.length) {
    console.log(`GUARDIA: ${negados.length} negación(es) desde ${desde}:`)
    for (const f of negados.slice(-5)) console.log(`  - ${f.rol} ${f.herramienta} «${String(f.objetivo ?? '').slice(0, 100)}» → ${f.motivo}`)
  }
  if (!permitidos.length) console.log('ALCANCE: (sin lista de permitidos)')
  else console.log(fuera ? `ALCANCE: FUERA (${fuera})` : 'ALCANCE: OK')
}

function diff(base, permitidos, rutas) {
  const ahora = foto(permitidos)
  const filtro = ['--', ...rutas]
  const stat = git(['diff', '--stat=150', '--no-renames', base, ahora, ...filtro]).trimEnd()
  const cuerpo = git(['diff', '--no-renames', '--no-color', base, ahora, ...filtro]).trimEnd()
  console.log(`DIFF ${corto(base)} → árbol actual${rutas.length ? ` (${rutas.join(', ')})` : ''}`)
  if (!cuerpo) {
    console.log('(sin cambios)')
    return
  }
  console.log(stat)
  console.log('')
  const lineas = cuerpo.split('\n')
  console.log(lineas.slice(0, TOPE_DIFF).join('\n'))
  if (lineas.length > TOPE_DIFF) {
    console.log(`\n… recortado: ${lineas.length - TOPE_DIFF} líneas más. Pide por ruta: --diff ${corto(base)} --permitidos "…" -- <ruta>`)
  }
}

/**
 * Argumentos → `{ modo, base, desde, permitidos, rutas, paso, aviso, tokens, agente, tipo, ajuste }`. Las opciones valen
 * solo antes de `--`; lo de después son rutas. Precedencia: --reglas > --estado > --guardar > --base > --cambios > --diff > preflight.
 * `paso` es un entero de 0 a 7 o null (con `aviso` si venía y no valía). `tokens` es el valor crudo de `--tokens`;
 * `agente` y `tipo`, los dos valores que siguen a `--guardar`.
 */
export function opcionesDe(args) {
  const corte = args.indexOf('--')
  const opciones = corte >= 0 ? args.slice(0, corte) : args
  const rutas = corte >= 0 ? args.slice(corte + 1) : []
  const valor = (nombre, salto = 1) => {
    const k = opciones.indexOf(nombre)
    return k >= 0 ? opciones[k + salto] : undefined
  }
  let modo = 'preflight'
  let base
  if (opciones.includes('--reglas')) modo = 'reglas'
  else if (opciones.includes('--estado')) modo = 'estado'
  else if (opciones.includes('--guardar')) modo = 'guardar'
  else if (opciones.includes('--base')) modo = 'base'
  else if (opciones.includes('--cambios')) {
    modo = 'cambios'
    base = valor('--cambios')
  } else if (opciones.includes('--diff')) {
    modo = 'diff'
    base = valor('--diff')
  }
  let paso = null
  let aviso
  if (opciones.includes('--paso')) {
    const v = valor('--paso')
    if (/^\d+$/.test(v ?? '') && Number(v) <= 7) paso = Number(v)
    else aviso = `--paso ${v ?? ''} no es un paso (0–7); se ignora`
  }
  return {
    modo,
    base,
    desde: valor('--desde'),
    permitidos: listaPermitidos(valor('--permitidos')),
    rutas,
    paso,
    aviso,
    tokens: valor('--tokens'),
    agente: modo === 'guardar' ? valor('--guardar') : undefined,
    tipo: modo === 'guardar' ? valor('--guardar', 2) : undefined,
    ajuste: opciones.includes('--ajuste'),
  }
}

const ROLES = ['explorador', 'planificador', 'revisor-plan', 'ejecutor', 'revisor', 'final']

/**
 * `"ejecutor=52000,ejecutor=48000,final=61000"` → `{ ejecutor: [52000, 48000], final: [61000] }`.
 * Un rol puede repetirse (un valor por llamada, en orden). `null` si falta, está vacío o algún par es inválido.
 */
export function tokensDe(texto) {
  if (typeof texto !== 'string' || !texto) return null
  const porRol = {}
  for (const par of texto.split(',')) {
    const m = /^([a-z-]+)=(\d+)$/.exec(par)
    if (!m || !ROLES.includes(m[1])) return null
    porRol[m[1]] ??= []
    porRol[m[1]].push(Number(m[2]))
  }
  return porRol
}

/** Agrega `fila` como una línea JSON a `archivo`, creando la carpeta si falta. */
export function anotarFlujo(archivo, fila) {
  fs.mkdirSync(path.dirname(archivo), { recursive: true })
  fs.appendFileSync(archivo, JSON.stringify(fila) + '\n')
}

/** Anota en el cierre los tokens por rol del flujo; avisa y sigue si no se puede. */
function anotarCierre(paso, tokens, base) {
  if (tokens === undefined) return
  if (paso !== 7) {
    console.log('AVISO: --tokens solo vale en el cierre (--cambios … --paso 7); se ignora')
    return
  }
  const porRol = tokensDe(tokens)
  if (!porRol) {
    console.log(`AVISO: --tokens ${tokens} no es rol=n,…; no se anota`)
    return
  }
  try {
    anotarFlujo(path.join(path.dirname(registroDe(RAIZ)), 'flujos.jsonl'), { t: new Date().toISOString(), raiz: RAIZ, base, tokens: porRol })
  } catch (e) {
    console.log(`AVISO: no se pudo anotar el flujo: ${e.message}`)
  }
}

function main() {
  const { modo, base, desde, permitidos, rutas, paso, aviso, tokens, agente, tipo, ajuste } = opcionesDe(process.argv.slice(2))
  if (aviso) console.log(`AVISO: ${aviso}`)
  // Ni las reglas ni el estado necesitan git: las reglas se inyectan antes del preflight.
  if (modo === 'reglas') {
    imprimirReglas()
    return
  }
  if (modo === 'estado') {
    mostrarEstado()
    return
  }
  if (modo === 'guardar') {
    try {
      guardar(agente, tipo, ajuste)
    } catch (e) {
      console.log(`AVISO: no se pudo guardar el informe (${e.message}): despacha copiando su texto, como antes`)
    }
    return
  }
  try {
    if (git(['rev-parse', '--is-inside-work-tree'], { opcional: true })?.trim() !== 'true') {
      throw new Error(`${RAIZ} no es un repositorio git: los flujos necesitan git (el usuario puede hacer git init)`)
    }
    if (modo === 'base') {
      const nueva = { base: foto(), desde: new Date().toISOString() }
      const { fotos } = leerEstado()
      anotarEstado({ fotos: [...(Array.isArray(fotos) ? fotos : []), nueva] })
      console.log(`BASE=${nueva.base} DESDE=${nueva.desde}`)
    } else if (modo === 'cambios') {
      exigirBase(base)
      anotarCierre(paso, tokens, base)
      if (paso === 7) anotarEstado({ cierre: new Date().toISOString() })
      cambios(base, desde, permitidos)
    } else if (modo === 'diff') diff(exigirBase(base), permitidos, rutas)
    else preflight()
  } catch (e) {
    console.log(`ERROR: ${e.message}`)
    process.exitCode = 2
  }
}

function esPrincipal() {
  if (!process.argv[1]) return false
  const a = path.resolve(process.argv[1])
  const b = fileURLToPath(import.meta.url)
  return WIN ? a.toLowerCase() === b.toLowerCase() : a === b
}

if (esPrincipal()) main()
