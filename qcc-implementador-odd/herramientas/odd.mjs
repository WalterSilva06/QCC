#!/usr/bin/env node
// Herramienta de /qcc-implementador-odd (nivel usuario: sirve para cualquier proyecto).
//
//   node <plugin>/herramientas/odd.mjs --inicio
//   node <plugin>/herramientas/odd.mjs --plan --base <BASE> --tamano chico|grande --reglas <n>
//        --riesgo "1:sí <motivo>;2:no;…;6:no" [--bordes "<borde> | <borde>"]
//   node <plugin>/herramientas/odd.mjs --previsto chico|grande
//   node <plugin>/herramientas/odd.mjs --diff <BASE> [--stat] [-- <rutas>]
//   node <plugin>/herramientas/odd.mjs --cierre --base <BASE> --resultado COMPLETO|DETENIDO --tamano chico|grande
//        --riesgo "<ítem N (motivo) | ninguno>" [--revision APROBADO|RECHAZADO|omitida] [--titulo "<t>"]
//   node <plugin>/herramientas/odd.mjs --cancelar
//   node <plugin>/herramientas/odd.mjs --ultimos [<n>]
//   node <plugin>/herramientas/odd.mjs --copia-base <BASE>
//   node <plugin>/herramientas/odd.mjs --diferencial [--base <BASE>] -- <comando>
//   node <plugin>/herramientas/odd.mjs --limpiar -- <rutas>
//
// --inicio: toma una foto del árbol (versionados + nuevos no ignorados) como commit suelto, que es la BASE, y la
// imprime como `ODD_BASE=<sha>`: con esa marca costo.mjs encuentra la sesión. Además: rama, sucios previos,
// archivos de código y `explorar`, `criticos`, reglas de la guardia y pasos de `verificar` de `.claude/qcc-implementador-odd.json`, y los
// `odd/tasks/*.md` con tareas abiertas. Deja la marca de corrida abierta (`registros/activas/`), que activa la guardia
// del orquestador; `--cierre` o `--cancelar` la borra.
// --plan: el cierre de la exploración, visible: tamaño, los 6 ítems de riesgo (cada uno «sí <motivo>» o «no») y los
// bordes. Un ítem que falta, un «sí» sin motivo o un riesgo sin bordes salen con ERROR y código 2. Anota el tamaño en
// la marca de corrida: con `grande`, la guardia niega al orquestador editar fuera de `odd/tasks/`.
// --previsto: anota solo el tamaño (`chico` o `grande`) en la marca de corrida, sin base ni riesgo, para activar la guardia
// del tamaño antes de `--plan`; imprime `PREVISTO: <tamano>`. Sin marca (sin `--inicio`) no hace nada.
// --diff: el cambio desde la BASE contra una foto nueva (incluye archivos nuevos), con --stat y recortado a TOPE_DIFF líneas.
// Con --stat, solo el resumen: es el control tras un despacho, y no cuenta como el --diff del autochequeo.
// --cierre: anota una fila en `registros/odd.jsonl` con el costo y el control de proceso, e imprime CAMBIOS, COSTO y PROCESO.
// Si la config trae `aceptacion` (un comando, o `{ cmd, timeoutSeg? }`; 600 s por defecto), lo corre desde la raíz del repo y
// anota y imprime `ACEPTACIÓN: <pasan>/<total>` (su última línea `ACEPTACION: p/t`; si no, el resumen TAP; si no, el código de salida).
// En una grande con riesgo (`--riesgo` distinto de «ninguno»), PROCESO no exige el `--diff` entero: lo revisa el revisor.
// --plan, --diff y --cierre imprimen `CONTEXTO: <n>k`, el del último pedido del orquestador, leído del transcript.
// --cancelar: borra la marca de corrida abierta sin anotar nada en `registros/odd.jsonl`, para un pedido que no llegó a
// ser una corrida (vacío o solo de investigar); imprime `CANCELADA: …` y sale con código 0 haya o no marca.
// --ultimos: las últimas corridas anotadas (10 por defecto), con el promedio y el costo real (con el reporte).
// --copia-base: el árbol de la BASE en un temporal nuevo, para comparar contra él; imprime `ODD_COPIA=<ruta>`.
// --diferencial: corre el comando (lo que sigue a `--`) en una copia de la BASE y en el repo, cada uno con su `$ODD_DIF_DIR` y
// `CI=1`, y compara salida, errores y código de salida; imprime `DIFERENCIAL: <cmd> → igual` (código 0) o `→ DIFIERE` con las
// líneas que cambian (código 1). La BASE sale de `--base` o de la marca. Valida el comando con la guardia (rol ejecutor): sin
// comando, sin BASE o negado, sale con ERROR y código 2 sin ejecutar ni guardar nada. Guarda el comando en la marca
// (`diferenciales`) para que `verificar.mjs` lo repita.
// --limpiar: borra las rutas que están dentro de un temporal (no el temporal mismo); las demás quedan, con su motivo.
// Sin candado ni estado: lo que el flujo tiene que recordar va en la salida o en `odd/tasks/`.
// `ODD_REGISTROS` cambia la carpeta de registros (los tests la llevan a un temporal).

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { raizDe, rutaNativa, enTemporal, reglasDelProyecto, marcaDe, anotarMarca, corridaAbierta, motivoComando, registrosDe } from './guardia.mjs'
import { copiaBase, diferencial } from './copia.mjs'
import { correrPaso } from './verificar.mjs'
import { costoDelFlujo, contextoActual, finDeCorrida, filasDe, sesionDe, resumenDeCosto, resumenDeTokens, dolares, miles } from './costo.mjs'
import { procesoDe, lineaDeProceso, TOPE_CONTEXTO } from './proceso.mjs'

