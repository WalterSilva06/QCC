#!/usr/bin/env node
// Herramienta de /qcc-implementador-odd (nivel usuario: sirve para cualquier proyecto).
//
//   node ~/.claude/flujos-odd/odd.mjs --inicio
//   node ~/.claude/flujos-odd/odd.mjs --plan --base <BASE> --tamano chico|grande --reglas <n>
//        --riesgo "1:sí <motivo>;2:no;…;6:no" [--bordes "<borde> | <borde>"]
//   node ~/.claude/flujos-odd/odd.mjs --diff <BASE> [-- <rutas>]
//   node ~/.claude/flujos-odd/odd.mjs --cierre --base <BASE> --resultado COMPLETO|DETENIDO --tamano chico|grande
//        --riesgo "<ítem N (motivo) | ninguno>" [--revision APROBADO|RECHAZADO|omitida] [--titulo "<t>"]
//   node ~/.claude/flujos-odd/odd.mjs --ultimos [<n>]
//   node ~/.claude/flujos-odd/odd.mjs --copia-base <BASE>
//   node ~/.claude/flujos-odd/odd.mjs --limpiar -- <rutas>
//
// --inicio: toma una foto del árbol (versionados + nuevos no ignorados) como commit suelto, que es la BASE, y la
// imprime como `ODD_BASE=<sha>`: con esa marca costo.mjs encuentra la sesión. Además: rama, sucios previos,
// archivos de código y `explorar`, `criticos`, reglas de la guardia y pasos de `verificar` de `.claude/qcc-implementador-odd.json`, y los
// `odd/tasks/*.md` con tareas abiertas. Deja la marca de corrida abierta (`registros/activas/`), que activa la guardia
// del orquestador; `--cierre` la borra.
// --plan: el cierre de la exploración, visible: tamaño, los 6 ítems de riesgo (cada uno «sí <motivo>» o «no») y los
// bordes. Un ítem que falta, un «sí» sin motivo o un riesgo sin bordes salen con ERROR y código 2. Anota el tamaño en
// la marca de corrida: con `grande`, la guardia niega al orquestador editar fuera de `odd/tasks/`.
// --diff: el cambio desde la BASE contra una foto nueva (incluye archivos nuevos), con --stat y recortado a TOPE_DIFF líneas.
// --cierre: anota una fila en `registros/odd.jsonl` con el costo y el control de proceso, e imprime CAMBIOS, COSTO y PROCESO.
// --plan, --diff y --cierre imprimen `CONTEXTO: <n>k`, el del último pedido del orquestador, leído del transcript.
// --ultimos: las últimas corridas anotadas (10 por defecto), con el promedio y el costo real (con el reporte).
// --copia-base: el árbol de la BASE en un temporal nuevo, para comparar contra él; imprime `ODD_COPIA=<ruta>`.
// --limpiar: borra las rutas que están dentro de un temporal (no el temporal mismo); las demás quedan, con su motivo.
// Sin candado ni estado: lo que el flujo tiene que recordar va en la salida o en `odd/tasks/`.
// `ODD_REGISTROS` cambia la carpeta de registros (los tests la llevan a un temporal).

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { raizDe, rutaNativa, enTemporal, reglasDelProyecto, marcaDe } from './guardia.mjs'
import { costoDelFlujo, contextoActual, finDeCorrida, filasDe, sesionDe, resumenDeCosto, resumenDeTokens, dolares, miles } from './costo.mjs'
import { procesoDe, lineaDeProceso, TOPE_CONTEXTO } from './proceso.mjs'

const WIN = process.platform === 'win32'
const DIR = path.dirname(fileURLToPath(import.meta.url))
const RAIZ = raizDe(process.env.CLAUDE_PROJECT_DIR || process.cwd())
const TOPE_DIFF = 400
const TOPE_SUCIOS = 10
const CONFIG = '.claude/qcc-implementador-odd.json'
const TAREAS = 'odd/tasks'
const REGLAS_CHICO = 8

const registroDe = () => path.join(process.env.ODD_REGISTROS || path.join(DIR, 'registros'), 'odd.jsonl')

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

