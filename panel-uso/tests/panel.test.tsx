import type { On, SessionContextBreakdown, SessionMeasureInput } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { comandoCarpeta, tipoDeRuta } from '../hooks/carpeta'
import {
  PASOS,
  PASOS_AUDITAR,
  avanzar,
  iniciarFlujo,
  nodos,
  pasosDe,
  resumenFlujo,
  senalAlTerminar,
  senalDeHerramienta,
  terminarFlujo,
} from '../hooks/flujo'
import type { Senal } from '../hooks/flujo'
import { aDesglose, barra, falta, pct, tokens, tono, totalConSalida, tramos } from '../hooks/formato'
import {
  ESPERA_MAX_MS,
  anotar,
  clave,
  comoRegistro,
  estadoActividad,
  etiquetaDia,
  familia,
  idDeFila,
  idFila,
  inicioDeHora,
  inicioSemana,
  iniciarPeticion,
  limpiarPendientes,
  podar,
  resumir,
  terminarPeticion,
} from '../hooks/semana'
import type { Cuentas, Registro } from '../hooks/semana'
import type { Actividad, Flujo } from '../types'

const AHORA = Date.parse('2026-10-09T15:00:00Z')

const PANE = {
  plugin: 'panel-uso',
  component: 'Pane',
  requestId: 'panel-uso',
  props: {
    title: 'Uso',
    isFocused: false,
    bodyColumns: 32,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

const MEDIDA: SessionMeasureInput = {
  context: { tokens: 96_200, window: 200_000, percent: 48 },
  rateLimits: [
    { kind: 'seven_day', percentUsed: 61, resetsAt: '2026-10-11T12:00:00Z' },
    { kind: 'five_hour', percentUsed: 23, resetsAt: '2026-10-09T17:10:00Z' },
  ],
  changed: ['context', 'rateLimits'],
}

const DESGLOSE: SessionContextBreakdown = {
  categories: [
    { name: 'System prompt', tokens: 3_100, color: 'promptBorder', isDeferred: false, kind: 'used' },
    { name: 'System tools', tokens: 14_200, color: 'inactive', isDeferred: false, kind: 'used' },
    { name: 'Memory files', tokens: 21_400, color: 'claude', isDeferred: false, kind: 'used' },
    { name: 'Messages', tokens: 51_400, color: 'permission', isDeferred: false, kind: 'used' },
    { name: 'MCP tools', tokens: 9_000, color: 'warning', isDeferred: true, kind: 'deferred' },
    { name: 'Free space', tokens: 76_900, color: 'subtle', isDeferred: false, kind: 'free' },
    { name: 'Autocompact buffer', tokens: 33_000, color: 'inactive', isDeferred: false, kind: 'buffer' },
  ],
  totalTokens: 90_100,
  maxTokens: 200_000,
  rawMaxTokens: 200_000,
  autocompactSource: 'auto',
  percentage: 45,
  gridRows: [],
  model: 'claude-opus-5-5',
  memoryFiles: [
    { path: 'D:\\GitHub-Personal\\turno-pro\\CLAUDE.md', type: 'Project', tokens: 18_900 },
    { path: 'C:\\Users\\x\\.claude\\memory\\MEMORY.md', type: 'AutoMem', tokens: 1_600 },
  ],
  mcpTools: [
    { name: 'mcp__21st__search', serverName: '21st', tokens: 700, isLoaded: true },
    { name: 'mcp__21st__get_component', serverName: '21st', tokens: 500, isLoaded: true },
    { name: 'mcp__drive__read', serverName: 'drive', tokens: 9_000, isLoaded: false },
  ],
  agents: [{ agentType: 'orchestrator', source: 'userSettings', tokens: 900 }],
  isAutoCompactEnabled: true,
  apiUsage: null,
}

/** Lo que el motor hace bajo los plugins al medir: devolver `{ changed }`. */
function motorMide(on: On) {
  on('session.measure', (_$, e) => ({ changed: [...e.changed] }))
}

/** `$.session.usage`: con desglose si se pide; `full` se distingue por sus Mensajes. */
function motorUsa(on: On, pedidos: string[] = []) {
  on('session.usage', (_$, e) => {
    if (e.breakdown !== undefined) pedidos.push(e.breakdown)
    const breakdown =
      e.breakdown === 'full'
        ? {
            ...DESGLOSE,
            categories: DESGLOSE.categories.map(c => (c.name === 'Messages' ? { ...c, tokens: 50_000 } : c)),
          }
        : DESGLOSE

    return {
      value: {
        startedAt: 0,
        context: { ...MEDIDA.context, ...(e.breakdown === undefined ? {} : { breakdown }) },
        rateLimits: MEDIDA.rateLimits,
      },
    }
  })
}

describe('formato', () => {
  test('barra, tono, tokens y cuenta regresiva', async () => {
    expect(barra(50, 10)).toBe('█████░░░░░')
    expect(barra(130, 4)).toBe('████')
    expect(tono(20)).toBe('success')
    expect(tono(70)).toBe('warning')
    expect(tono(90)).toBe('error')
    expect(tokens(96_200)).toBe('96,2k')
    expect(tokens(200_000)).toBe('200k')
    expect(tokens(1_000_000)).toBe('1M')
    expect(falta(0, 2 * 3_600_000 + 10 * 60_000)).toBe('en 2 h 10 min')
    expect(falta(0, 27 * 3_600_000)).toBe('en 1 d 3 h')
    expect(falta(0, -1)).toBe('ya reinició')
    expect(pct(10.74)).toBe('10,7%')
  })

  test('totalConSalida: total y salida juntos; sin salida, solo el total', async () => {
    expect(totalConSalida(14_400_000, 48_000)).toBe('14,4M · sal 48k')
    expect(totalConSalida(500_000, 2_000)).toBe('500k · sal 2k')
    expect(totalConSalida(1_000_000, 950)).toBe('1M · sal 950')
    expect(totalConSalida(950, 120)).toBe('950 · sal 120')
    expect(totalConSalida(96_200, 0)).toBe('96,2k')
    expect(totalConSalida(0, 0)).toBe('0')
  })

  test('desglose: traduce, deja fuera lo diferido, libre y reserva al final', async () => {
    const d = aDesglose(DESGLOSE, false)

    expect(d.partes.map(p => p.nombre)).toEqual([
      'Prompt del sistema',
      'Herramientas',
      'Memoria',
      'Mensajes',
      'Libre',
      'Reserva compactación',
    ])
    expect(pct(d.partes.find(p => p.nombre === 'Memoria')?.porcentaje ?? 0)).toBe('10,7%')
    expect(d.pesados).toEqual([
      { nombre: 'CLAUDE.md', tokens: 18_900 },
      { nombre: 'MEMORY.md', tokens: 1_600 },
      { nombre: 'MCP 21st', tokens: 1_200 },
    ])
  })

  test('tramos: suman el ancho y ninguna parte usada desaparece', async () => {
    const partes = [
      { nombre: 'a', tokens: 1, porcentaje: 0, color: 'claude', tipo: 'usado' as const },
      { nombre: 'b', tokens: 50_000, porcentaje: 0, color: 'inactive', tipo: 'usado' as const },
      { nombre: 'c', tokens: 150_000, porcentaje: 0, color: 'subtle', tipo: 'libre' as const },
    ]
    const t = tramos(partes, 20)

    expect(t.reduce((s, x) => s + x.celdas, 0)).toBe(20)
    expect(t[0]).toEqual({ celdas: 1, color: 'claude', tipo: 'usado' })
  })
})

describe('panel', () => {
  test('acoplado: contexto, 5 horas antes que la semana, y su reinicio', async ($, on) => {
    mock.clock(on, { now: AHORA })
    motorMide(on)
    motorUsa(on)
    await $.session.measure(MEDIDA)

    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    const textos = (await ui.findAll({ type: 'Text' })).map(t => t.text ?? '')

    expect(textos).toContain('Contexto')
    expect(textos).toContain('96,2k de 200k tokens')
    expect(textos.indexOf('Límite 5 horas')).toBeLessThan(textos.indexOf('Límite semanal'))
    expect(textos.some(t => t.includes('en 2 h 10 min'))).toBe(true)
    expect(textos.some(t => t.includes('en 1 d 21 h'))).toBe(true)
    await ui.unmount()
  })

  test('sin medición todavía: lo dice, no inventa cifras', async ($, on) => {
    mock.clock(on, { now: AHORA })
    motorMide(on)
    motorUsa(on)
    await $.session.measure({ context: { window: 200_000 }, rateLimits: [], changed: ['context'] })

    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

    expect(await ui.find({ type: 'Text', text: /se mide tras la 1.ª respuesta/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /aparecen tras la 1.ª respuesta/ })).toBeDefined()
    await ui.unmount()
  })

  test('en línea sobre el prompt: una sola fila resumida', async ($, on) => {
    mock.clock(on, { now: AHORA })
    motorMide(on)
    motorUsa(on)
    await $.session.measure(MEDIDA)

    const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, placement: 'inline' }, surface: 'terminal' })
    const fila = await ui.find({ type: 'Text', text: /ctx 48%/ })

    expect(fila?.text).toContain('5h 23% (en 2 h 10 min)')
    expect(fila?.text).toContain('sem 61%')
    await ui.unmount()
  })

  test('cada parte con sus tokens y su %; estimado sin pedir nada a la API', async ($, on) => {
    const pedidos: string[] = []
    mock.clock(on, { now: AHORA })
    motorMide(on)
    motorUsa(on, pedidos)
    await $.session.measure(MEDIDA)

    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    const textos = (await ui.findAll({ type: 'Text' })).map(t => t.text ?? '')

    expect(pedidos).toEqual(['summary'])
    expect(textos).toContain('Memoria')
    expect(textos).toContain(' 21,4k')
    expect(textos).toContain('  10,7%')
    expect(textos).toContain('Reserva compactación')
    expect(textos).not.toContain('MCP')
    expect(textos.some(t => t.includes('CLAUDE.md'))).toBe(true)
    expect(textos).toContain(' estimado')
    await ui.unmount()
  })

  test('tras /clear suelta el contexto viejo y conserva los límites', async ($, on) => {
    mock.clock(on, { now: AHORA })
    motorMide(on)
    motorUsa(on)
    on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
    await $.session.measure(MEDIDA)

    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
    const textos = (await ui.findAll({ type: 'Text' })).map(t => t.text ?? '')

    expect(textos).not.toContain('96,2k de 200k tokens')
    expect(textos).not.toContain('Memoria')
    expect(textos).not.toContain('48%')
    expect(textos).toContain('ventana 200k · se mide tras la 1.ª respuesta')
    expect(textos).toContain('Límite 5 horas')
    await ui.unmount()
  })

  test('«Precisar» cuenta con la API una vez y lo marca exacto', async ($, on) => {
    const pedidos: string[] = []
    mock.clock(on, { now: AHORA })
    motorMide(on)
    motorUsa(on, pedidos)
    await $.session.measure(MEDIDA)

    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await ui.press({ key: 'precisar' })
    const textos = (await ui.findAll({ type: 'Text' })).map(t => t.text ?? '')

    expect(pedidos).toEqual(['summary', 'full'])
    expect(textos).toContain('   50k')
    expect(textos).toContain(' exacto')
    await ui.unmount()
  })
})

type Corrida = { argv: string[]; cwd: string | undefined }

/**
 * `session.root`, `process.run` y `ui.toast` bajo el plugin: anotan lo que reciben.
 * `salidas` da la salida por programa (el que no está sale con 0); `estado.root` y
 * `estado.negar` se pueden cambiar entre pulsaciones.
 */
function motorCarpeta(on: On, root: string, salidas: Record<string, { exitCode: number; stdout?: string }> = {}) {
  const corridas: Corrida[] = []
  const avisos: string[] = []
  const estado = { root, negar: false }
  on('session.root', () => ({ value: estado.root }))
  on('process.run', (_$, e) => {
    corridas.push({ argv: [...e.argv], cwd: e.init?.cwd })
    if (estado.negar) return { deny: `negado: ${e.argv[0]}` }
    const s = salidas[e.argv[0] ?? ''] ?? { exitCode: 0 }

    return {
      value: {
        exitCode: s.exitCode,
        stdout: s.stdout ?? '',
        stderr: '',
        isStdoutTruncated: false,
        isStderrTruncated: false,
      },
    }
  })
  on('ui.toast', (_$, e) => {
    avisos.push(e.text)

    return { value: undefined }
  })

  return { corridas, avisos, estado }
}

