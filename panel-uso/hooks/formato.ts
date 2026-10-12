// Formato puro del panel: barras, cifras y tiempos. Sin `$`, para poder probarlo solo.

import type { SessionContextBreakdown } from 'claude-code'

import type { Desglose, Parte, Pesado } from '../types'

const MINUTO = 60_000
const HORA = 60 * MINUTO
const DIA = 24 * HORA

export function barra(porcentaje: number, ancho: number): string {
  const lleno = Math.round((Math.min(Math.max(porcentaje, 0), 100) / 100) * ancho)

  return '█'.repeat(lleno) + '░'.repeat(ancho - lleno)
}

/**
 * Una barra como `barra`, con las celdas llenas repartidas entre la parte principal y la de
 * subagente. `parte` y `sub` son porcentajes de la sección (0-100); `sub` nunca pasa de lo lleno.
 */
export function barraPartida(parte: number, sub: number, ancho: number): { principal: string, sub: string, vacio: string } {
  const llenas = Math.min(Math.max(Math.round((Math.min(Math.max(parte, 0), 100) / 100) * ancho), 0), ancho)
  const celdasSub = Math.min(Math.max(Math.round((sub / 100) * ancho), 0), llenas)

  return { principal: '█'.repeat(llenas - celdasSub), sub: '█'.repeat(celdasSub), vacio: '░'.repeat(ancho - llenas) }
}

/** Color de tema según cuánto se usó: verde, ámbar o rojo. */
export function tono(porcentaje: number): 'success' | 'warning' | 'error' {
  if (porcentaje >= 85) return 'error'
  if (porcentaje >= 60) return 'warning'

  return 'success'
}

/** 950 → «950», 96 200 → «96,2k», 200 000 → «200k», 1 000 000 → «1M». */
export function tokens(n: number): string {
  if (n >= 1_000_000) return `${decimal(n / 1_000_000)}M`
  if (n >= 1_000) return `${decimal(n / 1_000)}k`

  return String(Math.round(n))
}

/** El total con la salida al lado: «14,4M · sal 48k». Sin salida, solo el total. */
export function totalConSalida(total: number, salida: number): string {
  if (salida <= 0) return tokens(total)

  return `${tokens(total)} · sal ${tokens(salida)}`
}

function decimal(x: number): string {
  const redondo = x >= 100 ? Math.round(x) : Math.round(x * 10) / 10

  return String(redondo).replace('.', ',')
}

/** Un lapso de al menos 1 min en días, horas y minutos: «2 h 10 min», «1 d 3 h», «45 min». */
function armar(ms: number): string {
  const d = Math.floor(ms / DIA)
  const h = Math.floor((ms % DIA) / HORA)
  const m = Math.floor((ms % HORA) / MINUTO)

  if (d > 0) return h > 0 ? `${d} d ${h} h` : `${d} d`
  if (h > 0) return m > 0 ? `${h} h ${m} min` : `${h} h`

  return `${m} min`
}

/** Cuánto falta para `hasta`: «en 2 h 10 min», «en 1 d 3 h», «en 45 min». */
export function falta(desde: number, hasta: number): string {
  const ms = hasta - desde
  if (ms <= 0) return 'ya reinició'
  if (ms < MINUTO) return 'en menos de 1 min'

  return `en ${armar(ms)}`
}

/** Cuánto duró algo: «0 s», «45 s», «3 min 20 s», «1 h 20 min». Lo negativo cuenta como 0. */
export function duracion(ms: number): string {
  const total = Math.max(ms, 0)

  if (total >= HORA) return armar(total)

  const min = Math.floor(total / MINUTO)
  const s = Math.floor((total % MINUTO) / 1000)

  if (min === 0) return `${s} s`

  return s > 0 ? `${min} min ${s} s` : `${min} min`
}

const DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb']

/** Hora local del reinicio: «14:30», o con el día delante si no es hoy («vie 10, 09:00»). */
export function cuando(desde: number, hasta: number): string {
  const fin = new Date(hasta)
  const hoy = new Date(desde)
  const hora = `${dos(fin.getHours())}:${dos(fin.getMinutes())}`
  const mismoDia =
    fin.getFullYear() === hoy.getFullYear() &&
    fin.getMonth() === hoy.getMonth() &&
    fin.getDate() === hoy.getDate()

  return mismoDia ? hora : `${DIAS[fin.getDay()]} ${fin.getDate()}, ${hora}`
}

