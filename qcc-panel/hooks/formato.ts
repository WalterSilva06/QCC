// Formato puro del panel: barras, cifras y tiempos. Sin `$`, para poder probarlo solo.

import type { SessionContextBreakdown } from 'claude-code'

import type { Desglose, FilaSemana, Historial, Parte, Pesado, Pestana } from '../types'

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

/**
 * Como `barraPartida`, con un tramo más: las celdas del hilo principal durante un flujo, que salen de
 * `principal`. `flujo` es un porcentaje de la sección (0-100) y nunca pasa de lo que queda en `principal`.
 */
export function barraTramos(parte: number, flujo: number, sub: number, ancho: number): { principal: string, flujo: string, sub: string, vacio: string } {
  const b = barraPartida(parte, sub, ancho)
  const celdasFlujo = Math.min(Math.max(Math.round((flujo / 100) * ancho), 0), b.principal.length)

  return { principal: b.principal.slice(celdasFlujo), flujo: '█'.repeat(celdasFlujo), sub: b.sub, vacio: b.vacio }
}

/** Un trozo de barra ya dibujado: su texto y su color. */
export type TrozoBarra = { texto: string; color: string }

/** Celdas que ocupa la chispa de `conOnda`: la cabeza y su estela. */
const LARGO_ONDA = 3

/**
 * La onda que recorre una barra mientras su fila consume tokens: una chispa avanza una celda por `fase`
 * de punta a punta, sobre lo lleno y lo vacío, sale por el final y vuelve a empezar. La cabeza es `█` en
 * `cabeza` y la estela `▓▒` en `estela`. Devuelve los trozos con la chispa encima, unidos por color (`unirPorColor`).
 */
export function conOnda(trozos: readonly TrozoBarra[], fase: number, cabeza: string, estela: string): TrozoBarra[] {
  const celdas = trozos.flatMap(t => [...t.texto].map(texto => ({ texto, color: t.color })))
  const pos = ((fase % (celdas.length + LARGO_ONDA)) + celdas.length + LARGO_ONDA) % (celdas.length + LARGO_ONDA)
  for (let i = 0; i < LARGO_ONDA; i++) {
    if (pos - i >= 0 && pos - i < celdas.length) celdas[pos - i] = { texto: '█▓▒'[i], color: i === 0 ? cabeza : estela }
  }

  return unirPorColor(celdas)
}

/** Une los trozos seguidos del mismo color y quita los vacíos. */
export function unirPorColor(trozos: readonly TrozoBarra[]): TrozoBarra[] {
  const unidos: TrozoBarra[] = []
  for (const c of trozos.filter(x => x.texto !== '')) {
    const ultimo = unidos[unidos.length - 1]
    if (ultimo?.color === c.color) ultimo.texto += c.texto
    else unidos.push({ ...c })
  }

  return unidos
}

/**
 * El desglose de una fila por tramos: «directo 6,4M · orquestador 3,5M · sub 3M», sin los tramos en 0.
 * Sin flujo ni sub, vacío. Si no cabe en `ancho` (mínimo 1) quita los espacios y, si aún no cabe, recorta con «…».
 */
export function desgloseTramos(f: Pick<FilaSemana, 'total' | 'flujo' | 'sub'>, ancho: number): string {
  const flujo = f.flujo ?? 0
  const sub = f.sub ?? 0
  if (flujo <= 0 && sub <= 0) return ''

  const partes = [
    { nombre: 'directo', n: Math.max(0, f.total - flujo - sub) },
    { nombre: 'orquestador', n: flujo },
    { nombre: 'sub', n: sub },
  ]
    .filter(p => p.n > 0)
    .map(p => `${p.nombre} ${tokens(p.n)}`)
  const limite = Math.max(1, ancho)
  const normal = partes.join(' · ')
  if (normal.length <= limite) return normal

  const compacta = partes.join('·')
  if (compacta.length <= limite) return compacta

  return `${compacta.slice(0, limite - 1).trimEnd()}…`
}

/**
 * Las etiquetas de las filas en columnas separadas por un espacio: familia, versión (si alguna la
 * tiene) y esfuerzo, cada una rellenada al más largo. Todas salen del mismo largo; si pasa de `ancho`
 * (mínimo 1), cada una se recorta por el final con «…» y se rellena hasta `ancho`.
 */