/** Windows: la ventana la abre el Explorador que ya corre, no un `explorer.exe` oculto. */
const WINDOWS = [
  'powershell.exe',
  '-NoProfile',
  '-NonInteractive',
  '-Command',
  '$s = New-Object -ComObject Shell.Application; $p = (Get-Location).ProviderPath; ' +
    '@($s.Windows()) | Where-Object { -not $_.Visible -and $(try { $_.Document.Folder.Self.Path -eq $p } catch { $false }) } | ForEach-Object { $_.Quit() }; ' +
    '$s.Open($p)',
]

describe('carpeta', () => {
  test('carpeta: tipo de ruta y programa por sistema', async () => {
    expect(tipoDeRuta('D:\\GitHub-Personal\\mods-claude')).toBe('windows')
    expect(tipoDeRuta('D:/x')).toBe('windows')
    expect(tipoDeRuta('\\\\srv\\p')).toBe('windows')
    expect(tipoDeRuta('/home/x/p')).toBe('posix')
    for (const mala of ['', 'proyecto', '-x', 'D:proyecto', '/home/x\n']) expect(tipoDeRuta(mala)).toBeNull()
    expect(comandoCarpeta('windows')).toEqual(WINDOWS)
    expect(comandoCarpeta('mac')).toEqual(['open', '.'])
    expect(comandoCarpeta('otro')).toEqual(['xdg-open', '.'])
  })

  test('"Abrir carpeta" va arriba de Contexto y abre la raíz en el Explorador', async ($, on) => {
    const pedidos: string[] = []
    const root = 'D:\\GitHub-Personal\\mods-claude'
    mock.clock(on, { now: AHORA })
    motorMide(on)
    motorUsa(on, pedidos)
    const salidas: Record<string, { exitCode: number }> = {}
    const { corridas, avisos } = motorCarpeta(on, root, salidas)
    await $.session.measure(MEDIDA)

    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    const arbol = await ui.findAll({})
    const boton = arbol.findIndex(n => n.type === 'Button' && n.key === 'carpeta')
    const contexto = arbol.findIndex(n => n.type === 'Text' && n.text === 'Contexto')

    expect(boton).toBeGreaterThan(-1)
    expect(contexto).toBeGreaterThan(boton)
    expect(corridas).toEqual([])

    await ui.press({ key: 'carpeta' })

    expect(corridas).toEqual([{ argv: WINDOWS, cwd: root }])
    expect(avisos).toEqual([])
    expect(pedidos).toEqual(['summary'])

    // PowerShell sí informa el fallo: en Windows la salida ≠ 0 ahora avisa.
    salidas['powershell.exe'] = { exitCode: 1 }
    await ui.press({ key: 'carpeta' })
    expect(avisos).toHaveLength(1)
    await ui.unmount()
  })

  test('"Abrir carpeta" en macOS y Linux: uname decide el programa', async ($, on) => {
    mock.clock(on, { now: AHORA })
    motorMide(on)
    motorUsa(on)
    const root = '/home/x/proyecto'
    const salidas = { uname: { exitCode: 0, stdout: 'Linux\n' } }
    const { corridas, avisos } = motorCarpeta(on, root, salidas)
    await $.session.measure(MEDIDA)

    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await ui.press({ key: 'carpeta' })

    expect(corridas).toEqual([
      { argv: ['uname', '-s'], cwd: undefined },
      { argv: ['xdg-open', '.'], cwd: root },
    ])

    corridas.length = 0
    salidas.uname.stdout = 'Darwin\n'
    await ui.press({ key: 'carpeta' })

    expect(corridas).toEqual([
      { argv: ['uname', '-s'], cwd: undefined },
      { argv: ['open', '.'], cwd: root },
    ])
    expect(avisos).toEqual([])
    await ui.unmount()
  })

  test('"Abrir carpeta": ruta no absoluta, salida ≠ 0 o proceso negado avisan y no rompen', async ($, on) => {
    mock.clock(on, { now: AHORA })
    motorMide(on)
    motorUsa(on)
    const { corridas, avisos, estado } = motorCarpeta(on, 'proyecto', {
      uname: { exitCode: 0, stdout: 'Linux\n' },
      'xdg-open': { exitCode: 3 },
    })
    await $.session.measure(MEDIDA)

    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

    await ui.press({ key: 'carpeta' })
    expect(corridas).toEqual([])
    expect(avisos).toHaveLength(1)

    estado.root = '/home/x/proyecto'
    await ui.press({ key: 'carpeta' })
    expect(corridas.map(c => c.argv)).toEqual([['uname', '-s'], ['xdg-open', '.']])
    expect(avisos).toHaveLength(2)

    estado.negar = true
    await ui.press({ key: 'carpeta' })
    expect(avisos).toHaveLength(3)
    await ui.unmount()
  })
})

const USO = { input_tokens: 1_000, output_tokens: 2_000, cache_read_input_tokens: 90_000, cache_creation_input_tokens: 7_000 }

/** El modelo bajo los plugins: responde sin chunks, con el uso dado. */
function motorResponde(on: On, modelo: string) {
  on('turn.step', async function* (_$, e) {
    return {
      turnId: e.turnId,
      index: e.index,
      answer: 'ok',
      toolUses: [],
      stopReason: 'end_turn',
      usage: { ...USO, model: modelo },
    }
  })
}

async function paso($: Engine, modelo: string, effort?: 'low' | 'medium' | 'high', agentId?: string) {
  const s = $.turn.step({ turnId: 't', index: 0, model: modelo, messageCount: 1, ...(effort ? { effort } : {}), ...(agentId ? { agentId } : {}) })
  for await (const _ of s) {
    // sin chunks
  }

  return s.result
}