/** Foto del árbol actual como commit suelto, hijo de HEAD si existe. Usa un índice temporal: no toca el del usuario. */
function foto() {
  const indiceReal = path.resolve(RAIZ, git(['rev-parse', '--git-path', 'index']).trim())
  const tmp = path.join(os.tmpdir(), `qcc-odd-indice-${process.pid}-${Date.now()}`)
  try {
    fs.copyFileSync(indiceReal, tmp)
  } catch {
    // Repo sin índice todavía: el árbol parte vacío.
  }
  const env = {
    ...process.env,
    GIT_INDEX_FILE: tmp,
    GIT_AUTHOR_NAME: 'qcc-implementador-odd',
    GIT_AUTHOR_EMAIL: 'qcc-implementador-odd@local',
    GIT_COMMITTER_NAME: 'qcc-implementador-odd',
    GIT_COMMITTER_EMAIL: 'qcc-implementador-odd@local',
  }
  try {
    git(['add', '-A', '--', '.'], { env })
    const arbol = git(['write-tree'], { env }).trim()
    const head = git(['rev-parse', '--verify', '-q', 'HEAD'], { opcional: true })?.trim()
    return git(['commit-tree', arbol, ...(head ? ['-p', head] : []), '-m', 'qcc-implementador-odd: foto del árbol'], { env }).trim()
  } finally {
    fs.rmSync(tmp, { force: true })
  }
}

function exigirBase(base) {
  if (!base || base.startsWith('--')) throw new Error('falta la BASE')
  if (git(['cat-file', '-e', `${base}^{commit}`], { opcional: true }) === null) throw new Error(`BASE desconocida: ${base}`)
  return base
}

/** La config del proyecto; `{}` si no hay o no se puede leer. */
function configDelProyecto() {
  try {
    const config = JSON.parse(fs.readFileSync(path.join(RAIZ, CONFIG), 'utf8'))
    return config && typeof config === 'object' && !Array.isArray(config) ? config : {}
  } catch {
    return {}
  }
}

// ── Puras ───────────────────────────────────────────────────────────────────

/**
 * Opciones de la línea de comandos: `modo` (inicio | plan | diff | cierre | ultimos | copia-base | limpiar), los valores
 * con nombre y las `rutas` que siguen a `--`. Un valor que falta queda `undefined`.
 */
export function opcionesDe(args) {
  const k = args.indexOf('--')
  const propias = k >= 0 ? args.slice(0, k) : args
  const rutas = k >= 0 ? args.slice(k + 1) : []
  const valor = (nombre) => {
    const i = propias.indexOf(nombre)
    const v = i >= 0 ? propias[i + 1] : undefined
    return v === undefined || v.startsWith('--') ? undefined : v
  }
  const modo = ['cierre', 'diff', 'inicio', 'plan', 'ultimos', 'copia-base', 'limpiar'].find((m) => propias.includes(`--${m}`)) ?? null
  return {
    modo,
    base: modo === 'diff' || modo === 'copia-base' ? valor(`--${modo}`) : valor('--base'),
    resultado: valor('--resultado'),
    tamano: valor('--tamano'),
    reglas: valor('--reglas'),
    riesgo: valor('--riesgo'),
    bordes: valor('--bordes'),
    revision: valor('--revision'),
    titulo: valor('--titulo'),
    ultimos: Math.max(1, Number(valor('--ultimos') ?? 10) || 10),
    rutas,
  }
}

/** Los `criticos` de la config como líneas legibles: `- <rutas> (excepto …) [si …] · ítem N — <motivo>`. */
export function criticosLegibles(criticos) {
  if (!Array.isArray(criticos)) return []
  return criticos
    .filter((c) => c && Array.isArray(c.rutas) && c.rutas.length)
    .map((c) => {
      const excepto = Array.isArray(c.excepto) && c.excepto.length ? ` (excepto ${c.excepto.join(', ')})` : ''
      const si = c.si ? ` si ${c.si}` : ''
      const items = Array.isArray(c.riesgo) && c.riesgo.length ? ` · ítem ${c.riesgo.join(', ')}` : ''
      return `- ${c.rutas.join(', ')}${excepto}${si}${items}${c.motivo ? ` — ${c.motivo}` : ''}`
    })
}

