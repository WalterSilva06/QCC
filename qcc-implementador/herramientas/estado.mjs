#!/usr/bin/env node
// Estado git del flujo /impl (nivel usuario: sirve para
// cualquier proyecto con git). El proyecto es el repo que contiene el directorio actual.
//
//   node <plugin>/herramientas/estado.mjs [--paso <n>] [--forzar]  preflight + foto global; abre la carpeta del flujo
//   node <plugin>/herramientas/estado.mjs --base [--paso <n>]   foto nueva: BASE=<sha> DESDE=<iso>
//   node <plugin>/herramientas/estado.mjs --base --sub <n> [--paso <n>]   foto de la subtarea n, guardada en la carpeta del flujo (si ya hay, conserva la primera)
//   node <plugin>/herramientas/estado.mjs --cambios <BASE> --desde <iso> --permitidos "<a,b>" [--paso <n>] [--tokens "<rol>=<n>,…"] [--resultado COMPLETO|DETENIDO:<0-7>]
//   node <plugin>/herramientas/estado.mjs --cambios --sub <n>|--global [--permitidos "<ampliados>"] [--omitida] [--paso <n>] [--tokens "…"] [--resultado …]   BASE, DESDE y permitidos salen de la carpeta del flujo; --sub anota el avance de sus subtareas (--omitida: OMITIDA)
//   node <plugin>/herramientas/estado.mjs --diff <BASE> [--permitidos "<a,b>"] [--paso <n>] [-- <rutas>]
//   node <plugin>/herramientas/estado.mjs --guardar <agentId>[,<agentId>…] plan|exploracion|revision [--ajuste] [--paso <n>]   el plan imprime también las DECISIONES (ciclos, CRÍTICO, ASPECTOS); la exploración, la VERIFICACIÓN INICIAL (espera hasta 570 s), avisa con SIN EXPLORAR y con LARGO solo en la primera corrida. La lista con comas es solo para exploracion: une los informes en un exploracion.md y avisa con INCOMPLETO del que le falte una sección. La revisión final va a revision-<ciclo>.md
//   node <plugin>/herramientas/estado.mjs --aprobado [--ajustes "<texto>"] [--paso <n>]   anota que el usuario aprobó el plan, con los AJUSTES AL PLAN
//   node <plugin>/herramientas/estado.mjs --estado [--paso <n>]  qué lleva el flujo en curso (con las DECISIONES del plan, la VERIFICACIÓN INICIAL y la línea SIGUE)
//   node <plugin>/herramientas/estado.mjs --reanudar [--paso <n>]  sigue un flujo cortado en esta sesión sin vaciar su carpeta: lo de --estado más el PEDIDO y lo pendiente
//   node <plugin>/herramientas/estado.mjs --permiso-nuevo "<comando> · <servicio> · reversible: sí|no · Qué hace: … · Para qué: …" --sub <n> [--paso <n>]  agrega un permiso N<k> ya aprobado al ejecutor de la subtarea n
//   node <plugin>/herramientas/estado.mjs --tanda <n> [--sub <lista>] [--paso <n>]  abre una tanda de correcciones; --sub anota en en_curso las subtareas cuyos permisos valen
//   node <plugin>/herramientas/estado.mjs --cancelar [--paso <n>]  cierra un flujo abierto sin subtareas ejecutadas (resultado CANCELADO) y libera el candado
//   node <plugin>/herramientas/estado.mjs --reglas                reglas del proyecto para el orquestador
//   node <plugin>/herramientas/estado.mjs --guia comun|pasos [--parte 1|2]   imprime comun.md (entero o partido en «## 5.») o pasos.md con `${CLAUDE_PLUGIN_ROOT}` ya resuelto (los inyecta la skill)
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
// La verificación inicial: el preflight lanza `verificar.mjs` en segundo plano (desacoplado, con su salida en
// `verificacion-inicial.log` de la carpeta del flujo; `FLUJOS_INICIAL=0` la desactiva) y anota su pid en
// `estado.json`. `--guardar … exploracion` y `--estado` esperan a que termine y dan su resultado.
//
// La carpeta del flujo (`<git-dir>/qcc-impl/registro-flujo/`) guarda `estado.json` (fotos, plan,
// cierre), `mapa.md` (los archivos del repo por carpeta, que el preflight deja para el explorador), el informe
// del explorador, el plan y un `S<n>.md` por subtarea; el preflight la vacía, salvo
// que otro flujo del repo siga abierto (sin cierre y con actividad en los últimos 20 min, o 6 h si ya tiene
// plan): entonces avisa con el título del plan y pide `--forzar`. Un flujo con plan y sin cierre nunca se vacía solo:
// pasadas 6 h sin actividad avisa que quedó cortado, y `--forzar` lo archiva en `historial/` antes de vaciarlo.
// El cierre (`--cambios … --paso 7`) anota en `<carpeta global>/flujos.jsonl` (`~/.claude/flujos/registros`) una fila v2 (costo real, veredictos, tiempos,
// subtareas y calidad: costos.mjs), imprime el CONTEXTO del hilo principal y archiva el flujo en `<carpeta global>/historial/`
// (las 30 carpetas más recientes).
// `--guardar` toma el informe de un agente de su transcript, en `projects/*/*/subagents/agent-<id>.jsonl`
// dentro de `CLAUDE_CONFIG_DIR` (o `~/.claude`). Con `exploracion` acepta varios ids separados por coma y une sus informes.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync, spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { evaluar, rolDeAgente, registroDe, flujoDe, nombreDe, carpetaGlobal, arbolDe, configDe, coincide, relativaAlRepo, rutaNativa, regexDePermiso, motivoFijoDe, RAIZ } from './guardia.mjs'
import { pasosDe, ultimaVerde, vivo, salidasDe, cambiosDe } from './verificar.mjs'
import { metricasDelFlujo, pedidoDelFlujo, ejecutoresDelProyecto, precioDe, resumenDeCosto, resumenDeVeredictos } from './costos.mjs'

const CLAUDE = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')
const AGENTES = path.join(CLAUDE, 'agents')
const WIN = process.platform === 'win32'
const TOPE_DIFF = 1000
const TOPE_SUCIOS = 30
const TOPE_CAMBIOS = 20
const TOPE_GRUPOS = 15
const TOPE_MAPA = 300
const TOPE_NOMBRES = 25
const TOPE_REVERSION = 10
const ABIERTO_MIN = 20
// Con el plan ya guardado, el flujo puede pasar horas esperando la aprobación sin actividad.
const ABIERTO_CON_PLAN_MIN = 6 * 60
// Tope de la espera a la verificación inicial en segundo plano (verificar.mjs espera igual).
const ESPERA_INICIAL_SEG = 570
const VERIFICAR = fileURLToPath(new URL('./verificar.mjs', import.meta.url))
const EDICIONES = new Set(['Edit', 'Write', 'NotebookEdit', 'MultiEdit'])

// ── Permitidos ──────────────────────────────────────────────────────────────

/**
 * `"a.ts, src/routeTree.gen.ts (generado) ,b/*.ts"` → `['a.ts', 'src/routeTree.gen.ts', 'b/*.ts']`.
 * Solo parte en las comas fuera de paréntesis: `"src/a.ts (nuevo, sin 'use server')"` es una sola ruta, `src/a.ts`.
 * Una ruta absoluta dentro del repo pasa a relativa; una de fuera queda tal cual (y caerá fuera de alcance).
 */
export function listaPermitidos(texto) {
  const partes = ['']
  let profundidad = 0
  for (const c of String(texto ?? '')) {
    if (c === '(') profundidad++
    else if (c === ')') profundidad = Math.max(0, profundidad - 1)
    if (c === ',' && profundidad === 0) partes.push('')
    else partes[partes.length - 1] += c
  }
  return partes
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
      windowsHide: true,
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
    GIT_AUTHOR_NAME: 'qcc-implementador',
    GIT_AUTHOR_EMAIL: 'qcc-implementador@local',
    GIT_COMMITTER_NAME: 'qcc-implementador',
    GIT_COMMITTER_EMAIL: 'qcc-implementador@local',
  }
  const head = git(['rev-parse', '--verify', '-q', 'HEAD'], { opcional: true })?.trim()
  return git(['commit-tree', arbol, ...(head ? ['-p', head] : []), '-m', 'qcc-implementador: foto del árbol'], { env }).trim()
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

/** Las fotos por subtarea (`--base --sub`) del estado: `{ "<n>": { base, desde } }`, sin las entradas rotas. */
function basesDe(estado) {
  const crudas = estado.bases && typeof estado.bases === 'object' && !Array.isArray(estado.bases) ? estado.bases : {}
  return Object.fromEntries(Object.entries(crudas).filter(([, f]) => f && typeof f.base === 'string' && f.base && typeof f.desde === 'string' && f.desde))
}

/** Las sesiones del flujo (`[{ id?, transcript?, desde }]`): la del preflight y una por cada `--reanudar`; vacía en un flujo viejo. */
function sesionesDe(estado) {
  return (Array.isArray(estado.sesiones) ? estado.sesiones : []).filter((s) => s && Number.isFinite(Date.parse(s.desde)))
}

/** La sesión de Claude Code que corre este comando (`CLAUDE_CODE_SESSION_ID`), con su transcript si existe: `{ id?, transcript?, desde }`. */
function sesionActual(desde) {
  const id = /^[\w-]+$/.test(process.env.CLAUDE_CODE_SESSION_ID ?? '') ? process.env.CLAUDE_CODE_SESSION_ID : undefined
  if (!id) return { desde }
  const transcript = path.join(CLAUDE, 'projects', RAIZ.replace(/[^a-zA-Z0-9]/g, '-'), `${id}.jsonl`)
  return { id, ...(fs.existsSync(transcript) ? { transcript } : {}), desde }
}

/** El avance de la ejecución (`{ "<n>": { estado, ciclos, t } }`), sin las entradas rotas. */
function avanceDe(estado) {
  const crudo = estado.avance && typeof estado.avance === 'object' && !Array.isArray(estado.avance) ? estado.avance : {}
  return Object.fromEntries(Object.entries(crudo).filter(([, a]) => a && typeof a.estado === 'string'))
}

/** Lista guardada en el estado (`revisiones`, `tandas`), sin las entradas rotas. */
const listaDe = (estado, clave) => (Array.isArray(estado[clave]) ? estado[clave] : []).filter((x) => x && typeof x === 'object')

/** Hora (ms) de la última actividad de un flujo en este repo: su estado o el registro de la guardia; 0 si no hay. */
function ultimaActividad() {
  let t = 0
  for (const archivo of [ESTADO, registroDe(RAIZ)]) {
    try {
      t = Math.max(t, fs.statSync(archivo).mtimeMs)
    } catch {
      // No existe todavía.
    }
  }
  return t
}

/**
 * El flujo anterior del repo si sigue abierto: sin cierre y con actividad en los últimos `ABIERTO_MIN` minutos; null si no.
 * Un flujo con plan y sin cierre nunca es null (el plan es trabajo que no se pierde): pasados `ABIERTO_CON_PLAN_MIN`
 * minutos sin actividad vuelve con `cortado: true`, y el preflight no lo vacía sin `--forzar`.
 */
function flujoAbierto() {
  const previo = leerEstado()
  if (!previo.base_global || previo.cierre) return null
  const minutos = (Date.now() - ultimaActividad()) / 60_000
  if (previo.plan) return { ...previo, minutos, cortado: minutos >= ABIERTO_CON_PLAN_MIN }
  return minutos < ABIERTO_MIN ? { ...previo, minutos } : null
}

/** Vacía la carpeta del flujo y la abre con `estado`: la llama el preflight. */
function nuevoFlujo(estado) {
  // Solo se borra la carpeta propia del proyecto, nunca otra ruta.
  const padre = path.dirname(FLUJO)
  if (path.basename(FLUJO).endsWith('-flujo') && (path.basename(padre) === 'qcc-impl' || padre === carpetaGlobal()) && padre === path.dirname(registroDe(RAIZ))) {
    fs.rmSync(FLUJO, { recursive: true, force: true })
  }
  fs.mkdirSync(FLUJO, { recursive: true })
  fs.writeFileSync(ESTADO, JSON.stringify(estado, null, 2) + '\n')
}

// ── Verificación inicial en segundo plano ───────────────────────────────────

/**
 * Lanza `verificar.mjs` desacoplado (el preflight termina sin esperarlo) con su salida en `verificacion-inicial.log`
 * de la carpeta del flujo, anota `verificacion_inicial` en el estado y devuelve la línea para el preflight.
 * Sin pasos no hay nada que correr; `FLUJOS_INICIAL=0` la desactiva (los tests, que no pueden dejar procesos sueltos).
 */
function lanzarInicial(hayPasos) {
  const sinLanzar = (motivo) => {
    anotarEstado({ verificacion_inicial: { motivo } })
    return `no se lanzó (${motivo})`
  }
  if (!hayPasos) {
    anotarEstado({ verificacion_inicial: { resultado: 'SIN PASOS' } })
    return 'SIN PASOS'
  }
  if (process.env.FLUJOS_INICIAL === '0') return sinLanzar('desactivada con FLUJOS_INICIAL=0')
  let fd
  try {
    const log = path.join(FLUJO, 'verificacion-inicial.log')
    fd = fs.openSync(log, 'w')
    const hijo = spawn(process.execPath, [VERIFICAR], { cwd: RAIZ, detached: true, windowsHide: true, stdio: ['ignore', fd, fd] })
    hijo.on('error', () => {})
    hijo.unref()
    if (!hijo.pid) return sinLanzar('el proceso no arrancó')
    anotarEstado({ verificacion_inicial: { pid: hijo.pid, log, inicio: new Date().toISOString() } })
    return `en segundo plano (pid ${hijo.pid}); la espera --guardar … exploracion`
  } catch (e) {
    return sinLanzar(e.message)
  } finally {
    if (fd !== undefined) fs.closeSync(fd)
  }
}

const dormirSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)

/** `VERIFICACIÓN INICIAL: …` a partir de la línea `RESULTADO:` (con o sin ese prefijo) de la corrida. */
function lineaInicial(resultado, log) {
  const r = resultado.replace(/^RESULTADO: /, '')
  const rojo = /^ROJO \((.*)\)$/.exec(r)
  if (r === 'VERDE' || r === 'SIN PASOS') return `VERIFICACIÓN INICIAL: ${r}`
  if (rojo) return `VERIFICACIÓN INICIAL: ROJA (${rojo[1]}) · detalle: ${log}`
  return `VERIFICACIÓN INICIAL: SIN RESULTADO (${r}): corre verificar.mjs, que espera esa corrida`
}

/**
 * Espera (hasta `ESPERA_INICIAL_SEG` s) a la verificación inicial del preflight y devuelve su línea `VERIFICACIÓN INICIAL: …`;
 * null si el flujo no la tiene. El resultado se guarda en el estado: la siguiente llamada no espera. Un fallo
 * sin resultado (murió, o sigue tras el tope) no se guarda y se remite a `verificar.mjs`, que espera la corrida viva.
 */