describe('semana', () => {
  test('resumir: por familia y esfuerzo, de mayor a menor, solo dentro de la ventana', async () => {
    const h = inicioDeHora(AHORA)
    let r: Registro = {}
    r = anotar(r, h, clave('claude-opus-5-5', 'medium'), USO)
    r = anotar(r, h, clave('claude-opus-5-5', 'medium'), USO)
    r = anotar(r, h, clave('claude-sonnet-5-5', 'low'), USO)
    r = anotar(r, h - 10 * 86_400_000, clave('claude-sonnet-5-5', 'high'), USO)
    const s = resumir([r, { [String(h)]: { [clave('claude-haiku-5-5', undefined)]: [1, 1, 0, 0] } }], h - 86_400_000)

    expect(s.filas).toEqual([
      { modelo: 'Opus 5.5', esfuerzo: 'medium', origen: 'principal', total: 200_000, salida: 4_000 },
      { modelo: 'Sonnet 5.5', esfuerzo: 'low', origen: 'principal', total: 100_000, salida: 2_000 },
      { modelo: 'Haiku 5.5', esfuerzo: '—', origen: 'principal', total: 2, salida: 1 },
    ])
    expect(s.total).toBe(300_002)
  })

  test('familia: familia y versión; una fecha de 8 dígitos no es versión menor', async () => {
    expect(familia('claude-opus-5-5')).toBe('Opus 5.5')
    expect(familia('claude-fable-5-1')).toBe('Fable 5.1')
    expect(familia('claude-opus-4-20250514')).toBe('Opus 4')
    expect(familia('claude-opus-4-1-20250805')).toBe('Opus 4.1')
    expect(familia('claude-3-5-sonnet-20241022')).toBe('Sonnet 3.5')
    expect(familia('claude-3-haiku-20240307')).toBe('Haiku 3')
    expect(familia('claude-haiku')).toBe('Haiku')
    expect(familia('claude-opus-20250514')).toBe('Opus')
    expect(familia('gpt-raro')).toBe('gpt-raro')
  })

  test('clave: el hilo principal conserva modelo|esfuerzo; el subagente agrega |sub', async () => {
    expect(clave('claude-opus-5-5', 'high')).toBe('claude-opus-5-5|high')
    expect(clave('claude-opus-5-5', 'high', false)).toBe('claude-opus-5-5|high')
    expect(clave('claude-opus-5-5', 'high', true)).toBe('claude-opus-5-5|high|sub')
    expect(clave('claude-opus-5-5', undefined, true)).toBe('claude-opus-5-5||sub')
  })

  test('resumir: claves viejas de 2 partes son principal; |sub es subagente; esfuerzo vacío es «—»', async () => {
    const h = inicioDeHora(AHORA)
    const r: Registro = {
      [String(h)]: {
        'claude-opus-5-5|high': [10, 0, 0, 0],
        'claude-opus-5-5|high|sub': [5, 0, 0, 0],
        'claude-haiku-5-5|': [3, 0, 0, 0],
        'claude-haiku-5-5||sub': [1, 0, 0, 0],
        'claude-sonnet-4-20250514': [2, 0, 0, 0],
      },
    }
    const s = resumir([r], h - 1)

    expect(s.filas).toEqual([
      { modelo: 'Opus 5.5', esfuerzo: 'high', origen: 'principal', total: 10, salida: 0 },
      { modelo: 'Opus 5.5', esfuerzo: 'high', origen: 'subagente', total: 5, salida: 0 },
      { modelo: 'Haiku 5.5', esfuerzo: '—', origen: 'principal', total: 3, salida: 0 },
      { modelo: 'Sonnet 4', esfuerzo: '—', origen: 'principal', total: 2, salida: 0 },
      { modelo: 'Haiku 5.5', esfuerzo: '—', origen: 'subagente', total: 1, salida: 0 },
    ])
  })

  test('la semana es la ventana del límite semanal; sin él, 7 días atrás', async () => {
    const reinicio = Date.parse('2026-10-11T12:00:00Z')
    expect(inicioSemana(MEDIDA.rateLimits, AHORA)).toBe(reinicio - 7 * 86_400_000)
    expect(inicioSemana([], AHORA)).toBe(AHORA - 7 * 86_400_000)
  })

  test('podar y leer del store: descarta lo viejo y lo que no tiene forma', async () => {
    const r = comoRegistro({ '1000': { 'a|low': [1, 2, 3, 4], 'b|': 'x' }, nohora: {} })
    expect(r).toEqual({ '1000': { 'a|low': [1, 2, 3, 4] } })
    expect(podar(r, 10_000_000)).toBeNull()
  })

  test('cada respuesta suma en el panel, hilo principal y subagentes', async ($, on) => {
    mock.clock(on, { now: AHORA })
    motorMide(on)
    motorUsa(on)
    mock.store(on)
    on('session.id', () => ({ value: 's1' }))
    motorResponde(on, 'claude-opus-5-5')
    await $.session.measure(MEDIDA)

    await paso($, 'claude-opus-5-5', 'medium')
    await paso($, 'claude-opus-5-5', 'medium', 'agente-1')
    await paso($, 'claude-opus-5-5', 'high')

    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await ui.press({ key: 's-plegar' })
    const textos = (await ui.findAll({ type: 'Text' })).map(t => t.text ?? '')

    expect(textos).toContain('Esta semana')
    expect(textos).toContain('Opus 5.5 medium')
    expect(textos).toContain('Opus 5.5 medium · sub')
    expect(textos).toContain('Opus 5.5 high')
    expect(textos).toContain('   100k')
    expect(textos.indexOf('Opus 5.5 medium')).toBeLessThan(textos.indexOf('Opus 5.5 high'))
    expect(textos.indexOf('Esfuerzo')).toBeLessThan(textos.indexOf('Esta semana'))
    await ui.unmount()
  })

  test('esfuerzo: nivel y modelo salen en la misma fila que el título (turno)', async ($, on) => {
    mock.clock(on, { now: AHORA })
    motorMide(on)
    motorUsa(on)
    mock.store(on)
    on('session.id', () => ({ value: 's1' }))
    motorResponde(on, 'claude-opus-5-5')
    await $.session.measure(MEDIDA)
    await paso($, 'claude-opus-5-5', 'high')

    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    const fila = await ui.find({ type: 'Box', text: /^Esfuerzo/ })
    const textos = (await ui.findAll({ type: 'Text' })).map(t => t.text ?? '')

    expect(fila?.text).toBe('Esfuerzo high · claude-opus-5-5')
    expect(textos).toContain('Esfuerzo')
    // Nivel y modelo ya no son líneas sueltas: viven solo dentro de la fila.
    expect(textos).not.toContain('high')
    expect(textos).not.toContain('claude-opus-5-5')
    await ui.unmount()
  })

  test('esfuerzo: con origen «ajustes» la misma fila agrega «según ajustes»', async ($, on) => {
    mock.clock(on, { now: AHORA })
    motorMide(on)
    motorUsa(on)
    mock.store(on)
    on('session.id', () => ({ value: 's1' }))
    on('session.model', () => ({ value: 'claude-opus-5-5' }))
    on('settings.read', () => ({ value: { effortLevel: 'xhigh' } }))
    on('command.register', () => ({ value: undefined }))
    on('session.start', (_$, e) => ({ cwd: e.cwd }))
    on('ui.open', () => ({ value: { isPlaced: true } }))
    await $.session.start({ cwd: 'D:\\GitHub-Personal\\mods-claude' })

    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    const fila = await ui.find({ type: 'Box', text: /^Esfuerzo/ })

    expect(fila?.text).toBe('Esfuerzo xhigh · claude-opus-5-5 · según ajustes')
    await ui.unmount()
  })

  test('esfuerzo: sin dato la fila dice «Esfuerzo —»', async ($, on) => {
    mock.clock(on, { now: AHORA })
    motorMide(on)
    motorUsa(on)
    await $.session.measure(MEDIDA)

    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    const fila = await ui.find({ type: 'Box', text: /^Esfuerzo/ })

    expect(fila?.text).toBe('Esfuerzo —')
    await ui.unmount()
  })

  test('turn.step con y sin agentId deja dos claves y dos filas en el panel', async ($, on) => {
    mock.clock(on, { now: AHORA })
    motorMide(on)
    motorUsa(on)
    // Un store propio (igual al de `mock.store`) para poder leer lo que quedó anotado.
    const guardados = new Map<string, unknown>()
    on('store.get', (_$, e) => ({ value: guardados.get(e.key) }))
    on('store.set', (_$, e) => {
      guardados.set(e.key, e.value)

      return { value: undefined }
    })
    on('store.delete', (_$, e) => {
      guardados.delete(e.key)

      return { value: undefined }
    })
    on('store.keys', () => ({ value: [...guardados.keys()] }))
    on('session.id', () => ({ value: 's1' }))
    motorResponde(on, 'claude-opus-5-5')
    await $.session.measure(MEDIDA)

    await paso($, 'claude-opus-5-5', 'high')
    await paso($, 'claude-opus-5-5', 'high', 'agente-1')

    const guardado = comoRegistro(guardados.get('uso:s1'))
    expect(Object.keys(guardado[String(inicioDeHora(AHORA))] ?? {}).sort()).toEqual([
      'claude-opus-5-5|high',
      'claude-opus-5-5|high|sub',
    ])

    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await ui.press({ key: 's-plegar' })
    const textos = (await ui.findAll({ type: 'Text' })).map(t => t.text ?? '')
    const sem = textos.indexOf('Esta semana')
    expect(textos.slice(sem)).toContain('Opus 5.5 high')
    expect(textos.slice(sem)).toContain('Opus 5.5 high · sub')
    await ui.unmount()
  })

  test('esta sesión cuenta solo su clave; la semana suma todas', async ($, on) => {
    const h = String(inicioDeHora(AHORA))
    mock.clock(on, { now: AHORA })
    motorMide(on)
    motorUsa(on)
    mock.store(on, { 'uso:otra': { [h]: { [clave('claude-sonnet-5-5', 'low')]: [400_000, 0, 0, 0] } } })
    on('session.id', () => ({ value: 's1' }))
    motorResponde(on, 'claude-opus-5-5')
    await $.session.measure(MEDIDA)

    await paso($, 'claude-opus-5-5', 'medium')

    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await ui.press({ key: 's-plegar' })
    const textos = (await ui.findAll({ type: 'Text' })).map(t => t.text ?? '')
    const ses = textos.indexOf('Esta sesión')
    const sem = textos.indexOf('Esta semana')

    expect(ses).toBeGreaterThan(-1)
    expect(ses).toBeLessThan(sem)
    const deSesion = textos.slice(ses, sem)
    expect(deSesion).toContain('Opus 5.5 medium')
    expect(deSesion).not.toContain('Sonnet 5.5 low')
    const deSemana = textos.slice(sem)
    expect(deSemana).toContain('Opus 5.5 medium')
    expect(deSemana).toContain('Sonnet 5.5 low')
    await ui.unmount()
  })

  test('sesión y semana: cada fila lleva justo debajo su barra y su % de la sección', async ($, on) => {
    const h = String(inicioDeHora(AHORA))
    mock.clock(on, { now: AHORA })
    motorMide(on)
    motorUsa(on)
    mock.store(on, { 'uso:otra': { [h]: { [clave('claude-sonnet-5-5', 'low')]: [400_000, 0, 0, 0] } } })
    on('session.id', () => ({ value: 's1' }))
    motorResponde(on, 'claude-opus-5-5')
    await $.session.measure(MEDIDA)

    await paso($, 'claude-opus-5-5', 'medium')

    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await ui.press({ key: 's-plegar' })
    const textos = (await ui.findAll({ type: 'Text' })).map(t => t.text ?? '')
    const ses = textos.indexOf('Esta sesión')
    const sem = textos.indexOf('Esta semana')

    // Sesión: una sola fila, es el 100 % de su sección.
    const i = textos.indexOf('Opus 5.5 medium', ses)
    expect(i).toBeGreaterThan(ses)
    expect(i).toBeLessThan(sem)
    // Tras la etiqueta va el ■ de actividad (solo en la sesión): por eso son 6 textos y no 5.
    expect(textos.slice(i, i + 6)).toEqual(['Opus 5.5 medium', ' ■', '   100k', '     2k', '█'.repeat(25), ' 100,0%'])

    // Semana: Sonnet 400k de 500k (80 %) y Opus 100k (20 %), cada barra bajo su fila.
    const j = textos.indexOf('Sonnet 5.5 low', sem)
    expect(j).toBeGreaterThan(sem)
    expect(textos.slice(j, j + 5)).toEqual(['Sonnet 5.5 low', '   400k', '      0', '█'.repeat(20) + '░'.repeat(5), '  80,0%'])
    const k = textos.indexOf('Opus 5.5 medium', sem)
    expect(k).toBeGreaterThan(j)
    expect(textos.slice(k, k + 5)).toEqual(['Opus 5.5 medium', '   100k', '     2k', '█'.repeat(5) + '░'.repeat(20), '  20,0%'])
    await ui.unmount()
  })

  test('«Esta semana» arranca plegada: título y total; el botón la despliega y lo guarda', async ($, on) => {
    const h = String(inicioDeHora(AHORA))
    mock.clock(on, { now: AHORA })
    motorMide(on)
    motorUsa(on)
    const guardados = new Map<string, unknown>([
      ['uso:otra', { [h]: { [clave('claude-sonnet-5-5', 'low')]: [400_000, 0, 0, 0] } }],
    ])
    on('store.get', (_$, e) => ({ value: guardados.get(e.key) }))
    on('store.set', (_$, e) => {
      guardados.set(e.key, e.value)

      return { value: undefined }
    })
    on('store.delete', (_$, e) => {
      guardados.delete(e.key)

      return { value: undefined }
    })
    on('store.keys', () => ({ value: [...guardados.keys()] }))
    on('session.id', () => ({ value: 's1' }))
    motorResponde(on, 'claude-opus-5-5')
    await $.session.measure(MEDIDA)
    await paso($, 'claude-opus-5-5', 'medium')

    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    let textos = (await ui.findAll({ type: 'Text' })).map(t => t.text ?? '')
    let sem = textos.indexOf('Esta semana')
    expect(sem).toBeGreaterThan(-1)
    // Con 32 columnas «Esta semana» + total con salida + botón caben justo (ajustado: antes '500k').
    expect(textos[sem + 1]).toBe('500k · sal 2k')
    expect(textos.slice(sem)).not.toContain('Sonnet 5.5 low')
    expect(textos.slice(sem)).not.toContain('modelo · esfuerzo')
    // «Esta sesión» no se pliega.
    expect(textos.slice(0, sem)).toContain('Opus 5.5 medium')
    expect((await ui.find({ type: 'Button', key: 's-plegar' }))?.props.label).toBe('Ver')

    await ui.press({ key: 's-plegar' })
    textos = (await ui.findAll({ type: 'Text' })).map(t => t.text ?? '')
    sem = textos.indexOf('Esta semana')
    expect(textos.slice(sem)).toContain('Sonnet 5.5 low')
    expect((await ui.find({ type: 'Button', key: 's-plegar' }))?.props.label).toBe('Ocultar')
    expect(guardados.get('prefs:semana')).toBe(true)

    await ui.press({ key: 's-plegar' })
    textos = (await ui.findAll({ type: 'Text' })).map(t => t.text ?? '')
    expect(textos.slice(textos.indexOf('Esta semana'))).not.toContain('Sonnet 5.5 low')
    expect(guardados.get('prefs:semana')).toBe(false)
    await ui.unmount()
  })

  // El kit de pruebas no implementa el `$.ui.scroll` de un plugin (no hay ventana real ni
  // hook que lo reciba): lo que sí se ve es la `key` a la que apunta y el `clock.after` que lo agenda.
  test('al desplegar «Esta semana» se agenda el desplazamiento hasta su key; al plegar no', async ($, on) => {
    const h = String(inicioDeHora(AHORA))
    // Sin `mock.clock`: este test es el dueño de `clock.after` para ver cuánto se espera.
    on('clock.now', () => ({ value: AHORA }))
    motorMide(on)
    motorUsa(on)
    mock.store(on, { 'uso:otra': { [h]: { [clave('claude-sonnet-5-5', 'low')]: [400_000, 0, 0, 0] } } })
    on('session.id', () => ({ value: 's1' }))
    const esperas: number[] = []
    on('clock.after', (_$, e) => {
      esperas.push(e.ms)

      return { value: undefined }
    })
    await $.session.measure(MEDIDA)

    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    // La sección plegable lleva la key a la que apunta el desplazamiento.
    expect(await ui.find({ type: 'Box', key: 'semana' })).toBeDefined()
    expect(esperas).toEqual([])

    await ui.press({ key: 's-plegar' })
    expect(esperas).toEqual([150])
    expect((await ui.find({ type: 'Button', key: 's-plegar' }))?.props.label).toBe('Ocultar')

    await ui.press({ key: 's-plegar' })
    expect(esperas).toEqual([150])
    expect((await ui.find({ type: 'Button', key: 's-plegar' }))?.props.label).toBe('Ver')
    await ui.unmount()
  })

  test('si command.register falla en session.start, la semana y la preferencia se cargan igual', async ($, on) => {
    const h = String(inicioDeHora(AHORA))
    mock.clock(on, { now: AHORA })
    motorMide(on)
    motorUsa(on)
    mock.store(on, {
      'prefs:semana': true,
      'uso:otra': { [h]: { [clave('claude-sonnet-5-5', 'low')]: [400_000, 0, 0, 0] } },
    })
    on('session.id', () => ({ value: 's1' }))
    on('session.model', () => ({ value: 'claude-opus-5-5' }))
    on('settings.read', () => ({ value: {} }))
    on('command.register', () => {
      throw new Error('registro rechazado')
    })
    on('session.start', (_$, e) => ({ cwd: e.cwd }))
    const abiertos: string[] = []
    on('ui.open', (_$, e) => {
      abiertos.push(e.id)

      return { value: { isPlaced: true } }
    })
    await $.session.start({ cwd: 'D:\\GitHub-Personal\\mods-claude' })

    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    const textos = (await ui.findAll({ type: 'Text' })).map(t => t.text ?? '')
    const sem = textos.indexOf('Esta semana')
    expect(textos.slice(sem)).toContain('Sonnet 5.5 low')
    expect(textos[sem + 1]).toBe('400k')
    expect((await ui.find({ type: 'Button', key: 's-plegar' }))?.props.label).toBe('Ocultar')
    expect(abiertos).toEqual(['panel-uso'])
    await ui.unmount()
  })

  test('al abrir sesión, «Esta semana» vuelve como se dejó; la preferencia no cuenta como uso', async ($, on) => {
    const h = String(inicioDeHora(AHORA))
    mock.clock(on, { now: AHORA })
    motorMide(on)
    motorUsa(on)
    mock.store(on, {
      'prefs:semana': true,
      'uso:otra': { [h]: { [clave('claude-sonnet-5-5', 'low')]: [400_000, 0, 0, 0] } },
    })
    on('session.id', () => ({ value: 's1' }))
    on('session.model', () => ({ value: 'claude-opus-5-5' }))
    on('settings.read', () => ({ value: {} }))
    on('command.register', () => ({ value: undefined }))
    on('session.start', (_$, e) => ({ cwd: e.cwd }))
    on('ui.open', () => ({ value: { isPlaced: true } }))
    await $.session.start({ cwd: 'D:\\GitHub-Personal\\mods-claude' })

    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    const textos = (await ui.findAll({ type: 'Text' })).map(t => t.text ?? '')
    const sem = textos.indexOf('Esta semana')
    expect(textos.slice(sem)).toContain('Sonnet 5.5 low')
    expect(textos[sem + 1]).toBe('400k')
    expect((await ui.find({ type: 'Button', key: 's-plegar' }))?.props.label).toBe('Ocultar')
    await ui.unmount()
  })

  test('el encabezado de «Esta sesión» suma la salida de todas las filas (modelos, esfuerzos y subagentes)', async ($, on) => {
    mock.clock(on, { now: AHORA })
    motorMide(on)
    motorUsa(on)
    mock.store(on)
    on('session.id', () => ({ value: 's1' }))
    motorResponde(on, 'claude-opus-5-5')
    await $.session.measure(MEDIDA)

    await paso($, 'claude-opus-5-5', 'medium')
    await paso($, 'claude-opus-5-5', 'medium', 'agente-1')
    await paso($, 'claude-opus-5-5', 'high')
    await paso($, 'claude-opus-5-5', 'low', 'agente-2')

    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    const textos = (await ui.findAll({ type: 'Text' })).map(t => t.text ?? '')
    const ses = textos.indexOf('Esta sesión')

    // Cuatro respuestas de 100k con 2k de salida cada una.
    expect(textos[ses + 1]).toBe('400k · sal 8k')
    await ui.unmount()
  })

  /** Una semana de otra terminal: 530k en total, 130k de salida (más lo de este turno si lo hay). */
  function motorSemana(on: On, abierta: boolean) {
    const h = String(inicioDeHora(AHORA))
    mock.clock(on, { now: AHORA })
    motorMide(on)
    motorUsa(on)
    mock.store(on, {
      ...(abierta ? { 'prefs:semana': true } : {}),
      'uso:otra': { [h]: { [clave('claude-sonnet-5-5', 'low')]: [400_000, 130_000, 0, 0] } },
    })
    on('session.id', () => ({ value: 's1' }))
  }

  const conColumnas = (columnas: number) => ({ ...PANE, props: { ...PANE.props, bodyColumns: columnas } })

  test('«Esta semana» ancha: la salida va en el encabezado, junto al botón', async ($, on) => {
    motorSemana(on, false)
    await $.session.measure(MEDIDA)

    const ui = await $.ui.mount({ ...conColumnas(40), surface: 'terminal' })
    let textos = (await ui.findAll({ type: 'Text' })).map(t => t.text ?? '')
    let sem = textos.indexOf('Esta semana')

    expect(textos[sem + 1]).toBe('530k · sal 130k')
    expect((await ui.find({ type: 'Button', key: 's-plegar' }))?.props.label).toBe('Ver')

    // Desplegada sigue en el encabezado y el pie no la repite.
    await ui.press({ key: 's-plegar' })
    textos = (await ui.findAll({ type: 'Text' })).map(t => t.text ?? '')
    sem = textos.indexOf('Esta semana')
    expect(textos[sem + 1]).toBe('530k · sal 130k')
    expect(textos.some(t => t.endsWith('total incluye caché'))).toBe(true)
    expect(textos.some(t => t.startsWith('sal 130k'))).toBe(false)
    await ui.unmount()
  })

  test('«Esta semana» justa: el encabezado queda con el total y la salida pasa al pie', async ($, on) => {
    motorSemana(on, false)
    await $.session.measure(MEDIDA)

    const ui = await $.ui.mount({ ...conColumnas(32), surface: 'terminal' })
    let textos = (await ui.findAll({ type: 'Text' })).map(t => t.text ?? '')
    let sem = textos.indexOf('Esta semana')

    // Plegada y sin espacio: la salida no se muestra todavía.
    expect(textos[sem + 1]).toBe('530k')
    expect(textos.some(t => t.includes('sal 130k'))).toBe(false)

    await ui.press({ key: 's-plegar' })
    textos = (await ui.findAll({ type: 'Text' })).map(t => t.text ?? '')
    sem = textos.indexOf('Esta semana')
    expect(textos[sem + 1]).toBe('530k')
    // El pie lleva la salida primero y sigue con lo de siempre («anotado desde …» · «total incluye caché»).
    expect(textos.some(t => t.startsWith('sal 130k · ') && t.endsWith(' · total incluye caché'))).toBe(true)
    await ui.unmount()
  })

  test('el límite del ancho: con 34 columnas cabe justo, con 33 la salida pasa al pie', async ($, on) => {
    motorSemana(on, false)
    await $.session.measure(MEDIDA)

    // «Esta semana» (11) + «530k · sal 130k» (15) + espacio (1) + «[ Ver ]» (7) = 34.
    const justo = await $.ui.mount({ ...conColumnas(34), surface: 'terminal' })
    let textos = (await justo.findAll({ type: 'Text' })).map(t => t.text ?? '')
    expect(textos[textos.indexOf('Esta semana') + 1]).toBe('530k · sal 130k')
    await justo.unmount()

    const corto = await $.ui.mount({ ...conColumnas(33), surface: 'terminal' })
    textos = (await corto.findAll({ type: 'Text' })).map(t => t.text ?? '')
    expect(textos[textos.indexOf('Esta semana') + 1]).toBe('530k')
    await corto.unmount()
  })

  test('ninguna fila de encabezado supera el ancho, plegada o desplegada', async ($, on) => {
    motorSemana(on, false)
    motorResponde(on, 'claude-opus-5-5')
    await $.session.measure(MEDIDA)
    await paso($, 'claude-opus-5-5', 'medium')

    for (const columnas of [28, 32, 33, 34, 40, 80]) {
      const ancho = Math.min(40, columnas)
      const ui = await $.ui.mount({ ...conColumnas(columnas), surface: 'terminal' })

      for (const titulo of ['Esta sesión', 'Esta semana']) {
        for (const abierta of [false, true]) {
          if (abierta !== ((await ui.find({ type: 'Button', key: 's-plegar' }))?.props.label === 'Ocultar')) {
            await ui.press({ key: 's-plegar' })
          }
          const cabeceras = (await ui.findAll({ type: 'Box' }))
            .map(b => b.text ?? '')
            .filter(t => t.startsWith(titulo))
            .sort((a, b) => a.length - b.length)
          const cabecera = cabeceras[0] ?? ''
          const textos = (await ui.findAll({ type: 'Text' })).map(t => t.text ?? '')
          const total = textos[textos.indexOf(titulo) + 1] ?? ''
          const boton = titulo === 'Esta semana' ? ` [ ${abierta ? 'Ocultar' : 'Ver'} ]` : ''

          expect(cabecera.length).toBeGreaterThan(0)
          expect(cabecera.length).toBeLessThanOrEqual(ancho)
          expect(`${titulo}${total}${boton}`.length).toBeLessThanOrEqual(ancho)
        }
      }
      await ui.unmount()
    }
  })

  test('sin uso anotado lo dice', async ($, on) => {
    mock.clock(on, { now: AHORA })
    motorMide(on)
    motorUsa(on)
    mock.store(on)
    await $.session.measure(MEDIDA)

    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect(await ui.find({ type: 'Text', text: /sin respuestas anotadas/ })).toBeDefined()
    await ui.unmount()
  })
})

