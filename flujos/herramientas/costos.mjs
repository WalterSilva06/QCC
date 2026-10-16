#!/usr/bin/env node
// Costo real de los flujos /implementador, leído de los transcripts de Claude Code.
//
//   node ~/.claude/flujos/costos.mjs [--ultimos <n>] [--archivo <flujos.jsonl>]
//
// Lista los últimos flujos anotados en `registros/flujos.jsonl` (10 por defecto): costo, minutos, pedidos del
// orquestador, costo por rol, Clasificación, subtareas y veredictos, con el promedio al final. estado.mjs usa
// `costoDelFlujo` en el cierre (`--cambios … --paso 7`) para anotar cada flujo.
//
// Precios por millón de tokens de la página oficial de Anthropic (octubre de 2026): entrada, salida, lectura de
// caché y escritura de caché de 5 min y de 1 h. El hilo principal de Claude Code escribe con 1 h; los subagentes, con 5 min.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { registroDe, RAIZ } from './guardia.mjs'

const WIN = process.platform === 'win32'
const PRECIOS = {
  'claude-opus-5-5': { entrada: 4, salida: 20, lectura: 0.2, escritura5m: 5, escritura1h: 8 },
  'claude-sonnet-5-5': { entrada: 2, salida: 10, lectura: 0.1, escritura5m: 2.5, escritura1h: 4 },
  'claude-haiku-5-5': { entrada: 0.1, salida: 0.5, lectura: 0.01, escritura5m: 0.125, escritura1h: 0.2 },
}
// Haiku 5.5 cobra más con prompts de más de 100.000 tokens.
const HAIKU_LARGO = { entrada: 0.5, salida: 2.5, lectura: 0.05, escritura5m: 0.625, escritura1h: 1 }

const proyectosDe = () => path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'projects')
const dolares = (n) => `$${n.toFixed(2).replace('.', ',')}`
const decimal = (n) => n.toFixed(1).replace('.', ',')
const textoDe = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((x) => (x?.type === 'text' ? x.text : '')).join('') : '')

/** Precio por millón del modelo (id con o sin sufijos), según el tamaño del prompt; null si no se conoce. */
export function precioDe(modelo, prompt = 0) {
  const clave = Object.keys(PRECIOS).find((k) => String(modelo ?? '').startsWith(k))
  if (!clave) return null
  return clave === 'claude-haiku-5-5' && prompt > 100_000 ? HAIKU_LARGO : PRECIOS[clave]
}

/** Costo en USD de un pedido según su `usage`; null si el modelo no tiene precio. */
export function costoDePedido(uso, modelo) {
  const u = uso ?? {}
  const prompt = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0)
  const p = precioDe(modelo, prompt)
  if (!p) return null
  const w1h = u.cache_creation?.ephemeral_1h_input_tokens ?? 0
  const w5m = u.cache_creation ? (u.cache_creation.ephemeral_5m_input_tokens ?? 0) : (u.cache_creation_input_tokens ?? 0)
  return ((u.input_tokens ?? 0) * p.entrada + (u.cache_read_input_tokens ?? 0) * p.lectura + w5m * p.escritura5m + w1h * p.escritura1h + (u.output_tokens ?? 0) * p.salida) / 1e6
}

function filasDe(archivo) {
  let texto
  try {
    texto = fs.readFileSync(archivo, 'utf8')
  } catch {
    return []
  }
  const filas = []
  for (const linea of texto.split('\n')) {
    if (!linea.trim()) continue
    try {
      filas.push(JSON.parse(linea))
    } catch {
      // Línea cortada: se ignora.
    }
  }
  return filas
}

/** Pedidos al modelo de esas filas de transcript, cada mensaje una vez y con su uso final: `{ pedidos, usd, sinPrecio }`. */
export function usoDe(filas) {
  const porMensaje = new Map()
  for (const f of filas) {
    const m = f?.type === 'assistant' ? f.message : null
    if (!m?.id) continue
    const previo = porMensaje.get(m.id)
    if (!previo || (m.usage?.output_tokens ?? 0) >= (previo.uso?.output_tokens ?? 0)) porMensaje.set(m.id, { uso: m.usage, modelo: m.model })
  }
  let usd = 0
  let sinPrecio = 0
  for (const { uso, modelo } of porMensaje.values()) {
    const c = costoDePedido(uso, modelo)
    if (c === null) sinPrecio++
    else usd += c
  }
  return { pedidos: porMensaje.size, usd, sinPrecio }
}

/** Qué línea de su informe trae el veredicto de cada rol; los demás (explorador, planificador) no dan uno. */
const VEREDICTO_POR_ROL = { 'revisor-plan': 'VEREDICTO', revisor: 'VEREDICTO', final: 'VEREDICTO', ejecutor: 'ESTADO' }