const CODIGO = /\.(m?[jt]sx?|c[jt]s|py|go|rs|java|kts?|rb|php|cs|c|h|cc|cpp|hpp|swift|vue|svelte|sql|sh|ps1|lua|dart|scala|exs?)$/i

/** Cuántas de las rutas (una por línea) son archivos de código, por su extensión. */
export const cuentaCodigo = (lista) => String(lista).split('\n').filter((r) => CODIGO.test(r.trim())).length

/** `explorar` de la config: `siempre`, `nunca` o `auto` (lo que no sea uno de los dos). */
export const explorarDe = (config) => (['siempre', 'nunca'].includes(config?.explorar) ? config.explorar : 'auto')

/** Las reglas de la guardia del proyecto como líneas legibles: `- protegido: <ruta> — <motivo> (<config>)`… */
export function reglasLegibles({ protegidos, inmutables, scriptsNegados, origen }) {
  const de = (clave) => ` (${origen[clave]})`
  return [
    ...Object.entries(protegidos).map(([ruta, motivo]) => `- protegido: ${ruta} — ${motivo}${de('protegidos')}`),
    ...(inmutables.length ? [`- inmutables (los versionados): ${inmutables.join(', ')}${de('inmutables')}`] : []),
    ...(scriptsNegados.length ? [`- scripts negados: ${scriptsNegados.join(', ')}${de('scriptsNegados')}`] : []),
  ]
}

/** Tareas del documento de una feature: `{ abiertas, total }`, contando los `- [ ]` y `- [x]` de `## Tasks`. */
export function tareasDe(texto) {
  const seccion = /^## Tasks[^\n]*\n([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(String(texto))?.[1] ?? ''
  const abiertas = (seccion.match(/^\s*- \[ \]/gm) ?? []).length
  const hechas = (seccion.match(/^\s*- \[[xX]\]/gm) ?? []).length
  return { abiertas, total: abiertas + hechas }
}

/** `git diff --numstat` sumado: `{ archivos, mas, menos }` (los binarios cuentan como archivo, sin líneas). */
export function sumaNumstat(texto) {
  let archivos = 0
  let mas = 0
  let menos = 0
  for (const linea of String(texto).split('\n')) {
    const m = /^(\d+|-)\t(\d+|-)\t/.exec(linea)
    if (!m) continue
    archivos++
    if (m[1] !== '-') mas += Number(m[1])
    if (m[2] !== '-') menos += Number(m[2])
  }
  return { archivos, mas, menos }
}

/** Las primeras `tope` líneas de `texto` y cuántas sobran. */
export function recortar(texto, tope = TOPE_DIFF) {
  const lineas = String(texto).replace(/\n$/, '').split('\n')
  return { texto: lineas.slice(0, tope).join('\n'), sobran: Math.max(0, lineas.length - tope) }
}

/** Error de uso de `--plan`: sale con código 2. */
const errorDePlan = (mensaje) => Object.assign(new Error(mensaje), { codigo: 2 })

/**
 * Los 6 ítems de `--riesgo "1:sí <motivo>;2:no;…"`: `{ 1: '<motivo>' | null, …, 6 }`, con null para «no». Un ítem que
 * falta, repetido o fuera de 1-6, o un «sí» sin motivo, es un error.
 */
