#!/usr/bin/env node
// /impl-l: tareas largas por fases (ver FLUJOS.md#impl-l). La sesión de /impl-l planifica y escribe `fases.md`; este
// script corre cada fase en su propia sesión `claude -p "/impl-l:fase -p"` (contexto limpio), espera el reinicio del
// límite de 5 h y retoma la sesión, reintenta una vez la fase DETENIDA, salta lo que depende de una fase fallida y cierra
// con una sesión de integración y una fila en `registros/impl-l.jsonl`. Coordinar no gasta tokens: lo hace este script.
//
//   largo.mjs --plan [--forzar]      lo que inyecta /impl-l: CARPETA, BASE, MAPA, VERIFICAR, REGLAS, MEMORIA y la corrida
//                                    anterior (sin terminar: AVISO; terminada o con --forzar: la archiva en historial/)
//   largo.mjs --validar              revisa <CARPETA>/fases.md: el resumen, o ERRORES con exit 1
//   largo.mjs --aprobar              valida y deja la corrida lista para --correr (anota la BASE)
//   largo.mjs --fase [<id> | final]  lo que inyecta /impl-l:fase: la fase en curso, sus traspasos y la verificación
//   largo.mjs --correr [--sin-final] corre lo pendiente, la integración y anota la corrida
//   largo.mjs --todo "<pedido>"      planifica con `claude -p "/impl-l -p <pedido>"` y, si quedó aprobado, --correr
//   largo.mjs --estado               una línea por fase
//   largo.mjs --arbol | --diff <árbol> [args]
//
// Las funciones de git, MAPA, VERIFICAR, REGLAS y MEMORIA son copia de qcc-impl-directo/herramientas/corrida.mjs:
// cada plugin se instala por separado.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const SCRIPT = fileURLToPath(import.meta.url)
const ARBOL_VACIO = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'
/** Líneas por explorador con las que se parte el MAPA. */
export const LINEAS_POR_EXPLORADOR = 2000
const TOPE_MAPA = 60
/** Desde este % de la ventana de 5 h no se empieza una sesión: se espera el reinicio. Una fase gasta 5–30 %. */
export const MARGEN_5H = 85
/** Cortes sin cierre ni límite que se retoman antes de dar la sesión por cortada. */
export const MAX_CORTES = 3
const TOPE_SESION_MS = Number(process.env.QCC_LARGO_TOPE_MIN || 240) * 60e3
const SONDEO_MS = 10 * 60e3
const MARGEN_MS = 2 * 60e3
const PAUSA_CORTE_MS = Number(process.env.QCC_LARGO_PAUSA_MS ?? 60e3)
const RETOMAR = 'La sesión se cortó o se detuvo por el límite de uso, que ya se renovó. Sigue el flujo donde quedó, sin preguntas, y termina con su bloque de cierre.'
const MODELO_FASE = ['--model', 'opus', '--effort', 'medium']
const MODELO_PLAN = ['--model', 'opus', '--effort', 'medium']
/** Desde cuántas fases corre la sesión de integración: cada sesión cuesta ~5 % fijo de la ventana de 5 h. */
export const INTEGRACION_DESDE = 3
export const conIntegracion = (plan) => plan.fases.length >= INTEGRACION_DESDE
/** Estados de una fase que cuentan como hecha para las que dependen de ella. */
const HECHA = new Set(['completo', 'incompleto'])
export const hecha = (estado) => HECHA.has(estado)

const configDe = () => process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')
/** Los registros compartidos entre cuentas, los mismos de /impl (`FLUJOS_REGISTROS` lo cambia). */
const rutaRegistros = () => process.env.FLUJOS_REGISTROS || path.join(os.homedir(), '.claude', 'flujos', 'registros')
const carpetaProyecto = (cwd) => path.join(configDe(), 'projects', path.resolve(cwd).replace(/[^a-zA-Z0-9]/g, '-'))
const git = (cwd, args, env = process.env) => execFileSync('git', args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 256 * 1024 * 1024 }).trim()

/** Raíz del repo de `cwd`, o `null` fuera de git. */
export function raizDe(cwd = process.cwd()) {
  try {
    return git(cwd, ['rev-parse', '--show-toplevel'])
  } catch {
    return null
  }
}

/** `<git-dir>/qcc-impl/largo`: una por repo y por worktree, fuera del árbol de trabajo. */
export function carpetaDe(cwd = process.cwd()) {
  return path.join(path.resolve(cwd, git(cwd, ['rev-parse', '--git-dir'])), 'qcc-impl', 'largo')
}

/** Árbol git del estado actual, con los archivos sin seguimiento que `.gitignore` no excluye; no toca el índice real. */
export function arbolActual(cwd = process.cwd()) {
  let copia
  try {
    const indice = path.resolve(cwd, git(cwd, ['rev-parse', '--git-path', 'index']))
    copia = path.join(os.tmpdir(), `qcc-impl-l-indice-${process.pid}-${Date.now()}`)
    if (fs.existsSync(indice)) fs.copyFileSync(indice, copia)
    const env = { ...process.env, GIT_INDEX_FILE: copia }
    git(cwd, ['add', '-A'], env)
    return git(cwd, ['write-tree'], env)
  } catch {
    return null
  } finally {
    if (copia) fs.rmSync(copia, { force: true })
  }
}