function dos(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

export function nombreVentana(kind: string): string {
  if (kind === 'five_hour') return 'Límite 5 horas'
  if (kind === 'seven_day') return 'Límite semanal'
  if (kind === 'spend_limit') return 'Límite de gasto'

  return kind.replace(/_/g, ' ')
}

export function nombreCorto(kind: string): string {
  if (kind === 'five_hour') return '5h'
  if (kind === 'seven_day') return 'sem'

  return kind
}

/** Las ventanas conocidas primero (5 h, semana), el resto detrás en su orden. */
export function ordenar<T extends { kind: string }>(lista: readonly T[]): T[] {
  const peso = (k: string) => (k === 'five_hour' ? 0 : k === 'seven_day' ? 1 : 2)

  return [...lista].sort((a, b) => peso(a.kind) - peso(b.kind))
}

/** 10.74 → «10,7%». */
export function pct(x: number): string {
  return `${(Math.round(x * 10) / 10).toFixed(1).replace('.', ',')}%`
}

// ── Desglose del contexto ─────────────────────────────────────────────

const NOMBRES: Record<string, string> = {
  'System prompt': 'Prompt del sistema',
  'System tools': 'Herramientas',
  'MCP tools': 'MCP',
  'Custom agents': 'Agentes',
  'Memory files': 'Memoria',
  Skills: 'Skills',
  'Slash commands': 'Comandos',
  Messages: 'Mensajes',
  'Free space': 'Libre',
  'Autocompact buffer': 'Reserva compactación',
}

/** Lo que el motor no traduce sale tal cual: mejor en inglés que inventado. */
export function nombreParte(name: string): string {
  return NOMBRES[name] ?? name
}

const TIPO = { used: 'usado', free: 'libre', buffer: 'reserva' } as const

export function aDesglose(b: SessionContextBreakdown, exacto: boolean): Desglose {
  const ventana = b.rawMaxTokens > 0 ? b.rawMaxTokens : b.maxTokens
  // Las diferidas (esquemas MCP que se cargan a pedido) no están en la ventana.
  const enVentana = b.categories.filter(c => c.kind !== 'deferred')
  const orden = (k: string) => (k === 'used' ? 0 : k === 'free' ? 1 : 2)
  const partes = [...enVentana]
    .sort((a, c) => orden(a.kind) - orden(c.kind))
    .map(c => ({
      nombre: nombreParte(c.name),
      tokens: c.tokens,
      porcentaje: ventana > 0 ? (c.tokens / ventana) * 100 : 0,
      color: c.color,
      tipo: TIPO[c.kind as keyof typeof TIPO] ?? 'usado',
    }))

  return { partes, ventana, pesados: pesados(b, 3), exacto }
}

/** Los `n` elementos sueltos que más pesan: archivos de memoria, servidores MCP, skills y agentes. */
export function pesados(b: SessionContextBreakdown, n: number): Pesado[] {
  const porServidor = new Map<string, number>()
  for (const t of b.mcpTools) {
    if (t.isLoaded) porServidor.set(t.serverName, (porServidor.get(t.serverName) ?? 0) + t.tokens)
  }

  const todos: Pesado[] = [
    ...b.memoryFiles.map(f => ({ nombre: archivo(f.path), tokens: f.tokens })),
    ...[...porServidor].map(([servidor, tokens]) => ({ nombre: `MCP ${servidor}`, tokens })),
    ...(b.skills?.skillFrontmatter ?? []).map(s => ({ nombre: `skill ${s.name}`, tokens: s.tokens })),
    ...b.agents.map(a => ({ nombre: `agente ${a.agentType}`, tokens: a.tokens })),
  ]

  return todos
    .filter(p => p.tokens > 0)
    .sort((a, c) => c.tokens - a.tokens)
    .slice(0, n)
}

function archivo(ruta: string): string {
  const partes = ruta.split(/[\\/]/).filter(Boolean)

  return partes[partes.length - 1] ?? ruta
}

export type Tramo = { celdas: number; color: string; tipo: Parte['tipo'] }

/**
 * Reparte `ancho` celdas entre las partes en proporción a sus tokens (mayor resto).
 * Una parte usada con tokens nunca desaparece de la barra: se lleva al menos una celda,
 * que se le quita a la parte más grande.
 */
export function tramos(partes: readonly Parte[], ancho: number): Tramo[] {
  const total = partes.reduce((s, p) => s + p.tokens, 0)
  if (total <= 0 || partes.length === 0) return [{ celdas: ancho, color: 'subtle', tipo: 'libre' }]

  const exactas = partes.map(p => (p.tokens / total) * ancho)
  const celdas = exactas.map(Math.floor)
  const porResto = exactas.map((x, i) => ({ i, resto: x - Math.floor(x) })).sort((a, b) => b.resto - a.resto)
  let sobra = ancho - celdas.reduce((s, c) => s + c, 0)
  for (const { i } of porResto) {
    if (sobra <= 0) break
    celdas[i] = (celdas[i] ?? 0) + 1
    sobra -= 1
  }

  partes.forEach((p, i) => {
    if (p.tipo !== 'usado' || p.tokens <= 0 || (celdas[i] ?? 0) > 0) return
    const mayor = celdas.reduce((m, c, j) => (c > (celdas[m] ?? 0) ? j : m), 0)
    if ((celdas[mayor] ?? 0) <= 1) return
    celdas[mayor] = (celdas[mayor] ?? 0) - 1
    celdas[i] = 1
  })

  return partes
    .map((p, i) => ({ celdas: celdas[i] ?? 0, color: p.color, tipo: p.tipo }))
    .filter(t => t.celdas > 0)
}

export function relleno(tipo: Parte['tipo']): string {
  return tipo === 'usado' ? '█' : tipo === 'reserva' ? '▒' : '░'
}

export function marcador(tipo: Parte['tipo']): string {
  return tipo === 'usado' ? '■' : tipo === 'reserva' ? '▒' : '□'
}