export function riesgoDe(texto) {
  const items = {}
  for (const parte of String(texto ?? '').split(';').map((p) => p.trim()).filter(Boolean)) {
    const m = /^(\d+)\s*:\s*(sí|si|no)(?=[\s,:—-]|$)[\s,:—-]*(.*)$/i.exec(parte)
    if (!m || m[1] < 1 || m[1] > 6) throw errorDePlan(`--riesgo: «${parte}» no es «N:sí <motivo>» ni «N:no», con N de 1 a 6 (los ítems van separados por «;», que no va en un motivo)`)
    if (m[1] in items) throw errorDePlan(`--riesgo: el ítem ${m[1]} está dos veces`)
    const si = m[2].toLowerCase() !== 'no'
    if (si && !m[3].trim()) throw errorDePlan(`--riesgo: el ítem ${m[1]} dice sí sin motivo`)
    items[m[1]] = si ? m[3].trim() : null
  }
  const faltan = [1, 2, 3, 4, 5, 6].filter((n) => !(n in items))
  if (faltan.length) throw errorDePlan(`--riesgo: faltan los ítems ${faltan.join(', ')} (cada uno «N:sí <motivo>» o «N:no»)`)
  return items
}

/** Las líneas de `--plan` (sin CONTEXTO): AVISO si las reglas piden `grande`, TAMAÑO, RIESGO PREVISTO y BORDES. */
export function lineasDePlan({ tamano, reglas, riesgo, bordes }) {
  if (!['chico', 'grande'].includes(tamano)) throw errorDePlan('--tamano tiene que ser chico o grande')
  if (!/^\d+$/.test(reglas ?? '')) throw errorDePlan('--reglas tiene que ser la cantidad de reglas pedidas')
  const items = riesgoDe(riesgo)
  const si = Object.entries(items).filter(([, motivo]) => motivo !== null)
  if (si.length && !bordes?.trim()) throw errorDePlan('con riesgo previsto, --bordes es obligatorio')
  const lineas = []
  if (tamano === 'chico' && Number(reglas) > REGLAS_CHICO) lineas.push(`AVISO: ${reglas} reglas → grande`)
  lineas.push(`TAMAÑO: ${tamano} · ${reglas} reglas`)
  if (tamano === 'grande') lineas.push(`GRANDE: el código lo edita qcc-odd-ejecutor; tú solo ${TAREAS}/ (la guardia niega lo demás)`)
  const motivos = si.map(([n, motivo]) => `${n}: ${motivo}`).join(' · ')
  lineas.push(`RIESGO PREVISTO: ${si.length ? `ítem${si.length > 1 ? 's' : ''} ${si.map(([n]) => n).join(', ')} (${motivos})` : 'ninguno'}`)
  lineas.push(`BORDES: ${bordes?.trim() || 'no aplica'}`)
  return lineas
}

/** «CONTEXTO: 112k», con el aviso del ejecutor pasados los 150k; «sin datos» si no hay transcript. */
export function lineaDeContexto(tokens) {
  if (tokens === null || tokens === undefined) return 'CONTEXTO: sin datos'
  return `CONTEXTO: ${miles(tokens)}${tokens > TOPE_CONTEXTO ? ' · > 150k: lo que falta va a qcc-odd-ejecutor' : ''}`
}

const sinNulos = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== ''))

/**
 * La fila de `odd.jsonl`. `costo` es el de costo.mjs (o null); `cambios`, el de `sumaNumstat`; `proceso`, la línea de
 * PROCESO; `sesion`, el transcript, para recalcular el costo real en `--ultimos`.
 */
export function filaDeCorrida({ t, raiz, base, resultado, tamano, riesgo, revision, titulo, proceso, costo = null, cambios, sesion } = {}) {
  return sinNulos({ v: 1, t, raiz, base, titulo, resultado, tamano, riesgo, revision, proceso, cambios, costo, sesion })
}

/** Una línea del listado `--ultimos`. Con `costoReal` (calculado al listar), el costo es ese, junto al del cierre. */
export function lineaDeCorrida(f) {
  const fecha = String(f.t ?? '').slice(0, 16).replace('T', ' ')
  const repo = String(f.raiz ?? '?').split(/[\\/]/).filter(Boolean).pop() ?? '?'
  const c = f.costoReal ?? f.costo
  const informes = c?.hallazgos?.revisor ?? []
  const hallazgos = informes.length ? `hallazgos ${informes.map((h) => `${h.problemas}p/${h.observaciones}o`).join(' → ')}` : null
  const datos = [f.tamano, f.riesgo && `Riesgo: ${f.riesgo}`, f.revision && `revisión ${f.revision}`, hallazgos, f.proceso && `PROCESO: ${f.proceso}`, f.resultado, f.cambios && `+${f.cambios.mas} −${f.cambios.menos}`].filter(Boolean)
  const costo = c ? resumenDeCosto(c, f.costoReal && f.costo ? f.costo.usd : null) + (c.tokens ? ` · ${resumenDeTokens(c.tokens)}` : '') : 'sin costo'
  return `${fecha} · ${repo} · ${costo}${datos.length ? ` · ${datos.join(' · ')}` : ''}${f.titulo ? ` · ${f.titulo}` : ''}`
}