export function etiquetasAlineadas(filas: readonly Pick<FilaSemana, 'modelo' | 'esfuerzo'>[], ancho: number): string[] {
  if (filas.length === 0) return []

  const partes = filas.map(f => {
    const corte = f.modelo.indexOf(' ')

    return corte < 0
      ? { familia: f.modelo, version: '', esfuerzo: f.esfuerzo }
      : { familia: f.modelo.slice(0, corte), version: f.modelo.slice(corte + 1), esfuerzo: f.esfuerzo }
  })
  const mayor = (campo: 'familia' | 'version' | 'esfuerzo') => Math.max(...partes.map(p => p[campo].length))
  const anchoFamilia = mayor('familia')
  const anchoVersion = mayor('version')
  const anchoEsfuerzo = mayor('esfuerzo')
  const limite = Math.max(1, ancho)

  return partes.map(p => {
    const columnas = [p.familia.padEnd(anchoFamilia)]
    if (anchoVersion > 0) columnas.push(p.version.padEnd(anchoVersion))
    columnas.push(p.esfuerzo.padEnd(anchoEsfuerzo))

    const completa = columnas.join(' ')
    if (completa.length <= limite) return completa

    const corta = completa.trimEnd()
    if (corta.length <= limite) return corta.padEnd(limite)

    return `${corta.slice(0, limite - 1).trimEnd()}…`.padEnd(limite)
  })
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

/**
 * Las partes de la línea de un límite: etiqueta (5 columnas), barra, cifra («  5%») y cola («2 h 10 min»
 * con un espacio delante, sin el «en»). La barra mide entre 3 y 12; si con 3 no cabe, la cola se suelta.
 */
export function lineaLimite(kind: string, porcentaje: number, reinicio: number | undefined, ahora: number, ancho: number): { etiqueta: string, barra: string, cifra: string, cola: string } {
  const etiqueta = (kind === 'spend_limit' ? 'gasto' : nombreCorto(kind)).padEnd(5)
  const cifra = `${porcentaje}%`.padStart(4)
  let cola = reinicio === undefined || Number.isNaN(reinicio) ? '' : ` ${falta(ahora, reinicio).replace(/^en /, '')}`
  if (ancho - etiqueta.length - 1 - cifra.length - cola.length < 3) cola = ''

  const w = Math.min(12, Math.max(3, ancho - etiqueta.length - 1 - cifra.length - cola.length))

  return { etiqueta, barra: barra(porcentaje, w), cifra, cola }
}

/**
 * Las partes de la fila del contexto: etiqueta (5 columnas), barra, cifra («  48%», «   —» sin medir) y cola
 * (« 96,2k/200k»; sin medir « 1M · tras 1.ª respuesta», o « tras 1.ª respuesta» sin ventana). La barra mide
 * entre 3 y 12; si con 3 no cabe, la cola sin medir se acorta (« 1M») y después se suelta. Sin medir la barra va vacía.
 */
export function lineaContexto(m: { tokens?: number, ventana: number, porcentaje?: number } | null, ancho: number): { etiqueta: string, barra: string, cifra: string, cola: string, medido: boolean } {
  const etiqueta = 'ctx'.padEnd(5)
  const medido = m !== null && m.porcentaje !== undefined
  const porcentaje = medido ? m.porcentaje as number : 0
  const cifra = (medido ? `${porcentaje}%` : '—').padStart(4)
  let candidatas: string[]

  if (medido) candidatas = [` ${tokens(m.tokens ?? 0)}/${tokens(m.ventana)}`]
  else if (m !== null && m.ventana > 0) candidatas = [` ${tokens(m.ventana)} · tras 1.ª respuesta`, ` ${tokens(m.ventana)}`]
  else candidatas = [' tras 1.ª respuesta']

  // La cola se degrada antes de soltarse: la primera que deje la barra en 3 celdas o más.
  const cola = candidatas.find(c => ancho - etiqueta.length - 1 - cifra.length - c.length >= 3) ?? ''

  const w = Math.min(12, Math.max(3, ancho - etiqueta.length - 1 - cifra.length - cola.length))

  return { etiqueta, barra: barra(porcentaje, w), cifra, cola, medido }
}

/**
 * Reparte índices en filas de forma voraz: cada fila suma las medidas más `separacion` entre elementos
 * y no pasa de `ancho`. Un elemento más ancho que `ancho` va solo en su fila.
 */
export function repartir(medidas: readonly number[], ancho: number, separacion = 0): number[][] {
  const filas: number[][] = []
  let uso = 0

  medidas.forEach((m, i) => {
    const fila = filas[filas.length - 1]
    if (fila !== undefined && uso + separacion + m <= ancho) {
      fila.push(i)
      uso += separacion + m
    } else {
      filas.push([i])
      uso = m
    }
  })

  return filas
}

/**
 * Si lo leído antes de `flujos.jsonl` sirve todavía: solo con `v: 6` (una caché de una versión anterior trae filas de otro registro, no trae los
 * tokens de cada fila o trae `totales` de más, y sigue viva tras `/reload-plugins`) y con la misma fecha de modificación.
 */
export function historialVigente(actual: Pick<Historial, 'v' | 'mtimeMs'> | null | undefined, mtimeMs: number): boolean {
  return actual != null && actual.v === 6 && actual.mtimeMs === mtimeMs
}

/**
 * La pestaña guardada si es una de las cuatro; con cualquier otro valor (también el viejo `flujo`), `'inicio'`. Con `vista`, una
 * pestaña oculta (`historial` o `agentes` en `false`) también da `'inicio'`; sin ella, todas valen.
 */
export function pestanaValida(x: unknown, vista?: { historial: boolean; agentes?: boolean }): Pestana {
  if (x === 'historial') return vista?.historial === false ? 'inicio' : x
  if (x === 'agentes') return vista?.agentes === false ? 'inicio' : x

  return x === 'semana' ? x : 'inicio'
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
      color: colorParte(c.name, c.kind, c.color),
      tipo: TIPO[c.kind as keyof typeof TIPO] ?? 'usado',
    }))

  return { partes, ventana, pesados: pesados(b, 3), exacto }
}