/** Veredicto del último informe del agente (`APROBADO`, `AJUSTAR`, `HECHO`…), de una línea que empieza con él; null si no trae. */
function veredictoDe(filas, rol) {
  const campo = VEREDICTO_POR_ROL[rol]
  if (!campo) return null
  const textos = filas.filter((f) => f?.type === 'assistant').flatMap((f) => (f.message?.content ?? []).filter((c) => c?.type === 'text').map((c) => c.text))
  return new RegExp(`^[\\s*_>\`-]*${campo}:\\s*\\**\\s*([A-ZÁÉÍÓÚ]+)`, 'm').exec(textos.at(-1) ?? '')?.[1] ?? null
}

/**
 * El transcript de la sesión del flujo de `raiz` que empezó cerca de `desde` (DESDE_GLOBAL), con la hora de su
 * `/implementador`. Con `base` (su BASE_GLOBAL), la sesión es la que la recibió de su preflight: así no se confunde
 * con otro flujo del mismo repo que empezó a la vez. Si no, la del `/implementador` más cercano; sin esa fila (la skill
 * se llamó de otro modo), la sesión más reciente desde `desde`. null si no hay.
 */
export function sesionDelFlujo(raiz, desde, proyectos = proyectosDe(), base = null) {
  const carpeta = path.join(proyectos, path.resolve(raiz).replace(/[^a-zA-Z0-9]/g, '-'))
  const limite = Date.parse(desde)
  let archivos = []
  try {
    archivos = fs.readdirSync(carpeta).filter((a) => a.endsWith('.jsonl')).map((a) => path.join(carpeta, a))
  } catch {
    return null
  }
  const recientes = archivos
    .map((archivo) => ({ archivo, mtime: fs.statSync(archivo).mtimeMs }))
    .filter((a) => a.mtime >= limite - 60_000)
    .sort((a, b) => b.mtime - a.mtime)
  const esComando = (f) => f?.type === 'user' && !f.isSidechain && f.timestamp && textoDe(f.message?.content).includes('<command-name>/implementador')
  if (base) {
    const marca = `BASE_GLOBAL=${base}`
    for (const { archivo } of recientes) {
      let texto = ''
      try {
        texto = fs.readFileSync(archivo, 'utf8')
      } catch {
        continue
      }
      if (!texto.includes(marca)) continue
      const filas = filasDe(archivo)
      const k = filas.findIndex((f) => JSON.stringify(f?.message?.content ?? '').includes(marca))
      const comando = filas.slice(0, Math.max(k, 0)).reverse().find(esComando)
      return { archivo, inicio: comando?.timestamp ?? filas[k]?.timestamp ?? new Date(limite).toISOString() }
    }
  }
  let mejor = null
  for (const { archivo } of recientes) {
    for (const f of filasDe(archivo)) {
      if (!esComando(f)) continue
      const t = Date.parse(f.timestamp)
      if (t <= limite + 60_000 && t >= limite - 30 * 60_000 && (!mejor || t > Date.parse(mejor.inicio))) mejor = { archivo, inicio: f.timestamp }
    }
  }
  return mejor ?? (recientes.length ? { archivo: recientes[0].archivo, inicio: new Date(limite).toISOString() } : null)
}

/**
 * Costo real del flujo de `raiz` que empezó en `desde` (con `base`, su BASE_GLOBAL), hasta `hasta`: el hilo principal
 * (orquestador) y cada subagente lanzado en ese tramo, por rol (`final` es la revisión final), con sus veredictos.
 * null si no se encuentra la sesión.
 */