/** Un registro con una sola clave en cada hora dada. */
function registroEn(horas: readonly number[], cuentas: Cuentas = [1, 2, 3, 4]): Registro {
  return Object.fromEntries(horas.map(h => [String(h), { 'claude-opus-5-5|high': cuentas }]))
}

/** Comienzo del día local `d` (día del mes, puede salirse del mes: se normaliza por calendario). */
function diaLocal(anio: number, mes: number, d: number): number {
  return new Date(anio, mes, d).getTime()
}

describe('días', () => {
  test('etiquetaDia: nombre corto en español y número del día local', async () => {
    expect(etiquetaDia(new Date(2026, 9, 10, 12).getTime())).toBe('sáb 10')
    expect(etiquetaDia(new Date(2026, 9, 7, 0).getTime())).toBe('mié 7')
    expect(etiquetaDia(new Date(2026, 9, 11, 23, 59).getTime())).toBe('dom 11')
    expect(etiquetaDia(new Date(2026, 9, 12, 8).getTime())).toBe('lun 12')
    expect(etiquetaDia(new Date(2026, 9, 13, 8).getTime())).toBe('mar 13')
    expect(etiquetaDia(new Date(2026, 9, 8, 8).getTime())).toBe('jue 8')
    expect(etiquetaDia(new Date(2026, 9, 9, 8).getTime())).toBe('vie 9')
  })

  test('agrupa por día local y suma entrada, salida y las dos cachés', async () => {
    const r = registroEn([
      new Date(2026, 9, 5, 9).getTime(),
      new Date(2026, 9, 5, 18).getTime(),
      new Date(2026, 9, 6, 12).getTime(),
    ])
    const s = resumir([r], 0)

    expect(s.dias).toEqual([
      { inicio: diaLocal(2026, 9, 5), total: 20 },
      { inicio: diaLocal(2026, 9, 6), total: 10 },
    ])
    expect(s.total).toBe(30)
  })

  test('suma las sesiones del mismo día y rellena con 0 los días sin uso', async () => {
    const a = registroEn([new Date(2026, 9, 5, 12).getTime()], [10, 0, 0, 0])
    const b = registroEn([new Date(2026, 9, 5, 15).getTime(), new Date(2026, 9, 8, 12).getTime()], [5, 0, 0, 0])
    const s = resumir([a, b], 0)

    expect(s.dias).toEqual([
      { inicio: diaLocal(2026, 9, 5), total: 15 },
      { inicio: diaLocal(2026, 9, 6), total: 0 },
      { inicio: diaLocal(2026, 9, 7), total: 0 },
      { inicio: diaLocal(2026, 9, 8), total: 5 },
    ])
  })

  test('tope de 7 días: quedan los 7 más recientes', async () => {
    const horas = Array.from({ length: 10 }, (_, i) => new Date(2026, 9, 1 + i, 12).getTime())
    const s = resumir([registroEn(horas)], 0)

    expect(s.dias.map(d => d.inicio)).toEqual(Array.from({ length: 7 }, (_, i) => diaLocal(2026, 9, 4 + i)))
  })

  test('con `ahora` la lista llega hasta hoy; sin él, hasta el último día con uso', async () => {
    const r = registroEn([new Date(2026, 9, 6, 12).getTime()], [10, 0, 0, 0])
    const ahora = new Date(2026, 9, 9, 15).getTime()

    const con = resumir([r], 0, ahora)
    expect(con.dias).toEqual([
      { inicio: diaLocal(2026, 9, 6), total: 10 },
      { inicio: diaLocal(2026, 9, 7), total: 0 },
      { inicio: diaLocal(2026, 9, 8), total: 0 },
      { inicio: diaLocal(2026, 9, 9), total: 0 },
    ])

    expect(resumir([r], 0).dias).toEqual([{ inicio: diaLocal(2026, 9, 6), total: 10 }])
    // `ahora` en el mismo día del último uso no agrega nada.
    expect(resumir([r], 0, new Date(2026, 9, 6, 23).getTime()).dias).toHaveLength(1)
  })

  test('con `ahora` y mucho tiempo sin uso, quedan solo los 7 últimos días (todos en 0 salvo el viejo fuera)', async () => {
    const r = registroEn([new Date(2026, 9, 1, 12).getTime()])
    const s = resumir([r], 0, new Date(2026, 9, 10, 12).getTime())

    expect(s.dias.map(d => d.inicio)).toEqual(Array.from({ length: 7 }, (_, i) => diaLocal(2026, 9, 4 + i)))
    expect(s.dias.every(d => d.total === 0)).toBe(true)
  })

  test('sin uso, o con todo antes de la ventana, `dias` queda vacío', async () => {
    expect(resumir([], 0).dias).toEqual([])
    expect(resumir([{}], 0, AHORA).dias).toEqual([])

    const viejo = registroEn([new Date(2026, 9, 1, 12).getTime()])
    expect(resumir([viejo], new Date(2026, 9, 5).getTime(), AHORA).dias).toEqual([])
  })

  test('la ventana de la semana sigue igual: una hora que termina antes de `desde` no cuenta', async () => {
    const h = new Date(2026, 9, 5, 12).getTime()
    const r = registroEn([h, h + 3 * 3_600_000], [10, 0, 0, 0])

    expect(resumir([r], h + 3_600_000).dias).toEqual([{ inicio: diaLocal(2026, 9, 5), total: 10 }])
    expect(resumir([r], h + 3 * 3_600_000 + 3_600_000).dias).toEqual([])
  })

  test('avanza por calendario: 7 días seguidos son 7 inicios distintos, con cualquier huso, cambio de hora o fin de mes', async () => {
    // Cada arranque posible de 2026 (cruza fines de mes y los cambios de hora de cualquier huso).
    for (let n = 0; n < 365; n++) {
      const horas = Array.from({ length: 7 }, (_, i) => new Date(2026, 0, 1 + n + i, 12).getTime())
      const esperados = Array.from({ length: 7 }, (_, i) => diaLocal(2026, 0, 1 + n + i))
      const s = resumir([registroEn(horas)], 0)

      expect(s.dias.map(d => d.inicio)).toEqual(esperados)
      expect(new Set(s.dias.map(d => d.inicio)).size).toBe(7)
      expect(s.dias.every(d => d.total === 10)).toBe(true)

      // Un solo día con uso al principio y `ahora` 6 días después: rellena los 5 del medio con 0.
      const hueco = resumir([registroEn([horas[0] ?? 0])], 0, horas[6])
      expect(hueco.dias.map(d => d.inicio)).toEqual(esperados)
      expect(hueco.dias.map(d => d.total)).toEqual([10, 0, 0, 0, 0, 0, 0])
    }

    // Fin de mes explícito: del 27 de septiembre al 3 de octubre.
    const s = resumir([registroEn([0, 1, 2, 3, 4, 5, 6].map(i => new Date(2026, 8, 27 + i, 12).getTime()))], 0)
    expect(s.dias.map(d => etiquetaDia(d.inicio).split(' ')[1])).toEqual(['27', '28', '29', '30', '1', '2', '3'])
  })

  test('el panel desplegado dibuja «por día»: etiqueta, barra y total de cada día, a ancho completo', async ($, on) => {
    const dia5 = new Date(2026, 9, 5, 12).getTime()
    const dia8 = new Date(2026, 9, 8, 12).getTime()
    mock.clock(on, { now: AHORA })
    motorMide(on)
    motorUsa(on)
    mock.store(on, {
      'uso:otra': {
        [String(dia5)]: { [clave('claude-sonnet-5-5', 'low')]: [400_000, 0, 0, 0] },
        [String(dia8)]: { [clave('claude-sonnet-5-5', 'low')]: [100_000, 0, 0, 0] },
      },
    })
    on('session.id', () => ({ value: 's1' }))
    motorResponde(on, 'claude-opus-5-5')
    await $.session.measure(MEDIDA)
    await paso($, 'claude-opus-5-5', 'medium')

    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

    // Plegada: ni el bloque ni sus filas.
    let textos = (await ui.findAll({ type: 'Text' })).map(t => t.text ?? '')
    expect(textos).not.toContain('por día')
    expect(await ui.find({ type: 'Box', key: `dia-${diaLocal(2026, 9, 5)}` })).toBeUndefined()

    await ui.press({ key: 's-plegar' })
    textos = (await ui.findAll({ type: 'Text' })).map(t => t.text ?? '')

    // Solo en «Esta semana», una vez; «Esta sesión» no lo muestra.
    expect(textos.filter(t => t === 'por día')).toHaveLength(1)
    expect(textos.indexOf('por día')).toBeGreaterThan(textos.indexOf('Esta semana'))

    // Del 5 de octubre al día local de AHORA, y los totales: 400k, 100k y lo de este turno (100k).
    const hoy = new Date(AHORA)
    const ultimo = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate()).getTime()
    const inicios: number[] = []
    for (let i = 0; diaLocal(2026, 9, 5 + i) <= ultimo; i++) inicios.push(diaLocal(2026, 9, 5 + i))
    const totales = new Map<number, number>([
      [diaLocal(2026, 9, 5), 400_000],
      [diaLocal(2026, 9, 8), 100_000],
    ])
    totales.set(ultimo, (totales.get(ultimo) ?? 0) + 100_000)
    const ancho = 32

    for (const inicio of inicios) {
      const total = totales.get(inicio) ?? 0
      const fila = await ui.find({ type: 'Box', key: `dia-${inicio}` })
      const esperada = `${etiquetaDia(inicio).padEnd(6)} ${barra((total / 400_000) * 100, ancho - 14)}${tokens(total).padStart(7)}`

      expect(textos).toContain(`${etiquetaDia(inicio).padEnd(6)} `)
      expect(fila?.text).toBe(esperada)
      expect(fila?.text).toHaveLength(ancho)
    }
    expect(await ui.find({ type: 'Box', key: `dia-${inicios[0] ?? 0}` })).toBeDefined()
    // Ni un día antes del primero ni uno después de hoy.
    expect(await ui.find({ type: 'Box', key: `dia-${diaLocal(2026, 9, 4)}` })).toBeUndefined()
    expect(await ui.find({ type: 'Box', key: `dia-${diaLocal(2026, 9, 5 + inicios.length)}` })).toBeUndefined()
    expect(textos.slice(textos.indexOf('por día'))).toContain('   400k')

    // Plegar otra vez lo quita.
    await ui.press({ key: 's-plegar' })
    textos = (await ui.findAll({ type: 'Text' })).map(t => t.text ?? '')
    expect(textos).not.toContain('por día')
    await ui.unmount()
  })

  test('el panel sin uso no dibuja «por día»', async ($, on) => {
    mock.clock(on, { now: AHORA })
    motorMide(on)
    motorUsa(on)
    mock.store(on, { 'prefs:semana': true })
    on('session.id', () => ({ value: 's1' }))
    await $.session.measure(MEDIDA)

    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    const textos = (await ui.findAll({ type: 'Text' })).map(t => t.text ?? '')

    expect(textos).not.toContain('por día')
    await ui.unmount()
  })
})