/** Mensajes en naranja del tema, libre y reserva en gris del tema; lo demás conserva el color del motor. */
function colorParte(nombre: string, kind: string, colorMotor: string): string {
  if (nombre === 'Messages') return 'claude'
  if (kind === 'free') return 'subtle'
  if (kind === 'buffer') return 'inactive'

  return colorMotor
}

/**
 * La cabecera del desglose: lo usado, la ventana, el punto donde compacta (ventana menos la reserva) y el
 * porcentaje de lo usado sobre ese punto (0 si el punto no es positivo). `compacta` si hay reserva con tokens.
 */
export function resumenContexto(d: Desglose): { usados: number, ventana: number, punto: number, porcentaje: number, compacta: boolean } {
  const suma = (tipo: Parte['tipo']) => d.partes.filter(p => p.tipo === tipo).reduce((s, p) => s + p.tokens, 0)
  const usados = suma('usado')
  const reserva = suma('reserva')
  const punto = d.ventana - reserva

  return {
    usados,
    ventana: d.ventana,
    punto,
    porcentaje: punto <= 0 ? 0 : Math.round((usados / punto) * 100),
    compacta: d.partes.some(p => p.tipo === 'reserva' && p.tokens > 0),
  }
}

/** Color de la cabecera del desglose según cuánto falta para compactar: verde bajo 70, ámbar de 70 a 89, rojo desde 90. */
export function tonoCompactacion(p: number): 'success' | 'warning' | 'error' {
  if (p >= 90) return 'error'
  if (p >= 70) return 'warning'

  return 'success'
}

/** El porcentaje de una parte en la leyenda: vacío en libre y reserva, «<0,1%» en lo usado que pesa menos de 0,1. */
export function pctParte(p: Parte): string {
  if (p.tipo !== 'usado') return ''
  if (p.porcentaje > 0 && p.porcentaje < 0.1) return '<0,1%'

  return pct(p.porcentaje)
}

/** El orden de la leyenda: lo usado de mayor a menor (el empate queda en el orden del motor), y al final libre y reserva. */
export function ordenLeyenda(partes: readonly Parte[]): Parte[] {
  const usadas = partes.filter(p => p.tipo === 'usado').sort((a, b) => b.tokens - a.tokens)

  return [...usadas, ...partes.filter(p => p.tipo !== 'usado')]
}

/** Qué parte de lo usado es una parte, como «◀57%»; vacío si no hay nada usado. */
export function cuotaUsado(tokens: number, usados: number): string {
  return usados > 0 ? `◀${Math.round((tokens / usados) * 100)}%` : ''
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
  return tipo === 'usado' ? '█' : tipo === 'reserva' ? '░' : '─'
}

export function marcador(tipo: Parte['tipo']): string {
  return tipo === 'usado' ? '■' : tipo === 'reserva' ? '░' : '─'
}