function esperarInicial() {
  const v = leerEstado().verificacion_inicial
  if (!v || typeof v !== 'object') return null
  if (typeof v.resultado === 'string') return lineaInicial(v.resultado, v.log)
  const sinResultado = (motivo) => `VERIFICACIÓN INICIAL: SIN RESULTADO (${motivo}): corre verificar.mjs, que espera esa corrida`
  if (typeof v.motivo === 'string') return sinResultado(v.motivo)
  const t0 = Date.now()
  for (;;) {
    const vive = vivo(v.pid)
    const linea = (leerTexto(v.log) ?? '').split('\n').map((l) => l.trim()).filter((l) => l.startsWith('RESULTADO:')).at(-1)
    if (linea && !linea.startsWith('RESULTADO: EN CURSO')) {
      anotarEstado({ verificacion_inicial: { ...v, resultado: linea } })
      return lineaInicial(linea, v.log)
    }
    if (!vive) return sinResultado(linea ? 'otra corrida seguía en curso' : 'terminó sin RESULTADO')
    if (Date.now() - t0 >= ESPERA_INICIAL_SEG * 1000) return sinResultado(`sigue tras ${ESPERA_INICIAL_SEG} s`)
    dormirSync(500)
  }
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
const RE_PIE = /^\s*(?:\*\*)?(PERMISOS A APROBAR|Verificación final|Queda para ti|Costo)(?:\*\*)?\s*:/i
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

const RE_COSTO = /^\s*(?:\*\*)?Costo(?:\*\*)?\s*:/i

/** Quita del texto del plan las líneas posteriores a «Costo:» que no sean un campo del pie, `S<n> ·` ni «Sin cambios» (prosa que sobra). El resto queda tal cual. */
export function recortarPie(texto) {
  let trasCosto = false
  return String(texto).split('\n').filter((l) => {
    if (trasCosto && !RE_PIE.test(l) && !RE_SUBTAREA.test(l) && !RE_SIN_CAMBIOS.test(l)) return false
    if (RE_COSTO.test(l)) trasCosto = true
    else if (RE_SUBTAREA.test(l)) trasCosto = false
    return true
  }).join('\n')
}

/** Plan en texto → `{ cabecera, subtareas: [{ n, objetivo, lineas }], pie }`, con el formato de plan.md §3. La línea «Sin cambios» de un re-plan se descarta, y la prosa tras «Costo:» también. */
export function partesDelPlan(texto) {
  const cabecera = []
  const subtareas = []
  const pie = []
  let actual = cabecera
  for (const l of recortarPie(String(texto).replace(/\r\n/g, '\n')).split('\n')) {
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

/** Parte el texto en los «;» fuera de paréntesis (`a.mjs; b.mjs (x; y)` → dos partes). */
function partirPorPuntoYComa(texto) {
  const partes = ['']
  let profundidad = 0
  for (const c of texto) {
    if (c === '(') profundidad++
    else if (c === ')') profundidad = Math.max(0, profundidad - 1)
    if (c === ';' && profundidad === 0) partes.push('')
    else partes[partes.length - 1] += c
  }
  return partes
}

/** Rutas de «Archivos permitidos», sin comillas, marcas ni explicaciones; parte por «,» y por «;» fuera de paréntesis. */
export function permitidosDe(valor) {
  return partirPorPuntoYComa(String(valor ?? '').replace(/`/g, ''))
    .flatMap((parte) => listaPermitidos(parte))
    .map((p) => p.replace(/\s+[—–]\s+.*$/, '').trim())
    .filter((p) => p && !/^(ninguno|nada)$/i.test(p))
}

/** ¿Una ruta permitida tiene pinta de frase y no de ruta? Con espacios o terminada en «.». */
export function noPareceRuta(p) {
  return /\s/.test(p) || p.endsWith('.')
}

/**
 * Campo opcional «Depende de» de la subtarea `n` → `{ depende, aviso }`. `ninguna` da `[]` y `S1, S2` da `[1, 2]`, siempre que sean
 * subtareas anteriores del plan (`existentes`); `valor` null (falta) o inválido da `depende` undefined, y el inválido trae `aviso`.
 * Sin valor, la subtarea depende de la anterior.
 */
export function dependeDe(valor, n, existentes) {
  if (valor === null) return {}
  const texto = valor.replace(/\s+[—–]\s+.*$/, '').replace(/\s*\([^)]*\)/g, '').trim()
  if (/^ninguna$/i.test(texto)) return { depende: [] }
  const numeros = texto.split(',').map((p) => {
    const m = /^S(\d+)$/i.exec(p.trim())
    return m ? Number(m[1]) : NaN
  })
  if (numeros.every((k) => existentes.includes(k) && k < n)) return { depende: [...new Set(numeros)].sort((a, b) => a - b) }
  return { aviso: `S${n} · Depende de: «${valor}» no es «ninguna» ni subtareas anteriores del plan; se trata como ausente (depende de la anterior)` }
}

/**
 * Bloque «PERMISOS A APROBAR:» del pie → `[{ id, rol, sub?, comando, servicio, reversible, queHace, paraQue }]`. Cada permiso es una
 * línea `P<n> · <ejecutor S<n> | orquestador> · \`comando\`[ nota] · <servicio> · reversible: sí | no` con las líneas sangradas
 * `Qué hace:` y `Para qué:`. `rol` es la primera palabra de «quién» en minúsculas; lo que falta queda '' (y `reversible`
 * false: sin él cuenta como no). `comando` es lo que va entre comillas invertidas.
 */
export function permisosDe(pie) {
  const permisos = []
  for (const l of bloqueDe(pie, 'PERMISOS A APROBAR').split('\n').slice(1)) {
    const cabecera = /^\s*(?:[-*]\s+)?(?:\*\*)?(P\d+)(?:\*\*)?\s*·\s*(.*)$/.exec(l)
    if (cabecera) {
      const [, id, resto] = cabecera
      const m = /^(.*?)\s*·\s*(`+)(.+?)\2([^·]*)(?:·\s*(.*))?$/.exec(resto)
      const quien = (m ? m[1] : resto.split(/\s+·\s+/)[0]).trim()
      const partes = (m?.[5] ?? '').split(/\s+·\s+/).map((p) => p.trim()).filter(Boolean)
      const reversible = partes.map((p) => /^reversible\s*:\s*(sí|si|no)(?![\p{L}\d])/iu.exec(p)?.[1]).find(Boolean)
      const sub = /\bS(\d+)\b/i.exec(quien)?.[1]
      permisos.push({
        id,
        rol: quien.split(/\s+/)[0].toLowerCase(),
        ...(sub ? { sub: Number(sub) } : {}),
        comando: m ? m[3].trim() : '',
        servicio: partes.find((p) => !/^reversible\s*:/i.test(p)) ?? '',
        reversible: reversible ? /^s/i.test(reversible) : false,
        ...(reversible ? {} : { sinReversible: true }),
        queHace: '',
        paraQue: '',
      })
      continue
    }
    const campo = /^\s*(?:\*\*)?(Qué hace|Para qué)(?:\*\*)?\s*:(?:\*\*)?\s*(.*)$/i.exec(l)
    if (campo && permisos.length) permisos.at(-1)[/^qué/i.test(campo[1]) ? 'queHace' : 'paraQue'] = campo[2].trim()
  }
  return permisos
}

/**
 * Avisos de los permisos leídos de un plan (`bloque`: el texto del bloque, '' si no hay). `subs`: números de las subtareas;
 * `permitidos`: los de todas. Cubre: bloque sin permisos, campo que falta, quién inválido o subtarea que no existe, comodín
 * inválido, comando que ningún permiso levanta, y un argumento del comando que es un archivo permitido de alguna subtarea.
 */
function avisosDePermisos(permisos, bloque, subs, permitidos) {
  const avisos = []
  if (bloque && !permisos.length) avisos.push('PERMISOS A APROBAR: el bloque está pero no se leyó ningún permiso (¿quedó después de «Costo:»?)')
  for (const p of permisos) {
    const faltan = [
      ...(p.comando ? [] : ['«comando» entre comillas invertidas']),
      ...(p.servicio ? [] : ['servicio']),
      ...(p.sinReversible ? ['«reversible: sí | no» (cuenta como no)'] : []),
      ...(p.queHace ? [] : ['«Qué hace»']),
      ...(p.paraQue ? [] : ['«Para qué»']),
    ]
    if (faltan.length) avisos.push(`${p.id} · le falta ${faltan.join(', ')}`)
    if (p.rol === 'ejecutor' ? !subs.includes(p.sub) : p.rol !== 'orquestador') avisos.push(`${p.id} · quién «${p.rol}${p.sub ? ` S${p.sub}` : ''}» no vale: es «ejecutor S<n>» de una subtarea del plan u «orquestador»`)
    if (!p.comando) continue
    if (!regexDePermiso(p.comando)) avisos.push(`${p.id} · «${p.comando}» no se puede aprobar: no es un comando simple o el comodín «*» cae antes de la parte literal`)
    const fijo = motivoFijoDe(p.comando)
    if (fijo) avisos.push(`${p.id} · «${p.comando}» se niega aun aprobado (${fijo})`)
    const editable = p.comando.split(/\s+/).slice(1).find((w) => !w.startsWith('-') && coincide(w, permitidos))
    if (editable) avisos.push(`${p.id} · «${editable}» está en los permitidos de una subtarea: un agente podría editarlo y correrlo con los secretos`)
  }
  return avisos
}

/** Texto de un campo con sus líneas de continuación (las más sangradas que su línea); '' si no está. */
function bloqueDe(lineas, nombre) {
  const re = new RegExp(`^(\\s*)(?:[-*]\\s+)?(?:\\*\\*)?${nombre}(?:\\*\\*)?\\s*:`, 'i')
  const k = lineas.findIndex((l) => re.test(l))
  if (k < 0) return ''
  const sangria = re.exec(lineas[k])[1].length
  const bloque = [lineas[k]]
  for (const l of lineas.slice(k + 1)) {
    if (l.trim() && l.length - l.trimStart().length <= sangria) break
    bloque.push(l)
  }
  return bloque.join('\n')
}

/**
 * «Archivos permitidos» de la subtarea `n` con sus líneas de continuación (viñetas `-` o `*` incluidas), unidas con coma →
 * `{ permitidos, avisos }`. Sin el campo da `permitidos` vacío y sin avisos (la falta ya la avisa resumirPlan). Avisa si el campo
 * no trae ninguna ruta y por cada ruta que no parece una (`noPareceRuta`).
 */
export function permitidosDeSubtarea(lineas, n) {
  const bloque = bloqueDe(lineas, 'Archivos permitidos')
  if (!bloque) return { permitidos: [], avisos: [] }
  const texto = bloque.split('\n')
    .map((l, i) => (i === 0 ? l.replace(/^\s*(?:[-*]\s+)?(?:\*\*)?Archivos permitidos(?:\*\*)?\s*:(?:\*\*)?/i, '') : l.replace(/^\s*[-*]\s+/, '')).trim())
    .filter(Boolean)
    .join(', ')
  const permitidos = permitidosDe(texto)
  const avisos = permitidos.length
    ? permitidos.filter(noPareceRuta).map((p) => `S${n} · permitido «${p}» no parece una ruta`)
    : [`S${n} · Archivos permitidos: no se leyó ninguna ruta`]
  return { permitidos, avisos }
}

const RE_PARECE_EXTERNA =/\blocalhost\b|--env-file|\bservidor\b|\bdeploy\b|--linked/i
const RE_GET_POST = /\b(?:GET|POST)\s+a\b/

/** Lo que de «Hecho cuando», «Tests» y «Riesgos» sugiere un servicio vivo o la red (localhost, GET/POST a, --env-file, servidor, deploy, --linked); null si nada. */
export function parecenExternas(lineas) {
  const texto = ['Hecho cuando', 'Tests', 'Riesgos'].map((c) => bloqueDe(lineas, c)).join('\n')
  return RE_PARECE_EXTERNA.exec(texto)?.[0] ?? RE_GET_POST.exec(texto)?.[0] ?? null
}

/** Comandos `! …` del pie (los de «Queda para ti»), sin el comentario; salvo `git` y borrados recursivos, que se niegan aun aprobados. */
export function comandosParaTi(pie) {
  return [...pie.join('\n').matchAll(/`!\s*([^`#]*[^`#\s])/g)].map((m) => m[1]).filter((c) => !/^git\b|\brm\s+-\w*r/i.test(c))
}

const RE_GLOB = /[*?[{]/

/** Carpeta del tramo literal de un glob, antes de su primer carácter de glob: `src/a/*.ts` → `src/a/`. */
const carpetaLiteral = (p) => {
  const literal = p.slice(0, p.search(RE_GLOB))
  const carpeta = literal.slice(0, literal.lastIndexOf('/') + 1)
  return WIN ? carpeta.toLowerCase() : carpeta
}

/** ¿Se pisan dos rutas permitidas? Dos globs, si la carpeta literal de uno es prefijo de la del otro; si no, si una cae dentro de la otra. */
const pisa = (p, q) => {
  if (RE_GLOB.test(p) && RE_GLOB.test(q)) {
    const a = carpetaLiteral(p)
    const b = carpetaLiteral(q)
    return a.startsWith(b) || b.startsWith(a)
  }
  return enAlcance(p, [q]) || enAlcance(q, [p])
}

const sePisan = (a, b) => a.some((p) => b.some((q) => pisa(p, q)))

/** Tope de subtareas que editan el mismo árbol a la vez en un lote. */
const TOPE_LOTE = 4

/** ¿Hace de barrera? Sin permitidos, o con alguno que no parece una ruta: se pisa con todas. */
const esBarrera = (permitidos) => permitidos.length === 0 || permitidos.some(noPareceRuta)

/**
 * Lotes de ejecución del plan, por ondas, en orden de lote y dentro de cada uno por n: `[[1, 3], [2], [4]]`. `subtareas`:
 * `{ n, permitidos, depende }` (`depende` ausente = depende de la anterior). Cada subtarea va al primer lote con menos de
 * `TOPE_LOTE` miembros que quede después de los lotes de sus dependencias y de los de toda subtarea anterior con la que se pisa
 * (un archivo dentro de una carpeta o de un glob de la otra cuenta como pisarse). Sin permitidos, o con uno que no parece
 * una ruta, o con `sola: true`, se pisa con todas y hace de barrera.
 */
export function lotesDe(subtareas) {
  const lotes = []
  const loteDeN = new Map()
  const previas = []
  subtareas.forEach((s, i) => {
    const permitidos = Array.isArray(s.permitidos) ? s.permitidos : []
    // `sola`: tiene un permiso irreversible; la guardia no distingue qué ejecutor del lote llama, así que corre sin otros.
    const barrera = esBarrera(permitidos) || s.sola === true
    const depende = Array.isArray(s.depende) ? s.depende : i > 0 ? [subtareas[i - 1].n] : []
    const despuesDe = [
      ...depende.map((n) => loteDeN.get(n)),
      ...previas.filter((p) => barrera || p.barrera || sePisan(p.permitidos, permitidos)).map((p) => p.lote),
    ].filter((k) => k !== undefined)
    let lote = Math.max(-1, ...despuesDe) + 1
    while (lotes[lote]?.length >= TOPE_LOTE) lote++
    if (!lotes[lote]) lotes[lote] = []
    lotes[lote].push(s.n)
    loteDeN.set(s.n, lote)
    previas.push({ permitidos, barrera, lote })
  })
  return lotes.map((l) => [...l].sort((a, b) => a - b))
}

/** Criterios que `criticos` (de `.claude/qcc-implementador.json`) pide para `ruta`: los fijos y los que dependen de una condición. */
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
  // Un re-plan con pie pero sin el bloque de permisos conserva el anterior.
  const anterior = bloqueDe(a.pie, 'PERMISOS A APROBAR')
  const pie = b.pie.length ? (anterior && !bloqueDe(b.pie, 'PERMISOS A APROBAR') ? [...anterior.split('\n'), ...b.pie] : b.pie) : a.pie
  return [...cabecera, ...subtareas.flatMap((s) => [...s.lineas, '']), ...pie].join('\n').trim()
}

const RE_PRUEBAS = /(^|\/)(__tests__|tests?|specs?)\/|[._-](test|spec)\.[^/]+$/i

/**
 * Las decisiones que salen solas del plan (pasos.md paso 2, comun.md §5 y §6), como líneas listas para imprimir:
 * `{ ciclos, critico, aspectos }`. `subtareas` trae `{ n, critica, permitidos, fijos }` (`fijos`: los criterios
 * incondicionales de sus rutas críticas) y `pedidos` los criterios que piden las rutas críticas del plan (números, o `{ n, ruta }`).
 * Ante cualquier duda gana lo más estricto: sin Clasificación, o una que no empieza con «sin criterios», cuenta como CRÍTICO,
 * y también si hay pedidos o una subtarea de Crítica efectiva sí (la tiene si `critica` falta, no empieza con «no» o tiene `fijos`).
 */
export function decisionesDelPlan({ clasificacion = null, subtareas = [], pedidos = [] }) {
  const lista = Array.isArray(subtareas) ? subtareas : []
  const pedidas = (Array.isArray(pedidos) ? pedidos : [])
    .map((p) => (typeof p === 'object' && p !== null ? { n: Number(p.n), ruta: p.ruta } : { n: Number(p), ruta: undefined }))
    .filter((p) => Number.isInteger(p.n))
  const textoClasificacion = clasificacion === null || clasificacion === undefined ? null : String(clasificacion).trim()
  const criticas = lista.filter((s) => s.critica === null || s.critica === undefined || !/^no\b/i.test(String(s.critica).trim()) || (s.fijos ?? []).length > 0)
  const critico = textoClasificacion === null || !/^sin criterios/i.test(textoClasificacion) || pedidas.length > 0 || criticas.length > 0
  const delTexto = textoClasificacion === null ? [] : [...textoClasificacion.matchAll(/#(\d+)/g)].map((m) => Number(m[1]))
  const citados = [...new Set([...delTexto, ...pedidas.map((p) => p.n)])].sort((a, b) => a - b)

  const ciclos = `CICLOS DE LA REVISIÓN FINAL: ${critico ? 2 : 1}`

  let linea
  if (textoClasificacion === null) linea = 'sin Clasificación en el plan (cuenta como CRÍTICO)'
  else if (!critico) linea = 'ninguno'
  else {
    const razon = /\s[—–]\s+(.+)$/s.exec(textoClasificacion)?.[1]?.trim()
    const sinCitar = pedidas.filter((p) => !delTexto.includes(p.n))
    linea = [
      `${citados.length ? citados.map((n) => `#${n}`).join(', ') : 'sin números de criterio'}${razon ? ` — ${razon}` : ''}`,
      ...(sinCitar.length ? [`rutas críticas: ${sinCitar.map((p) => `#${p.n}${p.ruta ? ` (${p.ruta})` : ''}`).join(', ')}`] : []),
      ...(criticas.length ? [`primero ${criticas.map((s) => `S${s.n}`).join(', ')}`] : []),
    ].join(' · ')
  }

  const permitidos = lista.flatMap((s) => (Array.isArray(s.permitidos) ? s.permitidos : []))
  const soloTexto = permitidos.length > 0 && permitidos.every((p) => /\.md$/i.test(p))
  const aspectos = [
    'contratos, tipos y documentación',
    ...(permitidos.some((p) => RE_PRUEBAS.test(p)) ? ['tests'] : []),
    ...((textoClasificacion === null || citados.some((n) => [1, 2, 3, 6, 9].includes(n))) && !soloTexto ? ['casos borde y seguridad'] : []),
  ].join(', ')
  return { ciclos, critico: `CRÍTICO: ${linea}`, aspectos: `ASPECTOS: ${aspectos}` }
}

/** Las líneas de `decisiones` (de `decisionesDelPlan`) en el orden en que se imprimen. */
const lineasDeDecisiones = (d) => [d.ciclos, d.critico, d.aspectos]

/** Hallazgos de un informe de exploración: `[{ seccion, linea }]`, sin encabezados, renglones vacíos ni «ninguno». */
export function hallazgosDe(texto) {
  const hallazgos = []
  let seccion = null
  for (const linea of sinProsaFinal(texto)) {
    const encabezado = RE_ENCABEZADO.exec(linea)
    if (encabezado) seccion = encabezado[1]
    else if (seccion && linea.trim() && !RE_NINGUNO.test(linea)) hallazgos.push({ seccion, linea: linea.trim().replace(/^[-*]\s+/, '') })
  }
  return hallazgos
}

/** Avisos `SIN EXPLORAR: <línea>` de las DUDAS marcadas `no explorado:` (o `No exploradas:`, `**no explorado**:`, con viñeta o negrita). Solo DUDAS. */
export function sinExplorarDe(hallazgos) {
  return hallazgos.filter((h) => h.seccion === 'DUDAS' && /^[*_`\s]*no explorad[oa]s?\**\s*:/i.test(h.linea)).map((h) => `SIN EXPLORAR: ${h.linea}`)
}

/** ¿La ruta citada cae en `permitidos`? También abreviada, como la escribe el explorador: `billing/x.ts` calza con `src/billing/x.ts`. */
const citaPermitido = (ruta, permitidos) => coincide(ruta, permitidos) || permitidos.some((p) => p.endsWith(`/${ruta}`))

/** Los hallazgos que citan alguna ruta dentro de `permitidos`, como `- [SECCIÓN] …`: el CONTEXTO del ejecutor. Sin permitidos, ninguno. */
export function contextoDe(hallazgos, permitidos) {
  if (!permitidos.length) return []
  return hallazgos.filter((h) => rutasDeTexto(h.linea).some((r) => citaPermitido(r, permitidos))).map((h) => `- [${h.seccion}] ${h.linea}`)
}

/**
 * Rutas de ACOPLAMIENTOS (solo las que traen carpeta) que no caen en ningún permitido ni se nombran en «Fuera de alcance»
 * (por ruta o por nombre de archivo): `pasos.md` pide que cada acoplado tenga uno de los dos.
 */
export function acopladosSinCubrir(hallazgos, permitidos, fueraDeAlcance) {
  const fuera = String(fueraDeAlcance ?? '')
  const rutas = hallazgos.filter((h) => h.seccion === 'ACOPLAMIENTOS').flatMap((h) => rutasDeTexto(h.linea)).filter((r) => r.includes('/'))
  return [...new Set(rutas)].filter((r) => !citaPermitido(r, permitidos) && !fuera.includes(r) && !fuera.includes(path.posix.basename(r)))
}

const CAMPOS_APROBACION = ['Crítica', 'Depende de', 'Archivos permitidos', 'Cómo']
/** Con un `PARA APROBAR` entero más largo que esto, va compacto (una línea por subtarea, con el «Cómo» recortado): así la salida de `--guardar plan` no pasa de 30.000 caracteres, el tope de Claude Code. */
const TOPE_APROBACION_ENTERA = 18_000
/** Con más subtareas que esto, `--guardar plan` no imprime la línea de resumen de cada una: ya van en `PARA APROBAR`. */
const TOPE_LINEAS_RESUMEN = 20
const TOPE_COMO_COMPACTO = 160

/** `S<n> · <título> · Crítica: … · Depende de: … · permitidos: … · Cómo: …`: la línea de una subtarea en el `PARA APROBAR` compacto. */
function lineaCompacta(s) {
  const { permitidos } = permitidosDeSubtarea(s.lineas, s.n)
  const como = campoDe(s.lineas, 'Cómo')
  return [
    `S${s.n} · ${s.objetivo}`,
    `Crítica: ${campoDe(s.lineas, 'Crítica') ?? '(falta)'}`,
    `Depende de: ${campoDe(s.lineas, 'Depende de') ?? '(la anterior)'}`,
    `permitidos: ${permitidos.join(', ') || '(faltan)'}`,
    ...(como ? [`Cómo: ${como.length > TOPE_COMO_COMPACTO ? `${como.slice(0, TOPE_COMO_COMPACTO).trimEnd()}…` : como}`] : []),
  ].join(' · ')
}

/**
 * Lo que el orquestador muestra para aprobar el plan: cabecera, por subtarea su título y CAMPOS_APROBACION, y el pie sin «Verificación final».
 * Si eso pasa de `TOPE_APROBACION_ENTERA` caracteres, una línea compacta por subtarea (`lineaCompacta`): el «Cómo» entero queda en plan.md.
 */
export function aprobacionDe({ cabecera, subtareas, pie }) {
  const titulo = cabecera.find((l) => /^\s*(?:#{1,6}\s+)?(?:\*\*)?PLAN ·/i.test(l))
  const bloques = (lineas, campos) => campos.map((c) => bloqueDe(lineas, c)).filter(Boolean)
  const con = (lineas) => [
    ...(titulo ? [titulo.trim()] : []),
    ...bloques(cabecera, ['Clasificación', 'Objetivo', 'Fuera de alcance']),
    ...lineas,
    '',
    ...bloques(pie, ['PERMISOS A APROBAR', 'Queda para ti', 'Costo']),
  ].join('\n').trim()
  const entero = con(subtareas.flatMap((s) => ['', s.lineas[0].trim(), ...bloques(s.lineas, CAMPOS_APROBACION)]))
  return entero.length <= TOPE_APROBACION_ENTERA ? entero : con(['', ...subtareas.map(lineaCompacta)])
}

/** Escribe un `S<n>.md` por subtarea, revisa campos y rutas críticas, anota el plan en el estado e imprime el resumen. */
function resumirPlan(texto, destino) {
  const partes = partesDelPlan(texto)
  const { cabecera, subtareas } = partes
  const hallazgos = hallazgosDe(leerTexto(path.join(FLUJO, 'exploracion.md')) ?? '')
  const { criticos } = configDe(RAIZ)
  for (const f of fs.readdirSync(FLUJO)) if (/^S\d+\.md$/.test(f)) fs.rmSync(path.join(FLUJO, f), { force: true })
  const encabezado = cabecera.filter((l) => /^\s*(?:#{1,6}\s+)?(?:\*\*)?(PLAN ·|Objetivo|Fuera de alcance)/i.test(l))
  const titulo = cabecera.map((l) => /^\s*(?:#{1,6}\s+)?(?:\*\*)?PLAN ·\s*(.*?)(?:\*\*)?\s*$/i.exec(l)?.[1]).find(Boolean)
  const clasificacion = campoDe(cabecera, 'Clasificación')
  const avisos = []
  if (clasificacion === null) avisos.push('falta «Clasificación»')
  if (campoDe(cabecera, 'Objetivo') === null) avisos.push('falta «Objetivo»')
  const permisosPlan = permisosDe(partes.pie)
  const porCriterio = new Map()
  const resumen = []
  const paraDecidir = []
  console.log(`GUARDADO: plan → ${destino}`)
  console.log(`PLAN: ${subtareas.length} subtarea(s) · Clasificación: ${clasificacion ?? '(falta)'}`)
  const compacto = subtareas.length > TOPE_LINEAS_RESUMEN
  if (compacto) console.log(`SUBTAREAS: ${subtareas.length} → ${path.join(FLUJO, 'S<n>.md')} (con más de ${TOPE_LINEAS_RESUMEN}, su resumen va solo en PARA APROBAR)`)
  for (const s of subtareas) {
    const archivo = path.join(FLUJO, `S${s.n}.md`)
    for (const c of CAMPOS_SUBTAREA) if (campoDe(s.lineas, c) === null) avisos.push(`S${s.n} · falta «${c}»`)
    const { permitidos, avisos: avisosPermitidos } = permitidosDeSubtarea(s.lineas, s.n)
    const contexto = contextoDe(hallazgos, permitidos)
    const conContexto = contexto.length ? ['', 'CONTEXTO (hallazgos de la exploración sobre tus permitidos):', ...contexto] : []
    const suyos = permisosPlan.filter((p) => p.rol === 'ejecutor' && p.sub === s.n && p.comando)
    const conPermisos = ['', ...(suyos.length ? ['Permisos (los únicos comandos externos que puedes correr, una vez aprobados):', ...suyos.map((p) => `- ${p.id} · \`${p.comando}\` · ${p.servicio} · reversible: ${p.reversible ? 'sí' : 'no'} · Qué hace: ${p.queHace} · Para qué: ${p.paraQue}`)] : ['Permisos: ninguno'])]
    fs.writeFileSync(archivo, [...encabezado, '', ...s.lineas, ...conPermisos, ...conContexto].join('\n').trim() + '\n')
    avisos.push(...avisosPermitidos)
    const critica = campoDe(s.lineas, 'Crítica')
    const { depende, aviso } = dependeDe(campoDe(s.lineas, 'Depende de'), s.n, subtareas.map((x) => x.n))
    if (aviso) avisos.push(aviso)
    const parece = suyos.length ? null : parecenExternas(s.lineas)
    if (parece) avisos.push(`S${s.n} parece externa y no tiene permiso (menciona «${parece}»): propón el comando en «PERMISOS A APROBAR:» o déjala en «Queda para ti»`)
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
    resumen.push({ n: s.n, objetivo: s.objetivo, critica, permitidos, ...(depende ? { depende } : {}), ...(suyos.some((p) => !p.reversible) ? { sola: true } : {}) })
    paraDecidir.push({ n: s.n, critica, permitidos, fijos: [...fijos] })
    if (!compacto) console.log(`S${s.n} · ${s.objetivo} · Crítica: ${critica ?? '(falta)'} · permitidos: ${permitidos.join(', ') || '(faltan)'}${contexto.length ? ` · contexto: ${contexto.length}` : ''} → ${archivo}`)
  }
  const pedidos = [...porCriterio.keys()].sort((a, b) => a - b)
  if (!criticos.length) console.log(`RUTAS CRÍTICAS: el proyecto no declara «criticos» en ${configDe(RAIZ).nombre}`)
  else console.log(`RUTAS CRÍTICAS: ${pedidos.length ? pedidos.map((n) => `#${n} (${porCriterio.get(n)})`).join(', ') : 'ninguna'}`)
  if (pedidos.length && clasificacion !== null) {
    const citados = new Set([...clasificacion.matchAll(/#(\d+)/g)].map((m) => Number(m[1])))
    const faltan = pedidos.filter((n) => !citados.has(n))
    if (/sin criterios/i.test(clasificacion)) avisos.push(`Clasificación: dice «sin criterios», pero las rutas críticas piden #${pedidos.join(', #')}`)
    else if (faltan.length) avisos.push(`Clasificación: no cita ${faltan.map((n) => `#${n} (${porCriterio.get(n)})`).join(', ')}`)
  }
  if (!subtareas.length) avisos.push('no encontré subtareas «S<n> · …»: despacha copiando los campos del plan')
  for (const r of acopladosSinCubrir(hallazgos, resumen.flatMap((s) => s.permitidos), bloqueDe(cabecera, 'Fuera de alcance'))) {
    avisos.push(`acoplado «${r}» (ACOPLAMIENTOS de la exploración) no está en ningún permitido ni en «Fuera de alcance»`)
  }
  avisos.push(...avisosDePermisos(permisosPlan, bloqueDe(partes.pie, 'PERMISOS A APROBAR'), subtareas.map((x) => x.n), resumen.flatMap((s) => s.permitidos)))
  const paraTi = comandosParaTi(partes.pie)
  if (paraTi.length) avisos.push(`«Queda para ti» trae comandos (${paraTi.map((c) => `\`${c}\``).join(', ')}): los que un agente puede correr aprobados van en «PERMISOS A APROBAR:», aunque las reglas del proyecto digan otra cosa; re-planifica una vez con ese ajuste antes de la aprobación`)
  console.log(avisos.length ? `AVISOS:\n${avisos.map((a) => `  - ${a}`).join('\n')}` : 'AVISOS: ninguno')
  if (resumen.length) console.log(`LOTES: ${lotesDe(resumen).map((l) => l.map((n) => `S${n}`).join('+')).join(' | ')}`)
  const decisiones = decisionesDelPlan({ clasificacion, subtareas: paraDecidir, pedidos: pedidos.map((n) => ({ n, ruta: porCriterio.get(n) })) })
  console.log('DECISIONES (con los AVISOS resueltos a lo más estricto):')
  for (const l of lineasDeDecisiones(decisiones)) console.log(l)
  const dudas = hallazgos.filter((h) => h.seccion === 'DUDAS')
  if (dudas.length) console.log(`DUDAS DE LA EXPLORACIÓN (el plan no debe contradecirlas):\n${dudas.map((h) => `  - ${h.linea}`).join('\n')}`)
  if (subtareas.length) console.log(`PARA APROBAR (cópialo tal cual en tu texto; el plan completo está en ${destino}):\n${aprobacionDe(partes)}\nFIN PARA APROBAR`)
  // Un permiso conserva su aprobación solo si quién y comando son idénticos (aunque cambie su número); si no, se aprueba de nuevo con --permiso.
  // Los «nuevo» (agregados a mitad de corrida) siguen mientras su subtarea esté en el plan.
  const previas = Object.entries(leerEstado().permisos ?? {}).filter(([, p]) => p && typeof p === 'object')
  const permisos = {
    ...Object.fromEntries(previas.filter(([, p]) => p.nuevo && resumen.some((s) => s.n === p.sub))),
    ...Object.fromEntries(permisosPlan
      .filter((p) => p.comando && (p.rol === 'orquestador' || (p.rol === 'ejecutor' && resumen.some((s) => s.n === p.sub))))
      .map(({ id, sinReversible, ...p }) => {
        const aprobado = previas.find(([, a]) => !a.nuevo && a.rol === p.rol && a.sub === p.sub && a.comando === p.comando && a.aprobado)?.[1].aprobado
        return [id, { ...p, ...(aprobado ? { aprobado } : {}) }]
      })),
  }
  // Un plan nuevo o re-planificado se vuelve a aprobar: la aprobación previa ya no vale.
  anotarEstado({ plan: destino, subtareas: resumen, decisiones, aprobacion: undefined, permisos,...(clasificacion !== null ? { clasificacion } : {}), ...(titulo ? { titulo: sinMarcas(titulo) } : {}) })
}

/** Rutas de archivo que cita un informe (`ruta:línea`, absolutas o relativas), relativas al repo cuando caen dentro. */
export function rutasDeTexto(texto) {
  const rutas = new Set()
  const patron = /(?:[A-Za-z]:)?[\w.\-\\/À-ſ]*[\\/][\w.\-À-ſ]+\.[A-Za-z0-9]{1,8}|\b[\w\-À-ſ]+\.(?:md|json|mjs|cjs|js|ts|tsx|jsx|astro|vue|svelte|css|html|ya?ml|toml|sql|py|rs|go)\b/g
  for (const m of String(texto).matchAll(patron)) {
    const ruta = listaPermitidos(m[0])[0]
    if (ruta) rutas.add(ruta)
  }
  return [...rutas]
}

/**
 * Qué criterios de `criticos` tocan las rutas de la exploración: «ninguna» solo si el proyecto declara `criticos` y
 * ninguna ruta citada cae en ellos. Una regla condicional (`si`) cuenta como crítica.
 */
function criticasDeExploracion(texto) {
  const { criticos } = configDe(RAIZ)
  if (!criticos.length) return 'el proyecto no declara «criticos»'
  const porCriterio = new Map()
  for (const ruta of rutasDeTexto(texto)) {
    const { fijos, condicionales } = criticosDe(ruta, criticos)
    for (const n of [...fijos, ...condicionales.flatMap((c) => c.ns)]) if (!porCriterio.has(n)) porCriterio.set(n, ruta)
  }
  if (!porCriterio.size) return 'ninguna'
  return [...porCriterio.keys()].sort((a, b) => a - b).map((n) => `#${n} (${porCriterio.get(n)})`).join(', ')
}

const SECCIONES_EXPLORACION = ['ARCHIVOS', 'TESTS', 'ACOPLAMIENTOS', 'DATOS', 'DUDAS']
const RE_ENCABEZADO = /^\s*(?:#{1,6}\s*)?(?:\*\*)?(ARCHIVOS|TESTS|ACOPLAMIENTOS|DATOS|DUDAS)(?:\*\*)?\s*:?\s*$/
const RE_NINGUNO = /^\s*(?:[-*]\s*)?ninguno\.?\s*$/i

/** Tope de líneas de hallazgos de cada explorador y máximo de exploradores en total: fijos, el orquestador elige cuántos según el pedido. */
const TOPE_LINEAS_EXPLORADOR = 20
const MAX_EXPLORADORES = 16
const MAX_LINEA_EXPLORACION = 160
const RE_RUTA_LINEA = /[^\s`—]+:\d+/

/** Líneas del informe sin la prosa que sobra: en la última sección, tras un renglón vacío, solo quedan viñetas («-», «*») y líneas con `ruta:línea`. */
function sinProsaFinal(texto) {
  const lineas = String(texto ?? '').split('\n')
  const ultimo = lineas.findLastIndex((l) => RE_ENCABEZADO.test(l))
  if (ultimo < 0) return lineas
  let hayVacio = false
  return lineas.filter((l, i) => {
    if (i <= ultimo) return true
    if (!l.trim()) hayVacio = true
    return !hayVacio || !l.trim() || /^\s*[-*]/.test(l) || RE_RUTA_LINEA.test(l)
  })
}

/** Líneas `LARGO:` de los informes `[{ id, texto }]` que pasan de `tope` hallazgos (líneas no vacías sin los 5 encabezados) o traen líneas de más de 160 caracteres. */
export function avisosDeLargo(informes, tope) {
  const avisos = []
  for (const { id, texto } of informes) {
    const lineas = sinProsaFinal(texto).map((l) => l.trimEnd()).filter((l) => l.trim() && !RE_ENCABEZADO.test(l) && !RE_NINGUNO.test(l))
    if (lineas.length > tope) avisos.push(`LARGO: agente ${id} con ${lineas.length} hallazgos (tope ${tope})`)
    const anchas = lineas.filter((l) => l.length > MAX_LINEA_EXPLORACION).length
    if (anchas) avisos.push(`LARGO: agente ${id} con ${anchas} líneas de más de ${MAX_LINEA_EXPLORACION} caracteres`)
  }
  return avisos
}

/** Clave para no repetir un hallazgo de `seccion`: todos sus `ruta:línea`, o el texto antes de « — », o la línea entera. */
function claveDeHallazgo(seccion, linea) {
  const rutas = linea.match(new RegExp(RE_RUTA_LINEA.source, 'g'))
  if (rutas) return `${seccion} ruta:${rutas.join(' ')}`
  return `${seccion} texto:${linea.split(' — ')[0].replace(/^\s*[-*]\s*/, '').trim()}`
}

/**
 * Une los informes de varios exploradores (`[{ id, texto }]`) en uno solo: las secciones ARCHIVOS, TESTS, ACOPLAMIENTOS,
 * DATOS y DUDAS, en ese orden, con los hallazgos en el orden de llegada. Un hallazgo se descarta solo si otro informe ya
 * trajo, en la misma sección, los mismos `ruta:línea` (gana la primera aparición); los de un mismo informe quedan todos.
 * Devuelve `{ texto, incompletos }`; `incompletos` son los `{ id, faltan }` de los informes sin alguna sección.
 */
export function fusionarExploraciones(informes) {
  const porSeccion = new Map(SECCIONES_EXPLORACION.map((s) => [s, []]))
  const vistas = new Map()
  const incompletos = []
  for (const { id, texto } of informes) {
    const presentes = new Set()
    let actual = null
    for (const linea of sinProsaFinal(texto)) {
      const encabezado = RE_ENCABEZADO.exec(linea)
      if (encabezado) {
        actual = encabezado[1]
        presentes.add(actual)
        continue
      }
      if (!actual || !linea.trim() || RE_NINGUNO.test(linea)) continue
      const clave = claveDeHallazgo(actual, linea)
      if ((vistas.get(clave) ?? id) !== id) continue
      vistas.set(clave, id)
      porSeccion.get(actual).push(linea.trimEnd())
    }
    const faltan = SECCIONES_EXPLORACION.filter((s) => !presentes.has(s))
    if (faltan.length) incompletos.push({ id, faltan })
  }
  const bloques = SECCIONES_EXPLORACION.map((s) => [s, ...(porSeccion.get(s).length ? porSeccion.get(s) : ['- ninguno'])].join('\n'))
  return { texto: bloques.join('\n\n'), incompletos }
}

/** Agentes que la guardia cortó por contexto en esas filas del registro (`negado` con motivo `contexto <N>k`): `Map(id → motivo)`. */
function cortadosDe(filas) {
  const cortados = new Map()
  for (const f of filas) if (f.agente && f.decision === 'negado' && /^contexto \d+k$/.test(f.motivo ?? '') && !cortados.has(f.agente)) cortados.set(f.agente, f.motivo)
  return cortados
}

/** Líneas `CORTADO:` de los exploradores `ids` que la guardia dejó sin leer por contexto (desde el inicio del flujo). */
function avisosDeCortado(ids) {
  const e = leerEstado()
  const desde = e.desde_global ?? e.inicio
  if (!desde) return []
  let cortados
  try {
    cortados = cortadosDe(leerRegistro(desde))
  } catch {
    return []
  }
  return ids.filter((id) => cortados.has(id)).map((id) => `CORTADO: agente ${id} por contexto (${cortados.get(id).slice('contexto '.length)})`)
}

/** Ids de `--guardar` separados por coma: recortados y sin repetir (si no queda ninguno, el valor tal cual). */
function idsDe(id) {
  const lista = [...new Set(String(id ?? '').split(',').map((s) => s.trim()).filter(Boolean))]
  return lista.length ? lista : [id]
}

/**
 * Guarda en la carpeta del flujo el informe del agente `id`: `plan` (con su resumen) o `exploracion`
 * (`id` puede ser una lista separada por comas de exploradores).
 * La exploración cierra con el resultado de la verificación inicial, aunque no se haya encontrado el informe.
 */
function guardar(id, tipo, ajuste) {
  guardarInforme(id, tipo, ajuste)
  if (tipo !== 'exploracion') return
  const inicial = esperarInicial()
  if (inicial) console.log(inicial)
}

function guardarInforme(id, tipo, ajuste) {
  if (tipo === 'revision') return guardarRevision(id)
  if (tipo !== 'plan' && tipo !== 'exploracion') {
    console.log(`AVISO: --guardar <agentId> plan|exploracion|revision: tipo desconocido «${tipo ?? ''}»; no se guardó nada`)
    return
  }
  const pedidos = tipo === 'exploracion' ? idsDe(id) : [id]
  const informes = []
  for (const uno of pedidos) {
    const archivo = transcriptDe(uno)
    const texto = archivo ? textoFinalDe(archivo) : null
    if (texto) informes.push({ id: uno, texto })
    else console.log(`AVISO: no encontré el informe del agente ${uno ?? '(sin id)'}: despacha copiando su texto, como antes`)
  }
  if (!informes.length) return
  fs.mkdirSync(FLUJO, { recursive: true })
  const destino = path.join(FLUJO, `${tipo}.md`)
  if (tipo === 'exploracion') {
    const { texto: fusion, incompletos } = fusionarExploraciones(informes)
    const texto = pedidos.length === 1 ? informes[0].texto : fusion
    fs.writeFileSync(destino, texto + '\n')
    // El pedido literal queda en la carpeta del flujo, para que reanudar no dependa de los transcripts.
    const archivoPedido = path.join(FLUJO, 'pedido.md')
    if (!fs.existsSync(archivoPedido)) {
      try {
        const e = leerEstado()
        const pedido = pedidoDelFlujo(RAIZ, e.inicio ?? e.desde_global, { base: e.base_global })
        if (pedido) fs.writeFileSync(archivoPedido, pedido + '\n')
      } catch {
        // Sin el pedido, reanudar lo busca de nuevo.
      }
    }
    const repetida = Boolean(leerEstado().exploracion)
    anotarEstado({ exploracion: destino })
    console.log(`GUARDADO: exploración → ${destino}`)
    for (const { id: agente, faltan } of incompletos) {
      console.log(`INCOMPLETO: agente ${agente} sin ${faltan.join(', ')}: relanza solo esa parte`)
    }
    if (!repetida) for (const aviso of avisosDeLargo(informes, TOPE_LINEAS_EXPLORADOR)) console.log(aviso)
    for (const aviso of avisosDeCortado(pedidos)) console.log(aviso)
    for (const aviso of sinExplorarDe(hallazgosDe(texto))) console.log(aviso)
    console.log(`RUTAS CRÍTICAS EN LA EXPLORACIÓN: ${criticasDeExploracion(texto)}`)
    return
  }
  const texto = informes[0].texto
  const previo = ajuste ? leerTexto(destino) : null
  const plan = previo ? fusionarPlanes(previo, texto) : recortarPie(texto).trim()
  fs.writeFileSync(destino, plan + '\n')
  resumirPlan(plan, destino)
}

/** Texto del primer mensaje del usuario en el transcript de un agente (su despacho); '' si no hay. */
function promptDe(archivo) {
  for (const linea of (leerTexto(archivo) ?? '').split('\n')) {
    let fila
    try {
      fila = JSON.parse(linea)
    } catch {
      continue
    }
    if (fila?.type !== 'user') continue
    const c = fila.message?.content
    return typeof c === 'string' ? c : Array.isArray(c) ? c.map((x) => (x?.type === 'text' ? x.text : '')).join('') : ''
  }
  return ''
}

const RE_VEREDICTO = /^[\s*_>`-]*VEREDICTO(?:\*\*)?:\s*\**\s*([A-ZÁÉÍÓÚ]+)/m

/**
 * `--guardar <agentId> revision`: guarda el reporte de la revisión final en `revision-<c>.md` (con la `SALIDA DEL OWNER` de su
 * despacho, si la trae) y la anota en `revisiones` del estado. Cada agente nuevo es un ciclo más; volver a guardar el mismo agente
 * (un reintento) reemplaza su ciclo.
 */
function guardarRevision(id) {
  const archivo = transcriptDe(id)
  const texto = archivo ? textoFinalDe(archivo) : null
  if (!texto) {
    console.log(`AVISO: no encontré el informe del agente ${id ?? '(sin id)'}: sigue con su texto, como antes`)
    return
  }
  const revisiones = listaDe(leerEstado(), 'revisiones')
  const previa = revisiones.findIndex((r) => r.agente === id)
  const c = previa >= 0 ? revisiones[previa].c : revisiones.length + 1
  const veredicto = RE_VEREDICTO.exec(texto)?.[1] ?? null
  const owner = /^SALIDA DEL OWNER:[\s\S]*?(?=^NO corras verificar\.mjs\.|^CRÍTICO:|(?![\s\S]))/m.exec(promptDe(archivo))?.[0].trim()
  fs.mkdirSync(FLUJO, { recursive: true })
  const destino = path.join(FLUJO, `revision-${c}.md`)
  fs.writeFileSync(destino, [texto.trim(), ...(owner ? ['', owner] : [])].join('\n') + '\n')
  const entrada = { c, agente: id, veredicto, archivo: destino, t: new Date().toISOString() }
  anotarEstado({ revisiones: previa >= 0 ? revisiones.map((r, i) => (i === previa ? entrada : r)) : [...revisiones, entrada] })
  console.log(`GUARDADO: revisión ciclo ${c} (${veredicto ?? 'sin VEREDICTO'}) → ${destino}`)
}

/** El tramo de `texto` desde la línea que empieza con `desde` (incluida) hasta la primera que empiece con algo de `hasta`; '' si no está. */
function seccionDe(texto, desde, hasta) {
  const lineas = String(texto ?? '').split('\n')
  const k = lineas.findIndex((l) => l.replace(/^[\s*_]+/, '').startsWith(desde))
  if (k < 0) return ''
  const fin = lineas.findIndex((l, i) => i > k && hasta.some((h) => l.replace(/^[\s*_]+/, '').startsWith(h)))
  return lineas.slice(k, fin < 0 ? undefined : fin).join('\n').trim()
}

const TERMINADA = new Set(['HECHO', 'OMITIDA'])

/**
 * Dónde sigue el flujo, de lo guardado en su carpeta: `{ sigue, pendientes }`. `sigue` es la línea `SIGUE: paso <n> · …` y
 * `pendientes` las líneas con lo que falta (subtareas sin terminar con su foto, la última revisión con sus PROBLEMAS y CRITERIOS
 * literales, la BASE de su tanda). Sin aprobación sigue en el paso 4; con alguna subtarea sin terminar, en el lote que la tiene;
 * con todas, en la revisión final; con la última APROBADO o los ciclos agotados, en el cierre. `correcciones` (de
 * `ejecutoresDelProyecto`) dice si volvieron los ejecutores de una tanda.
 */
export function siguienteDe(e, correcciones = []) {
  const subtareas = Array.isArray(e.subtareas) ? e.subtareas : []
  const avance = avanceDe(e)
  const bases = basesDe(e)
  const pendientes = []
  if (!e.plan) return { sigue: 'SIGUE: paso 1 · el flujo no guardó el plan: empieza de cero (preflight con --forzar)', pendientes }
  if (!e.aprobacion) return { sigue: 'SIGUE: paso 4 · aprobación del plan (no se aprobó todavía)', pendientes }
  const lotes = lotesDe(subtareas)
  const k = lotes.findIndex((l) => l.some((n) => !TERMINADA.has(avance[String(n)]?.estado)))
  if (k >= 0) {
    for (const n of lotes[k]) {
      const a = avance[String(n)]
      if (a && TERMINADA.has(a.estado)) continue
      const f = bases[String(n)]
      const foto = f ? ` · FOTO BASE=${f.base} DESDE=${f.desde}` : ''
      if (a) pendientes.push(`S${n} · ${a.estado} (${a.ciclos ?? 0} correcciones)${foto}`)
      else if (f) pendientes.push(`S${n} · a medias (foto sin --cambios): se despacha de nuevo desde su foto y ese intento no cuenta como ciclo${foto}`)
      else pendientes.push(`S${n} · sin empezar`)
    }
    return { sigue: `SIGUE: paso 5 · lote ${k + 1}/${lotes.length} (${lotes[k].map((n) => `S${n}`).join('+')})`, pendientes }
  }
  const revisiones = listaDe(e, 'revisiones')
  const ultima = revisiones.at(-1)
  if (!ultima) return { sigue: 'SIGUE: paso 6 · revisión ciclo 1', pendientes }
  const maximo = Number(/(\d+)/.exec(e.decisiones?.ciclos ?? '')?.[1] ?? 2)
  const texto = leerTexto(ultima.archivo) ?? ''
  pendientes.push(`REVISIÓN ${ultima.c}: ${ultima.veredicto ?? 'sin VEREDICTO'} → ${ultima.archivo}`)
  if (ultima.veredicto === 'APROBADO') return { sigue: 'SIGUE: paso 7 · cierre (revisión final APROBADO)', pendientes }
  const owner = seccionDe(texto, 'SALIDA DEL OWNER:', [])
  if (owner) pendientes.push(owner)
  if (ultima.veredicto !== 'RECHAZADO') return { sigue: `SIGUE: paso 6 · revisión ciclo ${ultima.c} (volvió sin VEREDICTO: relánzala)`, pendientes }
  const problemas = seccionDe(texto, 'PROBLEMAS:', ['SIN EJECUTAR:', 'OBSERVACIONES:'])
  const criterios = seccionDe(texto, 'CRITERIOS:', ['PROBLEMAS:', 'SIN EJECUTAR:', 'OBSERVACIONES:'])
  pendientes.push('PROBLEMAS ABIERTOS (literales):', problemas || '(no encontré PROBLEMAS en el reporte)', 'CRITERIOS (literales):', criterios || '(no encontré CRITERIOS en el reporte)')
  if (ultima.c >= maximo) return { sigue: `SIGUE: paso 7 · cierre DETENIDO:6 (${maximo} ciclo(s) de la revisión final agotados)`, pendientes }
  const tanda = listaDe(e, 'tandas').find((t) => Date.parse(t.t) > Date.parse(ultima.t))
  if (!tanda) return { sigue: `SIGUE: paso 6 · correcciones del ciclo ${ultima.c} (los PROBLEMAS de abajo)`, pendientes }
  pendientes.push(`TANDA DEL CICLO ${ultima.c}: BASE=${tanda.base} (va como BASE DE LA CORRECCIÓN, también si repites la tanda)`)
  const vueltas = correcciones.filter((c) => Date.parse(c.inicio) >= Date.parse(tanda.t))
  if (vueltas.length < (tanda.n ?? 1) || vueltas.some((c) => !c.estado)) {
    return { sigue: `SIGUE: paso 6 · correcciones del ciclo ${ultima.c} (tanda a medias: ${vueltas.filter((c) => c.estado).length}/${tanda.n ?? 1} volvieron)`, pendientes }
  }
  return { sigue: `SIGUE: paso 6 · revisión ciclo ${ultima.c + 1} (correcciones hechas: --cambios --global, verificar.mjs y la revisión con REVISIÓN ANTERIOR)`, pendientes }
}

/** Lo que lleva el flujo en curso, para retomar el hilo (por ejemplo, después de una compactación o de un corte). */
function mostrarEstado() {
  const e = leerEstado()
  if (!e.base_global) {
    console.log('ESTADO: no hay un flujo en curso en este proyecto')
    return
  }
  const avance = avanceDe(e)
  console.log(`FLUJO: ${FLUJO}${e.cierre ? ` · cerrado ${e.cierre}` : ''}`)
  console.log(`BASE_GLOBAL=${e.base_global} DESDE_GLOBAL=${e.desde_global} · rama ${e.rama ?? '?'}`)
  if (e.exploracion) console.log(`EXPLORACIÓN: ${e.exploracion}`)
  if (e.plan) console.log(`PLAN: ${e.plan}${e.aprobacion?.t ? ` · aprobado ${e.aprobacion.t}` : ''}`)
  if (e.aprobacion) console.log(`AJUSTES AL PLAN: ${e.aprobacion.ajustes || 'ninguno'}`)
  if (Array.isArray(e.ampliados) && e.ampliados.length) console.log(`PERMITIDOS AMPLIADOS: ${e.ampliados.join(', ')}`)
  for (const s of Array.isArray(e.subtareas) ? e.subtareas : []) {
    const a = avance[String(s.n)]
    console.log(`  S${s.n} · ${s.objetivo} · permitidos: ${(s.permitidos ?? []).join(', ')}${a ? ` · ${a.estado} (${a.ciclos ?? 0} correcciones)` : ''} → ${path.join(FLUJO, `S${s.n}.md`)}`)
  }
  for (const [id, p] of Object.entries(e.permisos && typeof e.permisos === 'object' ? e.permisos : {})) {
    console.log(`  PERMISO ${id} · ${p.rol}${p.sub ? ` S${p.sub}` : ''} · ${p.comando} (reversible: ${p.reversible ? 'sí' : 'no'})${p.aprobado ? ` · aprobado ${p.aprobado}` : ' · sin aprobar'}`)
  }
  if (Array.isArray(e.en_curso) && e.en_curso.length) console.log(`EN CURSO: ${e.en_curso.map((n) => `S${n}`).join('+')}`)
  const d = e.decisiones
  if (d && typeof d === 'object' && [d.ciclos, d.critico, d.aspectos].every((l) => typeof l === 'string')) {
    console.log('DECISIONES (con los AVISOS resueltos a lo más estricto):')
    for (const l of lineasDeDecisiones(d)) console.log(l)
  }
  const fotos = Array.isArray(e.fotos) ? e.fotos : []
  fotos.forEach((f, i) => console.log(`FOTO ${i + 1} (--base): BASE=${f.base} DESDE=${f.desde}`))
  const bases = basesDe(e)
  for (const n of Object.keys(bases).sort((a, b) => Number(a) - Number(b))) {
    console.log(`FOTO S${n} (--base --sub): BASE=${bases[n].base} DESDE=${bases[n].desde}`)
  }
  const inicial = esperarInicial()
  if (inicial) console.log(inicial)
  const verde = ultimaVerde(RAIZ)
  if (verde) console.log(`ÚLTIMO VERDE: árbol ${corto(verde.arbol)} · ${verde.t}`)
  if (e.cierre) return
  const correcciones = listaDe(e, 'tandas').length ? ejecutoresDelProyecto(RAIZ, e.desde_global).filter((x) => x.n === 'final') : []
  const { sigue, pendientes } = siguienteDe(e, correcciones)
  console.log(sigue)
  if (pendientes.length) console.log(`PENDIENTES:\n${pendientes.map((l) => l.split('\n').map((x) => `  ${x}`).join('\n')).join('\n')}`)
}

/**
 * `--reanudar`: sigue en esta sesión un flujo cortado (por el límite de uso, al cerrar la sesión o al cambiar de cuenta) sin vaciar
 * su carpeta. Anota la sesión nueva en `sesiones` (el cierre suma todas), cierra las fases en paralelo que quedaron abiertas y
 * borra `en_curso`, e imprime el PEDIDO literal del flujo, lo de `--estado` (con `SIGUE:` y lo pendiente) y, sin aprobación, el
 * `PARA APROBAR` del plan guardado. Falla sin flujo, con el flujo cerrado o sin plan guardado (ahí se empieza de cero).
 */
function reanudar() {
  const e = leerEstado()
  if (!e.base_global) throw new Error('no hay un flujo en este proyecto para reanudar: corre el preflight')
  if (e.cierre) throw new Error(`el flujo ya cerró (${e.cierre}): no hay nada que reanudar`)
  if (!e.plan || !fs.existsSync(e.plan)) throw new Error('el flujo se cortó antes de guardar el plan: empieza de cero (preflight con --forzar)')
  cerrarParalelos()
  const sesiones = sesionesDe(e)
  const ahora = new Date().toISOString()
  const actual = sesionActual(ahora)
  // Dos ids ausentes nunca cuentan como la misma sesión.
  const misma = Boolean(actual.id) && sesiones[sesiones.length - 1]?.id === actual.id
  anotarEstado({ en_curso: undefined, ...(misma ? {} : { sesiones: [...(sesiones.length ? sesiones : [{ desde: e.desde_global }]), actual] }) })
  const archivoPedido = path.join(FLUJO, 'pedido.md')
  let pedido = leerTexto(archivoPedido)
  if (pedido === null) {
    try {
      pedido = pedidoDelFlujo(RAIZ, e.inicio ?? e.desde_global, { base: e.base_global })
      if (pedido) fs.writeFileSync(archivoPedido, pedido + '\n')
    } catch {
      pedido = null
    }
  }
  console.log(misma ? `REANUDADO: misma sesión del flujo · ${ahora}` : `REANUDADO: sesión ${sesiones.length + (sesiones.length ? 1 : 2)} del flujo · ${ahora}`)
  console.log(pedido ? `PEDIDO (literal, del /impl original):\n${pedido.trim()}\nFIN PEDIDO` : 'PEDIDO: no lo encontré en los transcripts; tómalo del plan (Objetivo)')
  mostrarEstado()
  if (!e.aprobacion) {
    const partes = partesDelPlan(leerTexto(e.plan) ?? '')
    if (partes.subtareas.length) console.log(`PARA APROBAR (cópialo tal cual en tu texto; el plan completo está en ${e.plan}):\n${aprobacionDe(partes)}\nFIN PARA APROBAR`)
  }
}

/** `--aprobado [--ajustes "<texto>"]`: anota que el usuario aprobó el plan guardado, con los AJUSTES AL PLAN (los que el orquestador mostró). */
function aprobar(ajustes) {
  const e = leerEstado()
  if (!e.base_global || e.cierre) throw new Error('el flujo no está abierto: no hay dónde anotar la aprobación (corre el preflight)')
  if (!e.plan) throw new Error('no hay plan guardado que aprobar (--guardar <agentId> plan)')
  const texto = String(ajustes ?? '').trim()
  anotarEstado({ aprobacion: { t: new Date().toISOString(), ajustes: texto } })
  console.log(`APROBADO: plan de ${(Array.isArray(e.subtareas) ? e.subtareas : []).length} subtarea(s) · ajustes: ${texto ? 'anotados' : 'ninguno'}`)
}

/**
 * Anota en `avance` el estado de las subtareas `miembros` tras su `--cambios --sub`: el `ESTADO:` del último ejecutor de cada una
 * (de los transcripts del proyecto desde `desde`) y cuántas correcciones tuvo; `omitida` las marca OMITIDA («seguir sin ella»).
 * Una subtarea sin ejecutor encontrado queda como `MEDIDA`. Nunca rompe el `--cambios`.
 */
function anotarAvance(miembros, desde, omitida) {
  try {
    const ejecutores = omitida ? [] : ejecutoresDelProyecto(RAIZ, desde)
    const avance = avanceDe(leerEstado())
    const t = new Date().toISOString()
    for (const n of miembros) {
      const suyos = ejecutores.filter((x) => x.n === String(n))
      const estado = omitida ? 'OMITIDA' : suyos.at(-1)?.estado ?? 'MEDIDA'
      avance[String(n)] = { estado, ciclos: suyos.filter((x) => x.correccion).length, t }
    }
    anotarEstado({ avance })
    console.log(`AVANCE: ${miembros.map((n) => `S${n} ${avance[String(n)].estado}`).join(' · ')}`)
  } catch {
    // Sin avance, el flujo sigue: --reanudar lo verá como «a medias».
  }
}

// ── Modos ───────────────────────────────────────────────────────────────────

/** `hooks/hooks.json` del plugin. */
const HOOKS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'hooks', 'hooks.json')

/** Por qué `hooks/hooks.json` no deja la guardia puesta para las herramientas que vigila (Bash, Edit, Read…); null si está bien. */
function hooksSinGuardia() {
  let entradas
  try {
    entradas = JSON.parse(fs.readFileSync(HOOKS, 'utf8'))?.hooks?.PreToolUse
  } catch (e) {
    return `no se pudo leer hooks/hooks.json: ${e.message}`
  }
  const guardias = (Array.isArray(entradas) ? entradas : []).filter((h) => (h?.hooks ?? []).some((x) => x?.type === 'command' && /guardia\.mjs/.test(String(x.command))))
  for (const herramienta of ['Bash', 'PowerShell', 'Edit', 'Write', 'NotebookEdit', 'Read', 'Glob', 'Grep']) {
    if (!guardias.some((h) => new RegExp('^(?:' + (h.matcher ?? '.*') + ')$').test(herramienta))) return `hooks/hooks.json no declara la guardia para ${herramienta}`
  }
  return null
}

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
    for (const rol of ['explorador', 'planificador', 'ejecutor', 'revisor']) {
      if (rolDeAgente(`impl:qcc-${rol}`) !== rol) return `FALLA (la guardia no reconoce al agente impl:qcc-${rol})`
    }
    // Los agentes de un plugin ignoran `hooks:`: sin `hooks/hooks.json` declarando la guardia, correrían sin ella.
    const sinGuardia = hooksSinGuardia()
    if (sinGuardia) return `FALLA (${sinGuardia})`
    // Una copia vieja en ~/.claude/agents duplica a los agentes del plugin y llama a una guardia que ya no está.
    for (const agente of ['explorador', 'planificador', 'ejecutor', 'revisor']) {
      if (fs.existsSync(path.join(AGENTES, `qcc-${agente}.md`))) avisos.push(`~/.claude/agents/qcc-${agente}.md es una copia vieja del agente: instalar.mjs --limpiar la archiva`)
    }
    if (configDe(RAIZ).invalido) avisos.push(`${configDe(RAIZ).nombre} no es JSON válido: rigen los valores por defecto`)
    return avisos.length ? `OK con avisos: ${avisos.join(' · ')}` : 'OK'
  } catch (e) {
    return `FALLA (${e.message})`
  }
}

const BYTES_POR_TOKEN = 3.5
const TOPE_IMPORTS = 5
const UMBRAL_CONTEXTO = 10_000
// Agentes típicos de un flujo que escriben el contexto del proyecto en caché: [modelo, escritura, cuántos].
// Explorador (Haiku), planificador y revisión final (Opus) y 3 ejecutores (Sonnet), todos con caché de 5 min;
// el orquestador (Sonnet) la escribe con 1 h.
const AGENTES_TIPICOS = [
  ['claude-haiku-5-5', 'escritura5m', 1],
  ['claude-opus-5-5', 'escritura5m', 2],
  ['claude-sonnet-5-5', 'escritura5m', 3],
  ['claude-sonnet-5-5', 'escritura1h', 1],
]

/** Rutas `@ruta` que importa un CLAUDE.md, fuera de bloques ``` y de `código`. */
function importsDe(texto) {
  const limpio = texto.replace(/^(```|~~~)[\s\S]*?^\1[^\n]*$/gm, '').replace(/`[^`\n]*`/g, '')
  return [...limpio.matchAll(/(?:^|\s)@(\S+)/g)].map((m) => m[1].replace(/[.,;:)\]]+$/, '')).filter(Boolean)
}

/**
 * Lo que Claude Code carga como instrucciones del proyecto en cada agente: CLAUDE.md, .claude/CLAUDE.md y CLAUDE.local.md de
 * la raíz, más los `@ruta` que importen (relativos al archivo que importa, `~/` es la carpeta del usuario; hasta 5 niveles,
 * sin repetir, saltando los que no existen). AGENTS.md cuenta si no hay ningún CLAUDE.md (supuesto tomado de lo observado:
 * Claude Code lo cargó como instrucciones del proyecto; no está confirmado que lo cargue junto a un CLAUDE.md) o si
 * algún archivo cargado lo importa. Tokens ≈ bytes / 3,5. `{ tokens, archivos }`, con `archivos` relativos a la raíz.
 */
export function contextoDelProyecto(raiz) {
  const raices = ['CLAUDE.md', path.join('.claude', 'CLAUDE.md'), 'CLAUDE.local.md'].map((r) => path.join(raiz, r))
  const hayClaude = raices.slice(0, 2).some((r) => fs.existsSync(r))
  if (!hayClaude) raices.push(path.join(raiz, 'AGENTS.md'))
  const vistos = new Set()
  const archivos = []
  let bytes = 0
  const cargar = (archivo, nivel) => {
    const clave = path.resolve(archivo)
    if (vistos.has(clave)) return
    vistos.add(clave)
    let buffer
    try {
      if (!fs.statSync(clave).isFile()) return
      buffer = fs.readFileSync(clave)
    } catch {
      return
    }
    bytes += buffer.length
    const rel = path.relative(raiz, clave)
    archivos.push(rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel.replace(/\\/g, '/') : clave.replace(/\\/g, '/'))
    if (nivel >= TOPE_IMPORTS) return
    for (const ruta of importsDe(buffer.toString('utf8'))) {
      const destino = ruta.startsWith('~/') ? path.join(os.homedir(), ruta.slice(2)) : path.resolve(path.dirname(clave), ruta)
      cargar(destino, nivel + 1)
    }
  }
  for (const r of raices) cargar(r, 0)
  return { tokens: Math.round(bytes / BYTES_POR_TOKEN), archivos }
}

/** Líneas del preflight sobre el contexto del proyecto: siempre `CONTEXTO DEL PROYECTO`, y un `AVISO` si pasa de 10.000 tokens. */
function lineasDelProyecto(raiz) {
  const { tokens, archivos } = contextoDelProyecto(raiz)
  const lineas = [`CONTEXTO DEL PROYECTO: ~${tokens} tokens por agente (${archivos.length ? archivos.join(', ') : 'ningún CLAUDE.md ni AGENTS.md'})`]
  if (tokens > UMBRAL_CONTEXTO) {
    const porMillon = AGENTES_TIPICOS.reduce((s, [modelo, escritura, n]) => s + n * (precioDe(modelo)?.[escritura] ?? 0), 0)
    const usd = ((tokens * porMillon) / 1e6).toFixed(2).replace('.', ',')
    lineas.push(`AVISO: contexto del proyecto pesado: ~$${usd} por flujo solo en escribirlo en caché; acórtalo o mueve lo largo a archivos que se lean a demanda`)
  }
  return lineas
}

/** Reglas del proyecto, en este orden y solo la primera que exista: la carpeta o el `.md` con el nombre nuevo y luego los viejos. */
const REGLAS_CANDIDATAS = [
  { ruta: '.claude/qcc-implementador/', carpeta: true },
  { ruta: '.claude/qcc-implementador.md', carpeta: false },
  { ruta: '.claude/implementador/', carpeta: true },
  { ruta: '.claude/implementador.md', carpeta: false },
]

/** `{ ruta, carpeta }` de las reglas que rigen en `raiz`, o `null` si no hay ninguna. */
export function reglasDe(raiz) {
  return REGLAS_CANDIDATAS.find((c) => fs.existsSync(path.join(raiz, c.ruta.replace(/\/$/, '')))) ?? null
}

function preflight(forzar) {
  const desde = new Date().toISOString()
  const rama = git(['rev-parse', '--abbrev-ref', 'HEAD'], { opcional: true })?.trim() ?? '?'
  const head = git(['log', '-1', '--format=%h %s'], { opcional: true })?.trim() || '(sin commits)'
  const sucios = git(['status', '--porcelain=v1', '--untracked-files=all']).split('\n').filter(Boolean)
  const base = foto()
  const config = configDe(RAIZ)
  const reglas = reglasDe(RAIZ)
  const { pasos, origen } = pasosDe(RAIZ)
  let flujo = FLUJO
  let mapa = 'MAPA: ninguno (la carpeta del flujo no se preparó)'
  let preparada = false
  const abierto = forzar ? null : flujoAbierto()
  if (abierto) {
    const hora = new Date(abierto.inicio).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })
    const plan = abierto.titulo ? `«${abierto.titulo}», ` : abierto.plan ? 'con plan, ' : 'sin plan todavía, '
    if (abierto.cortado) console.log(`AVISO: hay un flujo cortado en este repo (${plan}empezó a las ${hora}, sin actividad hace ${Math.round(abierto.minutos / 60)} h). No vacié su carpeta.`)
    else console.log(`AVISO: hay otro flujo abierto en este repo (${plan}empezó a las ${hora}, BASE_GLOBAL ${corto(abierto.base_global)}, sin cierre, con actividad hace ${Math.round(abierto.minutos)} min). Si sigue corriendo en otra sesión (o esperando su aprobación), los dos se pisan los archivos y la carpeta del flujo, que no vacié. Si ya no corre, repite el preflight con --forzar.`)
    if (abierto.plan) {
      const hechas = Object.values(avanceDe(abierto)).filter((a) => TERMINADA.has(a.estado)).length
      console.log(`REANUDAR: estado.mjs --reanudar --paso 0 sigue ese flujo sin vaciar su carpeta (plan guardado${abierto.aprobacion ? ' y aprobado' : ', sin aprobar'}, ${hechas}/${(abierto.subtareas ?? []).length} subtareas terminadas)`)
    }
    flujo = '(ocupada por el flujo anterior: repite el preflight con --forzar si ya no corre)'
    mapa = 'MAPA: ninguno (la carpeta del flujo está ocupada por el flujo anterior)'
  } else {
    try {
      // Un flujo con plan y sin cierre no se pierde: con --forzar se archiva (sin fila en flujos.jsonl) antes de vaciarlo.
      const previo = forzar ? leerEstado() : {}
      if (previo.base_global && previo.plan && !previo.cierre) archivarFlujo(new Date().toISOString())
      nuevoFlujo({ inicio: desde, raiz: RAIZ, rama, base_global: base, desde_global: desde, fotos: [], sesiones: [sesionActual(desde)] })
      const escrito = escribirMapa()
      mapa = escrito.linea
      preparada = true
    } catch (e) {
      flujo = `(no se pudo preparar: ${e.message}; despacha copiando el plan)`
    }
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
  console.log(mapa)
  console.log(lineaExploradores())
  console.log(`REGLAS DEL PROYECTO: ${reglas?.ruta ?? 'ninguna (no hay .claude/qcc-implementador/ ni .claude/qcc-implementador.md; rigen CLAUDE.md y las reglas comunes)'}`)
  for (const linea of lineasDelProyecto(RAIZ)) console.log(linea)
  console.log(`CONFIG: ${config.archivo ? config.nombre : 'no hay; guardia con valores por defecto'}${config.pm ? ` · gestor JS: ${config.pm}` : ''}`)
  console.log(`VERIFICACIÓN (${origen}): ${pasos.length ? pasos.map((p) => p.cmd).join(' → ') : 'SIN PASOS'}`)
  if (preparada) console.log(`VERIFICACIÓN INICIAL: ${lanzarInicial(pasos.length > 0)}`)
  console.log(`GUARDIA: ${autoprueba()}`)
}

const SIN_REGLAS = '(Este proyecto no tiene .claude/qcc-implementador/ ni .claude/qcc-implementador.md: rigen las reglas comunes, el CLAUDE.md del proyecto y lo que leas del repo.)'

/**
 * Las reglas del proyecto que lee el orquestador, encabezadas por la línea `REGLAS DEL PROYECTO` que llevan los despachos:
 * los archivos que haya de la primera que exista entre `.claude/qcc-implementador/`, `.claude/qcc-implementador.md`,
 * `.claude/implementador/` y `.claude/implementador.md`.
 */
function imprimirReglas() {
  const reglas = reglasDe(RAIZ)
  if (reglas?.carpeta) {
    const carpeta = path.join(RAIZ, reglas.ruta)
    const partes = ['clasificacion.md', 'buscar.md', 'planificar.md'].map((a) => leerTexto(path.join(carpeta, a))?.trimEnd()).filter((t) => t !== undefined)
    console.log(`REGLAS DEL PROYECTO: ${reglas.ruta}\n`)
    console.log(partes.length ? partes.join('\n\n') : '(no tiene clasificacion.md, buscar.md ni planificar.md: rigen las reglas comunes y el CLAUDE.md del proyecto.)')
    return
  }
  const unico = reglas ? leerTexto(path.join(RAIZ, reglas.ruta))?.trimEnd() : undefined
  console.log(`REGLAS DEL PROYECTO: ${unico === undefined ? 'ninguna' : reglas.ruta}\n`)
  console.log(unico ?? SIN_REGLAS)
}

const GUIAS = ['comun', 'pasos']

/**
 * Imprime `comun.md` o `pasos.md` (junto a este archivo) con `${CLAUDE_PLUGIN_ROOT}` cambiado por la carpeta del plugin, con `/`.
 * Claude Code solo resuelve esa variable en el texto de la skill, no en lo que ella inyecta con un comando, y el Bash del
 * modelo no la tiene: así las rutas de estos archivos llegan completas.
 */
export function imprimirGuia(nombre, parte) {
  const herramientas = path.dirname(fileURLToPath(import.meta.url))
  const leido = GUIAS.includes(nombre) ? leerTexto(path.join(herramientas, `${nombre}.md`)) : null
  if (leido === null) {
    console.log(`ERROR: --guia pide ${GUIAS.join(' o ')} y que el archivo exista`)
    process.exitCode = 2
    return
  }
  let texto = leido
  if (parte !== undefined) {
    // Claude Code guarda aparte lo inyectado de más de 30.000 caracteres: comun.md entra en dos partes, cortada en «## 5.».
    const corte = leido.search(/^## 5\./m)
    if (nombre !== 'comun' || !['1', '2'].includes(parte) || corte < 0) {
      console.log('ERROR: --parte vale solo con --guia comun y es 1 o 2')
      process.exitCode = 2
      return
    }
    texto = parte === '1' ? leido.slice(0, corte) : leido.slice(corte)
  }
  process.stdout.write(texto.replaceAll('${CLAUDE_PLUGIN_ROOT}', () => path.dirname(herramientas).replaceAll('\\', '/')))
}

/** Agrupa rutas por carpeta, subiendo de nivel hasta que no pasen de `tope` grupos: `[{ carpeta, rutas }]`. */
export function agruparPorCarpeta(rutas, tope = TOPE_GRUPOS) {
  const profundidad = Math.max(1, ...rutas.map((r) => r.split('/').length - 1))
  for (let n = profundidad; ; n--) {
    const grupos = new Map()
    for (const r of rutas) {
      const carpetas = r.split('/').slice(0, -1)
      const carpeta = carpetas.length ? `${carpetas.slice(0, n).join('/')}/` : './'
      if (grupos.has(carpeta)) grupos.get(carpeta).push(r)
      else grupos.set(carpeta, [r])
    }
    if (grupos.size <= tope || n <= 1) return [...grupos].map(([carpeta, lista]) => ({ carpeta, rutas: lista }))
  }
}

/** Extensión de una ruta (`.ts`); `(sin ext)` si el nombre no tiene. */
const extensionDe = (ruta) => {
  const nombre = ruta.slice(ruta.lastIndexOf('/') + 1)
  const i = nombre.lastIndexOf('.')
  return i > 0 ? nombre.slice(i) : '(sin ext)'
}

/**
 * Las líneas del mapa del repo para el explorador: una por carpeta (con los nombres si los archivos están en ella,
 * resumida por extensión si hay subcarpetas). Con `lineasPorRuta` (`{ ruta: n }`) suma líneas por carpeta y lista los
 * `.md` de más de 300 líneas; una ruta ausente cuenta 0. Nunca más de `tope + 3` líneas.
 */
export function mapaDelRepo(rutas, tope = TOPE_MAPA, lineasPorRuta = null) {
  const grupos = agruparPorCarpeta(rutas, tope)
  const miles = (n) => String(n).replace(/\B(?=(\d{3})+$)/g, '.')
  const suma = (lista) => lista.reduce((s, r) => s + (lineasPorRuta[r] ?? 0), 0)
  const lineas = [
    `MAPA · ${rutas.length} archivos${lineasPorRuta ? ` · ${miles(suma(rutas))} líneas` : ''} (git ls-files: versionados y nuevos, sin ignorados) · ${grupos.length} carpeta(s)`,
    'Las carpetas resumidas se exploran con Glob; lo ignorado por git no aparece.',
  ]
  if (lineasPorRuta) {
    const docs = rutas.filter((r) => r.endsWith('.md') && (lineasPorRuta[r] ?? 0) > 300)
      .sort((a, b) => lineasPorRuta[b] - lineasPorRuta[a]).slice(0, 20)
    if (docs.length) lineas.push(`Documentos de más de 300 líneas: ${docs.map((r) => `${r} (${miles(lineasPorRuta[r])})`).join(', ')}`)
  }
  const mostrados = grupos.length > tope ? grupos.slice(0, Math.max(0, tope - 1)) : grupos
  for (const { carpeta, rutas: lista } of mostrados) {
    const prefijo = carpeta === './' ? '' : carpeta
    const nombres = lista.map((r) => r.slice(prefijo.length))
    if (nombres.every((n) => !n.includes('/'))) {
      const resto = nombres.length - TOPE_NOMBRES
      const cuenta = lineasPorRuta ? `${lista.length} archivos · ${miles(suma(lista))} líneas: ` : ''
      lineas.push(`${carpeta} — ${cuenta}${nombres.slice(0, TOPE_NOMBRES).join(', ')}${resto > 0 ? `, … y ${resto} más` : ''}`)
      continue
    }
    const subcarpetas = new Set(lista.map((r) => r.slice(0, r.lastIndexOf('/') + 1)).filter((c) => c !== prefijo))
    const extensiones = new Map()
    for (const r of lista) extensiones.set(extensionDe(r), (extensiones.get(extensionDe(r)) ?? 0) + 1)
    const top = [...extensiones].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 5)
    const conLineas = lineasPorRuta ? ` · ${miles(suma(lista))} líneas` : ''
    lineas.push(`${carpeta} — ${lista.length} archivos en ${subcarpetas.size} subcarpetas${conLineas} (${top.map(([e, c]) => `${e} ${c}`).join(', ')})`)
  }
  if (mostrados.length < grupos.length) {
    const sobran = grupos.slice(mostrados.length)
    const cuentaSobran = sobran.flatMap((g) => g.rutas)
    lineas.push(`… y ${sobran.length} carpetas más (${cuentaSobran.length} archivos${lineasPorRuta ? ` · ${miles(suma(cuentaSobran))} líneas` : ''})`)
  }
  return lineas
}

/** Líneas por archivo (`{ ruta: n }`) según `git grep -c`, o null si git falla. Vacíos y binarios no salen: cuentan 0. */
function lineasPorArchivo() {
  try {
    const porRuta = {}
    for (const fila of git(['grep', '-z', '-c', '-I', '--untracked', '']).split('\n')) {
      const i = fila.lastIndexOf('\0')
      if (i > 0) porRuta[fila.slice(0, i)] = Number(fila.slice(i + 1))
    }
    return porRuta
  } catch {
    return null
  }
}

/** Escribe `<FLUJO>/mapa.md` con los archivos del repo (versionados y nuevos, sin ignorados) y devuelve la línea `MAPA:` del preflight y el total de archivos (null si no hay mapa). */
function escribirMapa() {
  try {
    const rutas = [...new Set(git(['ls-files', '-z', '--cached', '--others', '--exclude-standard']).split('\0').filter(Boolean))].sort()
    const archivo = path.join(FLUJO, 'mapa.md')
    fs.writeFileSync(archivo, mapaDelRepo(rutas, TOPE_MAPA, lineasPorArchivo()).join('\n') + '\n')
    return { linea: `MAPA: ${archivo} (${rutas.length} archivos)`, total: rutas.length }
  } catch (e) {
    return { linea: `MAPA: ninguno (${String(e.message).split('\n')[0]})`, total: null }
  }
}

/** Línea `EXPLORADORES:` del preflight: el máximo fijo; cuántos despacha el orquestador depende del pedido. */
function lineaExploradores() {
  return `EXPLORADORES: hasta ${MAX_EXPLORADORES} (según el pedido)`
}

/** Comillas simples de bash para una ruta. */
const comillas = (r) => `'${String(r).replace(/'/g, `'\\''`)}'`

/**
 * Los comandos que dejan los archivos del flujo como en la foto `base`: restaurar los modificados y borrados,
 * borrar los nuevos y avisar lo que git no ve. Con pocos archivos van en la línea; con muchos, en `reversion.sh`.
 */
function reversion(base, restaurar, borrar, aMano) {
  if (!restaurar.length && !borrar.length && !aMano.length) {
    console.log('REVERSIÓN: nada que deshacer')
    return
  }
  const comandos = []
  if (restaurar.length) comandos.push(`git restore --source=${base} --worktree -- ${restaurar.map(comillas).join(' ')}`)
  if (borrar.length) comandos.push(`rm -- ${borrar.map(comillas).join(' ')}`)
  if (restaurar.length + borrar.length <= TOPE_REVERSION && !aMano.length) {
    console.log(`REVERSIÓN: ${comandos.join(' && ')}`)
    return
  }
  const archivo = path.join(FLUJO, 'reversion.sh')
  try {
    fs.mkdirSync(FLUJO, { recursive: true })
    const notas = aMano.map((r) => `# a mano, git no la ve: ${r}`)
    fs.writeFileSync(archivo, ['#!/usr/bin/env bash', `# Deja los archivos del flujo como en la foto ${corto(base)}. Revísalo antes de correrlo.`, ...comandos, ...notas, ''].join('\n'))
    console.log(`REVERSIÓN: ${restaurar.length} a restaurar · ${borrar.length} a borrar${aMano.length ? ` · ${aMano.length} a mano` : ''} → bash ${archivo.replace(/\\/g, '/')}`)
  } catch (e) {
    console.log(`REVERSIÓN: no se pudo escribir ${archivo} (${e.message})`)
  }
}

/**
 * Lo que dejó `verificar.mjs` y sigue igual en `ahora`: `Map` de ruta (en minúsculas en Windows) a `{ paso, generado }`.
 * Cuenta una salida de la misma ruta y el mismo blob, anotada desde `desde` (si hay). Un cambio a mano posterior
 * tiene otro blob y no entra. Tampoco entra una salida cuya ventana `[inicio ?? t, t]` se cruza con la de una fase en paralelo
 * (`paralelos`, abierta hasta `hasta` o hasta ahora): otro agente pudo editar el archivo mientras corría verificar, así que
 * cae en el camino normal y sale FUERA. Si no se puede comparar, queda vacío (todo lo de fuera sigue siendo FUERA).
 */
function salidasVigentes(base, ahora, desde, clave, paralelos = []) {
  const vigentes = new Map()
  try {
    const inicio = desde ? Date.parse(desde) : Number.NaN
    const fases = paralelos.map((p) => [Date.parse(p.desde), p.hasta === undefined ? Date.now() : Date.parse(p.hasta)])
    const cruzaFase = (s) => {
      const fin = Date.parse(s.t)
      const comienzo = Number.isFinite(Date.parse(s.inicio)) ? Date.parse(s.inicio) : fin
      return fases.some(([d, h]) => comienzo <= h && fin >= d)
    }
    const salidas = salidasDe(RAIZ).filter((s) => !(inicio > Date.parse(s.t)) && !cruzaFase(s))
    if (!salidas.length) return vigentes
    const blobs = new Map(cambiosDe(RAIZ, base, ahora).map((c) => [clave(c.ruta), c.blob]))
    for (const s of salidas) {
      if (blobs.get(clave(s.ruta)) === s.blob) vigentes.set(clave(s.ruta), { paso: String(s.paso ?? 'verificar'), generado: s.generado === true })
    }
  } catch {
    // Sin la comparación, nada se perdona: todo lo de fuera sale FUERA.
  }
  return vigentes
}

/** Las líneas de la salida de verificar fuera de los permitidos: una por archivo, o por carpeta si pasan de `TOPE_CAMBIOS`. */
function lineasDeSalidas(salidas) {
  const nota = (lista) => {
    const pasos = [...new Set(lista.flatMap((s) => s.paso.split(', ')))].join(', ')
    return `(salida de verificar: ${pasos}${lista.every((s) => s.generado) ? '' : ', no generado'})`
  }
  if (salidas.length <= TOPE_CAMBIOS) return salidas.map((s) => `  ~ ${s.estado} ${s.ruta}   ← ${nota([s])}`)
  const porRuta = new Map(salidas.map((s) => [s.ruta, s]))
  return agruparPorCarpeta(salidas.map((s) => s.ruta)).map((g) => `  ~ ${g.carpeta} — ${g.rutas.length} archivo(s)   ← ${nota(g.rutas.map((r) => porRuta.get(r)))}`)
}

/**
 * Qué cambió desde `base` y qué cae fuera de `permitidos`. Con permitidos, nada fuera y sin cerrar, va en una línea
 * `CAMBIOS` agrupada por carpeta (más lo que solo está en el registro, uno por uno); si no, con muchos archivos
 * dentro del alcance van agrupados por carpeta, y lo de fuera y lo que solo está en el registro, uno por uno. Lo que
 * dejó `verificar.mjs` fuera de los permitidos no es FUERA, salvo que corriera con agentes en paralelo (`paralelos`).
 * En el cierre (`paso` 7) agrega `REVERSIÓN`.
 */
function cambios(base, desde, permitidos, paso, tokens, resultado, paralelos = []) {
  const ahora = foto(permitidos)
  const mapa = new Map()
  const clave = (r) => (WIN ? r.toLowerCase() : r)
  const vigentes = salidasVigentes(base, ahora, desde, clave, paralelos)
  for (const linea of git(['diff', '--name-status', '--no-renames', base, ahora]).split('\n')) {
    const m = /^([A-Z])\d*\t(.+)$/.exec(linea.trim())
    if (m) mapa.set(clave(m[2]), { estado: m[1], ruta: m[2], soloRegistro: false })
  }
  const filas = desde ? leerRegistro(desde) : []
  for (const f of filas) {
    if (f.rol !== 'ejecutor' || f.decision !== 'permitido' || !EDICIONES.has(f.herramienta) || !f.objetivo) continue
    // Ruta absoluta = fuera del repo: un temporal del ejecutor (scripts de medición), que no es del alcance.
    if (path.isAbsolute(f.objetivo)) continue
    if (!mapa.has(clave(f.objetivo))) mapa.set(clave(f.objetivo), { estado: '·', ruta: f.objetivo, soloRegistro: true })
  }
  const lista = [...mapa.values()].sort((a, b) => a.ruta.localeCompare(b.ruta))
  const marcaDentro = permitidos.length ? '✓' : ' '
  let fuera = 0
  const lineas = []
  const agrupables = []
  const restaurar = []
  const borrar = []
  const aMano = []
  const deVerificar = []
  for (const c of lista) {
    const dentro = enAlcance(c.ruta, permitidos)
    const salida = !dentro && !c.soloRegistro ? vigentes.get(clave(c.ruta)) : undefined
    if (salida) {
      deVerificar.push({ ...c, ...salida })
      if (c.estado === 'A') borrar.push(c.ruta)
      else restaurar.push(c.ruta)
      continue
    }
    if (!dentro) fuera++
    else if (c.soloRegistro) aMano.push(c.ruta)
    else (c.estado === 'A' ? borrar : restaurar).push(c.ruta)
    const nota = [
      dentro ? '' : 'FUERA DE ALCANCE',
      c.soloRegistro ? 'solo en el registro: ruta ignorada por git o edición sin efecto' : '',
    ]
      .filter(Boolean)
      .join(' · ')
    if (dentro && !nota) agrupables.push(c)
    lineas.push({ texto: `  ${dentro ? marcaDentro : '✗'} ${c.estado} ${c.ruta}${nota ? `   ← ${nota}` : ''}`, suelta: !dentro || Boolean(nota) })
  }
  if (permitidos.length && !fuera && paso !== 7) {
    const partes = agruparPorCarpeta(agrupables.map((c) => c.ruta)).map((g) => `${g.carpeta} ${g.rutas.length}`)
    if (deVerificar.length) partes.push(`salida de verificar ${deVerificar.length}`)
    if (aMano.length) partes.push(`solo en el registro ${aMano.length}`)
    console.log(`CAMBIOS desde ${corto(base)} (${lista.length})${partes.length ? `: ${partes.join(' · ')}` : ''}`)
    for (const l of lineas) if (l.suelta) console.log(l.texto)
  } else {
    console.log(`CAMBIOS desde ${corto(base)} (${lista.length}):`)
    if (agrupables.length <= TOPE_CAMBIOS) for (const l of lineas) console.log(l.texto)
    else {
      const porRuta = new Map(agrupables.map((c) => [c.ruta, c]))
      for (const g of agruparPorCarpeta(agrupables.map((c) => c.ruta))) {
        const cuenta = {}
        for (const r of g.rutas) cuenta[porRuta.get(r).estado] = (cuenta[porRuta.get(r).estado] ?? 0) + 1
        const detalle = Object.entries(cuenta).map(([e, n]) => `${e} ${n}`).join(', ')
        console.log(`  ${marcaDentro} ${g.carpeta} — ${g.rutas.length} archivo(s) (${detalle})`)
      }
      for (const l of lineas) if (l.suelta) console.log(l.texto)
    }
  }
  for (const l of lineasDeSalidas(deVerificar)) console.log(l)
  const negados = filas.filter((f) => f.decision === 'negado')
  if (negados.length) {
    console.log(`GUARDIA: ${negados.length} negación(es) desde ${desde}:`)
    for (const f of negados.slice(-5)) console.log(`  - ${f.rol} ${f.herramienta} «${String(f.objetivo ?? '').slice(0, 100)}» → ${f.motivo}`)
  }
  if (paso === 7) {
    const { base_global: global } = leerEstado()
    if (global && global !== base) console.log(`AVISO: el cierre va con BASE_GLOBAL=${global} y DESDE_GLOBAL; esta foto (${corto(base)}) no cubre todo el flujo`)
    reversion(base, restaurar, borrar, aMano)
    cerrarFlujo(base, desde, tokens, resultado)
  }
  if (!permitidos.length) console.log('ALCANCE: (sin lista de permitidos)')
  else console.log(fuera ? `ALCANCE: FUERA (${fuera})` : 'ALCANCE: OK')
}

const RE_RESULTADO = /^(COMPLETO|DETENIDO:[0-7])$/
const HISTORIAL_MAX = 30
const RE_CARPETA_HISTORIAL = /^\d{8}T\d{6}-/

/** La `version` de `.claude-plugin/plugin.json` del plugin que contiene este archivo; null si no se puede leer. */
function versionInstalada() {
  try {
    const manifiesto = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.claude-plugin', 'plugin.json')
    const version = JSON.parse(fs.readFileSync(manifiesto, 'utf8')).version
    return typeof version === 'string' && version ? version : null
  } catch {
    return null
  }
}

/** `git diff --numstat` entre dos fotos: `{ archivos, mas, menos }` (un binario cuenta como archivo, sin líneas). Con `permitidos`, solo las rutas que caen en ellos. */
function numstat(desdeFoto, hastaFoto, permitidos = []) {
  let archivos = 0
  let mas = 0
  let menos = 0
  for (const linea of git(['-c', 'core.quotepath=off', 'diff', '--numstat', '--no-renames', desdeFoto, hastaFoto]).split('\n')) {
    const m = /^(\d+|-)\t(\d+|-)\t(.*)$/.exec(linea)
    if (!m || !enAlcance(m[3], permitidos)) continue
    archivos++
    mas += Number(m[1]) || 0
    menos += Number(m[2]) || 0
  }
  return { archivos, mas, menos }
}

/**
 * Lo que cambió cada subtarea: la diferencia entre su foto (`--base --sub`) y la de la siguiente; la última, contra el árbol
 * de ahora. Las fotos van en orden de `desde` (a igual `desde`, por n). Las de un lote (`--base --sub 1,2`) comparten foto: su
 * siguiente es la próxima foto en el tiempo fuera del lote y cada miembro cuenta solo lo que cae en sus propios permitidos.
 * `{ "<n>": { archivos, mas, menos } }`; una subtarea cuya diferencia falla queda fuera.
 */
function cambiosPorSubtarea(estado) {
  const bases = basesDe(estado)
  const tiempo = (n) => Date.parse(bases[String(n)].desde)
  const numeros = Object.keys(bases).map(Number).sort((a, b) => (tiempo(a) - tiempo(b)) || a - b)
  const plan = Array.isArray(estado.subtareas) ? estado.subtareas : []
  const porSubtarea = {}
  let ahora = null
  numeros.forEach((n, i) => {
    try {
      const lote = loteDe(bases[String(n)])
      const proximo = numeros.slice(i + 1).find((m) => !lote?.includes(m))
      const siguiente = bases[String(proximo)]?.base ?? (ahora ??= foto())
      const delPlan = plan.find((s) => Number(s?.n) === n)?.permitidos
      const propios = lote && Array.isArray(delPlan) ? delPlan.map(String) : []
      porSubtarea[n] = numstat(bases[String(n)].base, siguiente, propios)
    } catch {
      // Sin esta diferencia, el cierre sigue.
    }
  })
  return porSubtarea
}

/** El objeto sin las claves nulas o sin definir; undefined si no queda ninguna. */
const sinNulos = (obj) => {
  const entradas = Object.entries(obj).filter(([, v]) => v !== null && v !== undefined)
  return entradas.length ? Object.fromEntries(entradas) : undefined
}

/**
 * La fila v2 de `registros/flujos.jsonl`. `datos`: `t` (hora del cierre), `raiz`, `base`, `version`, `resultado`, `tokens`
 * (de `--tokens`), `estado` (el estado del flujo), `metricas` (de `metricasDelFlujo`), `cambios` (de `cambiosPorSubtarea`)
 * `negados` (cuántas negaciones de la guardia hubo) y `cortados` (ids de los agentes que la guardia cortó por contexto;
 * cada explorador sale con `cortado: true|false`). Omite lo que falte; `uso` suma pedidos y tokens de todos los roles.
 * `sesiones` (de las métricas) es cuántas sesiones sumó el flujo: 1 sin corte, más si se reanudó con `--reanudar`.
 */
export function filaDelFlujo({ t, raiz, base, version, resultado, tokens, estado = {}, metricas = null, cambios = {}, negados, cortados = [] } = {}) {
  const m = metricas ?? {}
  const roles = Object.values(m.costo?.roles ?? {})
  const suma = (clave) => roles.reduce((s, r) => s + (r.tokens?.[clave] ?? 0), 0)
  const uso = m.costo ? { pedidos: roles.reduce((s, r) => s + (r.pedidos ?? 0), 0), tokens: { entrada: suma('entrada'), leidos: suma('leidos'), escritos: suma('escritos'), salida: suma('salida'), thinking: suma('thinking') } } : undefined
  const redondeo = (n) => (typeof n === 'number' ? Math.round(n * 10_000) / 10_000 : undefined)
  const subtareas = Array.isArray(estado.subtareas)
    ? estado.subtareas.map((s) => {
      const ejecutor = m.ejecutores?.[s.n] ?? {}
      const c = cambios[s.n] ?? {}
      return sinNulos({
        n: s.n,
        critica: s.critica === null || s.critica === undefined || !/^no\b/i.test(String(s.critica).trim()),
        esfuerzo: ejecutor.esfuerzo,
        archivos: c.archivos,
        mas: c.mas,
        menos: c.menos,
        usd: redondeo(ejecutor.usd),
        segundos: ejecutor.segundos,
        correcciones: ejecutor.correcciones,
        estado: estado.avance?.[String(s.n)]?.estado === 'OMITIDA' ? 'OMITIDA' : ejecutor.estado,
      })
    })
    : undefined
  return sinNulos({
    v: 2,
    t,
    raiz,
    base,
    version,
    sesion: m.sesion,
    sesiones: m.sesiones,
    pedido: m.pedido,
    titulo: estado.titulo,
    resultado,
    clasificacion: estado.clasificacion,
    costo: m.costo,
    uso,
    contexto: sinNulos({ primero: m.contexto?.primero }),
    tiempos: m.tiempos,
    subtareas,
    calidad: sinNulos({
      final: m.problemas?.final,
      negados,
      alcanceFuera: m.alcanceFuera,
      inicial: estado.verificacion_inicial?.resultado,
    }),
    explorador: m.explorador && Array.isArray(m.explorador.agentes) ? { ...m.explorador, agentes: m.explorador.agentes.map((a) => ({ ...a, cortado: cortados.includes(a.id) })) } : m.explorador,
    tokens,
  })
}

/** `CONTEXTO: …` del cierre: tokens del último pedido del hilo principal y lo que costaría reescribirlos en Opus con caché de 1 h. */
function lineaDeContexto(metricas) {
  if (!metricas) return 'CONTEXTO: sin datos (no encontré la sesión del flujo en los transcripts)'
  const n = metricas.contexto?.ultimo
  const precio = precioDe('claude-opus-5-5')
  if (typeof n !== 'number' || !precio) return 'CONTEXTO: sin datos (el hilo principal no tiene pedidos en el tramo del flujo)'
  return `CONTEXTO: ${n} tokens en el último pedido del hilo principal · reescribirlo en Opus con caché de 1 h: $${((n * precio.escritura1h) / 1e6).toFixed(2).replace('.', ',')}`
}

/**
 * Copia plan.md, exploracion.md, pedido.md, los S<n>.md, los revision-<c>.md y estado.json del flujo a `<registros>/historial/<AAAAMMDDTHHMMSS>-<proyecto>-<hash>/`
 * y deja las `HISTORIAL_MAX` carpetas más recientes: solo borra subcarpetas directas de `historial/` con nombre `AAAAMMDDTHHMMSS-…`,
 * nunca la recién creada. Nunca rompe el cierre.
 */
function archivarFlujo(t) {
  try {
    const historial = path.join(carpetaGlobal(), 'historial')
    const destino = path.join(historial, `${t.replace(/[-:]/g, '').slice(0, 15)}-${nombreDe(RAIZ)}`)
    fs.mkdirSync(destino, { recursive: true })
    for (const nombre of fs.readdirSync(FLUJO)) {
      if (/^(plan|exploracion|pedido|S\d+|revision-\d+)\.md$/.test(nombre) || nombre === 'estado.json') fs.copyFileSync(path.join(FLUJO, nombre), path.join(destino, nombre))
    }
    console.log(`HISTORIAL: ${destino}`)
    const carpetas = fs.readdirSync(historial, { withFileTypes: true }).filter((d) => d.isDirectory() && RE_CARPETA_HISTORIAL.test(d.name)).map((d) => d.name).sort().reverse()
    for (const nombre of carpetas.slice(HISTORIAL_MAX)) {
      const vieja = path.join(historial, nombre)
      if (path.dirname(vieja) === historial && vieja !== destino) fs.rmSync(vieja, { recursive: true, force: true })
    }
  } catch (err) {
    console.log(`AVISO: no se pudo archivar el flujo en el historial: ${err.message}`)
  }
}

/**
 * Cierre: imprime el costo real del flujo, sus veredictos y el CONTEXTO del hilo principal (de los transcripts), fija
 * `cierre` y `resultado` en el estado, anota la fila v2 en `registros/flujos.jsonl` (`filaDelFlujo`, con los `--tokens` si
 * vinieron) y archiva el flujo en el historial. Cada parte falla sola: nunca rompe el cierre. `cancelado` (solo `--cancelar`)
 * fija el resultado `CANCELADO`, que `--resultado` no acepta.
 */
function cerrarFlujo(base, desde, tokens, resultado, cancelado = false) {
  const e = leerEstado()
  const t = new Date().toISOString()
  let metricas = null
  try {
    metricas = metricasDelFlujo(RAIZ, e.inicio ?? desde ?? t, { hasta: t, base: e.base_global ?? null, sesiones: sesionesDe(e) })
  } catch {
    // Sin métricas, el cierre sigue.
  }
  const costo = metricas?.costo ?? null
  if (costo) {
    console.log(`COSTO: ${resumenDeCosto(costo)} (sin el mensaje de cierre)`)
    console.log(`VEREDICTOS: ${resumenDeVeredictos(costo)}`)
  } else console.log('COSTO: no encontré la sesión del flujo en los transcripts; el gasto está en «Flujo» del panel')
  console.log(lineaDeContexto(metricas))
  let porRol = null
  if (tokens !== undefined) {
    porRol = tokensDe(tokens)
    if (!porRol) console.log(`AVISO: --tokens ${tokens} no es rol=n,…; el flujo se anota sin ellos`)
  }
  let valido
  if (cancelado) valido = 'CANCELADO'
  else if (resultado !== undefined) {
    if (RE_RESULTADO.test(resultado)) valido = resultado
    else console.log(`AVISO: --resultado ${resultado || '(vacío)'} no es COMPLETO ni DETENIDO:<0-7>; el flujo se anota sin él`)
  }
  anotarEstado({ cierre: t, resultado: valido })
  if (valido === 'COMPLETO' && metricas) {
    // `subtareas` [{ n, estado }] si la métrica lo trae; si no, los ejecutores por subtarea (`1`, `2`…; `final` y `?` no cuentan).
    const lista = Array.isArray(metricas.subtareas) ? metricas.subtareas : Object.entries(metricas.ejecutores ?? {}).filter(([n]) => /^\d+$/.test(n)).map(([n, g]) => ({ n, estado: g?.estado }))
    for (const s of lista) if (s?.estado && s.estado !== 'HECHO' && s.estado !== 'OMITIDA') console.log(`AVISO: S${s.n} terminó ${s.estado} y el cierre es COMPLETO: dilo en Riesgos pendientes`)
  }
  let cambiosDeSubtareas = {}
  try {
    cambiosDeSubtareas = cambiosPorSubtarea(e)
  } catch {
    // Sin las diferencias por subtarea, la fila sigue.
  }
  let negados
  let cortados
  try {
    const filas = leerRegistro(e.desde_global ?? desde ?? e.inicio ?? t)
    negados = filas.filter((f) => f.decision === 'negado').length
    cortados = [...cortadosDe(filas).keys()]
  } catch {
    // Sin el registro, la fila sigue.
  }
  try {
    anotarFlujo(path.join(carpetaGlobal(), 'flujos.jsonl'), filaDelFlujo({ t, raiz: RAIZ, base, version: versionInstalada(), resultado: valido, tokens: porRol ?? undefined, estado: e, metricas, cambios: cambiosDeSubtareas, negados, cortados }))
  } catch (err) {
    console.log(`AVISO: no se pudo anotar el flujo: ${err.message}`)
  }
  archivarFlujo(t)
}

/**
 * `--cancelar`: cierra el flujo abierto que no llegó a ejecutar nada (candado libre para el siguiente preflight).
 * No hace nada si no hay flujo, si ya está cerrado o si tiene fotos de subtareas (hay trabajo hecho: se cierra con `--cambios`).
 * Cierra con `cerrarFlujo` (fila v2 con `resultado: 'CANCELADO'` e historial); no necesita git.
 */
function cancelar() {
  const e = leerEstado()
  if (!e.base_global) {
    console.log('CANCELAR: no hay un flujo en curso')
    return
  }
  if (e.cierre) {
    console.log(`CANCELAR: el flujo ya estaba cerrado (${e.cierre})`)
    return
  }
  const numeros = Object.keys(basesDe(e)).sort((a, b) => Number(a) - Number(b))
  if (numeros.length) {
    console.log(`AVISO: el flujo ya empezó a ejecutar subtareas (${numeros.map((n) => `S${n}`).join(', ')}): --cancelar no lo cierra para no perder su rastro; ciérralo con --cambios --global --resultado DETENIDO:<paso> --paso 7`)
    return
  }
  cerrarFlujo(e.base_global, e.desde_global, undefined, undefined, true)
  console.log('CANCELADO: flujo cerrado sin plan aprobado; el candado queda libre')
}

/**
 * `--base --sub <n>`: guarda la foto de la subtarea `n` en `bases` del estado del flujo e imprime `BASE=… DESDE=…`.
 * Si ya había una, conserva la primera (un reintento no esconde lo que el ejecutor ya editó).
 * También anota en `en_curso` (lista de números) la subtarea o el lote que corre ahora: la guardia deja pasar los comandos de los permisos
 * aprobados (`permisos`) solo de esas. `--cambios --sub` y `--cambios --global` la borran.
 */
function fotoDeSubtarea(n) {
  if (n === null) throw new Error('--sub necesita el número de la subtarea (un entero ≥ 1)')
  if (Array.isArray(n)) return fotoDeLote(n)
  const bases = basesDe(leerEstado())
  const previa = bases[String(n)]
  if (previa) console.log(`AVISO: S${n} ya tenía foto; se conserva la primera (la de antes de su ejecutor)`)
  const vigente = previa ?? { base: foto(), desde: new Date().toISOString() }
  anotarEstado({ ...(previa ? {} : { bases: { ...bases, [String(n)]: vigente } }), en_curso: [n] })
  console.log(`BASE=${vigente.base} DESDE=${vigente.desde}`)
}

/** El lote (`[1, 2]`) con que se tomó una foto (`--base --sub 1,2`); null si es de una sola subtarea. */
function loteDe(f) {
  const lote = f?.lote
  return Array.isArray(lote) && lote.length > 1 && lote.every((n) => Number.isSafeInteger(n) && n >= 1) ? lote : null
}

/**
 * `--base --sub 1,2`: una sola foto para el lote, guardada en cada n como `{ base, desde, lote }`. Nunca reemplaza una foto previa:
 * si alguna subtarea ya tenía, el lote usa esa (con el aviso de siempre) y, si las previas son de fotos distintas o alguna es una
 * foto suelta (sin `lote`), es un error y no se guarda nada.
 */
function fotoDeLote(numeros) {
  const bases = basesDe(leerEstado())
  const previas = numeros.filter((n) => bases[String(n)])
  const primera = bases[String(previas[0])]
  const suelta = previas.find((n) => !loteDe(bases[String(n)]))
  if (suelta !== undefined) throw new Error(`S${suelta} ya tiene una foto suelta, sin lote; no entra en un lote`)
  if (previas.some((n) => bases[String(n)].base !== primera.base || bases[String(n)].desde !== primera.desde)) {
    throw new Error(`${previas.map((n) => `S${n}`).join(', ')} ya tienen fotos distintas: no se pueden juntar en el lote ${numeros.join(',')}`)
  }
  for (const n of previas) console.log(`AVISO: S${n} ya tenía foto; se conserva la primera (la de antes de su ejecutor)`)
  const vigente = primera ? { base: primera.base, desde: primera.desde } : { base: foto(), desde: new Date().toISOString() }
  const nuevas = numeros.filter((n) => !bases[String(n)])
  anotarEstado({
    ...(nuevas.length ? { bases: { ...bases, ...Object.fromEntries(nuevas.map((n) => [String(n), { ...vigente, lote: numeros }])) } } : {}),
    en_curso: numeros,
    paralelos: [...paralelosDe(leerEstado()), { tipo: 'lote', n: numeros.length, desde: new Date().toISOString() }].slice(-TOPE_PARALELOS),
  })
  console.log(`BASE=${vigente.base} DESDE=${vigente.desde}`)
  console.log(`LOTE=${numeros.map((n) => `S${n}`).join('+')}`)
}

const TOPE_PARALELOS = 20

/**
 * Las fases con agentes en paralelo del estado (`paralelos`): `[{ tipo: 'lote'|'tanda', n, desde, hasta? }]`, sin las entradas rotas.
 * Una fase sin `hasta` sigue abierta. Un flujo viejo no tiene el campo: lista vacía.
 */
function paralelosDe(estado) {
  const crudas = Array.isArray(estado.paralelos) ? estado.paralelos : []
  return crudas.filter((p) => p && (p.tipo === 'lote' || p.tipo === 'tanda') && Number.isFinite(Date.parse(p.desde)) && (p.hasta === undefined || Number.isFinite(Date.parse(p.hasta))))
}

/** Cierra (`hasta` = ahora) las fases en paralelo abiertas: `--cambios --sub|--global` mide lo que hicieron los agentes. */
function cerrarParalelos() {
  const lista = paralelosDe(leerEstado())
  if (!lista.some((p) => p.hasta === undefined)) return
  const hasta = new Date().toISOString()
  anotarEstado({ paralelos: lista.map((p) => (p.hasta === undefined ? { ...p, hasta } : p)) })
}

/**
 * `--tanda <n>`: abre la fase en paralelo de una tanda de `n` ejecutores de correcciones (sin fotos por subtarea, así que no pasa por
 * `--base --sub`) e imprime `TANDA=<n> DESDE=<iso>`. Con `n` = 1 solo avisa: un ejecutor solo no corre en paralelo. Falla sin un flujo abierto.
 * Siempre imprime además `BASE=<sha>`, la foto previa a las correcciones: el siguiente ciclo de la revisión final mira solo el diff desde ahí.
 * `--sub <lista>` anota en `en_curso` las subtareas cuyos ejecutores corrigen (como `--base --sub`): la guardia deja pasar los permisos
 * aprobados solo de esas. Sin `--sub`, `en_curso` queda vacío y ningún permiso vale.
 */
function abrirTanda(n, sub) {
  if (n === null) throw new Error('--tanda necesita cuántos ejecutores tiene la tanda (un entero ≥ 1)')
  if (sub === null) throw new Error('--sub necesita el número de la subtarea o una lista (un entero ≥ 1, o 1,3)')
  const e = leerEstado()
  if (!e.base_global || e.cierre) throw new Error('el flujo no está abierto: no hay dónde anotar la tanda (corre el preflight)')
  const base = foto((Array.isArray(e.subtareas) ? e.subtareas : []).flatMap((s) => (Array.isArray(s?.permitidos) ? s.permitidos : [])))
  const desde = new Date().toISOString()
  // La BASE de cada tanda queda en el estado: `--reanudar` la da como BASE DE LA CORRECCIÓN.
  const tandas = [...listaDe(e, 'tandas'), { n, base, t: desde, ciclo: listaDe(e, 'revisiones').length }].slice(-TOPE_PARALELOS)
  const en_curso = sub === undefined ? undefined : [].concat(sub)
  if (n < 2) {
    anotarEstado({ tandas, en_curso })
    console.log(`AVISO: una tanda de ${n} no corre en paralelo; no se anota la fase en paralelo`)
    console.log(`BASE=${base}`)
    return
  }
  anotarEstado({ tandas, en_curso, paralelos: [...paralelosDe(e), { tipo: 'tanda', n, desde }].slice(-TOPE_PARALELOS) })
  console.log(`TANDA=${n} DESDE=${desde}`)
  console.log(`BASE=${base}`)
}

/**
 * `--permiso <Pn|Nn> aprobado`: deja `aprobado: <iso>` (la hora de la aprobación del usuario) en el permiso `id` de `permisos` del
 * estado e imprime `PERMISO: <id> aprobado`. La guardia deja pasar su comando solo al ejecutor y mientras su `sub` esté en
 * `en_curso`. Falla si el flujo no está abierto o si `id` no está en los permisos del plan.
 */
function aprobarPermiso(id, accion) {
  if (id === null) throw new Error('--permiso necesita el id del permiso (P<n> o N<n>) y «aprobado»: --permiso <id> aprobado')
  if (accion !== 'aprobado') throw new Error(`--permiso ${id}: solo vale «aprobado» (vino «${accion}»)`)
  const e = leerEstado()
  if (!e.base_global || e.cierre) throw new Error('el flujo no está abierto: no hay dónde anotar la aprobación (corre el preflight)')
  const previas = e.permisos && typeof e.permisos === 'object' && !Array.isArray(e.permisos) ? e.permisos : {}
  if (!previas[id]) throw new Error(`${id} no está en los permisos del plan guardado`)
  anotarEstado({ permisos: { ...previas, [id]: { ...previas[id], aprobado: new Date().toISOString() } } })
  console.log(`PERMISO: ${id} aprobado`)
}

const RE_PERMISO_NUEVO = /^(.+?)\s+·\s+(.+?)\s+·\s+reversible\s*:\s*(sí|si|no)\s+·\s+Qué hace\s*:\s*(.+?)\s+·\s+Para qué\s*:\s*(.+)$/is

/**
 * `--permiso-nuevo "<comando> · <servicio> · reversible: sí|no · Qué hace: … · Para qué: …" --sub <n>`: agrega a `permisos` del estado un
 * permiso `N<k>` (el siguiente libre) del ejecutor de la subtarea `n`, ya aprobado (el usuario lo aprobó en el chat) y marcado `nuevo`
 * para que un re-plan lo conserve mientras `n` siga en el plan. Imprime `PERMISO: N<k> aprobado`. Falla si falta algún campo, si el
 * comando no es simple o su comodín no se puede levantar (`regexDePermiso`), o si se niega aun aprobado (`motivoFijoDe`).
 */
function permisoNuevo(texto, sub) {
  if (!texto || /^--/.test(texto)) throw new Error('--permiso-nuevo necesita "<comando> · <servicio> · reversible: sí|no · Qué hace: … · Para qué: …"')
  if (!Number.isSafeInteger(sub)) throw new Error('--permiso-nuevo necesita --sub <n> (una sola subtarea)')
  const m = RE_PERMISO_NUEVO.exec(texto.trim())
  if (!m) throw new Error('--permiso-nuevo: el texto debe ser "<comando> · <servicio> · reversible: sí|no · Qué hace: … · Para qué: …" (separado por « · »)')
  const [, crudo, servicio, reversible, queHace, paraQue] = m
  const comando = crudo.trim().replace(/^(`+)(.+)\1$/, '$2').trim()
  const e = leerEstado()
  if (!e.base_global || e.cierre) throw new Error('el flujo no está abierto: no hay dónde anotar el permiso (corre el preflight)')
  if (!(Array.isArray(e.subtareas) ? e.subtareas : []).some((s) => s?.n === sub)) throw new Error(`S${sub} no está en el plan guardado`)
  if (!regexDePermiso(comando)) throw new Error(`«${comando}» no se puede aprobar: no es un comando simple o el comodín «*» cae antes de la parte literal`)
  const fijo = motivoFijoDe(comando)
  if (fijo) throw new Error(`«${comando}» se niega aun aprobado (${fijo})`)
  const previas = e.permisos && typeof e.permisos === 'object' && !Array.isArray(e.permisos) ? e.permisos : {}
  const id = `N${Math.max(0, ...Object.keys(previas).map((k) => Number(/^N(\d+)$/.exec(k)?.[1] ?? 0))) + 1}`
  const permiso = { rol: 'ejecutor', sub, comando, servicio: servicio.trim(), reversible: /^s/i.test(reversible), queHace: queHace.trim(), paraQue: paraQue.trim(), nuevo: true, aprobado: new Date().toISOString() }
  anotarEstado({ permisos: { ...previas, [id]: permiso } })
  console.log(`PERMISO: ${id} aprobado`)
}

/**
 * `--cambios --sub <n>`, `--cambios --sub 1,2` (un lote) o `--cambios --global`: BASE, DESDE y permitidos salen de la carpeta del flujo.
 * Los permitidos son los del plan (los de la subtarea, los del lote o los de todas) más los `--permitidos` explícitos (los ampliados).
 * Un número que es de un lote de varios mide el lote entero y lo avisa.
 * Devuelve `{ base, desde, permitidos }` e imprime la línea `FOTO`; lanza un error si falta algo.
 */
function contextoDelFlujo({ base, desde, permitidos, sub, global }) {
  if (sub === null) throw new Error('--sub necesita el número de la subtarea (un entero ≥ 1)')
  if (sub !== undefined && global) throw new Error('--sub y --global no van juntos')
  if (base !== undefined || desde !== undefined) {
    throw new Error('--sub y --global toman la BASE y el DESDE de la carpeta del flujo: quita <BASE> y --desde, o usa la forma explícita')
  }
  const e = leerEstado()
  const subtareas = Array.isArray(e.subtareas) ? e.subtareas : []
  const delPlan = (s) => (Array.isArray(s?.permitidos) ? s.permitidos.map(String) : [])
  let etiqueta
  let inicio
  let previstos
  let posteriores = []
  let etiquetaPosteriores = ''
  if (global) {
    if (!e.base_global) throw new Error('sin BASE_GLOBAL en la carpeta del flujo: usa --cambios <BASE> --desde <DESDE> --permitidos "…"')
    etiqueta = 'GLOBAL'
    inicio = { base: e.base_global, desde: e.desde_global }
    previstos = [...new Set(subtareas.flatMap(delPlan))]
  } else {
    const bases = basesDe(e)
    const fotoDe = (n) => {
      const f = bases[String(n)]
      if (!f) throw new Error(`sin foto de S${n} en la carpeta del flujo: usa --cambios <BASE> --desde <DESDE> --permitidos "…"`)
      return f
    }
    let miembros = [sub]
    if (Array.isArray(sub)) {
      const lotes = sub.map((n) => loteDe(fotoDe(n)))
      if (lotes.some((l) => !l || l.join() !== lotes[0].join())) {
        throw new Error(`${sub.map((n) => `S${n}`).join(' y ')} no son del mismo lote: toma su foto con --base --sub ${sub.join(',')}`)
      }
      miembros = lotes[0]
    } else {
      const lote = loteDe(fotoDe(sub))
      if (lote) {
        miembros = lote
        console.log(`AVISO: S${sub} es del lote ${lote.map((n) => `S${n}`).join('+')}: mide el lote entero (--cambios --sub ${lote.join(',')})`)
      }
    }
    etiqueta = miembros.map((n) => `S${n}`).join('+')
    inicio = fotoDe(miembros[0])
    previstos = [...new Set(miembros.flatMap((n) => delPlan(subtareas.find((s) => Number(s?.n) === n))))]
    // Las subtareas con foto posterior a la de la medición ya midieron lo suyo: una corrección vieja no las marca FUERA.
    const delante = Object.keys(bases).map(Number).filter((n) => !miembros.includes(n) && Date.parse(bases[String(n)].desde) > Date.parse(inicio.desde)).sort((a, b) => a - b)
    posteriores = delante.flatMap((n) => delPlan(subtareas.find((s) => Number(s?.n) === n))).filter((p) => !previstos.includes(p))
    posteriores = [...new Set(posteriores)]
    if (posteriores.length) etiquetaPosteriores = `${posteriores.length} de subtareas posteriores (${delante.map((n) => `S${n}`).join(', ')})`
  }
  const ampliados = [...new Set(permitidos)].filter((p) => !previstos.includes(p))
  const unidos = [...new Set([...previstos, ...ampliados, ...posteriores])]
  if (!unidos.length) throw new Error('sin plan guardado ni --permitidos: usa la forma explícita (--cambios <BASE> --desde <DESDE> --permitidos "…")')
  console.log(`FOTO ${etiqueta}: BASE=${corto(inicio.base)} DESDE=${inicio.desde} · permitidos: ${previstos.length} del plan + ${ampliados.length} ampliados${etiquetaPosteriores ? ` + ${etiquetaPosteriores}` : ''}`)
  // Los ampliados (respuestas «Aceptar» del usuario) quedan en el estado: `--reanudar` los devuelve.
  if (ampliados.length) anotarEstado({ ampliados: [...new Set([...(Array.isArray(e.ampliados) ? e.ampliados : []), ...ampliados])] })
  return { base: inicio.base, desde: inicio.desde, permitidos: unidos, miembros: global ? null : etiqueta.split('+').map((s) => Number(s.slice(1))) }
}

// Colores fijos para `--color-moved`: así la detección no depende de la configuración de color del usuario.
const COLORES_MOVIDO = ['color.diff.oldMoved=magenta', 'color.diff.newMoved=cyan', 'color.diff.old=red', 'color.diff.new=green']
const RE_MOVIDA = /^\x1b\[(35m-|36m\+)/
const RE_ANSI = /\x1b\[[0-9;]*m/g
const MIN_MOVIDAS = 4

/**
 * Colapsa las tiradas de `minimo` o más líneas que git marcó como movidas sin cambios (`--color-moved=plain` con los colores de
 * `COLORES_MOVIDO`) en una sola línea `~ <n> líneas quitadas|agregadas aquí, movidas sin cambios…`, y quita los colores de las demás.
 * Una línea movida y editada sale como diff normal. Devuelve `{ lineas, colapsadas }`.
 */
export function colapsarMovidos(crudas, minimo = MIN_MOVIDAS) {
  const lineas = []
  let colapsadas = 0
  for (let i = 0; i < crudas.length; ) {
    const signo = RE_MOVIDA.exec(crudas[i])?.[1]
    let j = i + 1
    if (signo) while (j < crudas.length && RE_MOVIDA.exec(crudas[j])?.[1] === signo) j++
    if (signo && j - i >= minimo) {
      lineas.push(signo.endsWith('-')
        ? `~ ${j - i} líneas quitadas aquí, movidas sin cambios a otro lugar del diff`
        : `~ ${j - i} líneas agregadas aquí, movidas sin cambios desde otro lugar del diff`)
      colapsadas += j - i
    } else for (let k = i; k < j; k++) lineas.push(crudas[k].replace(RE_ANSI, ''))
    i = j
  }
  return { lineas, colapsadas }
}

function diff(base, permitidos, rutas) {
  const ahora = foto(permitidos)
  const filtro = ['--', ...rutas]
  const stat = git(['diff', '--stat=150', '--no-renames', base, ahora, ...filtro]).trimEnd()
  const crudo = git([...COLORES_MOVIDO.flatMap((c) => ['-c', c]), 'diff', '--no-renames', '--color=always', '--color-moved=plain', '--color-moved-ws=no', base, ahora, ...filtro]).trimEnd()
  console.log(`DIFF ${corto(base)} → árbol actual${rutas.length ? ` (${rutas.join(', ')})` : ''}`)
  if (!crudo) {
    console.log('(sin cambios)')
    return
  }
  console.log(stat)
  const { lineas, colapsadas } = colapsarMovidos(crudo.split('\n'))
  if (colapsadas) console.log(`MOVIDO SIN CAMBIOS: ${colapsadas} líneas colapsadas en «~ …» (git --color-moved); para ver un bloque, lee el archivo`)
  console.log('')
  console.log(lineas.slice(0, TOPE_DIFF).join('\n'))
  if (lineas.length > TOPE_DIFF) {
    console.log(`\n… recortado: ${lineas.length - TOPE_DIFF} líneas más. Pide por ruta: --diff ${corto(base)} --permitidos "…" -- <ruta>`)
  }
}

/** Valor de `--sub`: un entero ≥ 1, o una lista `1,2,3` de enteros ≥ 1 sin repetir (ordenada); null si no vale. */
function subDe(texto) {
  if (!/^\d+(,\d+)*$/.test(texto ?? '')) return null
  const numeros = texto.split(',').map(Number)
  if (numeros.some((n) => !Number.isSafeInteger(n) || n < 1) || new Set(numeros).size !== numeros.length) return null
  return numeros.length === 1 ? numeros[0] : numeros.sort((a, b) => a - b)
}

/**
 * Argumentos → `{ modo, base, desde, permitidos, rutas, paso, aviso, tokens, resultado, agente, tipo, ajuste, forzar }`. Las opciones
 * valen solo antes de `--`; lo de después son rutas. Precedencia: --reglas > --guia > --reanudar > --estado > --aprobado > --cancelar > --guardar > --permiso > --permiso-nuevo > --tanda > --base > --cambios > --diff > preflight.
 * `paso` es un entero de 0 a 7 o null (con `aviso` si venía y no valía). `tokens` es el valor crudo de `--tokens`;
 * `resultado`, el de `--resultado` (`''` si el flag viene sin valor; undefined si no viene); `agente` y `tipo`, los dos valores que siguen a `--guardar` (`agente` es el texto crudo: varios ids van separados por coma, sin espacios).
 * `--guia <nombre>` agrega `guia` (el nombre, `''` si falta) y, con `--parte <k>`, `parte` (el texto crudo). `--omitida` agrega `omitida: true`; `--aprobado` agrega `ajustes` (el valor de `--ajustes`, `''` si falta). `--permiso <Pn|Nn> aprobado` es el modo `permiso` y agrega `permiso` (el id en mayúsculas; null si no vale) y `accion` (la palabra que sigue, `''` si falta). `--permiso-nuevo "<texto>"` es el modo `permisoNuevo` y agrega `permisoNuevo` (el texto crudo, `''` si falta). `--tanda <n>` es el modo `tanda` y agrega `tanda` (el entero ≥ 1; null si no vale). `--sub <n>` agrega `sub` (el entero ≥ 1; `1,2` da la lista `[1, 2]` de un lote; null si no vale) y `--global` agrega `global: true`; sin el flag no aparece la clave.
 * En modo `cambios` con alguno de los dos, `base` queda undefined si lo que sigue a `--cambios` es otra opción.
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
  else if (opciones.includes('--guia')) modo = 'guia'
  else if (opciones.includes('--reanudar')) modo = 'reanudar'
  else if (opciones.includes('--estado')) modo = 'estado'
  else if (opciones.includes('--aprobado')) modo = 'aprobado'
  else if (opciones.includes('--cancelar')) modo = 'cancelar'
  else if (opciones.includes('--guardar')) modo = 'guardar'
  else if (opciones.includes('--permiso')) modo = 'permiso'
  else if (opciones.includes('--permiso-nuevo')) modo = 'permisoNuevo'
  else if (opciones.includes('--tanda')) modo = 'tanda'
  else if (opciones.includes('--base')) modo = 'base'
  else if (opciones.includes('--cambios')) {
    modo = 'cambios'
    base = valor('--cambios')
  } else if (opciones.includes('--diff')) {
    modo = 'diff'
    base = valor('--diff')
  }
  const conSub = opciones.includes('--sub')
  const conGlobal = opciones.includes('--global')
  if (modo === 'cambios' && (conSub || conGlobal) && String(base ?? '').startsWith('--')) base = undefined
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
    resultado: opciones.includes('--resultado') ? (valor('--resultado') ?? '') : undefined,
    agente: modo === 'guardar' ? valor('--guardar') : undefined,
    tipo: modo === 'guardar' ? valor('--guardar', 2) : undefined,
    ajuste: opciones.includes('--ajuste'),
    forzar: opciones.includes('--forzar'),
    ...(conSub ? { sub: subDe(valor('--sub')) } : {}),
    ...(conGlobal ? { global: true } : {}),
    ...(modo === 'guia' ? { guia: valor('--guia') ?? '', ...(opciones.includes('--parte') ? { parte: valor('--parte') ?? '' } : {}) } : {}),
    ...(opciones.includes('--omitida') ? { omitida: true } : {}),
    ...(modo === 'aprobado' ? { ajustes: /^--/.test(valor('--ajustes') ?? '--') ? '' : valor('--ajustes') } : {}),
    ...(modo === 'tanda' ? { tanda: /^[1-9]\d*$/.test(valor('--tanda') ?? '') ? Number(valor('--tanda')) : null } : {}),
    ...(modo === 'permisoNuevo' ? { permisoNuevo: valor('--permiso-nuevo') ?? '' } : {}),
    ...(modo === 'permiso' ? { permiso: /^[PN][1-9]\d*$/i.test(valor('--permiso') ?? '') ? valor('--permiso').toUpperCase() : null, accion: /^--/.test(valor('--permiso', 2) ?? '--') ? '' : valor('--permiso', 2) } : {}),
  }
}

const ROLES = ['explorador', 'planificador', 'ejecutor', 'revisor', 'final']

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

function main() {
  const { modo, base, desde, permitidos, rutas, paso, aviso, tokens, resultado, agente, tipo, ajuste, forzar, sub, global, guia, parte, permiso, accion, permisoNuevo: textoNuevo, tanda, omitida, ajustes } = opcionesDe(process.argv.slice(2))
  if (aviso) console.log(`AVISO: ${aviso}`)
  // Ni las reglas ni el estado necesitan git: las reglas se inyectan antes del preflight.
  if (modo === 'reglas') {
    imprimirReglas()
    return
  }
  if (modo === 'guia') {
    imprimirGuia(guia, parte)
    return
  }
  if (modo === 'estado') {
    mostrarEstado()
    return
  }
  if (modo === 'reanudar' || modo === 'aprobado') {
    try {
      if (modo === 'reanudar') reanudar()
      else aprobar(ajustes)
    } catch (e) {
      console.log(`ERROR: ${e.message}`)
      process.exitCode = 2
    }
    return
  }
  if (modo === 'cancelar') {
    cancelar()
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
  if (modo === 'permiso') {
    try {
      aprobarPermiso(permiso, accion)
    } catch (e) {
      console.log(`ERROR: ${e.message}`)
      process.exitCode = 2
    }
    return
  }
  if (modo === 'permisoNuevo') {
    try {
      permisoNuevo(textoNuevo, sub)
    } catch (e) {
      console.log(`ERROR: ${e.message}`)
      process.exitCode = 2
    }
    return
  }
  if (modo === 'tanda') {
    try {
      abrirTanda(tanda, sub)
    } catch (e) {
      console.log(`ERROR: ${e.message}`)
      process.exitCode = 2
    }
    return
  }
  try {
    if (git(['rev-parse', '--is-inside-work-tree'], { opcional: true })?.trim() !== 'true') {
      throw new Error(`${RAIZ} no es un repositorio git: los flujos necesitan git (el usuario puede hacer git init)`)
    }
    if (modo === 'base' && sub !== undefined) fotoDeSubtarea(sub)
    else if (modo === 'base') {
      const nueva = { base: foto(), desde: new Date().toISOString() }
      const { fotos } = leerEstado()
      anotarEstado({ fotos: [...(Array.isArray(fotos) ? fotos : []), nueva] })
      console.log(`BASE=${nueva.base} DESDE=${nueva.desde}`)
    } else if (modo === 'cambios') {
      const delFlujo = sub !== undefined || global
      const del = delFlujo ? contextoDelFlujo({ base, desde, permitidos, sub, global }) : { base, desde, permitidos }
      exigirBase(del.base)
      // Las fases en paralelo se leen antes de cerrarlas: este mismo comando las mide.
      const paralelos = delFlujo ? paralelosDe(leerEstado()) : []
      if (delFlujo) anotarEstado({ en_curso: undefined })
      if (tokens !== undefined && paso !== 7) console.log('AVISO: --tokens solo vale en el cierre (--cambios … --paso 7); se ignora')
      if (resultado !== undefined && paso !== 7) console.log('AVISO: --resultado solo vale en el cierre (--cambios … --paso 7); se ignora')
      if (omitida && !del.miembros?.length) console.log('AVISO: --omitida solo vale con --cambios --sub <n>; se ignora')
      // Antes de los CAMBIOS: la salida sigue terminando en ALCANCE.
      if (del.miembros?.length) anotarAvance(del.miembros, del.desde, omitida)
      try {
        cambios(del.base, del.desde, del.permitidos, paso, tokens, resultado, paralelos)
      } finally {
        if (delFlujo) cerrarParalelos()
      }
    } else if (modo === 'diff') diff(exigirBase(base), permitidos, rutas)
    else preflight(forzar)
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