describe('actividad (puro)', () => {
  const T0 = 5_000_000
  const A = idFila('claude-opus-5-5', 'high', false)
  const B = idFila('claude-opus-5-5', 'high', true)

  test('inicio → activo', async () => {
    const a = iniciarPeticion({}, A, T0)

    expect(a[A]).toEqual({ enVuelo: 1, pendiente: false, desde: T0 })
    expect(estadoActividad(a, A, T0)).toBe('activo')
    expect(estadoActividad(a, B, T0)).toBe('inactivo')
  })

  test('fin con herramienta pendiente y otra fila en vuelo → espera', async () => {
    let a: Actividad = iniciarPeticion({}, A, T0)
    a = iniciarPeticion(a, B, T0)
    a = terminarPeticion(a, A, T0 + 1_000, true)

    expect(a[A]).toEqual({ enVuelo: 0, pendiente: true, desde: T0 + 1_000 })
    expect(estadoActividad(a, A, T0 + 2_000)).toBe('espera')
    expect(estadoActividad(a, B, T0 + 2_000)).toBe('activo')
  })

  test('la misma fila pendiente sin ninguna otra activa → espera', async () => {
    let a: Actividad = iniciarPeticion({}, A, T0)
    a = terminarPeticion(a, A, T0 + 1_000, true)

    expect(estadoActividad(a, A, T0 + 2_000)).toBe('espera')
    // Otra fila conocida pero sin nada en vuelo no cambia nada.
    a = terminarPeticion(iniciarPeticion(a, B, T0 + 3_000), B, T0 + 4_000, false)
    expect(estadoActividad(a, A, T0 + 5_000)).toBe('espera')
    expect(estadoActividad(a, B, T0 + 5_000)).toBe('inactivo')
  })

  test('fin sin herramienta → inactivo, aunque otra fila esté activa', async () => {
    let a: Actividad = iniciarPeticion({}, A, T0)
    a = iniciarPeticion(a, B, T0)
    a = terminarPeticion(a, A, T0 + 1_000, false)

    expect(a[A]?.pendiente).toBe(false)
    expect(estadoActividad(a, A, T0 + 2_000)).toBe('inactivo')
  })

  test('los contadores nunca son negativos: terminar más veces de las que se inició', async () => {
    let a: Actividad = terminarPeticion({}, A, T0, false)
    expect(a[A]?.enVuelo).toBe(0)

    a = iniciarPeticion(a, A, T0)
    a = terminarPeticion(a, A, T0 + 1, false)
    a = terminarPeticion(a, A, T0 + 2, false)
    a = terminarPeticion(a, A, T0 + 3, true)

    expect(a[A]?.enVuelo).toBe(0)
    // La última terminación pidió herramienta: sin otra fila activa ahora también es espera.
    expect(estadoActividad(a, A, T0 + 4)).toBe('espera')
  })

  test('dos peticiones simultáneas de la misma fila: con una que termina sigue activa', async () => {
    let a: Actividad = iniciarPeticion(iniciarPeticion({}, A, T0), A, T0 + 1)
    expect(a[A]?.enVuelo).toBe(2)

    a = terminarPeticion(a, A, T0 + 2, false)
    expect(a[A]?.enVuelo).toBe(1)
    expect(estadoActividad(a, A, T0 + 3)).toBe('activo')

    a = terminarPeticion(a, A, T0 + 4, false)
    expect(estadoActividad(a, A, T0 + 5)).toBe('inactivo')
  })

  test('iniciar una petición borra la espera de su fila', async () => {
    let a: Actividad = iniciarPeticion({}, B, T0)
    a = terminarPeticion(iniciarPeticion(a, A, T0), A, T0 + 1, true)
    expect(a[A]?.pendiente).toBe(true)

    a = iniciarPeticion(a, A, T0 + 2)
    expect(a[A]).toEqual({ enVuelo: 1, pendiente: false, desde: T0 + 2 })
  })

  test('la espera caduca pasados ESPERA_MAX_MS', async () => {
    expect(ESPERA_MAX_MS).toBe(30 * 60_000)
    let a: Actividad = iniciarPeticion({}, B, T0)
    a = terminarPeticion(iniciarPeticion(a, A, T0), A, T0, true)

    expect(estadoActividad(a, A, T0 + ESPERA_MAX_MS)).toBe('espera')
    expect(estadoActividad(a, A, T0 + ESPERA_MAX_MS + 1)).toBe('inactivo')
  })

  test('limpiarPendientes: quita toda espera y no toca lo que sigue en vuelo; no muta', async () => {
    let a: Actividad = iniciarPeticion({}, B, T0)
    a = terminarPeticion(iniciarPeticion(a, A, T0), A, T0 + 1, true)
    const copia = JSON.parse(JSON.stringify(a)) as Actividad
    const limpia = limpiarPendientes(a)

    expect(limpia[A]).toEqual({ enVuelo: 0, pendiente: false, desde: T0 + 1 })
    expect(limpia[B]).toEqual({ enVuelo: 1, pendiente: false, desde: T0 })
    expect(estadoActividad(limpia, A, T0 + 2)).toBe('inactivo')
    expect(a).toEqual(copia)
    expect(limpiarPendientes({})).toEqual({})
  })

  test('las funciones no mutan la actividad que reciben', async () => {
    const a: Actividad = Object.freeze({ [A]: Object.freeze({ enVuelo: 1, pendiente: false, desde: T0 }) })

    expect(iniciarPeticion(a, A, T0 + 1)[A]?.enVuelo).toBe(2)
    expect(terminarPeticion(a, A, T0 + 1, true)[A]?.enVuelo).toBe(0)
    expect(a[A]?.enVuelo).toBe(1)
  })

  test('idFila coincide con el id de las filas de resumir (principal, subagente y sin esfuerzo)', async () => {
    const h = inicioDeHora(AHORA)
    let r: Registro = {}
    r = anotar(r, h, clave('claude-opus-5-5', 'high'), USO)
    r = anotar(r, h, clave('claude-opus-5-5', 'high', true), USO)
    r = anotar(r, h, clave('claude-haiku-5-5', undefined), USO)
    r = anotar(r, h, clave('claude-sonnet-4-20250514', 'xhigh', true), USO)
    const s = resumir([r], h - 1)

    expect(s.filas.map(idDeFila).sort()).toEqual(
      [
        idFila('claude-opus-5-5', 'high', false),
        idFila('claude-opus-5-5', 'high', true),
        idFila('claude-haiku-5-5', undefined, false),
        idFila('claude-sonnet-4-20250514', 'xhigh', true),
      ].sort(),
    )
    expect(idFila('claude-opus-5-5', 'high', false)).toBe('Opus 5.5|high|principal')
    expect(idFila('claude-haiku-5-5', undefined, true)).toBe('Haiku 5.5|—|subagente')
  })
})