/** Las líneas del MAPA a partir de `[{ ruta, lineas }]` (copia de corrida.mjs). */
export function mapa(filas, tope = LINEAS_POR_EXPLORADOR) {
  const nuevo = () => ({ lineas: 0, hijos: new Map(), archivos: [] })
  const raiz = nuevo()
  for (const { ruta, lineas } of filas) {
    if (!(lineas > 0)) continue
    const partes = ruta.split('/')
    let nodo = raiz
    nodo.lineas += lineas
    for (const p of partes.slice(0, -1)) {
      if (!nodo.hijos.has(p)) nodo.hijos.set(p, nuevo())
      nodo = nodo.hijos.get(p)
      nodo.lineas += lineas
    }
    nodo.archivos.push({ nombre: partes.at(-1), lineas })
  }
  const grandes = (archivos) => {
    const g = archivos.filter((a) => a.lineas >= 300).sort((a, b) => b.lineas - a.lineas).slice(0, 5)
    return g.length ? `; ${g.map((a) => `${a.nombre} ${a.lineas}`).join(', ')}` : ''
  }
  const salida = []
  const emitir = (nodo, prefijo) => {
    const nombre = prefijo || './'
    if (nodo.lineas <= tope || nodo.hijos.size === 0) {
      const todos = []
      const juntar = (n) => {
        todos.push(...n.archivos)
        for (const h of n.hijos.values()) juntar(h)
      }
      juntar(nodo)
      salida.push(`- ${nombre} — ${nodo.lineas} (${todos.length} archivos${nodo.lineas > tope ? grandes(todos) : ''})`)
      return
    }
    const sueltos = nodo.archivos.reduce((s, a) => s + a.lineas, 0)
    if (sueltos) salida.push(`- ${nombre}* — ${sueltos} (${nodo.archivos.length} archivos sueltos${sueltos > tope ? grandes(nodo.archivos) : ''})`)
    for (const [n, h] of [...nodo.hijos].sort(([a], [b]) => a.localeCompare(b))) emitir(h, `${prefijo}${n}/`)
  }
  if (raiz.lineas) emitir(raiz, '')
  const cabeza = `MAPA: ${raiz.lineas} líneas de texto (versionadas y sin commit, sin lockfiles), ~${tope} por explorador:`
  if (salida.length > TOPE_MAPA) return [cabeza, ...salida.slice(0, TOPE_MAPA), `- … ${salida.length - TOPE_MAPA} carpetas más`]
  return [cabeza, ...salida]
}

function filasDe(cwd, base) {
  return git(cwd, ['diff', '--numstat', ARBOL_VACIO, base, '--', '.', ':!*lock*'])
    .split('\n')
    .map((l) => l.split('\t'))
    .filter((c) => c.length >= 3 && /^\d+$/.test(c[0]))
    .map(([n, , ruta]) => ({ ruta, lineas: Number(n) }))
}

/** Las líneas de VERIFICAR, de `.claude/qcc-implementador.json` (respaldo `.claude/implementador.json`). */
export function verificacionDe(raiz) {
  for (const nombre of ['qcc-implementador.json', 'implementador.json']) {
    const archivo = path.join(raiz, '.claude', nombre)
    if (!fs.existsSync(archivo)) continue
    let pasos
    try {
      pasos = JSON.parse(fs.readFileSync(archivo, 'utf8')).verificar
    } catch (e) {
      return [`VERIFICAR: .claude/${nombre} roto (${e.message}): los del CLAUDE.md o AGENTS.md`]
    }
    if (!Array.isArray(pasos) || !pasos.length) return [`VERIFICAR: .claude/${nombre} sin pasos en «verificar»`]
    return [`VERIFICAR (.claude/${nombre}):`, ...pasos.map((p) => `- ${p.nombre ?? 'paso'}: \`${p.cmd}\`${p.rutas?.length ? ` · solo si toca ${p.rutas.join(', ')}` : ''}${p.paralelo ? ' · paralelo' : ''}`)]
  }
  return ['VERIFICAR: sin .claude/qcc-implementador.json: los del CLAUDE.md o AGENTS.md']
}

/** La línea REGLAS: el archivo único para todos, o los de la carpeta por rol (sesión, explorador, revisor). */
export function reglasDe(raiz) {
  for (const base of ['qcc-implementador', 'implementador']) {
    if (fs.existsSync(path.join(raiz, '.claude', `${base}.md`))) return `REGLAS: .claude/${base}.md (para todos)`
    const carpeta = path.join(raiz, '.claude', base)
    if (!fs.existsSync(carpeta)) continue
    const de = (...nombres) => nombres.filter((n) => fs.existsSync(path.join(carpeta, n))).map((n) => `.claude/${base}/${n}`).join(', ') || 'ninguna'
    return `REGLAS: sesión ${de('planificar.md', 'ejecutor.md')} · explorador ${de('buscar.md')} · revisor ${de('revisor.md')}`
  }
  return 'REGLAS: ninguna'
}

/** El índice de la memoria del proyecto (`projects/<proyecto>/memory/MEMORY.md`), o `null`. */
export function memoriaDe(cwd) {
  const archivo = path.join(carpetaProyecto(cwd), 'memory', 'MEMORY.md')
  return fs.existsSync(archivo) ? archivo : null
}

const campo = (texto, nombre) => texto.match(new RegExp(`^${nombre}:[ \\t]*(.*)$`, 'mi'))?.[1].trim() ?? ''

/** Las viñetas `- …` que siguen a la línea `<nombre>:`, hasta la primera línea que no sea viñeta ni su continuación. */
function listaDe(texto, nombre) {
  const lineas = texto.split('\n')
  const i = lineas.findIndex((l) => new RegExp(`^${nombre}:\\s*$`, 'i').test(l.trim()))
  if (i < 0) return []
  const items = []
  for (const l of lineas.slice(i + 1)) {
    if (/^\s*-\s+\S/.test(l)) items.push(l.replace(/^\s*-\s+/, '').trim())
    else if (/^\s{2,}\S/.test(l) && items.length) items[items.length - 1] += ` ${l.trim()}`
    else break
  }
  return items
}

/**
 * El plan de `fases.md`: `{ titulo, pedido, globales, fases: [{ id, titulo, texto, depende, area, criterios }] }`.
 * Cada fase empieza en `## F<n> · <título>` y lleva `Depende de:`, `Área:`, `Objetivo:` y `Criterios:` con viñetas.
 */