export function costoDelFlujo(raiz, desde, { proyectos = proyectosDe(), hasta = new Date().toISOString(), base = null } = {}) {
  const sesion = sesionDelFlujo(raiz, desde, proyectos, base)
  if (!sesion) return null
  const enTramo = (t) => t && t >= sesion.inicio && t <= hasta
  const principal = filasDe(sesion.archivo).filter((f) => !f.isSidechain && enTramo(f.timestamp))
  const roles = { orquestador: { ...usoDe(principal), agentes: 0 } }
  const veredictos = {}
  const carpeta = path.join(path.dirname(sesion.archivo), path.basename(sesion.archivo, '.jsonl'), 'subagents')
  let agentes = []
  try {
    agentes = fs.readdirSync(carpeta).filter((a) => a.endsWith('.jsonl')).sort()
  } catch {
    // Sin subagentes.
  }
  for (const a of agentes) {
    const filas = filasDe(path.join(carpeta, a))
    if (!enTramo(filas.find((f) => f.timestamp)?.timestamp)) continue
    let tipo = '?'
    try {
      tipo = JSON.parse(fs.readFileSync(path.join(carpeta, a.replace(/\.jsonl$/, '.meta.json')), 'utf8')).agentType ?? '?'
    } catch {
      // Sin meta: rol desconocido.
    }
    const prompt = textoDe(filas.find((f) => f.type === 'user')?.message?.content)
    const rol = tipo === 'revisor' && /QUÉ REVISAR: cambio completo|YA REVISADO|EJECUTORES:/.test(prompt) ? 'final' : tipo
    const u = usoDe(filas)
    roles[rol] ??= { pedidos: 0, usd: 0, sinPrecio: 0, agentes: 0 }
    roles[rol].pedidos += u.pedidos
    roles[rol].usd += u.usd
    roles[rol].sinPrecio += u.sinPrecio
    roles[rol].agentes++
    const v = veredictoDe(filas, rol)
    if (v) (veredictos[rol] ??= []).push(v)
  }
  const usd = Object.values(roles).reduce((s, r) => s + r.usd, 0)
  return { inicio: sesion.inicio, minutos: Math.max(0, Date.parse(hasta) - Date.parse(sesion.inicio)) / 60_000, usd, roles, veredictos }
}

/** «$0,98 · 9,6 min · orquestador $0,39 (10 pedidos) · final $0,26 · …», con los roles de mayor a menor costo. */
export function resumenDeCosto(c) {
  const partes = Object.entries(c.roles)
    .filter(([, r]) => r.pedidos > 0)
    .sort((a, b) => b[1].usd - a[1].usd)
    .map(([rol, r]) => `${rol} ${dolares(r.usd)}${rol === 'orquestador' ? ` (${r.pedidos} pedidos)` : r.agentes > 1 ? ` (×${r.agentes})` : ''}`)
  const sinPrecio = Object.values(c.roles).reduce((s, r) => s + r.sinPrecio, 0)
  return `${dolares(c.usd)} · ${decimal(c.minutos)} min${partes.length ? ` · ${partes.join(' · ')}` : ' · sin pedidos'}${sinPrecio ? ` · ${sinPrecio} pedido(s) de un modelo sin precio` : ''}`
}

/** «revisor-plan AJUSTAR · ejecutor HECHO, HECHO · final RECHAZADO, APROBADO», o «ninguno». */
export function resumenDeVeredictos(c) {
  const partes = Object.entries(c.veredictos).map(([rol, vs]) => `${rol} ${vs.join(', ')}`)
  return partes.length ? partes.join(' · ') : 'ninguno'
}

/** «CRÍTICO (#1, #5)» o «sin criterios», sin la explicación que sigue. */
const clasificacionCorta = (texto) => /^(CRÍTICO(?:\s*\([^)]*\))?|sin criterios)/i.exec(String(texto ?? '').trim())?.[1] ?? String(texto ?? '').slice(0, 30)

function main() {
  const args = process.argv.slice(2)
  const valor = (nombre) => {
    const k = args.indexOf(nombre)
    return k >= 0 ? args[k + 1] : undefined
  }
  const n = Math.max(1, Number(valor('--ultimos') ?? 10) || 10)
  const archivo = valor('--archivo') ?? path.join(path.dirname(registroDe(RAIZ)), 'flujos.jsonl')
  const flujos = filasDe(archivo).filter((f) => f?.costo)
  if (!flujos.length) {
    console.log(`COSTOS: no hay flujos con costo en ${archivo}`)
    return
  }
  const ultimos = flujos.slice(-n)
  console.log(`FLUJOS (últimos ${ultimos.length} de ${flujos.length} con costo):`)
  for (const f of ultimos) {
    const datos = [f.clasificacion && clasificacionCorta(f.clasificacion), f.subtareas && `${f.subtareas} subtarea(s)`].filter(Boolean).join(' · ')
    console.log(`  ${String(f.t).slice(0, 16).replace('T', ' ')} · ${path.basename(String(f.raiz ?? '?'))} · ${resumenDeCosto(f.costo)}${datos ? ` · ${datos}` : ''} · ${resumenDeVeredictos(f.costo)}`)
  }
  const promedio = (valorDe) => ultimos.reduce((s, f) => s + valorDe(f.costo), 0) / ultimos.length
  console.log(`PROMEDIO: ${dolares(promedio((c) => c.usd))} · ${decimal(promedio((c) => c.minutos))} min · orquestador ${decimal(promedio((c) => c.roles.orquestador?.pedidos ?? 0))} pedidos`)
}

function esPrincipal() {
  if (!process.argv[1]) return false
  const a = path.resolve(process.argv[1])
  const b = fileURLToPath(import.meta.url)
  return WIN ? a.toLowerCase() === b.toLowerCase() : a === b
}

if (esPrincipal()) main()