describe('flujo (puro)', () => {
  const estado = (modo: 'preflight' | 'base' | 'cambios' | 'diff'): Senal => ({ tipo: 'estado', modo })
  const verificar: Senal = { tipo: 'verificar' }
  const agente = (nombre: string): Senal => ({ tipo: 'agente', nombre })
  const agenteFin = (nombre: string): Senal => ({ tipo: 'agente-fin', nombre })
  const pregunta = (plan: boolean): Senal => ({ tipo: 'pregunta', plan })
  const escritura = (destino: 'mapa' | 'reglas' | 'doc'): Senal => ({ tipo: 'escritura', destino })

  /** Inicia el flujo y devuelve el paso en que queda tras cada señal. */
  function pasos(skill: string, senales: Senal[], texto = ''): number[] {
    let f = iniciarFlujo(skill, texto)
    const vistos: number[] = []

    for (const s of senales) {
      f = avanzar(f, s)
      vistos.push(f?.paso ?? -1)
    }

    return vistos
  }

  const bash = (command: string) => senalDeHerramienta('Bash', { command }, undefined)
  const doc = (f: Flujo | null) => (f ? `${f.estado}:${f.paso}` : 'null')

  test('iniciarFlujo: solo las tres skills (con o sin / y prefijo); auditar por el pedido', async () => {
    const base = { paso: 0, ejecuto: false, estado: 'en curso' }

    expect(iniciarFlujo('implementador', '')).toEqual({ ...base, nombre: 'implementador', variante: null })
    expect(iniciarFlujo('/implementador-ligero', '')).toEqual({ ...base, nombre: 'implementador-ligero', variante: null })
    expect(iniciarFlujo('claude-config:implementador', '')).toEqual({ ...base, nombre: 'implementador', variante: null })
    expect(iniciarFlujo('/mi-plugin:documentar', '')).toEqual({ ...base, nombre: 'documentar', variante: null })
    expect(iniciarFlujo('documentar', '**Pedido:**   auditar la guía')).toEqual({ ...base, nombre: 'documentar', variante: 'auditar' })
    expect(iniciarFlujo('documentar', '**Pedido:** auditoría')).toEqual({ ...base, nombre: 'documentar', variante: null })
    expect(iniciarFlujo('documentar', '**Pedido:** documentar el panel')).toEqual({ ...base, nombre: 'documentar', variante: null })
    // Auditar solo existe en documentar.
    expect(iniciarFlujo('implementador', '**Pedido:** auditar')?.variante).toBeNull()
    expect(iniciarFlujo('simplify', '')).toBeNull()
    expect(iniciarFlujo('/implementador:otra', '')).toBeNull()
    expect(iniciarFlujo('', '')).toBeNull()
  })

  test('senalDeHerramienta: estado.mjs con sus opciones, verificar.mjs, ~ y $HOME, y no un cat', async () => {
    expect(bash('node ~/.claude/flujos/estado.mjs')).toEqual(estado('preflight'))
    expect(bash('node ~/.claude/flujos/estado.mjs --base')).toEqual(estado('base'))
    expect(bash('node "$HOME/.claude/flujos/estado.mjs" --cambios')).toEqual(estado('cambios'))
    expect(bash('node ~/.claude/flujos/estado.mjs --diff 2>&1')).toEqual(estado('diff'))
    expect(bash('cd repo && node ~/.claude/flujos/estado.mjs --base')).toEqual(estado('base'))
    expect(bash('node ~/.claude/flujos/verificar.mjs')).toEqual(verificar)
    expect(bash('node "$HOME/.claude/flujos/verificar.mjs"')).toEqual(verificar)
    // Si aparecen los dos, manda estado.
    expect(bash('node ~/.claude/flujos/verificar.mjs && node ~/.claude/flujos/estado.mjs --cambios')).toEqual(estado('cambios'))

    // Casos negativos: leer el script no es correrlo, y una opción dentro de una ruta no cuenta.
    expect(bash('cat ~/.claude/flujos/estado.mjs')).toBeNull()
    expect(bash('cat ~/.claude/flujos/verificar.mjs | node')).toBeNull()
    expect(bash('node ~/.claude/flujos/otro.mjs')).toBeNull()
    expect(bash('node ~/.claude/flujos/mi-estado.mjs')).toBeNull()
    expect(bash('node x.mjs | cat estado.mjs')).toBeNull()
    expect(bash('node ~/.claude/flujos/estado.mjs --basement')).toEqual(estado('preflight'))
    expect(bash('node ~/--base/.claude/flujos/estado.mjs')).toEqual(estado('preflight'))
    expect(bash('ls')).toBeNull()
    expect(senalDeHerramienta('Bash', {}, undefined)).toBeNull()
    expect(senalDeHerramienta('Bash', { command: 3 }, undefined)).toBeNull()
  })

  test('senalDeHerramienta: Agent, AskUserQuestion (header Plan), Edit/Write (mapa, reglas, doc) y nada de un subagente', async () => {
    expect(senalDeHerramienta('Agent', { subagent_type: 'explorador' }, undefined)).toEqual(agente('explorador'))
    expect(senalDeHerramienta('Agent', { subagent_type: '' }, undefined)).toBeNull()
    expect(senalDeHerramienta('Agent', { prompt: 'x' }, undefined)).toBeNull()

    expect(senalDeHerramienta('AskUserQuestion', { questions: [{ header: 'Plan' }] }, undefined)).toEqual(pregunta(true))
    expect(senalDeHerramienta('AskUserQuestion', { questions: [{ header: 'Otra' }, { header: ' plan ' }] }, undefined)).toEqual(pregunta(true))
    expect(senalDeHerramienta('AskUserQuestion', { questions: [{ header: 'Planes' }] }, undefined)).toEqual(pregunta(false))
    expect(senalDeHerramienta('AskUserQuestion', {}, undefined)).toEqual(pregunta(false))

    const rutas: [string, 'mapa' | 'reglas' | 'doc'][] = [
      ['D:\\repo\\.claude\\documentar\\cobertura.md', 'mapa'],
      ['/repo/.claude/documentar.md', 'reglas'],
      ['D:\\repo\\.claude\\documentar.md', 'reglas'],
      ['/repo/MODS.md', 'doc'],
      ['/repo/.claude/documentar/otra.md', 'doc'],
    ]
    for (const [file_path, destino] of rutas) {
      expect(senalDeHerramienta('Edit', { file_path }, undefined)).toEqual(escritura(destino))
      expect(senalDeHerramienta('Write', { file_path }, undefined)).toEqual(escritura(destino))
    }

    expect(senalDeHerramienta('Read', { file_path: '/repo/MODS.md' }, undefined)).toBeNull()
    expect(senalDeHerramienta('Grep', {}, undefined)).toBeNull()

    // Lo que hace un subagente no mueve el flujo.
    expect(senalDeHerramienta('Bash', { command: 'node ~/.claude/flujos/estado.mjs' }, 'agente-1')).toBeNull()
    expect(senalDeHerramienta('Agent', { subagent_type: 'ejecutor' }, 'agente-1')).toBeNull()
    expect(senalDeHerramienta('Edit', { file_path: '/repo/a.ts' }, 'agente-1')).toBeNull()
    expect(senalDeHerramienta('AskUserQuestion', { questions: [{ header: 'Plan' }] }, 'agente-1')).toBeNull()
  })

  test('senalAlTerminar: solo el explorador', async () => {
    expect(senalAlTerminar(agente('explorador'))).toEqual(agenteFin('explorador'))
    expect(senalAlTerminar(agente('planificador'))).toBeNull()
    expect(senalAlTerminar(agenteFin('explorador'))).toBeNull()
    expect(senalAlTerminar(verificar)).toBeNull()
  })

  test('implementador CRÍTICO: de Preflight a Cierre con ciclo de corrección y revisión integral', async () => {
    const subtarea = [estado('base'), agente('ejecutor'), estado('cambios'), agente('revisor')]
    const secuencia = [
      estado('preflight'),
      verificar,
      agente('explorador'),
      agenteFin('explorador'),
      agente('planificador'),
      pregunta(true),
      ...subtarea,
      ...subtarea,
      verificar,
      agente('revisor'),
      estado('cambios'),
      verificar,
    ]

    expect(pasos('implementador', secuencia)).toEqual([0, 0, 1, 2, 3, 4, 5, 5, 5, 5, 5, 5, 5, 5, 6, 6, 7, 7])
  })

  test('implementador NORMAL: sin planificador salta de Clasificación a Aprobación', async () => {
    expect(
      pasos('implementador', [estado('preflight'), agente('explorador'), agenteFin('explorador'), pregunta(true), estado('base')]),
    ).toEqual([0, 1, 2, 4, 5])
    // Una pregunta que no es el plan no mueve nada; el fin de otro agente tampoco.
    expect(pasos('implementador', [agente('explorador'), pregunta(false), agenteFin('planificador')])).toEqual([1, 1, 1])
    // El fin del explorador solo cuenta desde Exploración.
    expect(pasos('implementador', [estado('base'), agenteFin('explorador')])).toEqual([5, 5])
    expect(pasos('implementador', [estado('diff')])).toEqual([0])
  })

  test('verificación final ROJA: la corrección vuelve a Ejecución y la nueva verificación a Verificación final', async () => {
    const secuencia = [
      estado('base'),
      agente('ejecutor'),
      estado('cambios'),
      verificar,
      estado('base'),
      agente('ejecutor'),
      agente('revisor'),
      verificar,
      estado('cambios'),
      verificar,
    ]

    expect(pasos('implementador', secuencia)).toEqual([5, 5, 5, 6, 5, 5, 5, 6, 7, 7])
  })

  test('implementador-ligero: sin explorador, rechazo y cierre', async () => {
    const secuencia = [
      pregunta(true),
      agente('ejecutor'),
      estado('cambios'),
      agente('revisor'),
      agente('ejecutor'),
      agente('revisor'),
      estado('cambios'),
      verificar,
      agente('planificador'),
    ]

    expect(pasos('implementador-ligero', secuencia)).toEqual([4, 5, 5, 6, 5, 6, 7, 7, 7])
    expect(pasos('implementador-ligero', [verificar, estado('preflight'), agente('explorador'), agenteFin('explorador')])).toEqual([0, 0, 1, 2])
    expect(pasos('implementador-ligero', [agente('planificador'), pregunta(false)])).toEqual([0, 0])
  })

  test('documentar: Ficha, Lectura, Escritura, Revisión y Cierre; el mapa antes de la revisión no avanza; las reglas no cuentan', async () => {
    const secuencia = [
      estado('preflight'),
      pregunta(false),
      agente('lector'),
      escritura('mapa'),
      escritura('reglas'),
      escritura('doc'),
      escritura('reglas'),
      agente('revisor-doc'),
      escritura('doc'),
      escritura('mapa'),
    ]

    expect(pasos('documentar', secuencia)).toEqual([0, 2, 3, 3, 3, 4, 4, 5, 4, 4])
    // Tras la revisión, el mapa lleva al Cierre.
    expect(pasos('documentar', [pregunta(true), agente('lector'), escritura('doc'), agente('revisor-doc'), escritura('mapa')])).toEqual([2, 3, 4, 5, 6])
    // Ya pasada la Ficha, otra pregunta no retrocede; lo ajeno al flujo tampoco lo mueve.
    expect(pasos('documentar', [agente('lector'), pregunta(false), verificar, agente('ejecutor'), estado('base')])).toEqual([3, 3, 3, 3, 3])
    // Una pregunta en Preflight lleva a Ficha; en Modo también.
    expect(pasos('documentar', [pregunta(false), pregunta(false)])).toEqual([2, 2])
  })

  test('documentar auditar: mismos pasos con sus nombres', async () => {
    const f = iniciarFlujo('documentar', '**Pedido:** auditar')

    expect(f?.variante).toBe('auditar')
    expect(pasos('documentar', [pregunta(false), agente('lector'), escritura('doc'), agente('revisor-doc'), escritura('mapa')], '**Pedido:** auditar')).toEqual([
      2, 3, 4, 5, 6,
    ])
    expect(PASOS_AUDITAR).toEqual(['Preflight', 'Modo', 'Plan de auditoría', 'Lectura', 'Corrección', 'Revisión', 'Cierre'])
    expect(PASOS.documentar).toEqual(['Preflight', 'Modo', 'Ficha', 'Lectura', 'Escritura', 'Revisión', 'Cierre'])
    expect(PASOS.implementador).toEqual(['Preflight', 'Exploración', 'Clasificación', 'Plan', 'Aprobación', 'Ejecución', 'Verificación final', 'Cierre'])
    expect(PASOS['implementador-ligero']).toEqual(['Preflight', 'Exploración', 'Escalado', 'Plan breve', 'Aprobación', 'Ejecución', 'Revisión', 'Cierre'])
    expect(pasosDe(f as Flujo)).toBe(PASOS_AUDITAR)
    expect(pasosDe(iniciarFlujo('documentar', '') as Flujo)).toBe(PASOS.documentar)
    expect(resumenFlujo(avanzar(avanzar(f, pregunta(false)), agente('lector')))).toBe('/documentar auditar · Lectura')
  })

  test('sin flujo o terminado: ninguna señal lo cambia ni lo revive', async () => {
    const senales: Senal[] = [
      estado('preflight'),
      estado('base'),
      estado('cambios'),
      verificar,
      agente('explorador'),
      agente('ejecutor'),
      pregunta(true),
      escritura('doc'),
    ]

    for (const s of senales) expect(avanzar(null, s)).toBeNull()

    for (const razon of ['answer', 'abort', 'error']) {
      const f = terminarFlujo({ ...(iniciarFlujo('implementador', '') as Flujo), paso: 5 }, razon, 'listo')

      for (const s of senales) expect(avanzar(f, s)).toEqual(f)
    }
  })

  test('terminarFlujo: completo, detenido por CIERRE … DETENIDO, interrumpido; idempotente', async () => {
    const f: Flujo = { nombre: 'implementador', variante: null, paso: 6, ejecuto: true, estado: 'en curso' }

    expect(terminarFlujo(f, 'answer', 'CIERRE · todo listo')).toEqual({ ...f, estado: 'completo' })
    expect(terminarFlujo(f, 'answer', undefined)).toEqual({ ...f, estado: 'completo' })
    expect(terminarFlujo(f, 'answer', 'Resumen\nCIERRE · subtarea 2 — DETENIDO\nmás texto')).toEqual({ ...f, estado: 'detenido' })
    // El DETENIDO debe ir en la misma línea que CIERRE.
    expect(terminarFlujo(f, 'answer', 'CIERRE · listo\nDETENIDO')).toEqual({ ...f, estado: 'completo' })
    expect(terminarFlujo(f, 'abort', 'CIERRE · x — DETENIDO')).toEqual({ ...f, estado: 'interrumpido' })
    expect(terminarFlujo(f, 'error')).toEqual({ ...f, estado: 'interrumpido' })
    expect(terminarFlujo(null, 'answer', 'x')).toBeNull()

    const detenido = terminarFlujo(f, 'answer', 'CIERRE · x — DETENIDO')
    expect(terminarFlujo(detenido, 'abort')).toEqual(detenido)
    expect(terminarFlujo(detenido, 'answer', 'CIERRE · ok')).toEqual(detenido)
    expect(doc(terminarFlujo(f, 'abort'))).toBe('interrumpido:6')
  })

  test('nodos y resumenFlujo: pasado, actual, pendiente y Terminado al final', async () => {
    const f: Flujo = { nombre: 'implementador', variante: null, paso: 5, ejecuto: true, estado: 'en curso' }
    const lista = nodos(f)

    expect(lista.map(n => n.etiqueta)).toEqual([...PASOS.implementador, 'Terminado'])
    expect(lista.map(n => n.estado)).toEqual([
      'pasado', 'pasado', 'pasado', 'pasado', 'pasado', 'actual', 'pendiente', 'pendiente', 'pendiente',
    ])
    expect(resumenFlujo(f)).toBe('/implementador · Ejecución')

    const completo = terminarFlujo(f, 'answer', 'CIERRE · ok') as Flujo
    expect(nodos(completo).map(n => n.estado)).toEqual([
      'pasado', 'pasado', 'pasado', 'pasado', 'pasado', 'pasado', 'pendiente', 'pendiente', 'actual',
    ])
    expect(nodos(completo).at(-1)?.etiqueta).toBe('Terminado')
    expect(resumenFlujo(completo)).toBe('/implementador · Terminado')

    const ligero = terminarFlujo({ ...f, nombre: 'implementador-ligero', paso: 7 }, 'answer', 'CIERRE · x — DETENIDO') as Flujo
    expect(nodos(ligero).at(-1)).toEqual({ etiqueta: 'Terminado · detenido', estado: 'actual' })
    expect(nodos(ligero).filter(n => n.estado === 'pasado')).toHaveLength(8)
    expect(resumenFlujo(ligero)).toBe('/implementador-ligero · Terminado · detenido')

    const cortado = terminarFlujo({ ...f, nombre: 'documentar', variante: 'auditar', paso: 3 }, 'abort') as Flujo
    expect(nodos(cortado).at(-1)?.etiqueta).toBe('Terminado · interrumpido')
    expect(resumenFlujo(cortado)).toBe('/documentar auditar · Terminado · interrumpido')

    expect(resumenFlujo({ ...f, nombre: 'documentar', variante: 'auditar', paso: 3 })).toBe('/documentar auditar · Lectura')
    expect(resumenFlujo(null)).toBe('sin flujo en esta sesión')
  })

  test('las funciones no mutan el flujo que reciben', async () => {
    const f: Flujo = Object.freeze({ nombre: 'implementador', variante: null, paso: 4, ejecuto: false, estado: 'en curso' })

    const a = avanzar(f, agente('ejecutor'))
    expect(a).toEqual({ ...f, paso: 5, ejecuto: true })
    expect(a).not.toBe(f)
    expect(avanzar(f, estado('diff'))).toEqual(f)
    expect(terminarFlujo(f, 'answer', 'CIERRE · x — DETENIDO')?.estado).toBe('detenido')
    expect(nodos(f)).toHaveLength(9)
    expect(resumenFlujo(f)).toBe('/implementador · Aprobación')
    expect(f).toEqual({ nombre: 'implementador', variante: null, paso: 4, ejecuto: false, estado: 'en curso' })
  })
})