export function parsearFases(md) {
  const cabezas = [...md.matchAll(/^##\s+(F\d+)\s*·\s*(.+?)\s*$/gm)]
  const antes = md.slice(0, cabezas[0]?.index ?? md.length)
  const fases = cabezas.map((c, i) => {
    const texto = md.slice(c.index, cabezas[i + 1]?.index ?? md.length).trim()
    const dep = campo(texto, 'Depende de').replace(/[.—-]+$/, '').trim()
    return {
      id: c[1],
      titulo: c[2],
      texto,
      depende: !dep || /^ningun[ao]$/i.test(dep) ? [] : dep.split(/[,\s]+/).filter(Boolean),
      area: campo(texto, 'Área'),
      criterios: listaDe(texto, 'Criterios'),
    }
  })
  return { titulo: antes.match(/^#\s+(.+?)\s*$/m)?.[1] ?? '', pedido: campo(antes, 'PEDIDO'), globales: listaDe(antes, 'Criterios globales'), fases }
}

/** Los errores del plan, vacío si sirve. */
export function validarPlan(plan) {
  const errores = []
  if (!plan.pedido) errores.push('falta la línea «PEDIDO: <literal>» antes de la primera fase')
  if (!plan.fases.length) errores.push('no hay fases: cada una empieza con «## F1 · <título>»')
  plan.fases.forEach((f, i) => {
    if (f.id !== `F${i + 1}`) errores.push(`${f.id}: las fases van F1, F2… en orden (esperaba F${i + 1})`)
    if (!f.area) errores.push(`${f.id}: falta «Área:»`)
    if (!f.criterios.length) errores.push(`${f.id}: falta «Criterios:» con al menos una viñeta`)
    for (const d of f.depende) if (!plan.fases.slice(0, i).some((p) => p.id === d)) errores.push(`${f.id}: «Depende de» nombra ${d}, que no es una fase anterior`)
  })
  return errores
}

/** Resumen del plan para la aprobación: una línea por fase. */
export function resumenPlan(plan) {
  return [
    `PLAN: ${plan.titulo || 's/título'} · ${plan.fases.length} fase(s) · ${plan.globales.length} criterio(s) global(es)`,
    ...plan.fases.map((f) => `${f.id} · ${f.titulo} · depende: ${f.depende.join(', ') || 'ninguna'} · ${f.criterios.length} criterio(s) · área: ${f.area}`),
  ]
}

/**
 * Cómo terminó una sesión, por sus eventos stream-json: `completo`, `incompleto` (COMPLETO sin verificar), `detenido`,
 * `limite` (con `resetsAt`, epoch en s) o `cortada`; `cierre` es el último texto con «Resultado: …».
 */
export function clasificar(eventos) {
  const textos = eventos.flatMap((e) =>
    e?.type === 'result' ? [e.result ?? ''] : e?.type === 'assistant' ? (e.message?.content ?? []).filter((c) => c.type === 'text').map((c) => c.text) : [])
  const cierre = textos.findLast((t) => /Resultado\W*(COMPLETO|DETENIDO)/.test(t))
  if (cierre) {
    const [linea, estado] = cierre.match(/Resultado\W*(COMPLETO|DETENIDO)[^\n]*/)
    if (estado === 'DETENIDO' && /l[ií]mite/i.test(linea)) return { estado: 'limite', resetsAt: ultimoLimite(eventos)?.resetsAt, cierre }
    if (estado === 'COMPLETO' && /sin verificar/i.test(linea)) return { estado: 'incompleto', cierre }
    return { estado: estado.toLowerCase(), cierre }
  }
  const rechazo = eventos.findLast((e) => e?.type === 'rate_limit_event' && e.rate_limit_info?.status === 'rejected')
  if (rechazo) return { estado: 'limite', resetsAt: rechazo.rate_limit_info.resetsAt }
  return { estado: 'cortada' }
}

const ultimoLimite = (eventos) => eventos.findLast((e) => e?.type === 'rate_limit_event')?.rate_limit_info

/** Cuánto esperar un límite: hasta `resetsAt` (epoch en s) más el margen, al menos 1 min; sin hora, `SONDEO_MS`. */
export const esperaMs = (resetsAt, ahora = Date.now()) => (resetsAt ? Math.max(resetsAt * 1000 - ahora + MARGEN_MS, 60e3) : SONDEO_MS)

/** La última lectura de los límites en los eventos: `{ five_hour: { pct, resetsAt }, seven_day: … }`, o `null`. */
export function lecturaDe(eventos) {
  for (let i = eventos.length - 1; i >= 0; i--) {
    const v = eventos[i]?.type === 'rate_limit_event' ? eventos[i].rate_limit_info?.unifiedWindows : null
    if (!v) continue
    const lectura = {}
    for (const k of ['five_hour', 'seven_day']) {
      if (Number.isFinite(v[k]?.utilization)) lectura[k] = { pct: Math.round(v[k].utilization * 1000) / 10, resetsAt: v[k].resetsAt }
    }
    if (Object.keys(lectura).length) return lectura
  }
  return null
}

/**
 * Lo que subió cada ventana entre dos lecturas: `{ five_hour: { gasto, incompleto? }, seven_day }`. Si la ventana se
 * reinició en medio (bajó el % o cambió la hora de reinicio), la cota mínima: el % final, con `incompleto`.
 */
export function gastoEntre(antes, despues) {
  const r = {}
  for (const k of ['five_hour', 'seven_day']) {
    const a = antes?.[k]
    const b = despues?.[k]
    if (!a || !b) {
      r[k] = { gasto: null }
      continue
    }
    const reinicio = b.pct < a.pct || (a.resetsAt && b.resetsAt && Math.abs(a.resetsAt - b.resetsAt) > 60)
    r[k] = reinicio ? { gasto: b.pct, incompleto: true } : { gasto: Math.round((b.pct - a.pct) * 10) / 10 }
  }
  return r
}

/** Suma de gastos: un `null` deja la suma incompleta, sin inventar ceros. */
export function sumarGastos(gastos) {
  const r = {}
  for (const k of ['five_hour', 'seven_day']) {
    const validos = gastos.map((g) => g?.[k]).filter((g) => g && g.gasto !== null)
    r[k] = validos.length ? { gasto: Math.round(validos.reduce((s, g) => s + g.gasto, 0) * 10) / 10 } : { gasto: null }
    if (validos.length && (validos.length < gastos.length || validos.some((g) => g.incompleto))) r[k].incompleto = true
  }
  return r
}

/** «5h +8 % · sem +1 %»: `≥+` si es cota mínima, `s/d` sin dato. */
export function textoGasto(g) {
  return [['5h', 'five_hour'], ['sem', 'seven_day']]
    .map(([n, k]) => (g?.[k]?.gasto === null || g?.[k]?.gasto === undefined ? `${n} s/d` : `${n} ${g[k].incompleto ? '≥' : ''}+${String(g[k].gasto).replace('.', ',')} %`))
    .join(' · ')
}

const modeloCorto = (m) => m.match(/opus|sonnet|haiku/)?.[0] ?? m

/** Consumo de una o varias sesiones por sus eventos `result`: USD de lista, turnos y tokens por modelo. */
export function consumoDe(eventos) {
  const r = { usd: 0, turnos: 0, modelos: {} }
  for (const e of eventos) {
    if (e?.type !== 'result') continue
    r.usd += e.total_cost_usd ?? 0
    r.turnos += e.num_turns ?? 0
    for (const [modelo, u] of Object.entries(e.modelUsage ?? {})) {
      const m = (r.modelos[modeloCorto(modelo)] ??= { entrada: 0, escritos: 0, leidos: 0, salida: 0, usd: 0 })
      m.entrada += u.inputTokens ?? 0
      m.escritos += u.cacheCreationInputTokens ?? 0
      m.leidos += u.cacheReadInputTokens ?? 0
      m.salida += u.outputTokens ?? 0
      m.usd += u.costUSD ?? 0
    }
  }
  r.usd = Math.round(r.usd * 1000) / 1000
  return r
}

/** Suma consumos de `consumoDe`. */
export function sumarConsumos(lista) {
  const r = { usd: 0, turnos: 0, modelos: {} }
  for (const c of lista.filter(Boolean)) {
    r.usd += c.usd
    r.turnos += c.turnos
    for (const [m, u] of Object.entries(c.modelos)) {
      const acc = (r.modelos[m] ??= { entrada: 0, escritos: 0, leidos: 0, salida: 0, usd: 0 })
      for (const k of Object.keys(acc)) acc[k] += u[k] ?? 0
    }
  }
  r.usd = Math.round(r.usd * 1000) / 1000
  return r
}

const ETIQUETAS_CIERRE = /^\W*(Resultado|Cambios|Verificación|Revisión|Criterios|Riesgos pendientes|Decisiones sin preguntar|Queda para ti|Traspaso)\W*:/i

/** Las líneas de la sección `<nombre>:` del bloque de cierre (también lo que va en la misma línea), hasta la siguiente. */
export function seccionDe(cierre, nombre, tope = 25) {
  const lineas = String(cierre ?? '').split('\n')
  const i = lineas.findIndex((l) => new RegExp(`^\\W*${nombre}\\W*:`, 'i').test(l))
  if (i < 0) return []
  const primera = lineas[i].replace(new RegExp(`^\\W*${nombre}\\W*:\\**\\s*`, 'i'), '').trim()
  const resto = []
  for (const l of lineas.slice(i + 1)) {
    if (ETIQUETAS_CIERRE.test(l) || /^```/.test(l.trim())) break
    if (l.trim()) resto.push(l.trimEnd())
  }
  return [primera, ...resto].map((l) => l.replace(/^\*+\s*|\s*\*+$/g, '')).filter(Boolean).slice(0, tope)
}

const leerJson = (archivo) => {
  try {
    return JSON.parse(fs.readFileSync(archivo, 'utf8'))
  } catch {
    return null
  }
}
const escribirJson = (archivo, dato) => {
  fs.mkdirSync(path.dirname(archivo), { recursive: true })
  fs.writeFileSync(`${archivo}.tmp`, JSON.stringify(dato, null, 2))
  fs.renameSync(`${archivo}.tmp`, archivo)
}

function version() {
  return leerJson(fileURLToPath(new URL('../.claude-plugin/plugin.json', import.meta.url)))?.version ?? 's/d'
}

/** Una línea por fase del estado: `F1 · título — completo · 12,3 min · 5h +8 % · …`. */
export function lineasEstado(plan, estado) {
  const linea = (id, titulo, e) => {
    if (!e) return `${id} · ${titulo} — pendiente`
    const partes = [e.estado ?? 'pendiente']
    if (e.motivo) partes.push(e.motivo)
    if (e.minutos) partes.push(`${String(e.minutos).replace('.', ',')} min`)
    if (e.limites) partes.push(textoGasto(e.limites))
    if (e.consumo) partes.push(`US$ ${e.consumo.usd.toFixed(2)}`)
    if (e.intentos?.length > 1) partes.push(`${e.intentos.length} intentos`)
    if (e.revision) partes.push(`revisión: ${e.revision}`)
    return `${id} · ${titulo} — ${partes.join(' · ')}`
  }
  const lineas = plan.fases.map((f) => linea(f.id, f.titulo, estado?.fases?.[f.id]))
  if (conIntegracion(plan)) lineas.push(linea('final', 'integración', estado?.final))
  return lineas
}

// ——— comandos ———

function plan(argv, cwd) {
  const raiz = raizDe(cwd)
  if (!raiz) {
    console.log('ERROR: /impl-l necesita un repo git')
    process.exitCode = 1
    return
  }
  const dir = carpetaDe(raiz)
  const estado = leerJson(path.join(dir, 'estado.json'))
  const lineas = []
  if (estado?.aprobado) {
    const { plan } = leerPlan(dir)
    const terminada = Boolean(estado.terminada)
    if (!terminada && !argv.includes('--forzar')) {
      lineas.push(`AVISO: hay una corrida sin terminar: ${plan?.titulo ?? estado.titulo} (aprobada ${estado.aprobado})`, ...(plan ? lineasEstado(plan, estado) : []).map((l) => `  ${l}`), `REANUDAR: node "${SCRIPT}" --correr`)
    } else {
      const destino = path.join(dir, 'historial', (estado.aprobado || new Date().toISOString()).replace(/[:.]/g, '-'))
      fs.mkdirSync(destino, { recursive: true })
      for (const f of fs.readdirSync(dir)) if (f !== 'historial') fs.renameSync(path.join(dir, f), path.join(destino, f))
      lineas.push(`ARCHIVADA: la corrida anterior (${terminada ? 'terminada' : 'sin terminar, con --forzar'}) quedó en ${destino}`)
    }
  }
  fs.mkdirSync(dir, { recursive: true })
  const base = arbolActual(raiz)
  let lineasMapa = ['MAPA: s/d']
  if (base) {
    try {
      lineasMapa = mapa(filasDe(raiz, base))
    } catch {}
  }
  const memoria = memoriaDe(raiz)
  console.log([
    `CARPETA: ${dir}`,
    `FASES: ${path.join(dir, 'fases.md')}`,
    `BASE: ${base ?? 's/d'}`,
    ...lineas,
    ...lineasMapa,
    ...verificacionDe(raiz),
    reglasDe(raiz),
    `MEMORIA: ${memoria ?? 'ninguna'}`,
  ].join('\n'))
}

function leerPlan(dir) {
  const archivo = path.join(dir, 'fases.md')
  if (!fs.existsSync(archivo)) return { errores: [`no existe ${archivo}`] }
  const p = parsearFases(fs.readFileSync(archivo, 'utf8'))
  return { plan: p, errores: validarPlan(p) }
}

function validar(cwd, aprobar = false) {
  const raiz = raizDe(cwd)
  const dir = carpetaDe(raiz)
  const { plan: p, errores } = leerPlan(dir)
  if (errores.length) {
    console.log(['ERRORES:', ...errores.map((e) => `- ${e}`)].join('\n'))
    process.exitCode = 1
    return
  }
  console.log(resumenPlan(p).join('\n'))
  if (!aprobar) return
  const estado = { v: 1, titulo: p.titulo, pedido: p.pedido, aprobado: new Date().toISOString(), base: arbolActual(raiz), raiz, fases: Object.fromEntries(p.fases.map((f) => [f.id, { estado: 'pendiente', intentos: [] }])), corridas: [] }
  escribirJson(path.join(dir, 'estado.json'), estado)
  console.log(`APROBADO: ${estado.aprobado} · BASE ${estado.base}`)
  console.log(`CORRER: node "${SCRIPT}" --correr`)
}

function fase(argv, cwd) {
  const raiz = raizDe(cwd)
  const dir = carpetaDe(raiz)
  const { plan: p, errores } = leerPlan(dir)
  const estado = leerJson(path.join(dir, 'estado.json'))
  if (errores.length || !estado) {
    console.log(`ERROR: no hay una corrida aprobada en ${dir}${errores.length ? ` (${errores.join('; ')})` : ''}`)
    process.exitCode = 1
    return
  }
  const id = argv[0] && !argv[0].startsWith('-') ? argv[0] : process.env.QCC_LARGO_FASE || estado.actual
  const traspasos = (ids) => ids.flatMap((i) => {
    const t = path.join(dir, `traspaso-${i}.md`)
    return fs.existsSync(t) ? [`- ${i} · ${p.fases.find((f) => f.id === i)?.titulo}:`, ...fs.readFileSync(t, 'utf8').trim().split('\n').map((l) => `  ${l}`)] : []
  })
  const comunes = () => [...verificacionDe(raiz), reglasDe(raiz), `MEMORIA: ${memoriaDe(raiz) ?? 'ninguna'}`]
  if (id === 'final') {
    const hechas = p.fases.filter((f) => hecha(estado.fases[f.id]?.estado)).map((f) => f.id)
    console.log([
      `CARPETA: ${dir}`,
      `PEDIDO: ${p.pedido}`,
      `FASE: final (integración de ${p.fases.length} fases)`,
      'FASES:',
      ...lineasEstado(p, estado).slice(0, -1).map((l) => `- ${l}`),
      'CRITERIOS GLOBALES:',
      ...(p.globales.length ? p.globales.map((c) => `- ${c}`) : ['- ninguno']),
      'TRASPASOS:',
      ...(traspasos(hechas).length ? traspasos(hechas) : ['- ninguno']),
      `BASE: ${estado.base}`,
      `DIFF: node "${SCRIPT}" --diff ${estado.base}`,
      ...comunes(),
    ].join('\n'))
    return
  }
  const f = p.fases.find((x) => x.id === id)
  if (!f) {
    console.log(`ERROR: no hay fase «${id ?? ''}» en ${path.join(dir, 'fases.md')}`)
    process.exitCode = 1
    return
  }
  const e = estado.fases[f.id] ?? {}
  const ahora = arbolActual(raiz)
  const base = e.antes ?? ahora
  const previas = p.fases.slice(0, p.fases.indexOf(f)).filter((x) => hecha(estado.fases[x.id]?.estado)).map((x) => x.id)
  let lineasMapa = []
  try {
    lineasMapa = mapa(filasDe(raiz, ahora))
  } catch {}
  console.log([
    `CARPETA: ${dir}`,
    `PEDIDO: ${p.pedido}`,
    `FASE: ${f.id} · ${f.titulo} (${p.fases.indexOf(f) + 1} de ${p.fases.length})`,
    '--- fase ---',
    f.texto,
    '--- fin de la fase ---',
    // Sin integración (menos de INTEGRACION_DESDE fases), la última fase revisa también los criterios globales.
    ...(!conIntegracion(p) && f === p.fases.at(-1) && p.globales.length ? ['CRITERIOS GLOBALES (también tuyos: es la última fase y no hay integración):', ...p.globales.map((c) => `- ${c}`)] : []),
    'TRASPASOS (fases anteriores ya hechas):',
    ...(traspasos(previas).length ? traspasos(previas) : ['- ninguno']),
    `REINTENTO: ${e.reintento ?? 'ninguno'}`,
    `BASE: ${base}`,
    `DIFF: node "${SCRIPT}" --diff ${base}`,
    ...lineasMapa,
    ...comunes(),
  ].join('\n'))
}

// ——— el driver ———

const dormir = (ms) => new Promise((r) => setTimeout(r, ms))
const hora = (d = new Date()) => d.toLocaleString('es-UY', { hour12: false })
/** Sin las variables de la sesión madre de Claude Code: `claude` no arranca anidado. */
const ENV = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(CLAUDECODE|CLAUDE_CODE_\w+|CLAUDE_PID|CLAUDE_EFFORT|AI_AGENT)$/.test(k)))

/** Corre `claude` (o el doble de `QCC_LARGO_CLAUDE`, para los tests) y junta los eventos stream-json. */
export function claude(args, { cwd, salida, log = () => {} } = {}) {
  const doble = process.env.QCC_LARGO_CLAUDE
  const [bin, pre] = doble ? [process.execPath, [doble]] : ['claude', []]
  return new Promise((resolve) => {
    const hijo = spawn(bin, [...pre, ...args, '--output-format', 'stream-json', '--verbose', '--dangerously-skip-permissions'], { cwd, env: ENV(), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    const eventos = []
    let resto = ''
    const tope = setTimeout(() => {
      log(`  sesión colgada más de ${TOPE_SESION_MS / 60e3} min: la corto`)
      hijo.kill()
    }, TOPE_SESION_MS)
    hijo.stdout.on('data', (d) => {
      if (salida) fs.appendFileSync(salida, d)
      const lineas = (resto + d).split('\n')
      resto = lineas.pop()
      for (const l of lineas) {
        try {
          eventos.push(JSON.parse(l))
        } catch {}
      }
    })
    hijo.stderr.on('data', (d) => salida && fs.appendFileSync(salida, d))
    hijo.on('error', (e) => log(`  no pude lanzar claude: ${e.message}`))
    hijo.on('close', (codigo) => {
      clearTimeout(tope)
      try {
        eventos.push(JSON.parse(resto))
      } catch {}
      resolve({ eventos, codigo })
    })
  })
}

/** ¿Hay uso disponible? Una pregunta mínima a Haiku: trae la lectura de los límites y, si la rechaza, la hora de reinicio. */
export async function sondear(cwd) {
  const { eventos } = await claude(['-p', 'responde solo: ok', '--model', 'haiku'], { cwd })
  const r = clasificar(eventos)
  const res = eventos.findLast((e) => e?.type === 'result')
  return { libre: r.estado !== 'limite' && Boolean(res) && !res.is_error, resetsAt: r.resetsAt, lectura: lecturaDe(eventos) }
}

/** Espera el reinicio del límite y sondea hasta que haya uso; devuelve la lectura nueva. */
async function esperarLimite(cwd, resetsAt, log) {
  for (;;) {
    const ms = esperaMs(resetsAt)
    log(`  límite de uso: espero ${Math.round(ms / 60e3)} min (hasta ${hora(new Date(Date.now() + ms))})`)
    await dormir(Number(process.env.QCC_LARGO_ESPERA_MS ?? ms))
    const s = await sondear(cwd)
    if (s.libre) {
      log('  hay uso de nuevo')
      return s.lectura
    }
    resetsAt = s.resetsAt
  }
}

/**
 * Una sesión hasta su cierre: espera y retoma (`--resume`) si la corta el límite, y retoma hasta `MAX_CORTES` veces
 * si se corta sin cierre. `{ estado, cierre, eventos, procesos }`. Con `sinBloque` (la sesión de plan, que no cierra
 * con «Resultado:»), un `result` sin error ya es el cierre.
 */
async function sesion({ cwd, pedido, modelo, prefijo, log, sinBloque = false }) {
  const id = randomUUID()
  let args = ['-p', pedido, '--session-id', id, ...modelo]
  const todos = []
  let cortes = 0
  for (let n = 1; ; n++) {
    const { eventos, codigo } = await claude(args, { cwd, salida: `${prefijo}-${n}.jsonl`, log })
    todos.push(...eventos)
    let r = clasificar(eventos)
    if (sinBloque && r.estado === 'cortada' && eventos.some((e) => e?.type === 'result' && !e.is_error)) r = { estado: 'completo' }
    args = ['-p', RETOMAR, '--resume', id, ...modelo]
    if (['completo', 'incompleto', 'detenido'].includes(r.estado)) return { ...r, eventos: todos, sesion: id, procesos: n }
    if (r.estado === 'cortada') {
      const s = await sondear(cwd) // un límite no siempre llega como rate_limit_event
      if (!s.libre) r = { estado: 'limite', resetsAt: s.resetsAt }
    }
    if (r.estado === 'limite') {
      todos.push({ type: 'qcc_lectura', lectura: await esperarLimite(cwd, r.resetsAt, log) })
      continue
    }
    if (++cortes >= MAX_CORTES) {
      log(`  se cortó ${cortes} veces sin cierre (código ${codigo}): la doy por cortada`)
      return { estado: 'cortada', eventos: todos, sesion: id, procesos: n }
    }
    log(`  sesión cortada sin cierre (código ${codigo}): la retomo`)
    await dormir(PAUSA_CORTE_MS)
  }
}

/**
 * Lo que gastó una sesión, encadenando lecturas: desde `antes` hasta la última lectura de sus eventos. Las esperas de
 * límite meten una lectura nueva (`qcc_lectura`) que abre otro tramo.
 */
export function gastoDeSesion(antes, eventos) {
  const tramos = []
  let desde = antes
  let tramo = []
  const cerrar = () => {
    const hasta = lecturaDe(tramo)
    if (hasta) {
      tramos.push(gastoEntre(desde, hasta))
      desde = hasta
    }
    tramo = []
  }
  for (const e of eventos) {
    if (e?.type === 'qcc_lectura') {
      cerrar()
      desde = e.lectura ?? desde
    } else tramo.push(e)
  }
  cerrar()
  return { gasto: tramos.length ? sumarGastos(tramos) : sumarGastos([null]), lectura: desde }
}

function bloquear(dir) {
  const candado = path.join(dir, 'correr.pid')
  const pid = Number(fs.existsSync(candado) ? fs.readFileSync(candado, 'utf8') : NaN)
  if (pid && pid !== process.pid) {
    try {
      process.kill(pid, 0)
      return `ya corre otro --correr en esta carpeta (pid ${pid})`
    } catch {}
  }
  fs.writeFileSync(candado, String(process.pid))
  process.on('exit', () => fs.rmSync(candado, { force: true }))
  return null
}

async function correr(argv, cwd, lecturaInicial) {
  const raiz = raizDe(cwd)
  const dir = carpetaDe(raiz)
  const archivoEstado = path.join(dir, 'estado.json')
  const estado = leerJson(archivoEstado)
  const { plan: p, errores } = leerPlan(dir)
  if (!estado?.aprobado || errores.length) {
    console.log(`ERROR: no hay una corrida aprobada en ${dir}; primero /impl-l`)
    process.exitCode = 1
    return
  }
  const ocupado = bloquear(dir)
  if (ocupado) {
    console.log(`ERROR: ${ocupado}`)
    process.exitCode = 1
    return
  }
  const logs = path.join(dir, 'logs')
  fs.mkdirSync(logs, { recursive: true })
  const log = (msg) => {
    const linea = `[${hora()}] ${msg}`
    console.log(linea)
    fs.appendFileSync(path.join(dir, 'largo.log'), linea + '\n')
  }
  const guardar = () => escribirJson(archivoEstado, estado)
  const inicio = new Date().toISOString()
  let lectura = lecturaInicial ?? (await sondear(raiz)).lectura
  const corrida = { inicio, antes: lectura }
  estado.corridas.push(corrida)
  estado.terminada = false
  guardar()
  log(`empieza la corrida «${p.titulo}» en ${raiz}`)

  /** Corre la fase `id` (o la integración) una vez; anota el intento y su gasto. */
  const intento = async (id, e) => {
    if (lectura?.five_hour?.pct >= MARGEN_5H) {
      log(`  5h en ${lectura.five_hour.pct} %: espero el reinicio antes de empezar`)
      lectura = await esperarLimite(raiz, lectura.five_hour.resetsAt, log)
    }
    estado.actual = id
    const t0 = Date.now()
    const n = e.intentos.length + 1
    e.intentos.push({ inicio: new Date(t0).toISOString() })
    guardar()
    const r = await sesion({ cwd: raiz, pedido: `/impl-l:fase -p ${id}`, modelo: MODELO_FASE, prefijo: path.join(logs, `${id}-i${n}`), log })
    const g = gastoDeSesion(lectura, r.eventos)
    lectura = g.lectura ?? lectura
    Object.assign(e.intentos.at(-1), { fin: new Date().toISOString(), sesion: r.sesion, procesos: r.procesos, estado: r.estado, minutos: Math.round((Date.now() - t0) / 600) / 100, limites: g.gasto, consumo: consumoDe(r.eventos) })
    if (r.cierre) fs.writeFileSync(path.join(dir, `cierre-${id}${n > 1 ? `-i${n}` : ''}.txt`), r.cierre)
    e.estado = r.estado
    e.revision = seccionDe(r.cierre, 'Revisión', 1)[0] ?? null
    e.minutos = Math.round(e.intentos.reduce((s, x) => s + (x.minutos ?? 0), 0) * 100) / 100
    e.limites = sumarGastos(e.intentos.map((x) => x.limites))
    e.consumo = sumarConsumos(e.intentos.map((x) => x.consumo))
    const traspaso = seccionDe(r.cierre, 'Traspaso', 20)
    if (traspaso.length && id !== 'final') fs.writeFileSync(path.join(dir, `traspaso-${id}.md`), traspaso.join('\n') + '\n')
    guardar()
    log(`${id}: ${r.estado.toUpperCase()} · ${e.intentos.at(-1).minutos} min · ${textoGasto(g.gasto)}${e.revision ? ` · revisión: ${e.revision}` : ''}`)
    return r
  }

  for (const f of p.fases) {
    const e = (estado.fases[f.id] ??= { estado: 'pendiente', intentos: [] })
    if (hecha(e.estado)) continue
    const falta = f.depende.filter((d) => !hecha(estado.fases[d]?.estado))
    if (falta.length) {
      Object.assign(e, { estado: 'salteada', motivo: `requiere ${falta.join(', ')}` })
      guardar()
      log(`${f.id}: salteada, requiere ${falta.join(', ')}, que no terminó`)
      continue
    }
    delete e.motivo
    e.antes ??= arbolActual(raiz)
    log(`${f.id} · ${f.titulo}: empieza`)
    let r = await intento(f.id, e)
    // Una fase DETENIDA (rechazada dos veces o en rojo) se reintenta una vez con su cierre: lo hecho sigue sin commit.
    if (r.estado === 'detenido') {
      e.reintento = path.join(dir, `cierre-${f.id}${e.intentos.length > 1 ? `-i${e.intentos.length}` : ''}.txt`)
      log(`${f.id}: reintento con el cierre anterior`)
      r = await intento(f.id, e)
    }
    const parche = execFileSync('git', ['diff', '--binary', e.antes, arbolActual(raiz)], { cwd: raiz, maxBuffer: 1 << 28 })
    fs.writeFileSync(path.join(dir, `${f.id}.patch`), parche)
    guardar()
  }

  const hechas = p.fases.filter((f) => hecha(estado.fases[f.id].estado))
  if (conIntegracion(p) && hechas.length && !argv.includes('--sin-final') && !hecha(estado.final?.estado)) {
    estado.final ??= { estado: 'pendiente', intentos: [] }
    log('final · integración: empieza')
    await intento('final', estado.final)
  }

  const s = await sondear(raiz)
  corrida.fin = new Date().toISOString()
  corrida.despues = s.lectura ?? lectura
  const todas = p.fases.every((f) => hecha(estado.fases[f.id].estado))
  const finalOk = !conIntegracion(p) || hecha(estado.final?.estado)
  estado.terminada = todas && finalOk
  const incompletas = p.fases.filter((f) => estado.fases[f.id].estado === 'incompleto').length + (estado.final?.estado === 'incompleto' ? 1 : 0)
  estado.resultado = estado.terminada ? (incompletas ? 'COMPLETO (sin verificar)' : 'COMPLETO') : `INCOMPLETO (${hechas.length} de ${p.fases.length} fases${conIntegracion(p) ? `, integración ${estado.final?.estado ?? 'sin correr'}` : ''})`
  delete estado.actual
  guardar()

  const sesiones = [estado.plan, ...p.fases.map((f) => estado.fases[f.id]), estado.final].filter(Boolean)
  const consumo = sumarConsumos(sesiones.map((x) => x.consumo))
  const limites = sumarGastos(sesiones.map((x) => x.limites).filter(Boolean))
  const minutos = Math.round(sesiones.reduce((s, x) => s + (x.minutos ?? 0), 0) * 100) / 100
  const resumen = [
    `CIERRE IMPL-L · ${p.titulo} — ${estado.resultado}`,
    ...(estado.plan ? [`plan — ${estado.plan.minutos} min · ${textoGasto(estado.plan.limites)} · US$ ${estado.plan.consumo?.usd.toFixed(2)}`] : []),
    ...lineasEstado(p, estado),
    `Total: ${String(minutos).replace('.', ',')} min de sesiones · ${textoGasto(limites)} · US$ ${consumo.usd.toFixed(2)} (lista)`,
    `Cambios desde la BASE: ${(() => {
      try {
        return git(raiz, ['diff', '--shortstat', estado.base, arbolActual(raiz)]) || 'ninguno'
      } catch {
        return 's/d'
      }
    })()}`,
    `Cierres, traspasos y parches: ${dir}`,
  ]
  fs.writeFileSync(path.join(dir, 'resumen.md'), resumen.join('\n') + '\n')
  log(resumen.join('\n'))
  try {
    const fila = { v: 1, t: corrida.fin, inicio: estado.aprobado, raiz, version: version(), titulo: p.titulo, pedido: p.pedido, resultado: estado.resultado, minutos, limites, consumo, plan: estado.plan ?? null, fases: p.fases.map((f) => ({ id: f.id, titulo: f.titulo, ...resumenFase(estado.fases[f.id]) })), final: estado.final ? resumenFase(estado.final) : null, corridas: estado.corridas.length }
    fs.mkdirSync(rutaRegistros(), { recursive: true })
    fs.appendFileSync(path.join(rutaRegistros(), 'impl-l.jsonl'), JSON.stringify(fila) + '\n')
  } catch (e) {
    log(`REGISTRO: no (${e.message})`)
  }
}

const resumenFase = (e) => ({ estado: e.estado, motivo: e.motivo, intentos: e.intentos?.length ?? 0, minutos: e.minutos, limites: e.limites, consumo: e.consumo, revision: e.revision })

async function todo(argv, cwd) {
  const pedido = argv.join(' ').trim()
  const raiz = raizDe(cwd)
  if (!pedido || !raiz) {
    console.log('uso: largo.mjs --todo "<pedido>" (desde un repo git)')
    process.exitCode = 2
    return
  }
  const dir = carpetaDe(raiz)
  fs.mkdirSync(path.join(dir, 'logs'), { recursive: true })
  const log = (msg) => console.log(`[${hora()}] ${msg}`)
  let lectura = (await sondear(raiz)).lectura
  if (lectura?.five_hour?.pct >= MARGEN_5H) lectura = await esperarLimite(raiz, lectura.five_hour.resetsAt, log)
  log('plan: empieza')
  const t0 = Date.now()
  const prefijo = path.join(os.tmpdir(), `qcc-impl-l-plan-${Date.now()}`)
  const r = await sesion({ cwd: raiz, pedido: `/impl-l -p ${pedido}`, modelo: MODELO_PLAN, prefijo, log, sinBloque: true })
  const g = gastoDeSesion(lectura, r.eventos)
  const estado = leerJson(path.join(dir, 'estado.json'))
  // La sesión de plan archiva la corrida anterior al empezar: sus logs se copian después.
  for (const f of fs.readdirSync(path.dirname(prefijo)).filter((x) => x.startsWith(path.basename(prefijo)))) {
    fs.mkdirSync(path.join(dir, 'logs'), { recursive: true })
    fs.renameSync(path.join(path.dirname(prefijo), f), path.join(dir, 'logs', f.replace(path.basename(prefijo), 'plan')))
  }
  if (!estado?.aprobado) {
    log(`plan: la sesión terminó sin una corrida aprobada (${r.estado})${r.cierre ? `\n${r.cierre}` : ''}`)
    process.exitCode = 1
    return
  }
  estado.plan = { estado: r.estado === 'cortada' ? 'cortada' : 'completo', minutos: Math.round((Date.now() - t0) / 600) / 100, limites: g.gasto, consumo: consumoDe(r.eventos), sesion: r.sesion }
  escribirJson(path.join(dir, 'estado.json'), estado)
  log(`plan: listo · ${estado.plan.minutos} min · ${textoGasto(g.gasto)}`)
  await correr([], raiz, g.lectura ?? lectura)
}

function verEstado(cwd) {
  const dir = carpetaDe(raizDe(cwd))
  const estado = leerJson(path.join(dir, 'estado.json'))
  const { plan: p, errores } = leerPlan(dir)
  if (errores.length) return console.log(`sin corrida: ${errores.join('; ')}`)
  console.log([`${p.titulo} — ${estado?.resultado ?? (estado?.aprobado ? 'aprobada' : 'sin aprobar')}`, ...lineasEstado(p, estado)].join('\n'))
}

async function main(argv) {
  const cwd = process.cwd()
  const [opcion, ...resto] = argv
  if (opcion === '--plan') plan(resto, cwd)
  else if (opcion === '--validar') validar(cwd)
  else if (opcion === '--aprobar') validar(cwd, true)
  else if (opcion === '--fase') fase(resto, cwd)
  else if (opcion === '--correr') await correr(resto, cwd)
  else if (opcion === '--todo') await todo(resto, cwd)
  else if (opcion === '--estado') verEstado(cwd)
  else if (opcion === '--arbol') console.log(arbolActual(cwd) ?? 's/d (no es un repo git)')
  else if (opcion === '--diff' && /^[0-9a-f]{7,64}$/.test(resto[0] ?? '')) {
    const ahora = arbolActual(cwd)
    if (!ahora) {
      console.error('no es un repo git')
      process.exitCode = 1
      return
    }
    process.stdout.write(execFileSync('git', ['diff', resto[0], ahora, ...resto.slice(1)], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 256 * 1024 * 1024 }))
  } else {
    console.error('uso: largo.mjs --plan [--forzar] | --validar | --aprobar | --fase [<id>|final] | --correr [--sin-final] | --todo "<pedido>" | --estado | --arbol | --diff <árbol> [args]')
    process.exitCode = 2
  }
}

if (process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === SCRIPT.toLowerCase()) await main(process.argv.slice(2))