const WIN = process.platform === 'win32'
const RAIZ = raizDe(process.env.CLAUDE_PROJECT_DIR || process.cwd())
const TOPE_DIFF = 400
const TOPE_SUCIOS = 10
const CONFIG = '.claude/qcc-implementador-odd.json'
const TAREAS = 'odd/tasks'
const REGLAS_CHICO = 8

const registroDe = () => path.join(registrosDe(), 'odd.jsonl')

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
 * Opciones de la línea de comandos: `modo` (inicio | plan | previsto | diff | cierre | cancelar | ultimos | copia-base | diferencial | limpiar), los valores
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
  const modo = ['cancelar', 'cierre', 'diff', 'inicio', 'plan', 'previsto', 'ultimos', 'copia-base', 'diferencial', 'limpiar'].find((m) => propias.includes(`--${m}`)) ?? null
  return {
    modo,
    base: modo === 'diff' || modo === 'copia-base' ? valor(`--${modo}`) : valor('--base'),
    resultado: valor('--resultado'),
    tamano: modo === 'previsto' ? valor('--previsto') : valor('--tamano'),
    reglas: valor('--reglas'),
    riesgo: valor('--riesgo'),
    bordes: valor('--bordes'),
    revision: valor('--revision'),
    titulo: valor('--titulo'),
    stat: propias.includes('--stat'),
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

/** El tamaño de `--plan` y `--previsto`: `chico` o `grande`; cualquier otro valor es un error de uso. */
function exigirTamano(tamano) {
  if (!['chico', 'grande'].includes(tamano)) throw errorDePlan('--tamano tiene que ser chico o grande')
}

/** Las líneas de `--previsto`: `PREVISTO: <tamano>` y, con `grande`, lo que limita la guardia. */
export function lineasDePrevisto({ tamano }) {
  exigirTamano(tamano)
  const lineas = [`PREVISTO: ${tamano}`]
  if (tamano === 'grande') lineas.push(`GRANDE: la guardia limita tu Read (limit ≤ 120 fuera de ${TAREAS}/) y tu Edit/Write (solo ${TAREAS}/)`)
  return lineas
}

/** Las líneas de `--plan` (sin CONTEXTO): AVISO si las reglas piden `grande`, TAMAÑO, RIESGO PREVISTO y BORDES. */
export function lineasDePlan({ tamano, reglas, riesgo, bordes }) {
  exigirTamano(tamano)
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
 * PROCESO; `aceptacion`, `{ pasan, total }` (solo si la config lo pide); `sesion`, el transcript, para recalcular el costo real en `--ultimos`.
 */
export function filaDeCorrida({ t, raiz, base, resultado, tamano, riesgo, revision, titulo, proceso, costo = null, cambios, aceptacion, sesion } = {}) {
  return sinNulos({ v: 1, t, raiz, base, titulo, resultado, tamano, riesgo, revision, proceso, cambios, aceptacion, costo, sesion })
}

/** Una línea del listado `--ultimos`. Con `costoReal` (calculado al listar), el costo es ese, junto al del cierre. */
export function lineaDeCorrida(f) {
  const fecha = String(f.t ?? '').slice(0, 16).replace('T', ' ')
  const repo = String(f.raiz ?? '?').split(/[\\/]/).filter(Boolean).pop() ?? '?'
  const c = f.costoReal ?? f.costo
  const informes = c?.hallazgos?.revisor ?? []
  const hallazgos = informes.length ? `hallazgos ${informes.map((h) => `${h.problemas}p/${h.observaciones}o`).join(' → ')}` : null
  const datos = [f.tamano, f.riesgo && `Riesgo: ${f.riesgo}`, f.revision && `revisión ${f.revision}`, hallazgos, f.proceso && `PROCESO: ${f.proceso}`, Number.isFinite(f.aceptacion?.pasan) && Number.isFinite(f.aceptacion?.total) && `aceptación ${f.aceptacion.pasan}/${f.aceptacion.total}`, f.resultado, f.cambios && `+${f.cambios.mas} −${f.cambios.menos}`].filter(Boolean)
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
  // La marca de corrida abierta: con ella la guardia del orquestador se activa; --cierre o --cancelar la borran.
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
  anotarMarca(RAIZ, { tamano })
}

function plan(o) {
  if (!o.base) throw errorDePlan('falta la BASE: --base <ODD_BASE>')
  const lineas = lineasDePlan(o)
  exigirBase(o.base)
  anotarTamano(o.tamano)
  for (const l of lineas) console.log(l)
  console.log(lineaDeContexto(contexto(o.base)))
}

/** `--previsto`: anota el tamaño en la marca apenas se sabe, antes de `--plan`, para que la guardia lo aplique ya. */
function previsto(o) {
  const lineas = lineasDePrevisto(o)
  anotarTamano(o.tamano)
  for (const l of lineas) console.log(l)
}

/** `soloStat`: solo el `--stat`, para el control tras un despacho, sin cargar el diff entero en el contexto. */
function diff(base, rutas, soloStat = false) {
  exigirBase(base)
  console.log(lineaDeContexto(contexto(base)))
  const ahora = foto()
  const filtro = rutas.length ? ['--', ...rutas] : []
  const stat = git(['diff', '--stat', base, ahora, ...filtro]).trim()
  if (!stat) {
    console.log(`DIFF: sin cambios desde ${corto(base)}${rutas.length ? ` en ${rutas.join(', ')}` : ''}`)
    return
  }
  console.log(stat)
  if (soloStat) return
  const { texto, sobran } = recortar(git(['diff', base, ahora, ...filtro]))
  console.log('')
  console.log(texto)
  if (sobran) console.log(`\n… recortado: ${sobran} líneas más. Pide por ruta: --diff ${corto(base)} -- <ruta>`)
}

const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]/g

/** El comando de `aceptacion` de la config y su tope: `{ cmd, timeoutSeg }`; null si no la pide o es de otro tipo. */
function aceptacionDe(config) {
  const a = config?.aceptacion
  const cmd = typeof a === 'string' ? a : a && typeof a === 'object' && !Array.isArray(a) ? a.cmd : null
  if (typeof cmd !== 'string' || !cmd.trim()) return null
  const tope = typeof a === 'object' ? Number(a.timeoutSeg) : 0
  return { cmd, timeoutSeg: tope > 0 ? tope : 600 }
}

/**
 * `{ pasan, total }` de una corrida de aceptación: la última línea `ACEPTACION: p/t`; si no, el resumen TAP (`# pass N` y
 * `# fail M`); si no, el código de salida (0 → 1/1; otro o vencido → 0/1).
 */
function resultadoDeAceptacion({ codigo, salida, vencido }) {
  const texto = String(salida ?? '').replace(ANSI, '')
  const lineas = [...texto.matchAll(/^\s*ACEPTACI[OÓ]N:\s*(\d+)\s*\/\s*(\d+)\s*$/gim)]
  if (lineas.length) return { pasan: Number(lineas.at(-1)[1]), total: Number(lineas.at(-1)[2]) }
  const pass = [...texto.matchAll(/^#\s*pass\s+(\d+)\s*$/gm)].at(-1)
  const fail = [...texto.matchAll(/^#\s*fail\s+(\d+)\s*$/gm)].at(-1)
  if (pass && fail) return { pasan: Number(pass[1]), total: Number(pass[1]) + Number(fail[1]) }
  return !vencido && codigo === 0 ? { pasan: 1, total: 1 } : { pasan: 0, total: 1 }
}

async function cierre({ base, resultado, tamano, riesgo, revision, titulo }) {
  exigirBase(base)
  if (!/^(COMPLETO|DETENIDO)\b/.test(resultado ?? '')) throw new Error('--resultado tiene que ser COMPLETO o DETENIDO')
  const t = new Date().toISOString()
  const cambios = sumaNumstat(git(['diff', '--numstat', base, foto()]))
  const config = configDelProyecto()
  let sesion = null
  let costo = null
  let proceso = null
  try {
    sesion = sesionDe(RAIZ, base)
    costo = sesion && costoDelFlujo(RAIZ, base, { hasta: t, sesion })
    proceso = sesion && lineaDeProceso(procesoDe(filasDe(sesion.archivo), { raiz: RAIZ, inicio: sesion.inicio, hasta: t, tamano, riesgo, explorar: explorarDe(config) }))
  } catch {
    // Sin transcripts legibles: la fila va sin costo ni proceso.
  }
  fs.rmSync(marcaDe(RAIZ), { force: true })
  // La aceptación solo corre si la config la pide.
  const pedida = aceptacionDe(config)
  const aceptacion = pedida ? resultadoDeAceptacion(await correrPaso(pedida, RAIZ)) : undefined
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
  const fila = JSON.stringify(filaDeCorrida({ t, raiz: RAIZ, base, resultado, tamano, riesgo, revision, titulo, proceso, costo, cambios, aceptacion, sesion: sesion?.archivo }))
  fs.writeFileSync(archivo, [...otras, fila].join('\n') + '\n')
  console.log(`CAMBIOS: ${cambios.archivos} archivo(s) · +${cambios.mas} −${cambios.menos}`)
  console.log(`COSTO: ${costo ? resumenDeCosto(costo) : 'sin datos (no encontré la sesión en los transcripts)'}`)
  console.log(`PROCESO: ${proceso ?? 'sin datos'}`)
  if (aceptacion) console.log(`ACEPTACIÓN: ${aceptacion.pasan}/${aceptacion.total}`)
  console.log(lineaDeContexto(sesion ? contexto(base, sesion) : null))
}

/** `--cancelar`: borra la marca de corrida abierta sin tocar el registro de corridas. */
function cancelar() {
  const marca = marcaDe(RAIZ)
  const habia = fs.existsSync(marca)
  fs.rmSync(marca, { force: true })
  console.log(habia ? 'CANCELADA: corrida cerrada sin anotar' : 'CANCELADA: no había corrida abierta')
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

/** `--copia-base`: el árbol de la BASE en un temporal nuevo (lo hace copia.mjs); imprime su ruta. */
function copiaDeBase(base) {
  console.log(`ODD_COPIA=${copiaBase(RAIZ, base).replaceAll('\\', '/')}`)
}

/**
 * `--diferencial`: corre el comando en la copia de la BASE y en el repo y los compara. Sin comando, sin BASE o con el comando
 * negado por la guardia, no ejecuta ni guarda nada (código 2). Guarda el comando en la marca, sin repetidos.
 */
async function diferencialDe(o) {
  const cmd = o.rutas.join(' ').trim()
  if (!cmd) throw errorDePlan('--diferencial: falta el comando (--diferencial -- <comando>)')
  let marca = null
  try {
    // Una marca de más de 12 h cuenta como sin marca: ni aporta la BASE ni se reescribe.
    if (corridaAbierta(RAIZ)) marca = JSON.parse(fs.readFileSync(marcaDe(RAIZ), 'utf8'))
  } catch {
    // Sin marca: la BASE tiene que venir en --base.
  }
  const base = o.base ?? (typeof marca?.base === 'string' ? marca.base : undefined)
  if (!base) throw errorDePlan('--diferencial: falta la BASE (--base <ODD_BASE> o una corrida abierta con --inicio)')
  const motivo = motivoComando(cmd, { rol: 'ejecutor', raiz: RAIZ })
  if (motivo) throw errorDePlan(`Guardia /qcc-implementador-odd: ${motivo}`)
  const r = await diferencial(RAIZ, base, cmd)
  for (const l of r.lineas) console.log(l)
  const previos = Array.isArray(marca?.diferenciales) ? marca.diferenciales.filter((c) => typeof c === 'string') : []
  if (marca) anotarMarca(RAIZ, { diferenciales: [...new Set([...previos, cmd])] })
  if (!r.igual) process.exitCode = 1
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

async function main() {
  const o = opcionesDe(process.argv.slice(2))
  try {
    if (o.modo === 'inicio') inicio()
    else if (o.modo === 'plan') plan(o)
    else if (o.modo === 'previsto') previsto(o)
    else if (o.modo === 'diff') diff(o.base, o.rutas, o.stat)
    else if (o.modo === 'cierre') await cierre(o)
    else if (o.modo === 'cancelar') cancelar()
    else if (o.modo === 'ultimos') ultimos(o.ultimos)
    else if (o.modo === 'copia-base') copiaDeBase(o.base)
    else if (o.modo === 'diferencial') await diferencialDe(o)
    else if (o.modo === 'limpiar') limpiar(o.rutas)
    else throw new Error('uso: odd.mjs --inicio | --plan --base <BASE> --tamano … --reglas <n> --riesgo "1:…;…;6:…" [--bordes "…"] | --previsto chico|grande | --diff <BASE> [--stat] [-- <rutas>] | --cierre --base <BASE> --resultado … | --cancelar | --ultimos [<n>] | --copia-base <BASE> | --diferencial [--base <BASE>] -- <comando> | --limpiar -- <rutas>')
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