type Ui = Awaited<ReturnType<Engine['ui']['mount']>>

/** Deja correr las promesas pendientes del motor de prueba (la petición en curso avanza hasta su compuerta). */
const esperar = () => new Promise<void>(r => setTimeout(r, 25))

/**
 * El modelo bajo los plugins, con control: cada petición espera la compuerta de quien la hace
 * (`principal` o su `agentId`), y puede pedir una herramienta o fallar.
 */
function motorControlado(on: On, modelo: string) {
  const compuertas = new Map<string, Promise<void>>()
  const pidenHerramienta = new Set<string>()
  const fallan = new Set<string>()
  on('turn.step', async function* (_$, e) {
    const quien = e.agentId ?? 'principal'
    await compuertas.get(quien)
    if (fallan.has(quien)) throw new Error('modelo caído')
    const pide = pidenHerramienta.has(quien)

    return {
      turnId: e.turnId,
      index: e.index,
      answer: '',
      toolUses: pide ? [{ name: 'Read', input: {} }] : [],
      stopReason: pide ? ('tool_use' as const) : ('end_turn' as const),
      usage: { ...USO, model: modelo },
    }
  })

  /** Cierra la compuerta de `quien`; devuelve cómo abrirla. */
  function detener(quien: string): () => void {
    let abrir: () => void = () => undefined
    compuertas.set(quien, new Promise<void>(r => (abrir = r)))

    return abrir
  }

  return { detener, pidenHerramienta, fallan }
}

/** El `color` del ■ que sigue a la etiqueta de la fila (el primero del árbol con ese texto). */
async function colorDe(ui: Ui, etiqueta: string): Promise<unknown> {
  const arbol = await ui.findAll({})
  const i = arbol.findIndex(n => n.type === 'Text' && n.text === etiqueta)
  const cuadrado = arbol.slice(i + 1).find(n => n.type === 'Text' && n.text === ' ■')

  return i === -1 ? undefined : cuadrado?.props.color
}

describe('actividad en el panel', () => {
  function preparar(on: On, modelo = 'claude-opus-5-5') {
    mock.clock(on, { now: AHORA })
    motorMide(on)
    motorUsa(on)
    mock.store(on)
    on('session.id', () => ({ value: 's1' }))

    return motorControlado(on, modelo)
  }

  test('una petición en curso pinta el ■ de su fila en success y, al terminar, en subtle', async ($, on) => {
    const motor = preparar(on)
    await $.session.measure(MEDIDA)
    await paso($, 'claude-opus-5-5', 'high')

    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect(await colorDe(ui, 'Opus 5.5 high')).toBe('subtle')

    const abrir = motor.detener('principal')
    const enCurso = paso($, 'claude-opus-5-5', 'high')
    await esperar()
    expect(await colorDe(ui, 'Opus 5.5 high')).toBe('success')

    abrir()
    await enCurso
    expect(await colorDe(ui, 'Opus 5.5 high')).toBe('subtle')
    await ui.unmount()
  })

  test('el principal pide herramienta mientras un subagente sigue en curso: principal warning, subagente success', async ($, on) => {
    const motor = preparar(on)
    await $.session.measure(MEDIDA)
    await paso($, 'claude-opus-5-5', 'high')
    await paso($, 'claude-opus-5-5', 'high', 'agente-1')

    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    const abrirSub = motor.detener('agente-1')
    const sub = paso($, 'claude-opus-5-5', 'high', 'agente-1')
    await esperar()
    motor.pidenHerramienta.add('principal')
    await paso($, 'claude-opus-5-5', 'high')

    expect(await colorDe(ui, 'Opus 5.5 high')).toBe('warning')
    expect(await colorDe(ui, 'Opus 5.5 high · sub')).toBe('success')

    // Al terminar el subagente el principal sigue esperando su herramienta (hasta turn.complete o una nueva petición).
    abrirSub()
    await sub
    expect(await colorDe(ui, 'Opus 5.5 high')).toBe('warning')
    expect(await colorDe(ui, 'Opus 5.5 high · sub')).toBe('subtle')
    await ui.unmount()
  })

  test('el principal pide herramienta sin ningún subagente: warning; nueva petición success; sin herramienta subtle', async ($, on) => {
    const motor = preparar(on)
    await $.session.measure(MEDIDA)
    await paso($, 'claude-opus-5-5', 'high')

    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    motor.pidenHerramienta.add('principal')
    await paso($, 'claude-opus-5-5', 'high')
    expect(await colorDe(ui, 'Opus 5.5 high')).toBe('warning')

    motor.pidenHerramienta.delete('principal')
    const abrir = motor.detener('principal')
    const siguiente = paso($, 'claude-opus-5-5', 'high')
    await esperar()
    expect(await colorDe(ui, 'Opus 5.5 high')).toBe('success')

    abrir()
    await siguiente
    expect(await colorDe(ui, 'Opus 5.5 high')).toBe('subtle')
    await ui.unmount()
  })

  test('si next lanza, el error llega intacto, la fila queda gris y el panel sigue vivo', async ($, on) => {
    const motor = preparar(on)
    await $.session.measure(MEDIDA)
    await paso($, 'claude-opus-5-5', 'high')

    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    const abrir = motor.detener('principal')
    motor.fallan.add('principal')
    const enCurso = paso($, 'claude-opus-5-5', 'high')
    const resultado = enCurso.then(
      () => null,
      (err: unknown) => err,
    )
    await esperar()
    expect(await colorDe(ui, 'Opus 5.5 high')).toBe('success')

    abrir()
    const error = await resultado
    // El kit de pruebas convierte el fallo del motor de abajo en su propio error («no implementation
    // for turn.step»): el hook del panel lo deja pasar tal cual, sin envolverlo ni tragarlo.
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toMatch(/turn\.step/)
    expect((error as Error).message).not.toMatch(/panel/i)
    expect(await colorDe(ui, 'Opus 5.5 high')).toBe('subtle')

    // La fila no quedó con un contador pegado: la petición siguiente vuelve a abrir y cerrar bien.
    motor.fallan.clear()
    const abrir2 = motor.detener('principal')
    const otra = paso($, 'claude-opus-5-5', 'high')
    await esperar()
    expect(await colorDe(ui, 'Opus 5.5 high')).toBe('success')
    abrir2()
    await otra
    expect(await colorDe(ui, 'Opus 5.5 high')).toBe('subtle')
    await ui.unmount()
  })

  test('«Esta semana» no lleva cuadrados; «Esta sesión» sí, uno por fila', async ($, on) => {
    const motor = preparar(on)
    await $.session.measure(MEDIDA)
    await paso($, 'claude-opus-5-5', 'high')
    await paso($, 'claude-opus-5-5', 'high', 'agente-1')
    motor.detener('principal')()

    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await ui.press({ key: 's-plegar' })
    const textos = (await ui.findAll({ type: 'Text' })).map(t => t.text ?? '')
    const sem = textos.indexOf('Esta semana')

    expect(textos.slice(sem)).toContain('Opus 5.5 high')
    expect(textos.slice(sem)).not.toContain(' ■')
    expect(textos.slice(0, sem).filter(t => t === ' ■')).toHaveLength(2)
    await ui.unmount()
  })

  test('session.end limpia la actividad: la fila en curso vuelve a gris', async ($, on) => {
    const motor = preparar(on)
    on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
    await $.session.measure(MEDIDA)
    await paso($, 'claude-opus-5-5', 'high')

    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    const abrir = motor.detener('principal')
    const enCurso = paso($, 'claude-opus-5-5', 'high')
    await esperar()
    expect(await colorDe(ui, 'Opus 5.5 high')).toBe('success')

    await $.session.end({ reason: 'other', sessionId: 's1', resume: { id: 's1' } })
    expect(await colorDe(ui, 'Opus 5.5 high')).toBe('subtle')

    // Cuando la petición vieja termina, no deja el contador negativo ni cambia nada.
    abrir()
    await enCurso
    expect(await colorDe(ui, 'Opus 5.5 high')).toBe('subtle')
    await ui.unmount()
  })
})