// ── Modos ───────────────────────────────────────────────────────────────────

function inicio() {
  const base = foto()
  const rama = git(['rev-parse', '--abbrev-ref', 'HEAD'], { opcional: true })?.trim() || '(sin commits)'
  const head = git(['rev-parse', '--short', 'HEAD'], { opcional: true })?.trim() || '-'
  const sucios = git(['status', '--porcelain', '-uall', '-z']).split('\0').filter(Boolean).map((l) => l.slice(3))
  const config = configDelProyecto()
  const criticos = criticosLegibles(config.criticos)
  const pasos = Array.isArray(config.verificar) ? config.verificar.map((p) => p?.nombre ?? p?.cmd).filter(Boolean) : []
  const abiertas = []
  try {
    for (const a of fs.readdirSync(path.join(RAIZ, TAREAS)).filter((a) => a.endsWith('.md')).sort()) {
      const { abiertas: n, total } = tareasDe(fs.readFileSync(path.join(RAIZ, TAREAS, a), 'utf8'))
      if (n) abiertas.push(`${TAREAS}/${a} (${n} de ${total} abiertas)`)
    }
  } catch {
    // Sin odd/tasks/.
  }
  const lista = sucios.slice(0, TOPE_SUCIOS).join(', ') + (sucios.length > TOPE_SUCIOS ? `, … ${sucios.length - TOPE_SUCIOS} más` : '')
  const reglas = reglasLegibles(reglasDelProyecto(RAIZ))
  // La marca de corrida abierta: con ella la guardia del orquestador se activa; --cierre la borra.
  const marca = marcaDe(RAIZ)
  fs.mkdirSync(path.dirname(marca), { recursive: true })
  fs.writeFileSync(marca, JSON.stringify({ base, t: new Date().toISOString() }) + '\n')
  console.log(`ODD_BASE=${base}`)
  console.log(`RAMA: ${rama}@${head} · sucios previos: ${sucios.length ? `${sucios.length} (${lista})` : 'ninguno'}`)
  console.log(`CÓDIGO: ${cuentaCodigo(git(['ls-files', '-co', '--exclude-standard'], { opcional: true }) ?? '')} archivos · EXPLORAR: ${explorarDe(config)}`)
  console.log(`CRÍTICOS DEL PROYECTO: ${criticos.length ? `\n${criticos.join('\n')}` : 'ninguno'}`)
  console.log(`REGLAS DEL PROYECTO: ${reglas.length ? `\n${reglas.join('\n')}` : 'ninguna'}`)
  console.log(`VERIFICAR: ${pasos.length ? pasos.join(' → ') : 'detección automática de verificar.mjs'}`)
  console.log(`TAREAS ABIERTAS: ${abiertas.length ? abiertas.join(' · ') : 'ninguna'}`)
}

/** El contexto actual del orquestador; null sin transcript legible (nunca falla por eso). */
function contexto(base, sesion) {
  try {
    return contextoActual(RAIZ, base, sesion ? { sesion } : {})
  } catch {
    return null
  }
}

/** Anota el tamaño en la marca de la corrida abierta, para la guardia; sin marca (sin `--inicio`) no hace nada. */
function anotarTamano(tamano) {
  const marca = marcaDe(RAIZ)
  let datos
  try {
    datos = JSON.parse(fs.readFileSync(marca, 'utf8'))
  } catch {
    return
  }
  fs.writeFileSync(marca, JSON.stringify({ ...datos, tamano }) + '\n')
}

function plan(o) {
  if (!o.base) throw errorDePlan('falta la BASE: --base <ODD_BASE>')
  const lineas = lineasDePlan(o)
  exigirBase(o.base)
  anotarTamano(o.tamano)
  for (const l of lineas) console.log(l)
  console.log(lineaDeContexto(contexto(o.base)))
}

function diff(base, rutas) {
  exigirBase(base)
  console.log(lineaDeContexto(contexto(base)))
  const ahora = foto()
  const filtro = rutas.length ? ['--', ...rutas] : []
  const stat = git(['diff', '--stat', base, ahora, ...filtro]).trim()
  if (!stat) {
    console.log(`DIFF: sin cambios desde ${corto(base)}${rutas.length ? ` en ${rutas.join(', ')}` : ''}`)
    return
  }
  const { texto, sobran } = recortar(git(['diff', base, ahora, ...filtro]))
  console.log(stat)
  console.log('')
  console.log(texto)
  if (sobran) console.log(`\n… recortado: ${sobran} líneas más. Pide por ruta: --diff ${corto(base)} -- <ruta>`)
}

function cierre({ base, resultado, tamano, riesgo, revision, titulo }) {
  exigirBase(base)
  if (!/^(COMPLETO|DETENIDO)\b/.test(resultado ?? '')) throw new Error('--resultado tiene que ser COMPLETO o DETENIDO')
  const t = new Date().toISOString()
  const cambios = sumaNumstat(git(['diff', '--numstat', base, foto()]))
  let sesion = null
  let costo = null
  let proceso = null
  try {
    sesion = sesionDe(RAIZ, base)
    costo = sesion && costoDelFlujo(RAIZ, base, { hasta: t, sesion })
    proceso = sesion && lineaDeProceso(procesoDe(filasDe(sesion.archivo), { raiz: RAIZ, inicio: sesion.inicio, hasta: t, tamano, explorar: explorarDe(configDelProyecto()) }))
  } catch {
    // Sin transcripts legibles: la fila va sin costo ni proceso.
  }
  fs.rmSync(marcaDe(RAIZ), { force: true })
  const archivo = registroDe()
  fs.mkdirSync(path.dirname(archivo), { recursive: true })
  // Un --cierre repetido (tras arreglar un desvío) reemplaza la fila de la misma corrida.
  let previas = ''
  try {
    previas = fs.readFileSync(archivo, 'utf8')
  } catch {
    // Sin registro todavía.
  }
  const otras = previas.split('\n').filter((l) => {
    try {
      const f = JSON.parse(l)
      return !(f.base === base && f.raiz === RAIZ)
    } catch {
      return l.trim() !== ''
    }
  })
  const fila = JSON.stringify(filaDeCorrida({ t, raiz: RAIZ, base, resultado, tamano, riesgo, revision, titulo, proceso, costo, cambios, sesion: sesion?.archivo }))
  fs.writeFileSync(archivo, [...otras, fila].join('\n') + '\n')
  console.log(`CAMBIOS: ${cambios.archivos} archivo(s) · +${cambios.mas} −${cambios.menos}`)
  console.log(`COSTO: ${costo ? resumenDeCosto(costo) : 'sin datos (no encontré la sesión en los transcripts)'}`)
  console.log(`PROCESO: ${proceso ?? 'sin datos'}`)
  console.log(lineaDeContexto(sesion ? contexto(base, sesion) : null))
}

/** El costo hasta el siguiente mensaje del usuario, con el reporte incluido; null si no cambia o no hay datos. */
function costoReal(f) {
  if (!f.sesion || !f.costo?.inicio || !f.base) return null
  try {
    const fin = finDeCorrida(f.sesion, f.t)
    return fin > f.t ? costoDelFlujo(f.raiz, f.base, { hasta: fin, sesion: { archivo: f.sesion, inicio: f.costo.inicio } }) : null
  } catch {
    return null
  }
}