/** El store de prueba con su contenido a la vista: devuelve el mapa para leer lo que el panel guardó. */
function motorStore(on: On, inicial: Record<string, unknown> = {}) {
  const guardados = new Map<string, unknown>(Object.entries(inicial))
  on('store.get', (_$, e) => ({ value: guardados.get(e.key) }))
  on('store.set', (_$, e) => {
    guardados.set(e.key, e.value)

    return { value: undefined }
  })
  on('store.delete', (_$, e) => {
    guardados.delete(e.key)

    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...guardados.keys()] }))

  return guardados
}

/** Lo que el panel dibuja de «Flujo» abierta en `/implementador · Ejecución`, texto por texto. */
const FLUJO_EJECUCION = [
  'Flujo',
  '/implementador · Ejecución',
  '✓ ',
  'Preflight',
  '│',
  '✓ ',
  'Exploración',
  '│',
  '✓ ',
  'Clasificación',
  '│',
  '✓ ',
  'Plan',
  '│',
  '✓ ',
  'Aprobación',
  '│',
  '▸ ',
  'Ejecución',
  '│',
  '○ ',
  'Verificación final',
  '│',
  '○ ',
  'Cierre',
  '│',
  '○ ',
  'Terminado',
]

describe('flujo en el panel', () => {
  /** El motor bajo los plugins: la skill y el turno responden tal cual; `Agent` espera su compuerta y puede fallar. */
  function motorFlujo(on: On) {
    const llamadas: string[] = []
    const compuertas = new Map<string, Promise<void>>()
    const fallan = new Set<string>()
    on('skill.prompt', (_$, e) => ({ text: e.text }))
    on('tool.call', async (_$, e) => {
      llamadas.push(e.tool)
      if (e.tool === 'Agent') {
        await compuertas.get(e.subagent_type ?? '')
        if (fallan.has(e.subagent_type ?? '')) throw new Error('explorador caído')
      }

      return { result: 'listo' }
    })
    on('turn.complete', (_$, e) => ({ text: e.answer }))

    /** Cierra la compuerta del agente `nombre`; devuelve cómo abrirla. */
    function detener(nombre: string): () => void {
      let abrir: () => void = () => undefined
      compuertas.set(nombre, new Promise<void>(r => (abrir = r)))

      return abrir
    }

    return { llamadas, detener, fallan }
  }

  function preparar(on: On, pedidos: string[] = [], inicial: Record<string, unknown> = {}) {
    mock.clock(on, { now: AHORA })
    motorMide(on)
    motorUsa(on, pedidos)
    on('session.id', () => ({ value: 's1' }))
    const guardados = motorStore(on, inicial)

    return { ...motorFlujo(on), guardados }
  }

  const textosDe = async (ui: Ui) => (await ui.findAll({ type: 'Text' })).map(t => t.text ?? '')

  /** Los `n` textos que empiezan en el título «Flujo». */
  const desdeFlujo = async (ui: Ui, n: number) => {
    const textos = await textosDe(ui)
    const i = textos.indexOf('Flujo')

    return textos.slice(i, i + n)
  }

  const bash = ($: Engine, command: string) => $.tool.call({ tool: 'Bash', command })
  const agente = ($: Engine, subagent_type: string) =>
    $.tool.call({ tool: 'Agent', subagent_type, description: 'prueba', prompt: 'prueba' })
  const respuesta = (answer: string, extra: { reason?: 'answer' | 'aborted'; agentId?: string } = {}) => ({
    reason: extra.reason ?? 'answer',
    answer,
    durationMs: 10,
    isAborted: extra.reason === 'aborted',
    turnId: 't',
    ...(extra.agentId === undefined ? {} : { agentId: extra.agentId }),
  })

  test('«Flujo» arranca plegada y sin flujo: tecla f, Ver/Ocultar y prefs:flujo', async ($, on) => {
    const { guardados } = preparar(on)

    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    const boton = await ui.find({ type: 'Button', key: 'flujo-plegar' })
    expect(boton?.props.hotkey).toBe('f')
    expect(boton?.props.label).toBe('Ver')
    expect(await desdeFlujo(ui, 2)).toEqual(['Flujo', 'sin flujo en esta sesión'])

    await ui.press({ key: 'flujo-plegar' })
    expect((await ui.find({ type: 'Button', key: 'flujo-plegar' }))?.props.label).toBe('Ocultar')
    expect(guardados.get('prefs:flujo')).toBe(true)

    await ui.press({ key: 'flujo-plegar' })
    expect((await ui.find({ type: 'Button', key: 'flujo-plegar' }))?.props.label).toBe('Ver')
    expect(guardados.get('prefs:flujo')).toBe(false)
    await ui.unmount()
  })

  test('al abrir sesión, «Flujo» vuelve como se dejó', async ($, on) => {
    preparar(on, [], { 'prefs:flujo': true })
    on('session.model', () => ({ value: 'claude-opus-5-5' }))
    on('settings.read', () => ({ value: {} }))
    on('command.register', () => ({ value: undefined }))
    on('session.start', (_$, e) => ({ cwd: e.cwd }))
    on('ui.open', () => ({ value: { isPlaced: true } }))

    // Un /reload-plugins a mitad de flujo repite session.start: el flujo sigue ahí.
    await $.skill.prompt({ skill: 'implementador', text: '' })
    await $.session.start({ cwd: 'D:\\GitHub-Personal\\mods-claude' })

    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect((await ui.find({ type: 'Button', key: 'flujo-plegar' }))?.props.label).toBe('Ocultar')
    expect(await desdeFlujo(ui, 2)).toEqual(['Flujo', '/implementador · Preflight'])
    expect(await textosDe(ui)).toContain('Preflight')
    await ui.unmount()
  })

  test('/implementador de punta a punta: el diagrama marca cada paso y termina en Terminado', async ($, on) => {
    const pedidos: string[] = []
    preparar(on, pedidos)
    await $.session.measure(MEDIDA)
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await ui.press({ key: 'flujo-plegar' })
    const antes = pedidos.length

    await $.skill.prompt({ skill: 'implementador', text: '**Pedido:** algo' })
    await bash($, 'node ~/.claude/flujos/estado.mjs')
    await agente($, 'explorador')
    await $.tool.call({
      tool: 'AskUserQuestion',
      questions: [
        {
          question: '¿Apruebas el plan?',
          header: 'Plan',
          options: [
            { label: 'Sí', description: 'Ejecutar' },
            { label: 'No', description: 'Detener' },
          ],
          multiSelect: false,
        },
      ],
    })
    await bash($, 'node ~/.claude/flujos/estado.mjs --base')

    expect(await desdeFlujo(ui, FLUJO_EJECUCION.length)).toEqual(FLUJO_EJECUCION)

    await $.turn.complete(respuesta('CIERRE · x — COMPLETO'))
    const tramo = await desdeFlujo(ui, FLUJO_EJECUCION.length)
    expect(tramo.slice(0, 2)).toEqual(['Flujo', '/implementador · Terminado'])
    expect(tramo.slice(-2)).toEqual(['● ', 'Terminado'])
    expect(tramo.slice(2, 4)).toEqual(['✓ ', 'Preflight'])
    // Nada del flujo llama al modelo ni a $.session.usage.
    expect(pedidos).toHaveLength(antes)
    await ui.unmount()
  })

  test('mientras corre el explorador el paso es Exploración; al volver, Clasificación', async ($, on) => {
    const motor = preparar(on)
    await $.skill.prompt({ skill: 'implementador', text: '' })
    await bash($, 'node ~/.claude/flujos/estado.mjs')

    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect(await desdeFlujo(ui, 2)).toEqual(['Flujo', '/implementador · Preflight'])

    const abrir = motor.detener('explorador')
    const corriendo = agente($, 'explorador')
    await esperar()
    expect(await desdeFlujo(ui, 2)).toEqual(['Flujo', '/implementador · Exploración'])

    abrir()
    await corriendo
    expect(await desdeFlujo(ui, 2)).toEqual(['Flujo', '/implementador · Clasificación'])
    await ui.unmount()
  })

  test('skill.prompt y tool.call pasan intactos: mismo texto y mismo resultado', async ($, on) => {
    const motor = preparar(on)

    const texto = '**Pedido:** auditar la guía\n\nsegunda línea'
    expect(await $.skill.prompt({ skill: 'documentar', text: texto })).toEqual({ text: texto })
    expect(await $.skill.prompt({ skill: 'simplify', text: 'otra' })).toEqual({ text: 'otra' })

    const resultados = [
      await bash($, 'node ~/.claude/flujos/estado.mjs'),
      await bash($, 'ls'),
      await agente($, 'explorador'),
      await agente($, 'planificador'),
    ]
    expect(resultados.map(r => r.result)).toEqual(['listo', 'listo', 'listo', 'listo'])
    expect(motor.llamadas).toEqual(['Bash', 'Bash', 'Agent', 'Agent'])
  })

  test('si el explorador falla, el error llega intacto y el paso queda en Exploración', async ($, on) => {
    const motor = preparar(on)
    await $.skill.prompt({ skill: 'implementador', text: '' })

    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    motor.fallan.add('explorador')
    const error = await agente($, 'explorador').then(
      () => null,
      (err: unknown) => err,
    )

    // El kit convierte el fallo del motor de abajo en su propio error: el hook del panel no lo envuelve ni lo traga.
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).not.toMatch(/panel/i)
    expect(await desdeFlujo(ui, 2)).toEqual(['Flujo', '/implementador · Exploración'])
    await ui.unmount()
  })

  test('turn.complete de un subagente no termina el flujo; uno abortado muestra Terminado · interrumpido', async ($, on) => {
    preparar(on)
    await $.skill.prompt({ skill: 'implementador', text: '' })

    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await ui.press({ key: 'flujo-plegar' })
    await $.turn.complete(respuesta('CIERRE · x — COMPLETO', { agentId: 'agente-1' }))
    expect((await desdeFlujo(ui, 2))[1]).toBe('/implementador · Preflight')

    await $.turn.complete(respuesta('', { reason: 'aborted' }))
    expect((await desdeFlujo(ui, 2))[1]).toBe('/implementador · Terminado · interrumpido')
    const arbol = await ui.findAll({})
    const i = arbol.findIndex(n => n.type === 'Text' && n.text === 'Terminado · interrumpido')
    expect(arbol.slice(0, i).reverse().find(n => n.type === 'Text' && n.text === '● ')?.props.color).toBe('error')
    await ui.unmount()
  })

  test('fuera de un flujo, estado.mjs y los agentes no crean ninguno; otra skill tampoco', async ($, on) => {
    preparar(on)
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

    await bash($, 'node ~/.claude/flujos/estado.mjs')
    await agente($, 'explorador')
    await $.skill.prompt({ skill: 'simplify', text: '' })
    await $.turn.complete(respuesta('CIERRE · x — COMPLETO'))

    expect(await desdeFlujo(ui, 2)).toEqual(['Flujo', 'sin flujo en esta sesión'])
    await ui.unmount()
  })

  test('session.end borra el flujo', async ($, on) => {
    preparar(on)
    on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
    await $.skill.prompt({ skill: 'documentar', text: '' })

    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect((await desdeFlujo(ui, 2))[1]).toBe('/documentar · Preflight')

    await $.session.end({ reason: 'other', sessionId: 's1', resume: { id: 's1' } })
    expect(await desdeFlujo(ui, 2)).toEqual(['Flujo', 'sin flujo en esta sesión'])
    await ui.unmount()
  })
})