function ultimos(n) {
  let filas = []
  try {
    filas = fs.readFileSync(registroDe(), 'utf8').split('\n').filter((l) => l.trim()).flatMap((l) => {
      try {
        return [JSON.parse(l)]
      } catch {
        return []
      }
    })
  } catch {
    // Sin registro todavía.
  }
  if (!filas.length) {
    console.log(`CORRIDAS: ninguna anotada en ${registroDe()}`)
    return
  }
  const elegidas = filas.slice(-n).map((f) => ({ ...f, costoReal: costoReal(f) }))
  console.log(`CORRIDAS (últimas ${elegidas.length} de ${filas.length}):`)
  for (const f of elegidas) console.log(`  ${lineaDeCorrida(f)}`)
  const conCosto = elegidas.map((f) => f.costoReal ?? f.costo).filter(Boolean)
  if (conCosto.length) {
    const usd = conCosto.reduce((s, c) => s + c.usd, 0) / conCosto.length
    const minutos = conCosto.reduce((s, c) => s + c.minutos, 0) / conCosto.length
    console.log(`PROMEDIO: ${dolares(usd)} · ${minutos.toFixed(1).replace('.', ',')} min (${conCosto.length} con costo)`)
  }
}

/** Copia el árbol de la BASE en un temporal nuevo con un índice temporal: no toca el del usuario. */
function copiaBase(base) {
  exigirBase(base)
  const destino = fs.mkdtempSync(path.join(os.tmpdir(), 'qcc-odd-base-'))
  const indice = path.join(os.tmpdir(), `qcc-odd-indice-${process.pid}-${Date.now()}`)
  const env = { ...process.env, GIT_INDEX_FILE: indice }
  try {
    git(['read-tree', base], { env })
    git(['checkout-index', '-a', `--prefix=${destino.replaceAll('\\', '/')}/`], { env })
  } catch (e) {
    fs.rmSync(destino, { recursive: true, force: true })
    throw e
  } finally {
    fs.rmSync(indice, { force: true })
  }
  console.log(`ODD_COPIA=${destino.replaceAll('\\', '/')}`)
}

function limpiar(rutas) {
  if (!rutas.length) throw new Error('faltan las rutas: --limpiar -- <rutas>')
  let limpiados = 0
  const quedan = []
  for (const r of rutas) {
    const abs = path.resolve(RAIZ, rutaNativa(r))
    if (!enTemporal(abs)) quedan.push(`${r} (fuera del temporal)`)
    else if (!enTemporal(path.dirname(abs))) quedan.push(`${r} (es el temporal mismo)`)
    else if (fs.existsSync(abs)) {
      fs.rmSync(abs, { recursive: true, force: true })
      limpiados++
    }
  }
  console.log(`LIMPIADOS: ${limpiados}`)
  if (quedan.length) console.log(`NO BORRADOS: ${quedan.join(' · ')}`)
}

function main() {
  const o = opcionesDe(process.argv.slice(2))
  try {
    if (o.modo === 'inicio') inicio()
    else if (o.modo === 'plan') plan(o)
    else if (o.modo === 'diff') diff(o.base, o.rutas)
    else if (o.modo === 'cierre') cierre(o)
    else if (o.modo === 'ultimos') ultimos(o.ultimos)
    else if (o.modo === 'copia-base') copiaBase(o.base)
    else if (o.modo === 'limpiar') limpiar(o.rutas)
    else throw new Error('uso: odd.mjs --inicio | --plan --base <BASE> --tamano … --reglas <n> --riesgo "1:…;…;6:…" [--bordes "…"] | --diff <BASE> [-- <rutas>] | --cierre --base <BASE> --resultado … | --ultimos [<n>] | --copia-base <BASE> | --limpiar -- <rutas>')
  } catch (e) {
    console.log(`ERROR: ${e.message}`)
    process.exitCode = e.codigo ?? 1
  }
}

function esPrincipal() {
  if (!process.argv[1]) return false
  const a = path.resolve(process.argv[1])
  const b = fileURLToPath(import.meta.url)
  return WIN ? a.toLowerCase() === b.toLowerCase() : a === b
}

if (esPrincipal()) main()
