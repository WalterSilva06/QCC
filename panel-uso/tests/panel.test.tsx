import type { On, SessionContextBreakdown, SessionMeasureInput } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { comandoCarpeta, tipoDeRuta } from '../hooks/carpeta'
import {
  PASOS,
  abrirEspera,
  abreTanda,
  anotarConfig,
  anotarExplorador,
  anotarFilaExplorador,
  avanzar,
  baseDeUso,
  cerrarExploradorSinId,
  cerrarEspera,
  congelarConsumo,
  consumoDeFlujo,
  cuadradosDeFila,
  datosDeExplorador,
  detallePaso,
  iniciarFlujo,
  lineaDeExplorador,
  marcarAgente,
  marcarOrquestador,
  nodos,
  nombreOrquestador,
  resumenFlujo,
  senalAlTerminar,
  senalDeHerramienta,
  sumarGasto,
  sumarGastoDeExplorador,
  terminarFlujo,
} from '../hooks/flujo'
import type { Nodo, Senal } from '../hooks/flujo'
import { aDesglose, barra, barraPartida, barraTramos, desgloseTramos, duracion, etiquetasAlineadas, falta, pct, tokens, tono, totalConSalida, tramos } from '../hooks/formato'
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
  idsDeActividad,
  inicioDeHora,
  inicioSemana,
  iniciarPeticion,
  limpiarPendientes,
  podar,
  resumir,
  terminarPeticion,
  unirOrigenes,
} from '../hooks/semana'
import type { Cuentas, Registro } from '../hooks/semana'
import type { Actividad, FilaSemana, Flujo, Semana } from '../types'

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

/** El panel con el ancho real del usuario (49 columnas): ahí caben varios ■ en la fila. */
const PANE_ANCHO = { ...PANE, props: { ...PANE.props, bodyColumns: 49 } } as const

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
    expect(falta(0, 45 * 60_000)).toBe('en 45 min')
    expect(falta(0, 30_000)).toBe('en menos de 1 min')
    expect(pct(10.74)).toBe('10,7%')
  })

  test('duracion: segundos, minutos con segundos y horas', async () => {
    expect(duracion(0)).toBe('0 s')
    expect(duracion(-5_000)).toBe('0 s')
    expect(duracion(999)).toBe('0 s')
    expect(duracion(45_000)).toBe('45 s')
    expect(duracion(59_999)).toBe('59 s')
    expect(duracion(60_000)).toBe('1 min')
    expect(duracion(3 * 60_000 + 20_000)).toBe('3 min 20 s')
    expect(duracion(10 * 60_000)).toBe('10 min')
    expect(duracion(59 * 60_000 + 59_000)).toBe('59 min 59 s')
    expect(duracion(3_600_000)).toBe('1 h')
    expect(duracion(3_600_000 + 20 * 60_000 + 40_000)).toBe('1 h 20 min')
    expect(duracion(2 * 3_600_000 + 5 * 60_000)).toBe('2 h 5 min')
    expect(duracion(27 * 3_600_000)).toBe('1 d 3 h')
  })

  test('barraPartida: reparte lo lleno entre principal y subagente sin cambiar la barra', async () => {
    const ancho = 10

    expect(barraPartida(50, 20, ancho)).toEqual({ principal: '███', sub: '██', vacio: '░░░░░' })
    // Sin subagente, todo lo lleno es principal; con sub igual a la parte, todo es subagente.
    expect(barraPartida(50, 0, ancho)).toEqual({ principal: '█████', sub: '', vacio: '░░░░░' })
    expect(barraPartida(50, 50, ancho)).toEqual({ principal: '', sub: '█████', vacio: '░░░░░' })

    for (const parte of [0, 3, 14, 50, 77, 100, 130, -5]) {
      for (const sub of [0, 4, 20, 50, 100, 250, -10]) {
        const b = barraPartida(parte, sub, ancho)

        expect(b.principal.length + b.sub.length + b.vacio.length).toBe(ancho)
        expect(b.sub.length).toBeLessThanOrEqual(ancho - b.vacio.length)
        expect(b.principal + b.sub + b.vacio).toBe(barra(parte, ancho))
      }
    }
  })

  test('barraTramos: el tramo del flujo sale de lo principal; el de subagentes y la barra no cambian', async () => {
    const ancho = 10

    expect(barraTramos(50, 20, 20, ancho)).toEqual({ principal: '█', flujo: '██', sub: '██', vacio: '░░░░░' })
    expect(barraTramos(50, 0, 0, ancho)).toEqual({ principal: '█████', flujo: '', sub: '', vacio: '░░░░░' })
    expect(barraTramos(50, 50, 0, ancho)).toEqual({ principal: '', flujo: '█████', sub: '', vacio: '░░░░░' })
    // El flujo nunca pasa de lo que queda en principal.
    expect(barraTramos(50, 40, 20, ancho)).toEqual({ principal: '', flujo: '███', sub: '██', vacio: '░░░░░' })

    for (const parte of [0, 3, 14, 50, 77, 100, 130, -5]) {
      for (const flujo of [0, 4, 20, 50, 100, 250, -10]) {
        for (const sub of [0, 4, 20, 50]) {
          const t = barraTramos(parte, flujo, sub, ancho)
          const p = barraPartida(parte, sub, ancho)

          expect(t.principal + t.flujo + t.sub + t.vacio).toBe(barra(parte, ancho))
          expect(t.sub).toBe(p.sub)
          expect(t.vacio).toBe(p.vacio)
          if (flujo === 0) expect(t.principal).toBe(p.principal)
        }
      }
    }
  })

  test('desgloseTramos: normal, flujo y sub; quita espacios y luego recorta según el ancho', async () => {
    const f = { total: 12_900_000, flujo: 3_500_000, sub: 3_000_000 }

    expect(desgloseTramos(f, 40)).toBe('normal 6,4M · flujo 3,5M · sub 3M')
    expect(desgloseTramos(f, 32)).toBe('normal 6,4M·flujo 3,5M·sub 3M')
    expect(desgloseTramos(f, 20)).toBe('normal 6,4M·flujo 3…')
    expect(desgloseTramos(f, 0)).toBe('…')
  })

  test('desgloseTramos: sin flujo ni sub queda vacío, omite tramos en 0 y nunca pasa del ancho', async () => {
    expect(desgloseTramos({ total: 5_000_000 }, 40)).toBe('')
    expect(desgloseTramos({ total: 5_000_000, flujo: 0, sub: 0 }, 40)).toBe('')
    expect(desgloseTramos({ total: 100_000, sub: 100_000 }, 40)).toBe('sub 100k')
    expect(desgloseTramos({ total: 1_000_000, flujo: 400_000 }, 40)).toBe('normal 600k · flujo 400k')
    // Un redondeo que deja el normal en negativo lo deja en 0, y se omite.
    expect(desgloseTramos({ total: 100_000, flujo: 60_000, sub: 50_000 }, 40)).toBe('flujo 60k · sub 50k')

    for (const ancho of [32, 40]) {
      for (const f of [
        { total: 12_900_000, flujo: 3_500_000, sub: 3_000_000 },
        { total: 100_000, sub: 100_000 },
        { total: 999_000_000, flujo: 123_400_000, sub: 456_700_000 },
      ]) {
        expect(desgloseTramos(f, ancho).length).toBeLessThanOrEqual(ancho)
      }
    }
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

  test('etiquetasAlineadas: familia, versión y esfuerzo en columnas del mismo largo', async () => {
    const fila = (modelo: string, esfuerzo: string) => ({ modelo, esfuerzo })

    expect(etiquetasAlineadas([fila('Sonnet 5.5', 'high'), fila('Haiku 5.5', 'max')], 40)).toEqual([
      'Sonnet 5.5 high',
      'Haiku  5.5 max ',
    ])
    expect(
      etiquetasAlineadas([fila('Opus 5.5', 'high'), fila('Haiku 5.5', 'xhigh'), fila('Sonnet 5.5', 'high')], 40),
    ).toEqual(['Opus   5.5 high ', 'Haiku  5.5 xhigh', 'Sonnet 5.5 high '])
    // Una sola fila no lleva relleno.
    expect(etiquetasAlineadas([fila('Opus 5.5', 'medium')], 16)).toEqual(['Opus 5.5 medium'])
    // Principal y subagente del mismo modelo y esfuerzo: la misma etiqueta.
    expect(etiquetasAlineadas([fila('Haiku 5.5', 'high'), fila('Haiku 5.5', 'high')], 40)).toEqual([
      'Haiku 5.5 high',
      'Haiku 5.5 high',
    ])
    // La columna de versión se omite solo si todas están vacías; si no, la vacía conserva su hueco.
    expect(etiquetasAlineadas([fila('Opus', 'high'), fila('Opus 5.5', 'high')], 40)).toEqual([
      'Opus     high',
      'Opus 5.5 high',
    ])
    expect(etiquetasAlineadas([fila('Opus', 'high'), fila('Haiku', 'max')], 40)).toEqual(['Opus  high', 'Haiku max '])
    expect(etiquetasAlineadas([], 40)).toEqual([])
  })

  test('etiquetasAlineadas: si no caben, se recortan por el final con «…» y salen del mismo largo', async () => {
    const filas = [
      { modelo: 'Sonnet 5.5', esfuerzo: 'high' },
      { modelo: 'Haiku 5.5', esfuerzo: 'max' },
    ]

    // Largo 15: con 14 la segunda cabe sin su relleno (sin «…») y la primera pierde su última letra.
    expect(etiquetasAlineadas(filas, 14)).toEqual(['Sonnet 5.5 hi…', 'Haiku  5.5 max'])
    // Con 12 las dos se recortan; el espacio antes de «…» no se deja.
    expect(etiquetasAlineadas(filas, 12)).toEqual(['Sonnet 5.5… ', 'Haiku  5.5… '])
    expect(etiquetasAlineadas(filas, 3)).toEqual(['So…', 'Ha…'])
    // El mínimo es 1 columna.
    expect(etiquetasAlineadas(filas, 0)).toEqual(['…', '…'])
    expect(etiquetasAlineadas(filas, 12).map(s => s.length)).toEqual([12, 12])
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

async function paso($: Engine, modelo: string, effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max', agentId?: string) {
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

  test('unirOrigenes: suma principal y subagente por modelo·esfuerzo, reordena y deja origen principal', async () => {
    const h = inicioDeHora(AHORA)
    const r: Registro = {
      [String(h)]: {
        'claude-opus-5-5|high': [10, 2, 0, 0],
        'claude-opus-5-5|high|sub': [5, 1, 0, 0],
        'claude-sonnet-5-5|low': [12, 4, 0, 0],
        'claude-haiku-5-5|': [3, 0, 0, 0],
        'claude-haiku-5-5||sub': [1, 0, 0, 0],
      },
    }
    const s = resumir([r], h - 1, AHORA)
    const u = unirOrigenes(s)

    // Antes de unir Sonnet (16) iba por delante del Opus principal (12); unido, Opus (18) pasa primero.
    expect(s.filas[0]?.modelo).toBe('Sonnet 5.5')
    expect(u.filas).toEqual([
      { modelo: 'Opus 5.5', esfuerzo: 'high', origen: 'principal', total: 18, salida: 3, sub: 6 },
      { modelo: 'Sonnet 5.5', esfuerzo: 'low', origen: 'principal', total: 16, salida: 4, sub: 0 },
      { modelo: 'Haiku 5.5', esfuerzo: '—', origen: 'principal', total: 4, salida: 0, sub: 1 },
    ])
    expect(new Set(u.filas.map(f => `${f.modelo}|${f.esfuerzo}`)).size).toBe(u.filas.length)
    expect(u.filas.every(f => f.origen === 'principal')).toBe(true)
    expect(u.filas.reduce((a, f) => a + f.total, 0)).toBe(u.total)
    expect(u.filas.reduce((a, f) => a + f.salida, 0)).toBe(u.salida)
    expect({ ...u, filas: [] }).toEqual({ ...s, filas: [] })
  })

  test('unirOrigenes: el orden es por total tras unir y no toca la semana de entrada', async () => {
    const s: Semana = {
      desde: 0,
      filas: [
        { modelo: 'A', esfuerzo: 'high', origen: 'principal', total: 10, salida: 1 },
        { modelo: 'B', esfuerzo: 'high', origen: 'principal', total: 8, salida: 1 },
        { modelo: 'B', esfuerzo: 'high', origen: 'subagente', total: 5, salida: 2 },
      ],
      total: 23,
      salida: 4,
      registroDesde: 7,
      dias: [{ inicio: 1, total: 23 }],
    }
    const u = unirOrigenes(s)

    expect(u.filas.map(f => [f.modelo, f.total, f.salida])).toEqual([['B', 13, 3], ['A', 10, 1]])
    expect(u.filas.map(f => f.sub)).toEqual([5, 0])
    expect(s.filas.every(f => f.sub === undefined)).toBe(true)
    expect(s.filas).toHaveLength(3)
    expect(s.filas[1]?.total).toBe(8)
    expect(unirOrigenes({ ...s, filas: [], total: 0, salida: 0 }).filas).toEqual([])
  })

  test('clave: el hilo principal durante un flujo lleva el prefijo flujo|; el subagente no', async () => {
    expect(clave('claude-opus-5-5', 'high', false, true)).toBe('flujo|claude-opus-5-5|high')
    expect(clave('claude-opus-5-5', undefined, false, true)).toBe('flujo|claude-opus-5-5|')
    expect(clave('claude-opus-5-5', 'high', true, true)).toBe('claude-opus-5-5|high|sub')
  })

  test('resumir: flujo|… es principal con su parte en flujo; las filas sin flujo no llevan el campo', async () => {
    const h = inicioDeHora(AHORA)
    const r: Registro = {
      [String(h)]: {
        'claude-opus-5-5|high': [10, 0, 0, 0],
        'flujo|claude-opus-5-5|high': [6, 1, 0, 0],
        'flujo|claude-haiku-5-5|': [2, 0, 0, 0],
        'claude-opus-5-5|high|sub': [5, 0, 0, 0],
      },
    }
    const s = resumir([r], h - 1)

    expect(s.filas).toEqual([
      { modelo: 'Opus 5.5', esfuerzo: 'high', origen: 'principal', total: 17, salida: 1, flujo: 7 },
      { modelo: 'Opus 5.5', esfuerzo: 'high', origen: 'subagente', total: 5, salida: 0 },
      { modelo: 'Haiku 5.5', esfuerzo: '—', origen: 'principal', total: 2, salida: 0, flujo: 2 },
    ])
    // Así lo suma una terminal sin recargar: la familia de la clave con prefijo sale igual.
    expect(familia('flujo|claude-opus-5-5')).toBe('Opus 5.5')
  })

  test('unirOrigenes: suma flujo por modelo·esfuerzo y solo lo pone si lo hay', async () => {
    const h = inicioDeHora(AHORA)
    const r: Registro = {
      [String(h)]: {
        'claude-opus-5-5|high': [10, 2, 0, 0],
        'flujo|claude-opus-5-5|high': [4, 1, 0, 0],
        'claude-opus-5-5|high|sub': [5, 1, 0, 0],
        'claude-sonnet-5-5|low': [12, 4, 0, 0],
      },
    }
    const u = unirOrigenes(resumir([r], h - 1, AHORA))
    const opus = u.filas.find(f => f.modelo === 'Opus 5.5')
    const sonnet = u.filas.find(f => f.modelo === 'Sonnet 5.5')

    expect(opus).toEqual({ modelo: 'Opus 5.5', esfuerzo: 'high', origen: 'principal', total: 23, salida: 4, sub: 6, flujo: 5 })
    expect(sonnet).not.toHaveProperty('flujo')
    expect(sonnet?.total).toBe(16)
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
    const arbol = await ui.findAll({})
    const textos = (await ui.findAll({ type: 'Text' })).map(t => t.text ?? '')

    expect(textos).toContain('Esta semana')
    // «Esta sesión» une principal y subagente en una sola fila: el subagente es el tramo `purple_FOR_SUBAGENTS_ONLY` de su barra.
    const todos = arbol.map(n => (n.type === 'Text' ? (n.text ?? '') : ''))
    const ses = todos.indexOf('Esta sesión')
    const sem = todos.indexOf('Esta semana')
    // Las etiquetas de la semana también llevan relleno al largo común: se comparan sin él y acotadas a «Esta semana».
    const deSemanaTrim = todos.slice(sem).map(t => t.trimEnd())
    expect(deSemanaTrim).toContain('Opus 5.5 medium')
    expect(deSemanaTrim).toContain('Opus 5.5 high')
    // Las etiquetas de la sesión llevan relleno al largo común: se comparan sin él y acotadas a «Esta sesión».
    const deSesion = todos.slice(ses, sem).map(t => t.trimEnd())
    // Los dos ■ de la fila unida de medium restan 4 columnas al presupuesto de etiquetas (32 − 14 − 4 = 14): se acorta con «…».
    expect(deSesion.filter(t => t === 'Opus 5.5 medi…')).toHaveLength(1)
    expect(deSesion.filter(t => t === 'Opus 5.5 high')).toHaveLength(1)
    expect(deSesion.indexOf('Opus 5.5 medi…')).toBeLessThan(deSesion.indexOf('Opus 5.5 high'))
    // medium (200k de 300k, 100k de subagente): principal, sub y vacío; high (100k) sin subagente: una sola barra.
    expect(
      arbol
        .slice(ses, sem)
        .filter(n => n.type === 'Text' && /^[█░]+$/.test(n.text ?? ''))
        .map(n => [n.props.color, n.text]),
    ).toEqual([
      ['claude', '█'.repeat(9)],
      ['purple_FOR_SUBAGENTS_ONLY', '█'.repeat(8)],
      ['claude', '░'.repeat(8)],
      ['claude', '█'.repeat(8) + '░'.repeat(17)],
    ])
    // El desglose solo está en la fila con subagente.
    expect(deSesion.filter(t => /^(normal|flujo|sub) /.test(t))).toEqual(['normal 100k · sub 100k'])
    expect(textos).toContain('   100k')
    // La semana ordena por total: medium (200k) antes que high (100k).
    expect(deSemanaTrim.indexOf('Opus 5.5 medium')).toBeGreaterThan(-1)
    expect(deSemanaTrim.indexOf('Opus 5.5 medium')).toBeLessThan(deSemanaTrim.indexOf('Opus 5.5 high'))
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

  test('turn.step con y sin agentId deja dos claves; la sesión separa filas y la semana las une', async ($, on) => {
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
    const arbol = await ui.findAll({})
    const textos = (await ui.findAll({ type: 'Text' })).map(t => t.text ?? '')
    const ses = textos.indexOf('Esta sesión')
    const sem = textos.indexOf('Esta semana')
    // Esta sesión: una sola fila unida (200k) con su tramo de subagente en `purple_FOR_SUBAGENTS_ONLY` y su desglose.
    expect(textos.slice(ses, sem).filter(t => t === 'Opus 5.5 high')).toHaveLength(1)
    expect(textos.slice(ses, sem).filter(t => t.startsWith('normal '))).toEqual(['normal 100k · sub 100k'])
    const sesionArbol = arbol.slice(
      arbol.findIndex(n => n.type === 'Text' && n.text === 'Esta sesión'),
      arbol.findIndex(n => n.type === 'Text' && n.text === 'Esta semana'),
    )
    expect(sesionArbol.filter(n => n.type === 'Text' && /^[█░]+$/.test(n.text ?? '')).map(n => [n.props.color, n.text])).toEqual([
      ['claude', '█'.repeat(12)],
      ['purple_FOR_SUBAGENTS_ONLY', '█'.repeat(13)],
    ])
    // Esta semana: una sola fila con la suma (2 × 100k de total, 2 × 2k de salida) y sin «· sub».
    const deSemana = textos.slice(sem)
    expect(deSemana.filter(t => t.startsWith('Opus 5.5 high'))).toEqual(['Opus 5.5 high'])
    expect(deSemana.some(t => t.includes('· sub'))).toBe(false)
    const i = deSemana.indexOf('Opus 5.5 high')
    expect(deSemana[i + 1]).toBe('200k'.padStart(7))
    expect(deSemana[i + 2]).toBe('4k'.padStart(7))
    await ui.unmount()
  })

  test('la barra de una fila con subagente lleva su tramo sub en otro color, en la semana y en la sesión unida', async ($, on) => {
    const h = String(inicioDeHora(AHORA))
    mock.clock(on, { now: AHORA })
    motorMide(on)
    motorUsa(on)
    mock.store(on, { 'uso:otra': { [h]: { [clave('claude-sonnet-5-5', 'low')]: [400_000, 0, 0, 0] } } })
    on('session.id', () => ({ value: 's1' }))
    motorResponde(on, 'claude-opus-5-5')
    await $.session.measure(MEDIDA)

    await paso($, 'claude-opus-5-5', 'high')
    await paso($, 'claude-opus-5-5', 'high', 'agente-1')

    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await ui.press({ key: 's-plegar' })
    const arbol = await ui.findAll({})
    const textos = arbol.map(n => (n.type === 'Text' ? (n.text ?? '') : ''))
    const ses = textos.indexOf('Esta sesión')
    const sem = textos.indexOf('Esta semana')
    const esBarra = (n: (typeof arbol)[number]) => n.type === 'Text' && /^[█░]+$/.test(n.text ?? '')
    const barras = (desde: number, hasta: number) => arbol.slice(desde, hasta).filter(esBarra)

    // Semana: Opus 200k de 600k (33,3 %) con 100k de subagente (16,7 %) y Sonnet 400k sin subagente.
    // La semana ordena por total: Sonnet (400k) va antes que Opus (200k).
    // Las etiquetas de la semana van en columnas (familia y versión rellenadas): se buscan así, desde «Esta semana».
    const filaSonnet = textos.findIndex((t, i) => i > sem && t.trimEnd() === 'Sonnet 5.5 low')
    const fila = textos.findIndex((t, i) => i > sem && t === 'Opus   5.5 high')
    expect(filaSonnet).toBeGreaterThan(sem)
    expect(fila).toBeGreaterThan(filaSonnet)
    // La barra termina en el «%» de su fila; después vienen las barras de «por día».
    const tramos = barras(fila, textos.findIndex((t, i) => i > fila && t.endsWith('%')))
    const sub = tramos.filter(n => n.props.color === 'purple_FOR_SUBAGENTS_ONLY')

    expect(sub.map(n => n.text)).toEqual(['█'.repeat(4)])
    expect(tramos.map(n => [n.props.color, n.text])).toEqual([
      ['claude', '█'.repeat(4)],
      ['purple_FOR_SUBAGENTS_ONLY', '█'.repeat(4)],
      ['claude', '░'.repeat(17)],
    ])
    // Principal + sub + vacío = el ancho de la barra (25).
    expect(tramos.reduce((suma, n) => suma + (n.text ?? '').length, 0)).toBe(25)

    // La fila sin subagente conserva su único Text de barra.
    const sonnet = barras(filaSonnet, fila)
    expect(sonnet.map(n => [n.props.color, n.text])).toEqual([['claude', '█'.repeat(17) + '░'.repeat(8)]])

    // Sesión: una sola fila unida (200k, 100 % de su sección) con la mitad en subagente: principal y sub, sin vacío.
    const filasSesion = textos.flatMap((t, i) => (t === 'Opus 5.5 high' && i > ses && i < sem ? [i] : []))
    expect(filasSesion).toHaveLength(1)
    expect(barras(ses, sem).map(n => [n.props.color, n.text])).toEqual([
      ['claude', '█'.repeat(12)],
      ['purple_FOR_SUBAGENTS_ONLY', '█'.repeat(13)],
    ])
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
    expect(deSesion.map(t => t.trimEnd())).not.toContain('Sonnet 5.5 low')
    // La semana alinea sus dos filas: «Opus» se rellena al ancho de «Sonnet» y «low» al de «medium».
    const deSemana = textos.slice(sem)
    expect(deSemana).toContain('Opus   5.5 medium')
    expect(deSemana.map(t => t.trimEnd())).toContain('Sonnet 5.5 low')
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
    // Las etiquetas de la semana van rellenadas al largo común («low» al ancho de «medium», «Opus» al de «Sonnet»).
    const j = textos.indexOf('Sonnet 5.5 low   ', sem)
    expect(j).toBeGreaterThan(sem)
    expect(textos.slice(j, j + 5)).toEqual(['Sonnet 5.5 low   ', '   400k', '      0', '█'.repeat(20) + '░'.repeat(5), '  80,0%'])
    const k = textos.indexOf('Opus   5.5 medium', sem)
    expect(k).toBeGreaterThan(j)
    expect(textos.slice(k, k + 5)).toEqual(['Opus   5.5 medium', '   100k', '     2k', '█'.repeat(5) + '░'.repeat(20), '  20,0%'])
    await ui.unmount()
  })

  test('«Esta semana» alinea sus etiquetas en columnas, sin cuadrados', async ($, on) => {
    const h = String(inicioDeHora(AHORA))
    mock.clock(on, { now: AHORA })
    motorMide(on)
    motorUsa(on)
    mock.store(on, { 'uso:otra': { [h]: { [clave('claude-haiku-5-5', 'max')]: [300_000, 0, 0, 0] } } })
    on('session.id', () => ({ value: 's1' }))
    motorResponde(on, 'claude-sonnet-5-5')
    await $.session.measure(MEDIDA)

    await paso($, 'claude-sonnet-5-5', 'high')

    const ui = await $.ui.mount({ ...PANE_ANCHO, surface: 'terminal' })
    await ui.press({ key: 's-plegar' })
    const textos = (await ui.findAll({ type: 'Text' })).map(t => t.text ?? '')
    const sem = textos.indexOf('Esta semana')
    expect(sem).toBeGreaterThan(-1)

    // Solo la sección de la semana: la fila de «Esta sesión» no puede satisfacer nada de esto.
    const deSemana = textos.slice(sem)
    const etiquetas = deSemana.filter(t => /^(Sonnet|Haiku) +5\.5 /.test(t))
    expect(etiquetas.slice().sort()).toEqual(['Haiku  5.5 max ', 'Sonnet 5.5 high'])
    expect(new Set(etiquetas.map(t => t.length)).size).toBe(1)
    expect(deSemana).not.toContain(' ■')
    expect(deSemana.some(t => t.includes('■'))).toBe(false)
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
    // Las etiquetas de la semana llevan relleno: se comparan sin él.
    expect(textos.slice(sem).map(t => t.trimEnd())).not.toContain('Sonnet 5.5 low')
    expect(textos.slice(sem)).not.toContain('modelo · esfuerzo')
    // «Esta sesión» no se pliega.
    expect(textos.slice(0, sem)).toContain('Opus 5.5 medium')
    expect((await ui.find({ type: 'Button', key: 's-plegar' }))?.props.label).toBe('Ver')

    await ui.press({ key: 's-plegar' })
    textos = (await ui.findAll({ type: 'Text' })).map(t => t.text ?? '')
    sem = textos.indexOf('Esta semana')
    expect(textos.slice(sem).map(t => t.trimEnd())).toContain('Sonnet 5.5 low')
    expect((await ui.find({ type: 'Button', key: 's-plegar' }))?.props.label).toBe('Ocultar')
    expect(guardados.get('prefs:semana')).toBe(true)

    await ui.press({ key: 's-plegar' })
    textos = (await ui.findAll({ type: 'Text' })).map(t => t.text ?? '')
    expect(textos.slice(textos.indexOf('Esta semana')).map(t => t.trimEnd())).not.toContain('Sonnet 5.5 low')
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

  test('idsDeActividad: una fila sin unir da su id; una unida da principal y/o subagente según lo que tenga', async () => {
    const base = { modelo: 'Opus 5.5', esfuerzo: 'high', origen: 'principal' as const, salida: 0 }
    const sinUnir: FilaSemana = { ...base, total: 500 }

    expect(idsDeActividad(sinUnir)).toEqual([idDeFila(sinUnir)])
    expect(idsDeActividad({ ...base, origen: 'subagente', total: 500 })).toEqual(['Opus 5.5|high|subagente'])
    expect(idsDeActividad({ ...base, total: 500, sub: 200 })).toEqual(['Opus 5.5|high|principal', 'Opus 5.5|high|subagente'])
    expect(idsDeActividad({ ...base, total: 500, sub: 500 })).toEqual(['Opus 5.5|high|subagente'])
    expect(idsDeActividad({ ...base, total: 500, sub: 0 })).toEqual(['Opus 5.5|high|principal'])
  })
})

describe('flujo (puro)', () => {
  const estado = (modo: 'preflight' | 'base' | 'cambios' | 'diff' | 'otro'): Senal => ({ tipo: 'estado', modo })
  const verificar: Senal = { tipo: 'verificar' }
  const agente = (nombre: string): Senal => ({ tipo: 'agente', nombre })
  const agenteFin = (nombre: string, bien = true): Senal => ({ tipo: 'agente-fin', nombre, bien })
  const pregunta = (plan: boolean): Senal => ({ tipo: 'pregunta', plan })

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

  test('iniciarFlujo: solo implementador (con o sin / y prefijo)', async () => {
    const base = { paso: 0, ejecuto: false, estado: 'en curso', inicio: 0, desde: 0, tiempos: {}, fin: null }

    expect(iniciarFlujo('implementador', '')).toEqual({ ...base, nombre: 'implementador' })
    expect(iniciarFlujo('/implementador-ligero', '')).toBeNull()
    expect(iniciarFlujo('claude-config:implementador', '')).toEqual({ ...base, nombre: 'implementador' })
    expect(iniciarFlujo('simplify', '')).toBeNull()
    expect(iniciarFlujo('/implementador:otra', '')).toBeNull()
    expect(iniciarFlujo('', '')).toBeNull()
    // Con la hora, el flujo y su primer tramo empiezan ahí, sin tiempos ni fin.
    expect(iniciarFlujo('implementador', '', 5_000)).toEqual({
      nombre: 'implementador',
      paso: 0,
      ejecuto: false,
      estado: 'en curso',
      inicio: 5_000,
      desde: 5_000,
      tiempos: {},
      fin: null,
    })
  })

  test('iniciarFlujo: el texto del pedido no cambia el flujo', async () => {
    const base = { paso: 0, ejecuto: false, estado: 'en curso', inicio: 0, desde: 0, tiempos: {}, fin: null }
    const relevo = '**Pedido:** RELEVO · inicio\nPEDIDO: arreglar el panel'
    const uso: Flujo['usoBase'] = { 'Opus 5.5|high|principal': [100, 10] }

    // Con o sin la marca, implementador abre implementador.
    for (const texto of [relevo, '**Pedido:** arreglar el panel']) {
      expect(iniciarFlujo('implementador', texto)).toEqual({ ...base, nombre: 'implementador' })
      expect(iniciarFlujo('/claude-config:implementador', texto)).toEqual({ ...base, nombre: 'implementador' })
    }

    expect(iniciarFlujo('implementador', relevo, 5_000, uso)).toEqual({ ...base, nombre: 'implementador', inicio: 5_000, desde: 5_000, usoBase: uso })
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

  test('senalDeHerramienta: estado.mjs con --paso trae el paso; sin él, con un valor roto o después de -- no', async () => {
    expect(bash('node ~/.claude/flujos/estado.mjs --cambios abc123 --desde x --paso 6')).toEqual({ tipo: 'estado', modo: 'cambios', paso: 6 })
    expect(bash('node ~/.claude/flujos/estado.mjs --base --paso 5')).toEqual({ tipo: 'estado', modo: 'base', paso: 5 })
    expect(bash('node ~/.claude/flujos/estado.mjs --paso 0')).toEqual({ tipo: 'estado', modo: 'preflight', paso: 0 })

    // Sin marca o con un valor que no es un entero: la misma señal de siempre, sin el campo.
    expect(bash('node ~/.claude/flujos/estado.mjs --cambios')).toEqual(estado('cambios'))
    expect(bash('node ~/.claude/flujos/estado.mjs --cambios --paso x')).toEqual(estado('cambios'))
    expect(bash('node ~/.claude/flujos/estado.mjs --cambios --paso')).toEqual(estado('cambios'))
    expect(bash('node ~/.claude/flujos/estado.mjs --cambios --paso -1')).toEqual(estado('cambios'))
    expect(bash('node ~/.claude/flujos/estado.mjs --cambios --paso 6x')).toEqual(estado('cambios'))

    // Después de `--` son rutas: no cuenta.
    expect(bash('node ~/.claude/flujos/estado.mjs --diff abc123 -- --paso 6')).toEqual(estado('diff'))

    // --guardar, --estado y --reglas son «otro»: no son el preflight, con o sin --paso.
    expect(bash('node ~/.claude/flujos/estado.mjs --guardar a86c3e plan --paso 2')).toEqual({ tipo: 'estado', modo: 'otro', paso: 2 })
    expect(bash('node ~/.claude/flujos/estado.mjs --estado')).toEqual(estado('otro'))
    expect(bash('node "$HOME/.claude/flujos/estado.mjs" --reglas')).toEqual(estado('otro'))
  })

  test('estado con --paso: manda sobre la heurística; sin marca o fuera de rango, la heurística', async () => {
    const marcado = (paso: number): Senal => ({ tipo: 'estado', modo: 'cambios', paso })
    const f = (paso: number): Flujo => ({ nombre: 'implementador', paso, ejecuto: true, estado: 'en curso', inicio: 0, desde: 0, tiempos: {}, fin: null })

    expect(avanzar(f(5), marcado(6))?.paso).toBe(6)
    expect(avanzar(f(5), { tipo: 'estado', modo: 'base', paso: 5 })?.paso).toBe(5)
    // «otro» sin marca deja el paso; con marca, la marca manda.
    expect(avanzar(f(5), { tipo: 'estado', modo: 'otro' })?.paso).toBe(5)
    expect(avanzar(f(1), { tipo: 'estado', modo: 'otro', paso: 2 })?.paso).toBe(2)

    // `--paso 9` no existe: queda lo que daba la heurística (en 5, `--cambios` sigue en 5; en 6, pasa a 7).
    expect(avanzar(f(5), marcado(9))?.paso).toBe(5)
    expect(avanzar(f(6), marcado(9))?.paso).toBe(7)
    expect(avanzar(f(5), estado('cambios'))?.paso).toBe(5)
  })

  test('una sola subtarea con marcas: la revisión final cuenta en Verificación final', async () => {
    const senales = [
      bash('node ~/.claude/flujos/estado.mjs --base --paso 5'),
      agente('ejecutor'),
      bash('node ~/.claude/flujos/estado.mjs --cambios abc --desde x --paso 6'),
      bash('node ~/.claude/flujos/verificar.mjs'),
      agente('revisor'),
      bash('node ~/.claude/flujos/estado.mjs --cambios abc --desde x --paso 7'),
    ]

    let flujo = iniciarFlujo('implementador', '')
    const vistos: number[] = []

    for (const s of senales) {
      expect(s).not.toBeNull()

      flujo = s === null ? flujo : avanzar(flujo, s)
      vistos.push(flujo?.paso ?? -1)
    }

    expect(vistos).toEqual([5, 5, 6, 6, 6, 7])
    expect(flujo?.revisiones).toEqual({ 6: 1 })

    const lista = flujo === null ? [] : nodos(flujo)

    expect(lista[5]?.revisiones).toBeUndefined()
    expect(lista[6]?.revisiones).toBe(1)
    expect(lista[7]?.estado).toBe('actual')
  })

  test('senalDeHerramienta: Agent, AskUserQuestion (header Plan), Edit/Write no mueven y nada de un subagente', async () => {
    expect(senalDeHerramienta('Agent', { subagent_type: 'explorador' }, undefined)).toEqual(agente('explorador'))
    expect(senalDeHerramienta('Agent', { subagent_type: '' }, undefined)).toBeNull()
    expect(senalDeHerramienta('Agent', { prompt: 'x' }, undefined)).toBeNull()

    expect(senalDeHerramienta('AskUserQuestion', { questions: [{ header: 'Plan' }] }, undefined)).toEqual(pregunta(true))
    expect(senalDeHerramienta('AskUserQuestion', { questions: [{ header: 'Otra' }, { header: ' plan ' }] }, undefined)).toEqual(pregunta(true))
    expect(senalDeHerramienta('AskUserQuestion', { questions: [{ header: 'Planes' }] }, undefined)).toEqual(pregunta(false))
    expect(senalDeHerramienta('AskUserQuestion', {}, undefined)).toEqual(pregunta(false))

    for (const file_path of ['/repo/MODS.md', '/repo/.claude/implementador.md', 'D:\\repo\\FLUJOS.md']) {
      expect(senalDeHerramienta('Edit', { file_path }, undefined)).toBeNull()
      expect(senalDeHerramienta('Write', { file_path }, undefined)).toBeNull()
    }

    expect(senalDeHerramienta('Read', { file_path: '/repo/MODS.md' }, undefined)).toBeNull()
    expect(senalDeHerramienta('Grep', {}, undefined)).toBeNull()

    // Lo que hace un subagente no mueve el flujo.
    expect(senalDeHerramienta('Bash', { command: 'node ~/.claude/flujos/estado.mjs' }, 'agente-1')).toBeNull()
    expect(senalDeHerramienta('Agent', { subagent_type: 'ejecutor' }, 'agente-1')).toBeNull()
    expect(senalDeHerramienta('Edit', { file_path: '/repo/a.ts' }, 'agente-1')).toBeNull()
    expect(senalDeHerramienta('AskUserQuestion', { questions: [{ header: 'Plan' }] }, 'agente-1')).toBeNull()
  })

  test('senalAlTerminar: el explorador y el revisor', async () => {
    expect(senalAlTerminar(agente('explorador'))).toEqual(agenteFin('explorador'))
    expect(senalAlTerminar(agente('explorador'), false)).toEqual(agenteFin('explorador', false))
    expect(senalAlTerminar(agente('revisor'))).toEqual(agenteFin('revisor'))
    expect(senalAlTerminar(agente('revisor'), false)).toEqual(agenteFin('revisor', false))
    expect(senalAlTerminar(agente('planificador'))).toBeNull()
    expect(senalAlTerminar(agente('ejecutor'))).toBeNull()
    expect(senalAlTerminar(agente('revisor-plan'))).toBeNull()
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
      agente('revisor-plan'),
      pregunta(true),
      ...subtarea,
      ...subtarea,
      verificar,
      agente('revisor'),
      estado('cambios'),
      verificar,
    ]

    expect(pasos('implementador', secuencia)).toEqual([0, 0, 1, 2, 2, 3, 4, 5, 5, 5, 5, 5, 5, 5, 5, 6, 6, 7, 7])
  })

  test('planificador lleva al paso 2 y cuenta el plan', async () => {
    const f: Flujo = { nombre: 'implementador', paso: 1, ejecuto: false, estado: 'en curso', inicio: 0, desde: 0, tiempos: {}, fin: null }

    const plan = avanzar(f, agente('planificador'), 1_000)
    expect(plan).toMatchObject({ paso: 2, planes: 1 })
    // Un re-plan desde la revisión del plan vuelve al 2 y suma otro.
    const revisado = avanzar(plan, agente('revisor-plan'), 2_000)
    expect(revisado?.paso).toBe(3)
    expect(avanzar(revisado, agente('planificador'), 3_000)).toMatchObject({ paso: 2, planes: 2 })
  })

  test('revisor-plan lleva al paso 3', async () => {
    const secuencia = [
      estado('preflight'),
      agente('explorador'),
      agenteFin('explorador'),
      agente('planificador'),
      agente('revisor-plan'),
      pregunta(true),
    ]

    expect(pasos('implementador', secuencia)).toEqual([0, 1, 2, 2, 3, 4])

    const f: Flujo = {
      nombre: 'implementador',
      paso: 3,
      ejecuto: false,
      planes: 1,
      estado: 'en curso',
      inicio: 0,
      desde: 0,
      tiempos: {},
      fin: null,
    }

    // En el paso 3 no cambia nada: ni el paso, ni `planes`, ni `revisiones`; el fin del agente tampoco.
    expect(avanzar(f, agente('revisor-plan'), 1_000)).toEqual(f)
    expect(avanzar(f, agenteFin('revisor-plan'), 1_000)).toEqual(f)

    // Desde el plan sí lleva al 3, sin contar como plan ni como revisión.
    const plan: Flujo = { ...f, paso: 2 }
    expect(avanzar(plan, agente('revisor-plan'), 1_000)).toEqual({ ...f, tiempos: { 2: 1_000 }, desde: 1_000 })

    // El `revisor` de verdad, desde la revisión del plan, pasa a Ejecución y se cuenta ahí.
    expect(avanzar(f, agente('revisor'), 1_000)).toMatchObject({ paso: 5, revisiones: { 5: 1 } })
  })

  test('implementador NORMAL: sin planificador salta de Plan a Aprobación', async () => {
    expect(
      pasos('implementador', [estado('preflight'), agente('explorador'), agenteFin('explorador'), pregunta(true), estado('base')]),
    ).toEqual([0, 1, 2, 4, 5])
    // Una pregunta que no es el plan no mueve nada; el fin de otro agente tampoco.
    expect(pasos('implementador', [agente('explorador'), pregunta(false), agenteFin('planificador')])).toEqual([1, 1, 1])
    // El fin del explorador solo cuenta desde Exploración.
    expect(pasos('implementador', [estado('base'), agenteFin('explorador')])).toEqual([5, 5])
    expect(pasos('implementador', [estado('diff')])).toEqual([0])
  })

  test('un verificar sin revisor antes queda en Ejecución; tras el revisor marca Verificación final y Cierre', async () => {
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

    // El índice 3 es el verificar de una subtarea (sin revisor antes): queda en Ejecución.
    expect(pasos('implementador', secuencia)).toEqual([5, 5, 5, 5, 5, 5, 5, 6, 7, 7])
  })

  test('el verificar y el revisor de cada subtarea quedan en Ejecución; solo el verificar tras el último revisor marca Verificación final', async () => {
    const sub = [estado('base'), agente('ejecutor'), estado('cambios'), verificar, agente('revisor')]
    const secuencia = [pregunta(true), ...sub, ...sub, verificar, agente('revisor'), estado('cambios'), verificar]

    expect(pasos('implementador', secuencia)).toEqual([4, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 6, 6, 7, 7])

    let f = iniciarFlujo('implementador', '', 0)

    for (const s of secuencia) f = avanzar(f, s, 1_000)

    expect(f).toMatchObject({ ejecuciones: 2, revisiones: { 5: 2, 6: 1 } })
    expect(nodos(f as Flujo)[5]?.revisiones).toBe(2)
    expect(nodos(f as Flujo)[6]?.revisiones).toBe(1)
  })

  test('una corrección de la subtarea (RECHAZADO o verificar ROJO) sigue en Ejecución', async () => {
    const secuencia = [
      estado('base'),
      agente('ejecutor'),
      estado('cambios'),
      verificar,
      agente('ejecutor'),
      estado('cambios'),
      verificar,
      agente('revisor'),
      agente('ejecutor'),
      estado('cambios'),
      verificar,
      agente('revisor'),
    ]

    expect(pasos('implementador', secuencia)).toEqual(Array(12).fill(5))

    let f = iniciarFlujo('implementador', '', 0)

    for (const s of secuencia) f = avanzar(f, s, 1_000)

    expect(f).toMatchObject({ paso: 5, revisiones: { 5: 2 } })
  })

  test('verificación final ROJA y corrección de la revisión final vuelven a Verificación final', async () => {
    const secuencia = [
      estado('base'),
      agente('ejecutor'),
      estado('cambios'),
      verificar,
      agente('revisor'),
      verificar,
      agente('ejecutor'),
      estado('cambios'),
      verificar,
      agente('revisor'),
      agente('ejecutor'),
      estado('cambios'),
      verificar,
      agente('revisor'),
    ]

    expect(pasos('implementador', secuencia)).toEqual([5, 5, 5, 5, 5, 6, 5, 5, 6, 6, 5, 5, 6, 6])

    let f = iniciarFlujo('implementador', '', 0)

    for (const s of secuencia) f = avanzar(f, s, 1_000)

    expect(f).toMatchObject({ revisiones: { 5: 1, 6: 2 } })
  })

  test('estado --base tras un verificar en 6 abre otra subtarea en Ejecución', async () => {
    const secuencia = [
      estado('base'),
      agente('ejecutor'),
      estado('cambios'),
      verificar,
      agente('revisor'),
      verificar,
      estado('base'),
      agente('ejecutor'),
      estado('cambios'),
      verificar,
      agente('revisor'),
    ]

    expect(pasos('implementador', secuencia)).toEqual([5, 5, 5, 5, 5, 6, 5, 5, 5, 5, 5])
  })

  test('una corrección del cierre con dos ejecutores seguidos conserva la verificación final', async () => {
    const secuencia = [
      estado('base'),
      agente('ejecutor'),
      estado('cambios'),
      verificar,
      agente('revisor'),
      verificar,
      agente('ejecutor'),
      agente('ejecutor'),
      estado('cambios'),
      verificar,
    ]

    expect(pasos('implementador', secuencia).at(-1)).toBe(6)
  })

  test('reviso y cierre: solo se escriben cuando hay algo que anotar y un flujo sin ellos se tolera', async () => {
    const nuevo = iniciarFlujo('implementador', '') as Flujo

    expect(nuevo).not.toHaveProperty('reviso')
    expect(nuevo).not.toHaveProperty('cierre')

    // Flujo en 5 con `ejecuto` y sin los campos (atom de 0.13.0).
    const en5: Flujo = { ...nuevo, paso: 5, ejecuto: true }
    const ejecutado = avanzar(en5, agente('ejecutor'), 0)

    expect(ejecutado).toEqual({ ...en5, ejecuciones: 2 })
    expect(avanzar(en5, verificar, 0)).toEqual(en5)

    // Flujo en 6 sin los campos: el verificar se queda en 6.
    const en6: Flujo = { ...en5, paso: 6 }

    expect(avanzar(en6, verificar, 0)).toEqual(en6)

    // Tras un revisor queda `reviso: true`.
    const revisado = avanzar(en5, agente('revisor'), 0) as Flujo

    expect(revisado.reviso).toBe(true)
    expect(revisado).not.toHaveProperty('cierre')

    // Un ejecutor en 5 sin `cierre` deja `reviso` en false.
    expect(avanzar(revisado, agente('ejecutor'), 0)).toMatchObject({ paso: 5, reviso: false })

    // Un verificar con `reviso: true` escribe `cierre: true`.
    const cerrado = avanzar(revisado, verificar, 0) as Flujo

    expect(cerrado).toMatchObject({ paso: 6, reviso: true, cierre: true })

    // Un ejecutor con `cierre: true` conserva `reviso: true`.
    expect(avanzar(cerrado, agente('ejecutor'), 0)).toMatchObject({ paso: 5, reviso: true, cierre: true })

    // `--base` con `cierre: true` lo pone en false.
    expect(avanzar(cerrado, estado('base'), 0)).toMatchObject({ paso: 5, cierre: false })
  })

  test('PASOS.implementador: Plan en el paso 2 y Revisión del plan en el 3', async () => {
    expect(PASOS.implementador).toHaveLength(8)
    expect(PASOS.implementador[2]).toBe('Plan')
    expect(PASOS.implementador[3]).toBe('Revisión del plan')
    expect(PASOS.implementador.slice(4)).toEqual(['Aprobación', 'Ejecución', 'Verificación final', 'Cierre'])
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
      agenteFin('revisor'),
    ]

    for (const s of senales) expect(avanzar(null, s)).toBeNull()

    for (const razon of ['answer', 'abort', 'error']) {
      const f = terminarFlujo({ ...(iniciarFlujo('implementador', '') as Flujo), paso: 5 }, razon, 'listo')

      for (const s of senales) expect(avanzar(f, s)).toEqual(f)
    }
  })

  test('terminarFlujo: completo, detenido por CIERRE … DETENIDO, interrumpido; idempotente', async () => {
    const f: Flujo = {
      nombre: 'implementador',
      paso: 6,
      ejecuto: true,
      estado: 'en curso',
      inicio: 1_000,
      desde: 4_000,
      tiempos: {},
      fin: null,
    }
    // Cierra a los 10 s: el tramo abierto (6 s) se suma al paso actual y el flujo fija su fin.
    const T = 10_000
    const cerrado = (estado: Flujo['estado']): Flujo => ({ ...f, estado, tiempos: { 6: 6_000 }, desde: T, fin: T })

    expect(terminarFlujo(f, 'answer', 'CIERRE · todo listo', T)).toEqual(cerrado('completo'))
    expect(terminarFlujo(f, 'answer', undefined, T)).toEqual(cerrado('completo'))
    expect(terminarFlujo(f, 'answer', 'Resumen\nCIERRE · subtarea 2 — DETENIDO\nmás texto', T)).toEqual(cerrado('detenido'))
    // El DETENIDO debe ir en la misma línea que CIERRE.
    expect(terminarFlujo(f, 'answer', 'CIERRE · listo\nDETENIDO', T)).toEqual(cerrado('completo'))
    expect(terminarFlujo(f, 'abort', 'CIERRE · x — DETENIDO', T)).toEqual(cerrado('interrumpido'))
    expect(terminarFlujo(f, 'error', undefined, T)).toEqual(cerrado('interrumpido'))
    expect(terminarFlujo(null, 'answer', 'x', T)).toBeNull()
    // Sin hora no suma tiempo: el tramo queda en 0 y el fin en la hora del tramo abierto.
    expect(terminarFlujo(f, 'abort')).toEqual({ ...f, estado: 'interrumpido', tiempos: { 6: 0 }, fin: 4_000 })

    const detenido = terminarFlujo(f, 'answer', 'CIERRE · x — DETENIDO', T)
    expect(terminarFlujo(detenido, 'abort', undefined, T + 5_000)).toEqual(detenido)
    expect(terminarFlujo(detenido, 'answer', 'CIERRE · ok', T + 5_000)).toEqual(detenido)
    expect(doc(terminarFlujo(f, 'abort', undefined, T))).toBe('interrumpido:6')
  })

  test('avanzar y terminarFlujo: el tiempo se acumula por paso, también al volver', async () => {
    /** Dónde va el flujo: paso, inicio del tramo abierto y tiempos acumulados. */
    const tramo = (x: Flujo | null) => ({ paso: x?.paso, desde: x?.desde, tiempos: x?.tiempos })

    let f = iniciarFlujo('implementador', '', 1_000)
    expect(tramo(f)).toEqual({ paso: 0, desde: 1_000, tiempos: {} })

    // Si el paso no cambia no se suma nada ni se mueve el tramo abierto.
    f = avanzar(f, estado('preflight'), 3_000)
    expect(tramo(f)).toEqual({ paso: 0, desde: 1_000, tiempos: {} })

    // Un paso nuevo suma el tramo al paso que deja y abre otro desde la hora de la señal.
    f = avanzar(f, agente('explorador'), 4_000)
    expect(tramo(f)).toEqual({ paso: 1, desde: 4_000, tiempos: { 0: 3_000 } })
    f = avanzar(f, agenteFin('explorador'), 10_000)
    expect(tramo(f)).toEqual({ paso: 2, desde: 10_000, tiempos: { 0: 3_000, 1: 6_000 } })

    expect(avanzar(f, pregunta(false), 50_000)).toEqual(f)
    expect(avanzar(f, agenteFin('explorador'), 60_000)).toEqual(f)

    // Salta de Plan a Ejecución: el paso 2 suma y los saltados (3 y 4) no tienen tiempo.
    f = avanzar(f, estado('base'), 12_000)
    expect(tramo(f)).toEqual({ paso: 5, desde: 12_000, tiempos: { 0: 3_000, 1: 6_000, 2: 2_000 } })

    // El ejecutor en Ejecución no cambia de paso: marca `ejecuto` pero no suma tiempo.
    f = avanzar(f, agente('ejecutor'), 14_000)
    expect(f?.ejecuto).toBe(true)
    expect(tramo(f)).toEqual({ paso: 5, desde: 12_000, tiempos: { 0: 3_000, 1: 6_000, 2: 2_000 } })

    // Verificación final y vuelta a Ejecución: volver a un paso ya visitado acumula.
    // El revisor de la subtarea: el siguiente verificar es el final.
    f = avanzar(f, agente('revisor'), 18_000)
    f = avanzar(f, verificar, 20_000)
    expect(tramo(f)).toEqual({ paso: 6, desde: 20_000, tiempos: { 0: 3_000, 1: 6_000, 2: 2_000, 5: 8_000 } })
    f = avanzar(f, estado('base'), 25_000)
    expect(tramo(f)).toEqual({ paso: 5, desde: 25_000, tiempos: { 0: 3_000, 1: 6_000, 2: 2_000, 5: 8_000, 6: 5_000 } })
    f = avanzar(f, verificar, 31_000)
    expect(tramo(f)).toEqual({ paso: 6, desde: 31_000, tiempos: { 0: 3_000, 1: 6_000, 2: 2_000, 5: 14_000, 6: 5_000 } })

    // Sin hora, el paso cambia pero no suma tiempo.
    expect(tramo(avanzar(f, estado('cambios')))).toEqual({
      paso: 7,
      desde: 31_000,
      tiempos: { 0: 3_000, 1: 6_000, 2: 2_000, 5: 14_000, 6: 5_000 },
    })

    // Terminar cierra el tramo abierto y fija el fin.
    const fin = terminarFlujo(f, 'answer', 'CIERRE · ok', 36_000)
    expect(fin).toMatchObject({ estado: 'completo', paso: 6, desde: 36_000, fin: 36_000, inicio: 1_000 })
    expect(fin?.tiempos).toEqual({ 0: 3_000, 1: 6_000, 2: 2_000, 5: 14_000, 6: 10_000 })
    // Una hora anterior al tramo abierto no resta.
    expect(terminarFlujo(f, 'abort', undefined, 1_000)?.tiempos[6]).toBe(5_000)

    // Terminado no se revive: ni suma ni cambia.
    expect(avanzar(fin, estado('base'), 90_000)).toEqual(fin)
  })

  test('nodos y resumenFlujo con tiempos: pasados, actual en curso, saltados sin tiempo y total', async () => {
    let f = iniciarFlujo('implementador', '', 0)
    f = avanzar(f, agente('explorador'), 5_000)
    f = avanzar(f, agenteFin('explorador'), 25_000)
    f = avanzar(f, estado('base'), 30_000)
    f = avanzar(f, agente('ejecutor'), 32_000)
    // Ahora: paso 5 (Ejecución) desde los 30 s; a los 200 s lleva 170 s en el paso.
    const T = 200_000
    const lista = nodos(f as Flujo, T)

    expect(lista.map(n => n.ms)).toEqual([5_000, 20_000, 5_000, undefined, undefined, 170_000, undefined, undefined, undefined])
    expect(lista.map(n => n.estado)).toEqual(['pasado', 'pasado', 'pasado', 'pasado', 'pasado', 'actual', 'pendiente', 'pendiente', 'pendiente'])
    expect(resumenFlujo(f, T)).toBe('/implementador · Ejecución · 3 min 20 s')

    // Volver a Ejecución después de la Verificación final: el actual suma lo de antes y lo de ahora.
    let g = avanzar(f, agente('revisor'), 100_000)
    g = avanzar(g, verificar, 100_000)
    g = avanzar(g, estado('base'), 110_000)
    // El paso 6 (ahora pendiente) no muestra tiempo aunque ya se visitó.
    expect(nodos(g as Flujo, 150_000).map(n => n.ms)).toEqual([5_000, 20_000, 5_000, undefined, undefined, 70_000 + 40_000, undefined, undefined, undefined])

    // Terminado: el último nodo trae el total y el tramo abierto ya se cerró.
    const fin = terminarFlujo(f, 'answer', 'CIERRE · ok', 3_900_000) as Flujo
    const final = nodos(fin, 9_999_999)

    expect(final[5]).toEqual({ etiqueta: 'Ejecución', estado: 'pasado', veces: 1, ms: 3_870_000 })
    expect(final.at(-1)).toEqual({ etiqueta: 'Terminado', estado: 'actual', ms: 3_900_000 })
    expect(final.slice(6, 8).map(n => n.ms)).toEqual([undefined, undefined])
    // El total de un flujo terminado no sigue corriendo con la hora.
    expect(resumenFlujo(fin, 9_999_999)).toBe('/implementador · Terminado · 1 h 5 min')

    // Sin la hora no hay tiempos en ningún nodo.
    expect(nodos(f as Flujo).every(n => n.ms === undefined)).toBe(true)
    expect(nodos(fin).every(n => n.ms === undefined)).toBe(true)
  })

  test('nodos y resumenFlujo: pasado, actual, pendiente y Terminado al final', async () => {
    const f: Flujo = { nombre: 'implementador', paso: 5, ejecuto: true, estado: 'en curso', inicio: 0, desde: 0, tiempos: {}, fin: null }
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

    // Un flujo guardado con un nombre que ya no existe no lanza: no tiene pasos y se resume sin ellos.
    const viejo = { ...f, nombre: 'otro', paso: 3 } as unknown as Flujo
    expect(nodos(viejo, 1_000)).toEqual([{ etiqueta: 'Terminado', estado: 'pendiente' }])
    expect(resumenFlujo(viejo)).toBe('/otro')
    expect(resumenFlujo(terminarFlujo(viejo, 'abort'))).toBe('/otro · Terminado · interrumpido')
    expect(() => avanzar(viejo, agente('explorador'), 1_000)).not.toThrow()
    expect(resumenFlujo(null)).toBe('sin flujo en esta sesión')
  })

  test('resumenFlujo con y sin la hora', async () => {
    const f: Flujo = { nombre: 'implementador', paso: 2, ejecuto: false, estado: 'en curso', inicio: 0, desde: 0, tiempos: {}, fin: null }

    expect(resumenFlujo(f, 4_000)).toBe('/implementador · Plan · 4 s')
    expect(resumenFlujo(f)).toBe('/implementador · Plan')
  })

  test('las funciones no mutan el flujo que reciben', async () => {
    const original: Flujo = {
      nombre: 'implementador',
      paso: 4,
      ejecuto: false,
      estado: 'en curso',
      inicio: 0,
      desde: 1_000,
      tiempos: Object.freeze({ 3: 500 }),
      fin: null,
    }
    const f: Flujo = Object.freeze({ ...original })

    const a = avanzar(f, agente('ejecutor'), 4_000)
    expect(a).toEqual({ ...f, paso: 5, ejecuto: true, ejecuciones: 1, desde: 4_000, tiempos: { 3: 500, 4: 3_000 } })
    expect(a).not.toBe(f)
    expect(avanzar(f, estado('diff'), 4_000)).toEqual(f)
    expect(terminarFlujo(f, 'answer', 'CIERRE · x — DETENIDO', 4_000)?.estado).toBe('detenido')
    expect(nodos(f, 4_000)).toHaveLength(9)
    expect(resumenFlujo(f, 4_000)).toBe('/implementador · Aprobación · 4 s')
    expect(f).toEqual(original)
    expect(f.tiempos).toEqual({ 3: 500 })
  })

  test('un flujo con la forma 0.9.3 (sin inicio, desde, tiempos ni fin) no lanza: empieza en la hora que se le da', async () => {
    const viejo = { nombre: 'implementador', variante: null, paso: 4, ejecuto: false, estado: 'en curso' } as unknown as Flujo

    // Dibujar: nodos y línea resumen cuentan desde esa hora.
    expect(resumenFlujo(viejo, 9_000)).toBe('/implementador · Aprobación · 0 s')
    expect(nodos(viejo, 9_000).find(n => n.estado === 'actual')?.ms).toBe(0)
    expect(resumenFlujo(viejo)).toBe('/implementador · Aprobación')
    expect(nodos(viejo, 9_000)).toHaveLength(9)
    expect(nodos(viejo, 9_000).at(-1)).toEqual({ etiqueta: 'Terminado', estado: 'pendiente' })

    // Uno ya terminado, también sin fin: se dibuja con «Terminado» actual y sin tiempo.
    const terminado = { ...viejo, estado: 'completo' } as Flujo
    expect(resumenFlujo(terminado, 9_000)).toBe('/implementador · Terminado · 0 s')
    expect(nodos(terminado, 9_000).at(-1)).toEqual({ etiqueta: 'Terminado', estado: 'actual' })

    // Avanzar sin cambio de paso conserva el paso y deja los campos completos.
    expect(avanzar(viejo, estado('diff'), 9_000)).toEqual({ ...viejo, inicio: 9_000, desde: 9_000, tiempos: {}, fin: null })

    // Avanzar con cambio de paso abre el tramo siguiente a esa hora.
    expect(avanzar(viejo, agente('ejecutor'), 9_000)).toEqual({
      ...viejo,
      paso: 5,
      ejecuto: true,
      ejecuciones: 1,
      inicio: 9_000,
      desde: 9_000,
      tiempos: { 4: 0 },
      fin: null,
    })

    // Terminar cierra con fin y estado.
    expect(terminarFlujo(viejo, 'answer', 'CIERRE · x — COMPLETO', 9_000)).toEqual({
      ...viejo,
      estado: 'completo',
      inicio: 9_000,
      desde: 9_000,
      tiempos: { 4: 0 },
      fin: 9_000,
    })
    expect(terminarFlujo(viejo, 'aborted')?.estado).toBe('interrumpido')
    expect(viejo).not.toHaveProperty('tiempos')
  })

  test('varios exploradores: Exploración hasta que vuelve el último, en cualquier orden', async () => {
    const A = agente('explorador')
    const F = agenteFin('explorador')

    expect(pasos('implementador', [estado('preflight'), A, A, A, F, F, F])).toEqual([0, 1, 1, 1, 1, 1, 2])
    expect(pasos('implementador', [A, A, F, A, F, F])).toEqual([1, 1, 1, 1, 1, 2])
  })

  test('varios exploradores: el tiempo de Exploración corre desde el primero hasta que vuelve el último, una sola vez', async () => {
    const A = agente('explorador')
    const F = agenteFin('explorador')
    const tramo = (x: Flujo | null) => ({ paso: x?.paso, desde: x?.desde, tiempos: x?.tiempos })

    let f = iniciarFlujo('implementador', '', 0)

    for (const t of [1_000, 3_000, 4_000]) {
      f = avanzar(f, A, t)
      expect(tramo(f)).toEqual({ paso: 1, desde: 1_000, tiempos: { 0: 1_000 } })
    }

    for (const t of [10_000, 12_000]) {
      f = avanzar(f, F, t)
      expect(tramo(f)).toEqual({ paso: 1, desde: 1_000, tiempos: { 0: 1_000 } })
    }

    f = avanzar(f, F, 15_000)
    expect(tramo(f)).toEqual({ paso: 2, desde: 15_000, tiempos: { 0: 1_000, 1: 14_000 } })
  })

  test('exploradores que fallan: cuentan como vueltos; si fallan todos queda en Exploración; relanzar lo destraba', async () => {
    const A = agente('explorador')
    const F = agenteFin('explorador')
    const M = agenteFin('explorador', false)

    expect(pasos('implementador', [A, A, F, M])).toEqual([1, 1, 1, 2])
    expect(pasos('implementador', [A, A, M, F])).toEqual([1, 1, 1, 2])
    expect(pasos('implementador', [A, A, M, M, A, F])).toEqual([1, 1, 1, 1, 1, 2])
    expect(pasos('implementador', [A, M])).toEqual([1, 1])
  })

  test('el contador de exploradores nunca es negativo y una tanda nueva lo reinicia', async () => {
    const A = agente('explorador')
    const F = agenteFin('explorador')

    // Un fin de más no deja el contador bajo cero.
    let g = iniciarFlujo('implementador', '')
    for (const s of [A, F, F]) g = avanzar(g, s)
    expect(g).toMatchObject({ paso: 2, exploradores: 0, exploro: true })

    // Desde otro paso, un explorador abre una tanda nueva: reinicia el contador y `exploro`.
    const f: Flujo = {
      nombre: 'implementador',
      paso: 3,
      ejecuto: false,
      exploradores: 2,
      exploro: true,
      estado: 'en curso',
      inicio: 0,
      desde: 0,
      tiempos: {},
      fin: null,
    }
    const nueva = avanzar(f, A)
    expect(nueva).toMatchObject({ paso: 1, exploradores: 1, exploro: false })
    expect(avanzar(nueva, F)).toMatchObject({ paso: 2, exploradores: 0, exploro: true })

    // Otro agente no toca el contador.
    expect(avanzar(f, agenteFin('planificador'))).toEqual(f)

    // Un flujo congelado no se muta.
    const congelado: Flujo = Object.freeze({ ...f, tiempos: Object.freeze({}) })
    expect(() => avanzar(congelado, A, 1_000)).not.toThrow()
    expect(() => avanzar(congelado, F, 1_000)).not.toThrow()
    expect(congelado).toEqual(f)
  })

  test('un flujo con la forma 0.9.4 (sin exploradores ni exploro) no lanza: su explorador en vuelo, al volver, pasa a Plan', async () => {
    const viejo: Flujo = {
      nombre: 'implementador',
      paso: 1,
      ejecuto: false,
      estado: 'en curso',
      inicio: 0,
      desde: 1_000,
      tiempos: { 0: 1_000 },
      fin: null,
    }

    const vuelto = avanzar(viejo, agenteFin('explorador'), 5_000)
    expect(vuelto).toMatchObject({ paso: 2, exploradores: 0, tiempos: { 0: 1_000, 1: 4_000 } })
    expect(Number.isNaN(vuelto?.exploradores)).toBe(false)
    expect(avanzar(viejo, agente('explorador'), 2_000)).toMatchObject({ paso: 1, exploradores: 1 })

    // La forma 0.9.3 en Exploración: al volver su explorador pasa a Plan.
    const v093 = { nombre: 'implementador', variante: null, paso: 1, ejecuto: false, estado: 'en curso' } as unknown as Flujo
    expect(avanzar(v093, agenteFin('explorador'), 5_000)?.paso).toBe(2)

    expect(() => nodos(viejo, 3_000)).not.toThrow()
    expect(() => resumenFlujo(viejo, 3_000)).not.toThrow()
  })

  test('totalExploradores suma en cada tanda y se conserva al volver y al cerrar', async () => {
    const A = agente('explorador')
    const F = agenteFin('explorador')
    let f = iniciarFlujo('implementador', '', 0)

    for (const s of [A, A, A, F, F, F]) f = avanzar(f, s, 1_000)
    expect(f).toMatchObject({ totalExploradores: 3, exploradores: 0, paso: 2 })

    // Otra tanda desde Plan: el total sigue y suma; los en vuelo reinician.
    f = avanzar(f, A, 2_000)
    expect(f).toMatchObject({ totalExploradores: 4, exploradores: 1, paso: 1 })

    const cerrado = terminarFlujo(f, 'answer', 'CIERRE · ok', 3_000)
    expect(cerrado).toMatchObject({ totalExploradores: 4, estado: 'completo' })
    expect(avanzar(cerrado, A, 4_000)).toBe(cerrado)
    expect(avanzar(cerrado, F, 4_000)).toBe(cerrado)
    expect(terminarFlujo(f, 'clear', undefined, 3_000)).toMatchObject({ totalExploradores: 4, estado: 'interrumpido' })
  })

  test('nodos: Exploración lleva exploradores solo si hubo y no está pendiente', async () => {
    const A = agente('explorador')
    const F = agenteFin('explorador')
    const nuevo = iniciarFlujo('implementador', '', 0) as Flujo

    // Sin exploradores el nodo no trae la propiedad.
    expect(nodos(nuevo)[1]).toEqual({ etiqueta: 'Exploración', estado: 'pendiente' })

    let f: Flujo | null = nuevo
    // La primera señal abre Exploración a 1 s; el último regreso, a 6 s, la cierra con 5 s.
    const senales = [A, A, A, F, F, F]

    for (const [i, s] of senales.entries()) f = avanzar(f, s, 1_000 * (i + 1))

    expect(nodos(f as Flujo)[1]).toEqual({ etiqueta: 'Exploración', estado: 'pasado', exploradores: 3 })
    expect(nodos(f as Flujo, 7_000)[1]).toEqual({ etiqueta: 'Exploración', estado: 'pasado', exploradores: 3, ms: 5_000 })

    const fin = terminarFlujo(f, 'answer', 'CIERRE · ok', 6_000) as Flujo
    expect(nodos(fin)[1].exploradores).toBe(3)
    expect(nodos(fin, 9_000)[1].exploradores).toBe(3)

    // Exploración en curso con lanzados en vuelo.
    const enVuelo = avanzar(avanzar(nuevo, A, 1_000), A, 1_000) as Flujo
    expect(nodos(enVuelo, 2_000)[1]).toMatchObject({ estado: 'actual', exploradores: 2 })

    // Volver al paso 0: Exploración queda pendiente y no lleva el total.
    const atras = avanzar(f, estado('preflight'), 2_000) as Flujo
    expect(atras.paso).toBe(0)
    expect(nodos(atras)[1]).toEqual({ etiqueta: 'Exploración', estado: 'pendiente' })
    expect(nodos(atras, 3_000)[1].exploradores).toBeUndefined()
  })

  test('un flujo con la forma 0.9.5 (exploradores sin totalExploradores) no lanza', async () => {
    const A = agente('explorador')
    const F = agenteFin('explorador')
    const viejo: Flujo = {
      nombre: 'implementador',
      paso: 1,
      ejecuto: false,
      estado: 'en curso',
      exploradores: 2,
      exploro: false,
      inicio: 0,
      desde: 1_000,
      tiempos: { 0: 1_000 },
      fin: null,
    }

    // Sin total, los en vuelo son la cota inferior; al primer regreso se fija.
    expect(nodos(viejo, 2_000)[1].exploradores).toBe(2)
    expect(avanzar(viejo, F, 3_000)).toMatchObject({ exploradores: 1, totalExploradores: 2 })
    expect(avanzar(viejo, A, 3_000)).toMatchObject({ exploradores: 3, totalExploradores: 3 })
    expect(() => nodos(viejo, 3_000)).not.toThrow()
    expect(() => resumenFlujo(viejo, 3_000)).not.toThrow()

    // Un flujo congelado no se muta.
    const congelado: Flujo = Object.freeze({ ...viejo, tiempos: Object.freeze({ 0: 1_000 }) })
    expect(() => avanzar(congelado, A, 3_000)).not.toThrow()
    expect(() => avanzar(congelado, F, 3_000)).not.toThrow()
    expect(congelado.exploradores).toBe(2)
    expect(congelado.totalExploradores).toBeUndefined()
  })

  test('Plan, Ejecución y revisores cuentan cada lanzamiento: re-plan, correcciones y revisión integral en paralelo', async () => {
    const R = agente('revisor')
    const senales = [
      agente('planificador'),
      agente('planificador'),
      pregunta(true),
      estado('base'),
      agente('ejecutor'),
      agente('ejecutor'),
      agente('ejecutor'),
      R,
      R,
      R,
      verificar,
      R,
      R,
    ]
    let f = iniciarFlujo('implementador', '', 0)
    for (const s of senales) f = avanzar(f, s, 1_000)

    expect(f).toMatchObject({ paso: 6, planes: 2, ejecuciones: 3, revisiones: { 5: 3, 6: 2 } })

    const lista = nodos(f as Flujo)

    expect(lista[2]).toEqual({ etiqueta: 'Plan', estado: 'pasado', veces: 2 })
    expect(lista[5]).toEqual({ etiqueta: 'Ejecución', estado: 'pasado', veces: 3, revisiones: 3 })
    expect(lista[6]).toEqual({ etiqueta: 'Verificación final', estado: 'actual', revisiones: 2 })
    expect(lista.filter((_, i) => ![2, 5, 6].includes(i)).some(n => n.veces !== undefined || n.revisiones !== undefined)).toBe(false)

    // Se conservan tras terminar.
    const fin = terminarFlujo(f, 'answer', 'CIERRE · ok', 2_000) as Flujo
    expect(fin).toMatchObject({ planes: 2, ejecuciones: 3, revisiones: { 5: 3, 6: 2 } })
    expect(nodos(fin)[2].veces).toBe(2)
    expect(nodos(fin)[5]).toMatchObject({ veces: 3, revisiones: 3 })
    expect(nodos(fin)[6].revisiones).toBe(2)
    expect(nodos(fin).at(-1)).toEqual({ etiqueta: 'Terminado', estado: 'actual' })

    // Con el paso pendiente faltan.
    const atras = avanzar(f, estado('preflight'), 3_000) as Flujo
    expect(atras.paso).toBe(0)
    expect(nodos(atras).some(n => n.veces !== undefined || n.revisiones !== undefined)).toBe(false)

    // Que vuelva el ejecutor no cuenta.
    expect(avanzar(f, agenteFin('ejecutor'))).toEqual(f)

    // Un flujo congelado, con `revisiones` congelado, no se muta.
    const congelado: Flujo = Object.freeze({ ...(f as Flujo), revisiones: Object.freeze({ 5: 3, 6: 2 }) })
    expect(() => avanzar(congelado, R, 4_000)).not.toThrow()
    expect(avanzar(congelado, R, 4_000)?.revisiones).toEqual({ 5: 3, 6: 3 })
    expect(congelado.revisiones).toEqual({ 5: 3, 6: 2 })
  })

  test('una sola subtarea: la revisión final cuenta en Verificación final', async () => {
    // Una sola subtarea: su ejecutor y su revisor, verificar.mjs y luego la revisión final.
    const senales = [estado('base'), agente('ejecutor'), estado('cambios'), agente('revisor'), verificar, agente('revisor')]
    let f = iniciarFlujo('implementador', '', 0)
    expect(pasos('implementador', senales)).toEqual([5, 5, 5, 5, 6, 6])
    for (const s of senales) f = avanzar(f, s, 1_000)

    expect(f).toMatchObject({ paso: 6, ejecuciones: 1, revisiones: { 5: 1, 6: 1 } })

    const lista = nodos(f as Flujo)

    expect(lista[5]).toEqual({ etiqueta: 'Ejecución', estado: 'pasado', veces: 1, revisiones: 1 })
    expect(lista[6]).toEqual({ etiqueta: 'Verificación final', estado: 'actual', revisiones: 1 })
    expect(lista.filter((_, i) => ![5, 6].includes(i)).some(n => n.veces !== undefined || n.revisiones !== undefined)).toBe(false)
  })

  test('un flujo con la forma 0.9.7 (sin planes, ejecuciones ni revisiones) no lanza: Ejecución toma `ejecuto` como cota y cuenta desde ahí', async () => {
    const viejo: Flujo = {
      nombre: 'implementador',
      paso: 5,
      ejecuto: true,
      totalExploradores: 2,
      estado: 'en curso',
      inicio: 0,
      desde: 1_000,
      tiempos: { 0: 1_000 },
      fin: null,
    }

    expect(nodos(viejo, 2_000)[5]).toMatchObject({ etiqueta: 'Ejecución', veces: 1 })
    expect(nodos(viejo, 2_000)[2].veces).toBeUndefined()
    expect(avanzar(viejo, agente('ejecutor'), 2_000)?.ejecuciones).toBe(2)
    expect(avanzar(viejo, agente('revisor'), 2_000)?.revisiones).toEqual({ 5: 1 })
    expect(avanzar(viejo, agente('planificador'), 2_000)?.planes).toBe(1)

    // La forma 0.9.3 tampoco lanza.
    const muyViejo = { nombre: 'implementador', variante: null, paso: 5, ejecuto: true, estado: 'en curso' } as unknown as Flujo
    expect(() => nodos(muyViejo, 3_000)).not.toThrow()
    expect(() => resumenFlujo(muyViejo, 3_000)).not.toThrow()
    expect(nodos(muyViejo, 3_000)[5].veces).toBe(1)
  })

  test('la espera del usuario no suma al paso ni al trabajo: va aparte en su paso y en Terminado', async () => {
    let f = iniciarFlujo('implementador', '', 0)
    f = avanzar(f, agente('explorador'), 5_000)
    f = avanzar(f, agenteFin('explorador'), 25_000)
    f = abrirEspera(avanzar(f, pregunta(true), 30_000), 30_000)
    expect(f).toMatchObject({ paso: 4, desde: 30_000, preguntaDesde: 30_000, tiempos: { 0: 5_000, 1: 20_000, 2: 5_000, 4: 0 } })

    // Con la pregunta abierta, Aprobación no cuenta trabajo: todo el tiempo es espera.
    expect(nodos(f, 90_000)[4]).toEqual({ etiqueta: 'Aprobación', estado: 'actual', ms: 0, esperaUsuario: 60_000 })
    expect(resumenFlujo(f, 90_000)).toBe('/implementador · Aprobación · 30 s')
    // Sin hora, ningún nodo lleva espera.
    expect(nodos(f).some(n => n.esperaUsuario !== undefined)).toBe(false)

    // Al responder, la espera queda en Aprobación y el trabajo sigue desde ahí.
    f = cerrarEspera(f, 330_000)
    expect(f).toMatchObject({ paso: 4, desde: 330_000, preguntaDesde: null, esperaUsuario: { 4: 300_000 } })
    f = avanzar(f, estado('base'), 340_000)
    expect(f?.tiempos[4]).toBe(10_000)

    // Otra pregunta en Ejecución: la espera se anota en su paso.
    f = abrirEspera(f, 400_000)
    f = cerrarEspera(f, 460_000)
    expect(f?.esperaUsuario).toEqual({ 4: 300_000, 5: 60_000 })

    f = terminarFlujo(f, 'answer', 'CIERRE · ok — COMPLETO', 500_000)
    expect(f?.estado).toBe('completo')
    expect(Object.values(f?.tiempos ?? {}).reduce((suma, ms) => suma + ms, 0)).toBe(140_000)

    const lista = f ? nodos(f, 600_000) : []
    expect(lista[4]).toMatchObject({ etiqueta: 'Aprobación', ms: 10_000, esperaUsuario: 300_000 })
    expect(lista[5]).toMatchObject({ etiqueta: 'Ejecución', ms: 100_000, esperaUsuario: 60_000 })
    expect(lista[2].esperaUsuario).toBeUndefined()
    expect(lista.at(-1)).toEqual({ etiqueta: 'Terminado', estado: 'actual', ms: 140_000, esperaUsuario: 360_000 })
    expect(resumenFlujo(f, 600_000)).toBe('/implementador · Terminado · 2 min 20 s')
    expect(nodos(f as Flujo).some(n => n.esperaUsuario !== undefined)).toBe(false)
  })

  test('abrirEspera y cerrarEspera: idempotentes, sin efecto sin flujo o ya terminado, y un cambio de paso con la pregunta abierta no cuenta como trabajo', async () => {
    const f = iniciarFlujo('implementador', '', 0) as Flujo

    // Sin flujo, nada.
    expect(abrirEspera(null, 1_000)).toBeNull()
    expect(cerrarEspera(null, 1_000)).toBeNull()

    // Cerrar sin espera abierta devuelve lo mismo; abrir dos veces, también.
    expect(cerrarEspera(f, 1_000)).toBe(f)
    const abierta = abrirEspera(f, 10_000) as Flujo
    expect(abierta).not.toBe(f)
    expect(abierta.preguntaDesde).toBe(10_000)
    expect(abrirEspera(abierta, 20_000)).toBe(abierta)

    // Terminado no se toca.
    const terminado = terminarFlujo(f, 'answer', 'CIERRE · x — COMPLETO', 50_000)
    expect(abrirEspera(terminado, 60_000)).toBe(terminado)
    expect(cerrarEspera(terminado, 60_000)).toBe(terminado)

    // No muta un flujo congelado.
    const congelado: Flujo = Object.freeze({ ...abierta, tiempos: Object.freeze({ ...abierta.tiempos }), esperaUsuario: Object.freeze({ 0: 1_000 }) })
    const copia: Flujo = JSON.parse(JSON.stringify(congelado))
    expect(abrirEspera(congelado, 30_000)).toBe(congelado)
    expect(cerrarEspera(congelado, 30_000)).toMatchObject({ preguntaDesde: null, esperaUsuario: { 0: 21_000 }, desde: 30_000 })
    expect(abrirEspera(f, 5_000)).toMatchObject({ preguntaDesde: 5_000 })
    expect(congelado).toEqual(copia)

    // Cambio de paso con la pregunta abierta: el paso que se deja no suma trabajo y la espera va al paso en que cierra.
    let g = avanzar(f, agente('planificador'), 0) as Flujo
    g = abrirEspera(g, 30_000) as Flujo
    g = avanzar(g, estado('base'), 40_000) as Flujo
    expect(g).toMatchObject({ paso: 5, desde: 40_000, preguntaDesde: 30_000 })
    // Plan trabajó hasta abrir la pregunta (30 s); el cambio de paso no le suma nada más.
    expect(g.tiempos[2]).toBe(30_000)
    const enCurso = nodos(g, 50_000)
    expect(enCurso[2]).toEqual({ etiqueta: 'Plan', estado: 'pasado', ms: 30_000, veces: 1 })
    expect(enCurso[5]).toEqual({ etiqueta: 'Ejecución', estado: 'actual', ms: 0, esperaUsuario: 20_000 })
    g = cerrarEspera(g, 70_000) as Flujo
    expect(g.esperaUsuario).toEqual({ 5: 40_000 })
    expect(nodos(g, 80_000)[2].esperaUsuario).toBeUndefined()
    expect(nodos(g, 80_000)[5]).toEqual({ etiqueta: 'Ejecución', estado: 'actual', ms: 10_000, esperaUsuario: 40_000 })
  })

  test('interrumpir con una pregunta abierta: terminarFlujo cierra la espera a su hora y el orden con la vuelta de la pregunta no cambia el resultado', async () => {
    const abierta = abrirEspera(avanzar(iniciarFlujo('implementador', '', 0), pregunta(true), 5_000), 5_000) as Flujo

    // Escape: el turno termina antes que la vuelta de la pregunta.
    const interrumpido = terminarFlujo(abierta, 'aborted', undefined, 65_000) as Flujo
    expect(interrumpido).toMatchObject({ estado: 'interrumpido', fin: 65_000, preguntaDesde: null, esperaUsuario: { 4: 60_000 } })
    expect(nodos(interrumpido, 90_000).at(-1)).toEqual({ etiqueta: 'Terminado · interrumpido', estado: 'actual', ms: 5_000, esperaUsuario: 60_000 })
    expect(resumenFlujo(interrumpido, 90_000)).toBe('/implementador · Terminado · interrumpido · 5 s')

    // La vuelta tardía no cambia nada.
    expect(cerrarEspera(interrumpido, 95_000)).toBe(interrumpido)

    // Al revés: primero la vuelta y luego el fin, a la misma hora, da los mismos nodos.
    const alReves = terminarFlujo(cerrarEspera(abierta, 65_000), 'aborted', undefined, 65_000) as Flujo
    expect(nodos(alReves, 90_000)).toEqual(nodos(interrumpido, 90_000))
    expect(resumenFlujo(alReves, 90_000)).toBe(resumenFlujo(interrumpido, 90_000))

    // Sin espera abierta, terminarFlujo no agrega campos de espera.
    const sinEspera = terminarFlujo(iniciarFlujo('implementador', '', 0), 'aborted', undefined, 1_000) as Flujo
    expect(sinEspera).not.toHaveProperty('esperaUsuario')
    expect(sinEspera).not.toHaveProperty('preguntaDesde')
  })

  test('formas 0.9.3 a 0.9.7 (sin espera) no lanzan con abrirEspera, cerrarEspera, nodos y resumenFlujo', async () => {
    const muyViejo = { nombre: 'implementador', variante: null, paso: 4, ejecuto: false, estado: 'en curso' } as unknown as Flujo
    const viejo: Flujo = {
      nombre: 'implementador',
      paso: 5,
      ejecuto: true,
      totalExploradores: 2,
      estado: 'en curso',
      inicio: 0,
      desde: 1_000,
      tiempos: { 0: 1_000 },
      fin: null,
    }

    for (const forma of [muyViejo, viejo]) {
      expect(() => nodos(forma, 5_000)).not.toThrow()
      expect(() => resumenFlujo(forma, 5_000)).not.toThrow()
      expect(cerrarEspera(forma, 5_000)).toBe(forma)
      expect(nodos(forma, 5_000).some(n => n.esperaUsuario !== undefined)).toBe(false)

      const abierta = abrirEspera(forma, 5_000)
      expect(abierta).toMatchObject({ paso: forma.paso, desde: 5_000, preguntaDesde: 5_000 })
      expect(nodos(abierta as Flujo, 8_000)[forma.paso]).toMatchObject({ estado: 'actual', esperaUsuario: 3_000 })
      expect(() => resumenFlujo(abierta, 8_000)).not.toThrow()

      const cerrada = cerrarEspera(abierta, 8_000)
      expect(cerrada).toMatchObject({ preguntaDesde: null, esperaUsuario: { [forma.paso]: 3_000 } })
      expect(resumenFlujo(cerrada, 8_000)).toMatch(/^\/implementador · (Aprobación|Ejecución) · /)
    }
  })

  test('anotarFilaExplorador y cuadradosDeFila', async () => {
    const base = iniciarFlujo('implementador', '', 0) as Flujo
    const con = (n: number): Flujo => ({ ...base, exploradores: n })
    const fila = 'Haiku 5.5|high|subagente'
    const otra = 'Opus 5.5|high|principal'
    const vacias: string[] = []

    // Sin flujo: no anota y da 1.
    expect(anotarFilaExplorador(vacias, null, fila)).toBe(vacias)
    expect(cuadradosDeFila(null, [fila], fila)).toBe(1)

    // En curso con 3 en vuelo: anota y da 3 (con 5 da 5; con 6, tope de 5).
    const anotadas = anotarFilaExplorador(vacias, con(3), fila)
    expect(anotadas).toEqual([fila])
    expect(vacias).toEqual([])
    expect(cuadradosDeFila(con(3), anotadas, fila)).toBe(3)
    expect(cuadradosDeFila(con(5), anotadas, fila)).toBe(5)
    expect(cuadradosDeFila(con(6), anotadas, fila)).toBe(5)
    expect(cuadradosDeFila(con(2), anotadas, fila)).toBe(2)

    // Con 0 en vuelo (o sin el campo): ni anota ni multiplica.
    expect(anotarFilaExplorador(vacias, con(0), fila)).toBe(vacias)
    expect(anotarFilaExplorador(vacias, base, fila)).toBe(vacias)
    expect(cuadradosDeFila(con(0), anotadas, fila)).toBe(1)
    expect(cuadradosDeFila(base, anotadas, fila)).toBe(1)

    // Flujo terminado: ni anota ni multiplica.
    const terminado = terminarFlujo(con(3), 'answer', 'CIERRE · x — COMPLETO', 1_000) as Flujo
    expect(terminado.estado).toBe('completo')
    expect(anotarFilaExplorador(vacias, terminado, fila)).toBe(vacias)
    expect(cuadradosDeFila(terminado, anotadas, fila)).toBe(1)

    // Otra fila no anotada: 1.
    expect(cuadradosDeFila(con(3), anotadas, otra)).toBe(1)

    // No duplica y devuelve la misma referencia si no cambia.
    expect(anotarFilaExplorador(anotadas, con(3), fila)).toBe(anotadas)
    expect(anotarFilaExplorador(anotadas, con(3), otra)).toEqual([fila, otra])

    // Una entrada congelada no se muta.
    const congeladas = Object.freeze([fila])
    expect(() => anotarFilaExplorador(congeladas, con(2), otra)).not.toThrow()
    expect(anotarFilaExplorador(congeladas, con(2), otra)).toEqual([fila, otra])
    expect(congeladas).toEqual([fila])
  })

  test('revisores en vuelo: suben al lanzar, bajan al volver sin mover el paso y no bajan de 0', async () => {
    const base = { ...(iniciarFlujo('implementador', '', 0) as Flujo), paso: 6 }

    let f: Flujo = base

    for (let i = 0; i < 3; i++) f = avanzar(f, agente('revisor'), 0) as Flujo

    expect(f.revisores).toBe(3)
    expect(f.revisiones).toEqual({ 6: 3 })
    expect(f.paso).toBe(6)

    for (let i = 0; i < 3; i++) f = avanzar(f, agenteFin('revisor'), 0) as Flujo

    expect(f.revisores).toBe(0)
    expect(f.paso).toBe(6)

    // Un cuarto fin no baja de 0: el flujo queda igual.
    expect(avanzar(f, agenteFin('revisor'), 0)).toEqual(f)

    // Un flujo sin el campo: el fin lo deja igual y no lo escribe.
    const sin = avanzar(base, agenteFin('revisor'), 0) as Flujo
    expect(sin).toEqual(base)
    expect('revisores' in sin).toBe(false)

    // El ejecutor limpia el contador; sin él, no escribe el campo.
    expect((avanzar({ ...base, revisores: 2 }, agente('ejecutor'), 0) as Flujo).revisores).toBe(0)
    expect('revisores' in (avanzar(base, agente('ejecutor'), 0) as Flujo)).toBe(false)

    // Una entrada congelada no se muta.
    const congelado = Object.freeze({ ...base, revisores: 1 })
    expect(() => avanzar(congelado, agenteFin('revisor'), 0)).not.toThrow()
    expect((avanzar(congelado, agenteFin('revisor'), 0) as Flujo).revisores).toBe(0)
    expect(congelado.revisores).toBe(1)
  })

  test('anotar y cuadradosDeFila cuentan exploradores y revisores', async () => {
    const base = iniciarFlujo('implementador', '', 0) as Flujo
    const fila = 'Haiku 5.5|high|subagente'
    const vacias: string[] = []
    const anotadas = [fila]

    // Solo revisores en vuelo.
    expect(anotarFilaExplorador(vacias, { ...base, revisores: 2 }, fila)).toEqual([fila])
    expect(cuadradosDeFila({ ...base, revisores: 2 }, anotadas, fila)).toBe(2)
    expect(cuadradosDeFila({ ...base, revisores: 6 }, anotadas, fila)).toBe(5)

    // Exploradores y revisores suman.
    expect(cuadradosDeFila({ ...base, exploradores: 1, revisores: 1 }, anotadas, fila)).toBe(2)

    // Con 0 revisores: no anota y da 1.
    expect(anotarFilaExplorador(vacias, { ...base, revisores: 0 }, fila)).toBe(vacias)
    expect(cuadradosDeFila({ ...base, revisores: 0 }, anotadas, fila)).toBe(1)

    // Flujo terminado: da 1.
    const terminado = terminarFlujo({ ...base, revisores: 3 }, 'answer', 'CIERRE · x — COMPLETO', 1_000) as Flujo
    expect(terminado.estado).toBe('completo')
    expect(cuadradosDeFila(terminado, anotadas, fila)).toBe(1)
  })

  test('abreTanda', async () => {
    const base = iniciarFlujo('implementador', '', 0) as Flujo
    const paso1 = { ...base, paso: 1 }

    // Revisor: abre con 0 o sin el campo; no con 1 en vuelo.
    expect(abreTanda({ ...base, revisores: 0 }, agente('revisor'))).toBe(true)
    expect(abreTanda(base, agente('revisor'))).toBe(true)
    expect(abreTanda({ ...base, revisores: 1 }, agente('revisor'))).toBe(false)

    // Explorador: fuera del paso 1 abre; en el paso 1 solo sin otros en vuelo.
    expect(abreTanda({ ...base, paso: 0, exploradores: 2 }, agente('explorador'))).toBe(true)
    expect(abreTanda({ ...paso1, exploradores: 2 }, agente('explorador'))).toBe(false)
    expect(abreTanda(paso1, agente('explorador'))).toBe(true)

    // Nada más abre tanda.
    expect(abreTanda(base, agente('ejecutor'))).toBe(false)
    expect(abreTanda(base, verificar)).toBe(false)
    expect(abreTanda(null, agente('revisor'))).toBe(false)

    const terminado = terminarFlujo(base, 'answer', 'CIERRE · x — COMPLETO', 1_000) as Flujo
    expect(abreTanda(terminado, agente('revisor'))).toBe(false)
  })

  /** Una sesión con esas filas, ya ordenadas como las deja `resumir` (de mayor a menor total). */
  const sesionCon = (filas: FilaSemana[]): Semana =>
    Object.freeze({
      desde: 0,
      filas: Object.freeze(filas.map(f => Object.freeze(f))) as unknown as FilaSemana[],
      total: filas.reduce((s, f) => s + f.total, 0),
      salida: filas.reduce((s, f) => s + f.salida, 0),
      registroDesde: null,
      dias: [],
    }) as Semana
  const fila = (modelo: string, esfuerzo: string, origen: 'principal' | 'subagente', total: number, salida: number): FilaSemana => ({ modelo, esfuerzo, origen, total, salida })

  test('baseDeUso y consumoDeFlujo: el flujo gasta lo que la sesión sumó desde que empezó, fila por fila', async () => {
    const antes = sesionCon([fila('Opus 5.5', 'high', 'principal', 1_000, 100), fila('Haiku 5.5', 'xhigh', 'subagente', 700, 70)])
    const base = baseDeUso(antes)
    expect(base).toEqual({ 'Opus 5.5|high|principal': [1_000, 100], 'Haiku 5.5|xhigh|subagente': [700, 70] })

    // Sin filas o sin sesión no hay base, y el flujo no lleva el campo.
    expect(baseDeUso(null)).toBeUndefined()
    expect(baseDeUso(sesionCon([]))).toBeUndefined()
    expect(iniciarFlujo('implementador', '', 5)).not.toHaveProperty('usoBase')
    expect(iniciarFlujo('implementador', '', 5, {})).not.toHaveProperty('usoBase')
    const f = iniciarFlujo('implementador', '', 5, base) as Flujo
    expect(f.usoBase).toEqual(base)

    const despues = sesionCon([
      fila('Opus 5.5', 'high', 'principal', 3_000, 400),
      fila('Sonnet 5.5', 'high', 'subagente', 5_000, 500),
      fila('Haiku 5.5', 'xhigh', 'subagente', 700, 70),
    ])
    // Solo lo que subió, de mayor a menor; la fila que no se movió no sale.
    expect(consumoDeFlujo(f, despues)).toEqual([
      fila('Sonnet 5.5', 'high', 'subagente', 5_000, 500),
      fila('Opus 5.5', 'high', 'principal', 2_000, 300),
    ])
    // Una fila que bajó (no debería pasar) no sale ni da negativos.
    expect(consumoDeFlujo(f, sesionCon([fila('Opus 5.5', 'high', 'principal', 500, 50)]))).toEqual([])
    expect(consumoDeFlujo(f, null)).toEqual([])
    // Un flujo sin base (anterior a este campo) cuenta toda la sesión.
    const sinBase = iniciarFlujo('implementador', '', 5) as Flujo
    expect(consumoDeFlujo(sinBase, despues).map(x => x.total)).toEqual([5_000, 3_000, 700])
  })

  test('consumoDeFlujo: las filas del consumo no llevan flujo', async () => {
    const f = iniciarFlujo('implementador', '', 5) as Flujo
    const conFlujo: FilaSemana = { ...fila('Opus 5.5', 'high', 'principal', 3_000, 400), flujo: 1_200 }

    expect(consumoDeFlujo(f, sesionCon([conFlujo]))).toEqual([fila('Opus 5.5', 'high', 'principal', 3_000, 400)])
    expect(consumoDeFlujo(f, sesionCon([conFlujo]))[0]).not.toHaveProperty('flujo')
  })

  test('congelarConsumo: fija el consumo al terminar una sola vez y no escribe un valor vacío', async () => {
    const base = baseDeUso(sesionCon([fila('Opus 5.5', 'high', 'principal', 1_000, 100)]))
    const en = iniciarFlujo('implementador', '', 0, base) as Flujo
    const ses = sesionCon([fila('Opus 5.5', 'high', 'principal', 4_000, 300)])

    // Sin flujo o en curso: la misma referencia.
    expect(congelarConsumo(null, ses)).toBeNull()
    expect(congelarConsumo(en, ses)).toBe(en)

    const fin = terminarFlujo(en, 'answer', 'CIERRE · x — COMPLETO', 1_000) as Flujo
    const fijo = congelarConsumo(fin, ses) as Flujo
    expect(fijo.consumo).toEqual([fila('Opus 5.5', 'high', 'principal', 3_000, 200)])

    // Lo que la sesión gaste después ya no lo mueve; tampoco con otra sesión distinta.
    const mas = sesionCon([fila('Opus 5.5', 'high', 'principal', 9_000, 900)])
    expect(congelarConsumo(fijo, mas)).toBe(fijo)

    // Sin gasto nuevo no se escribe un consumo vacío, y un flujo sin sesión queda como estaba.
    const quieto = sesionCon([fila('Opus 5.5', 'high', 'principal', 1_000, 100)])
    expect(congelarConsumo(fin, quieto)).toBe(fin)
    expect(congelarConsumo(fin, null)).toBe(fin)
    expect(fin).not.toHaveProperty('consumo')
  })

  test('nombreOrquestador y marcarOrquestador: el modelo real del hilo principal, solo mientras el flujo está en curso', async () => {
    expect(nombreOrquestador('claude-opus-5-5', 'high')).toBe('Opus 5.5 high')
    expect(nombreOrquestador('claude-sonnet-5-5', 'xhigh')).toBe('Sonnet 5.5 xhigh')
    expect(nombreOrquestador('claude-haiku-5-5', undefined)).toBe('Haiku 5.5 —')

    const f = iniciarFlujo('implementador', '', 0) as Flujo
    expect(marcarOrquestador(null, 'Opus 5.5 high')).toBeNull()

    const opus = marcarOrquestador(f, 'Opus 5.5 high') as Flujo
    expect(opus.orquestador).toBe('Opus 5.5 high')
    expect(f).not.toHaveProperty('orquestador')
    // El mismo nombre: la misma referencia; otro modelo: el último gana.
    expect(marcarOrquestador(opus, 'Opus 5.5 high')).toBe(opus)
    expect((marcarOrquestador(opus, 'Sonnet 5.5 high') as Flujo).orquestador).toBe('Sonnet 5.5 high')

    // Terminado: no cambia.
    const fin = terminarFlujo(opus, 'answer', 'CIERRE · x — COMPLETO', 1_000) as Flujo
    expect(marcarOrquestador(fin, 'Sonnet 5.5 high')).toBe(fin)
  })

  test('detallePaso: las líneas de agente de cada nodo, sin sangría', async () => {
    const pasado = (etiqueta: string, resto: Partial<Nodo> = {}): Nodo => ({ etiqueta, estado: 'pasado', ...resto })

    // Pendiente, Aprobación y Terminado: siempre vacío.
    expect(detallePaso({ etiqueta: 'Plan', estado: 'pendiente' }, 'Opus 5.5 high')).toEqual([])
    expect(detallePaso({ etiqueta: 'Ejecución', estado: 'pendiente', veces: 2, revisiones: 1, ms: 5 }, 'Opus 5.5 high')).toEqual([])
    expect(detallePaso(pasado('Aprobación', { ms: 1_000, veces: 1, revisiones: 1 }), 'Opus 5.5 high')).toEqual([])
    expect(detallePaso({ etiqueta: 'Terminado', estado: 'actual', ms: 9_000 }, 'Opus 5.5 high')).toEqual([])
    expect(detallePaso({ etiqueta: 'Terminado · detenido', estado: 'actual', ms: 9_000 }, 'Opus 5.5 high')).toEqual([])

    // Preflight y Cierre: el orquestador, solo con tiempo y con nombre.
    for (const etiqueta of ['Preflight', 'Cierre']) {
      expect(detallePaso(pasado(etiqueta, { ms: 1_000 }), 'Opus 5.5 high')).toEqual(['orquestador Opus 5.5 high'])
      expect(detallePaso({ etiqueta, estado: 'actual', ms: 0 }, 'Sonnet 5.5 high')).toEqual(['orquestador Sonnet 5.5 high'])
      expect(detallePaso(pasado(etiqueta), 'Opus 5.5 high')).toEqual([])
      expect(detallePaso(pasado(etiqueta, { ms: 1_000 }))).toEqual([])
    }

    // Exploración: singular y plural.
    expect(detallePaso(pasado('Exploración', { exploradores: 1 }))).toEqual(['1 explorador · Haiku high'])
    expect(detallePaso(pasado('Exploración', { exploradores: 3 }))).toEqual(['3 exploradores · Haiku high'])
    expect(detallePaso(pasado('Exploración'))).toEqual([])
    expect(detallePaso({ etiqueta: 'Exploración', estado: 'actual', exploradores: 2 })).toEqual(['2 exploradores · Haiku high'])

    // Plan: el planificador si se lanzó.
    expect(detallePaso(pasado('Plan', { veces: 1 }))).toEqual(['planificador · Opus high'])
    expect(detallePaso(pasado('Plan', { veces: 2 }))).toEqual(['planificador · Opus high'])
    expect(detallePaso(pasado('Plan'))).toEqual([])
    expect(detallePaso(pasado('Plan', { revisiones: 1 }))).toEqual([])

    // Revisión del plan: solo si tiene tiempo (un paso saltado no lo tiene).
    expect(detallePaso(pasado('Revisión del plan', { ms: 2_000 }))).toEqual(['revisor-plan · Sonnet medium'])
    expect(detallePaso({ etiqueta: 'Revisión del plan', estado: 'actual', ms: 0 })).toEqual(['revisor-plan · Sonnet medium'])
    expect(detallePaso(pasado('Revisión del plan'))).toEqual([])

    // Ejecución: ejecutor y después revisor.
    expect(detallePaso(pasado('Ejecución', { veces: 2, revisiones: 2 }))).toEqual(['ejecutor · Sonnet high', 'revisor · Sonnet high/medium'])
    expect(detallePaso(pasado('Ejecución', { veces: 1 }))).toEqual(['ejecutor · Sonnet high'])
    expect(detallePaso(pasado('Ejecución', { revisiones: 1 }))).toEqual(['revisor · Sonnet high/medium'])
    expect(detallePaso(pasado('Ejecución', { ms: 1_000 }))).toEqual([])

    // Verificación final: el revisor de Opus si se lanzó.
    expect(detallePaso(pasado('Verificación final', { revisiones: 1 }))).toEqual(['revisor · Opus high'])
    expect(detallePaso(pasado('Verificación final', { veces: 1 }))).toEqual([])
    expect(detallePaso(pasado('Verificación final'))).toEqual([])

    // Una etiqueta desconocida no tiene líneas.
    expect(detallePaso(pasado('Otro', { ms: 1, veces: 1, revisiones: 1, exploradores: 1 }), 'Opus 5.5 high')).toEqual([])
  })

  test('detallePaso: ninguna línea fija pasa de 30 caracteres', async () => {
    const lleno = (etiqueta: string): Nodo => ({ etiqueta, estado: 'actual', ms: 1, veces: 9, revisiones: 9, exploradores: 99 })
    const lineas = PASOS.implementador.flatMap(etiqueta => detallePaso(lleno(etiqueta)))

    expect(lineas).toEqual([
      '99 exploradores · Haiku high',
      'planificador · Opus high',
      'revisor-plan · Sonnet medium',
      'ejecutor · Sonnet high',
      'revisor · Sonnet high/medium',
      'revisor · Opus high',
    ])

    for (const linea of lineas) expect(linea.length).toBeLessThanOrEqual(30)

    // Las líneas de los nodos reales de un flujo también caben.
    const f = iniciarFlujo('implementador', '', 0) as Flujo

    for (const n of nodos(f, 1_000)) for (const linea of detallePaso(n)) expect(linea.length).toBeLessThanOrEqual(30)
  })

  const flujoEn = (paso: number, resto: Partial<Flujo> = {}): Flujo => ({ nombre: 'implementador', paso, ejecuto: false, estado: 'en curso', inicio: 0, desde: 0, tiempos: {}, fin: null, ...resto })
  const nodoPasado = (etiqueta: string, resto: Partial<Nodo> = {}): Nodo => ({ etiqueta, estado: 'pasado', ...resto })

  test('detallePaso con configs observadas lista high y medium', async () => {
    const ejecucion = nodoPasado('Ejecución', { veces: 1, revisiones: 2, configs: { ejecutor: ['Sonnet 5.5 high'], revisor: ['Sonnet 5.5 high', 'Sonnet 5.5 medium'] } })
    const larga = ['ejecutor · Sonnet 5.5 high', 'revisor · Sonnet 5.5 high, medium']

    expect(detallePaso(ejecucion)).toEqual(larga)
    expect(detallePaso(ejecucion, undefined, 30)).toEqual(['ejecutor · Sonnet 5.5 high', 'revisor · Sonnet high, medium'])
    expect(detallePaso(ejecucion, undefined, 47)).toEqual(larga)

    // Plan y Verificación final también usan lo observado; sin lista de su agente, la línea fija.
    expect(detallePaso(nodoPasado('Plan', { veces: 1, configs: { planificador: ['Opus 5.5 high'] } }))).toEqual(['planificador · Opus 5.5 high'])
    expect(detallePaso(nodoPasado('Verificación final', { revisiones: 1, configs: { revisor: ['Opus 5.5 high'] } }), undefined, 30)).toEqual(['revisor · Opus 5.5 high'])
    expect(detallePaso(nodoPasado('Verificación final', { revisiones: 1, configs: { revisor: ['Opus 5.5 high'] } }), undefined, 20)).toEqual(['revisor · Opus high'])
    expect(detallePaso(nodoPasado('Ejecución', { veces: 1, revisiones: 1, configs: { ejecutor: ['Sonnet 5.5 high'] } }))).toEqual(['ejecutor · Sonnet 5.5 high', 'revisor · Sonnet high/medium'])
    expect(detallePaso(nodoPasado('Plan', { veces: 1, configs: { planificador: [] } }))).toEqual(['planificador · Opus high'])
  })

  test('revisor-plan observado se acorta a 30', async () => {
    const n = nodoPasado('Revisión del plan', { ms: 2_000, configs: { 'revisor-plan': ['Sonnet 5.5 medium'] } })

    expect(detallePaso(n, undefined, 30)).toEqual(['revisor-plan · Sonnet medium'])
    expect(detallePaso(n, undefined, 47)).toEqual(['revisor-plan · Sonnet 5.5 medium'])
  })

  test('modelos distintos que no caben se cortan con …', async () => {
    const n = nodoPasado('Verificación final', { revisiones: 1, configs: { revisor: ['Sonnet 5.5 high', 'Opus 5.5 high'] } })
    const [linea = ''] = detallePaso(n, undefined, 30)

    expect(Array.from(linea).length).toBeLessThanOrEqual(30)
    expect(linea.endsWith('…')).toBe(true)
    expect(linea.startsWith('revisor · Sonnet high, Opus')).toBe(true)
    expect(detallePaso(n)).toEqual(['revisor · Sonnet 5.5 high, Opus 5.5 high'])
  })

  test('el effort max del explorador se ve', async () => {
    expect(lineaDeExplorador({ descripcion: 'Explorar tests', ms: 5_000, gasto: 1_500, config: ['Haiku 5.5 max'] }, 47)).toBe('tests · Haiku max · 5 s · 1,5k')
    expect(lineaDeExplorador({ descripcion: 'Explorar tests', config: ['Haiku 5.5 high', 'Haiku 5.5 max'] })).toBe('tests · Haiku high, max')
    expect(lineaDeExplorador({ descripcion: 'Explorar tests', config: [] })).toBe('tests · Haiku high')
    expect(detallePaso(nodoPasado('Exploración', { exploradores: 2, configs: { explorador: ['Haiku 5.5 high', 'Haiku 5.5 max'] } }))).toEqual(['2 exploradores · Haiku high, max'])
    expect(detallePaso(nodoPasado('Exploración', { exploradores: 1, configs: { explorador: ['Haiku 5.5 max'] } }), undefined, 30)).toEqual(['1 explorador · Haiku max'])
  })

  test('sin esfuerzo usa —', async () => {
    expect(detallePaso(nodoPasado('Ejecución', { veces: 1, configs: { ejecutor: ['Sonnet 5.5 —'] } }))).toEqual(['ejecutor · Sonnet 5.5 —'])
    expect(detallePaso(nodoPasado('Ejecución', { veces: 1, configs: { ejecutor: ['Sonnet 5.5 —'] } }), undefined, 20)).toEqual(['ejecutor · Sonnet —'])
  })

  test('ninguna línea observada pasa del ancho', async () => {
    // La línea total de «Exploración» no se recorta (solo usa la forma corta): aquí solo se comprueba que cabe a 47.
    expect(Array.from(detallePaso(nodoPasado('Exploración', { exploradores: 2, configs: { explorador: ['Haiku 5.5 high', 'Haiku 5.5 medium', 'Haiku 5.5 max'] } }), undefined, 47)[0] ?? '').length).toBeLessThanOrEqual(47)

    const nodosConConfig: Nodo[] = [
      nodoPasado('Exploración', { exploradores: 1, porExplorador: [{ descripcion: 'Explorar tests de todo el panel', ms: 200_000, gasto: 96_200, config: ['Haiku 5.5 high', 'Haiku 5.5 max'] }] }),
      nodoPasado('Plan', { veces: 1, configs: { planificador: ['Opus 5.5 high', 'Sonnet 5.5 medium'] } }),
      nodoPasado('Revisión del plan', { ms: 1, configs: { 'revisor-plan': ['Sonnet 5.5 medium'] } }),
      nodoPasado('Ejecución', { veces: 1, revisiones: 2, configs: { ejecutor: ['Sonnet 5.5 high'], revisor: ['Sonnet 5.5 high', 'Sonnet 5.5 medium', 'Opus 5.5 high'] } }),
      nodoPasado('Verificación final', { revisiones: 1, configs: { revisor: ['Sonnet 5.5 high', 'Opus 5.5 high', 'Haiku 5.5 max'] } }),
    ]

    for (const ancho of [30, 47]) for (const n of nodosConConfig) for (const linea of detallePaso(n, undefined, ancho)) expect(Array.from(linea).length).toBeLessThanOrEqual(ancho)
    for (let ancho = 1; ancho <= 60; ancho++) for (const n of nodosConConfig) for (const linea of detallePaso(n, undefined, ancho)) expect(Array.from(linea).length).toBeLessThanOrEqual(ancho)
  })

  test('anotarConfig atribuye por agente en vuelo', async () => {
    // Revisores en vuelo: van a configs[paso].revisor, sin repetir y en orden de aparición.
    const f = flujoEn(5, { revisores: 1 })
    const uno = anotarConfig(f, 'r1', 'Sonnet 5.5 high') as Flujo
    expect(uno.configs).toEqual({ 5: { revisor: ['Sonnet 5.5 high'] } })
    expect(f).not.toHaveProperty('configs')
    expect(anotarConfig(uno, 'r1', 'Sonnet 5.5 high')).toBe(uno)
    expect(anotarConfig(uno, 'r2', '  Sonnet 5.5 high  ')).toBe(uno)
    const dos = anotarConfig(uno, 'r2', 'Sonnet 5.5 medium') as Flujo
    expect(dos.configs).toEqual({ 5: { revisor: ['Sonnet 5.5 high', 'Sonnet 5.5 medium'] } })
    expect(uno.configs).toEqual({ 5: { revisor: ['Sonnet 5.5 high'] } })
    expect(anotarConfig(f, 'r1', '')).toBe(f)
    expect(anotarConfig(f, 'r1', '   ')).toBe(f)

    // Otro paso conserva lo del anterior (Verificación final).
    const final = anotarConfig({ ...dos, paso: 6 }, 'r3', 'Opus 5.5 high') as Flujo
    expect(final.configs).toEqual({ 5: { revisor: ['Sonnet 5.5 high', 'Sonnet 5.5 medium'] }, 6: { revisor: ['Opus 5.5 high'] } })

    // Sin revisores en vuelo, un `revisor` marcado no cuenta.
    const sinVuelo = flujoEn(5, { revisores: 0, ultimoAgente: 'revisor' })
    expect(anotarConfig(sinVuelo, 'r1', 'Sonnet 5.5 high')).toBe(sinVuelo)

    // El último agente lanzado: ejecutor, planificador y revisor-plan.
    expect((anotarConfig(flujoEn(5, { ultimoAgente: 'ejecutor' }), 'e1', 'Sonnet 5.5 high') as Flujo).configs).toEqual({ 5: { ejecutor: ['Sonnet 5.5 high'] } })
    expect((anotarConfig(flujoEn(2, { ultimoAgente: 'planificador' }), 'p1', 'Opus 5.5 high') as Flujo).configs).toEqual({ 2: { planificador: ['Opus 5.5 high'] } })
    expect((anotarConfig(flujoEn(3, { ultimoAgente: 'revisor-plan' }), 'v1', 'Sonnet 5.5 medium') as Flujo).configs).toEqual({ 3: { 'revisor-plan': ['Sonnet 5.5 medium'] } })

    const ejecutor = anotarConfig(flujoEn(5, { ultimoAgente: 'ejecutor' }), 'e1', 'Sonnet 5.5 high') as Flujo
    expect(anotarConfig(ejecutor, 'e1', 'Sonnet 5.5 high')).toBe(ejecutor)
    expect((anotarConfig(ejecutor, 'e1', 'Sonnet 5.5 max') as Flujo).configs).toEqual({ 5: { ejecutor: ['Sonnet 5.5 high', 'Sonnet 5.5 max'] } })

    // Sin nada en vuelo o con un agente que no se anota: misma referencia.
    const nada = flujoEn(5)
    expect(anotarConfig(nada, 'x1', 'Sonnet 5.5 high')).toBe(nada)

    for (const ultimoAgente of ['explorador', 'otro', '']) {
      const g = flujoEn(5, { ultimoAgente })
      expect(anotarConfig(g, 'x1', 'Sonnet 5.5 high')).toBe(g)
    }
  })

  test('anotarConfig de explorador', async () => {
    const f = flujoEn(1, { exploradores: 1, totalExploradores: 1 })
    const a = anotarConfig(f, 'a1', 'Haiku 5.5 high') as Flujo

    expect(a.detalleExploradores).toEqual([{ id: 'a1', config: ['Haiku 5.5 high'] }])
    expect(a.configs).toEqual({ 1: { explorador: ['Haiku 5.5 high'] } })
    expect(f).not.toHaveProperty('detalleExploradores')
    expect(anotarConfig(a, 'a1', 'Haiku 5.5 high')).toBe(a)

    // Con el registro ya creado y sin exploradores en vuelo, sigue anotando en el registro y en el paso.
    const vuelto = { ...a, exploradores: 0 }
    const max = anotarConfig(vuelto, 'a1', 'Haiku 5.5 max') as Flujo
    expect(max.detalleExploradores).toEqual([{ id: 'a1', config: ['Haiku 5.5 high', 'Haiku 5.5 max'] }])
    expect(max.configs).toEqual({ 1: { explorador: ['Haiku 5.5 high', 'Haiku 5.5 max'] } })
    expect(anotarConfig(max, 'a1', 'Haiku 5.5 max')).toBe(max)

    // Otro explorador con el mismo nombre: registro propio, el paso no repite.
    const b = anotarConfig({ ...max, exploradores: 1 }, 'a2', 'Haiku 5.5 high') as Flujo
    expect(b.detalleExploradores).toEqual([{ id: 'a1', config: ['Haiku 5.5 high', 'Haiku 5.5 max'] }, { id: 'a2', config: ['Haiku 5.5 high'] }])
    expect(b.configs).toEqual({ 1: { explorador: ['Haiku 5.5 high', 'Haiku 5.5 max'] } })

    // Conserva lo que el registro ya traía.
    const descrito = flujoEn(1, { exploradores: 1, detalleExploradores: [{ id: 'a1', descripcion: 'Explorar x', ms: 5, gasto: 7 }] })
    expect((anotarConfig(descrito, 'a1', 'Haiku 5.5 high') as Flujo).detalleExploradores).toEqual([{ id: 'a1', descripcion: 'Explorar x', ms: 5, gasto: 7, config: ['Haiku 5.5 high'] }])

    // Sin flujo, terminado o sin agentId: la misma referencia.
    expect(anotarConfig(null, 'a1', 'Haiku 5.5 high')).toBeNull()

    for (const estado of ['completo', 'detenido', 'interrumpido'] as const) {
      const fin = flujoEn(1, { estado, fin: 9, exploradores: 1 })
      expect(anotarConfig(fin, 'a1', 'Haiku 5.5 high')).toBe(fin)
    }

    for (const id of ['', undefined, null]) expect(anotarConfig(f, id, 'Haiku 5.5 high')).toBe(f)

    // Atom 0.16.0 (sin detalleExploradores) y 0.9.3 (sin inicio, desde, tiempos ni fin): no lanza y se dibuja.
    const f016 = flujoEn(2, { exploradores: 2, totalExploradores: 2, tiempos: { 1: 2_000 } })
    expect('detalleExploradores' in f016).toBe(false)
    const nuevo016 = anotarConfig(f016, 'a1', 'Haiku 5.5 max') as Flujo
    expect(nuevo016.configs).toEqual({ 2: { explorador: ['Haiku 5.5 max'] } })
    expect(() => nodos(nuevo016, 5_000)).not.toThrow()

    const v093 = { nombre: 'implementador', variante: null, paso: 1, ejecuto: false, estado: 'en curso', exploradores: 2 } as unknown as Flujo
    expect(() => anotarConfig(v093, 'a1', 'Haiku 5.5 high')).not.toThrow()
    const nuevo093 = anotarConfig(v093, 'a1', 'Haiku 5.5 high') as Flujo
    expect(nuevo093.configs).toEqual({ 1: { explorador: ['Haiku 5.5 high'] } })
    expect(() => nodos(nuevo093, 3_000)).not.toThrow()
    expect(nodos(nuevo093, 3_000)[1]?.configs).toEqual({ explorador: ['Haiku 5.5 high'] })

    // Configs mal formadas (atom roto): no lanza, se reemplazan por una válida y nodos las ignora.
    for (const malo of ['basura', 5, true, [], [1, 2], { 1: 'x' }, { 1: 5 }, { 1: { explorador: 'x' } }, { 1: { explorador: [1, null] } }, { 2: [] }]) {
      const roto = { ...flujoEn(1, { exploradores: 1 }), configs: malo } as unknown as Flujo

      expect(() => nodos(roto, 5_000)).not.toThrow()
      expect(nodos(roto, 5_000)[1]).not.toHaveProperty('configs')
      expect(() => detallePaso(nodos(roto, 5_000)[1] as Nodo, undefined, 30)).not.toThrow()
      expect((anotarConfig(roto, 'a1', 'Haiku 5.5 high') as Flujo).configs?.[1]).toEqual({ explorador: ['Haiku 5.5 high'] })
    }

    // Lista del registro mal formada: cuenta como vacía.
    const registroRoto = { ...flujoEn(1, { exploradores: 1 }), detalleExploradores: [{ id: 'a1', config: 'x' }] } as unknown as Flujo
    expect((anotarConfig(registroRoto, 'a1', 'Haiku 5.5 high') as Flujo).detalleExploradores).toEqual([{ id: 'a1', config: ['Haiku 5.5 high'] }])

    // No muta un flujo congelado.
    const congelado: Flujo = Object.freeze(flujoEn(1, { exploradores: 1, configs: Object.freeze({ 1: Object.freeze({ explorador: Object.freeze(['Haiku 5.5 high']) as unknown as string[] }) }) }))
    expect(() => anotarConfig(congelado, 'a1', 'Haiku 5.5 max')).not.toThrow()
    expect(congelado.configs).toEqual({ 1: { explorador: ['Haiku 5.5 high'] } })
  })

  test('marcarAgente', async () => {
    const f = flujoEn(2)
    const planificador = marcarAgente(f, 'planificador') as Flujo

    expect(planificador.ultimoAgente).toBe('planificador')
    expect(f).not.toHaveProperty('ultimoAgente')
    expect(marcarAgente(planificador, 'planificador')).toBe(planificador)
    expect(marcarAgente(planificador, '  planificador ')).toBe(planificador)
    expect((marcarAgente(planificador, ' ejecutor ') as Flujo).ultimoAgente).toBe('ejecutor')

    // Sin flujo, terminado o con el nombre vacío: la misma referencia.
    expect(marcarAgente(null, 'ejecutor')).toBeNull()
    expect(marcarAgente(f, '')).toBe(f)
    expect(marcarAgente(f, '   ')).toBe(f)

    for (const estado of ['completo', 'detenido', 'interrumpido'] as const) {
      const fin = flujoEn(2, { estado, fin: 9 })
      expect(marcarAgente(fin, 'ejecutor')).toBe(fin)
    }

    // No cambia el paso ni lo que avanzar y cambioDeImplementacion calculan.
    expect(avanzar(planificador, agente('ejecutor'))).toEqual({ ...avanzar(f, agente('ejecutor')), ultimoAgente: 'planificador' })
    expect(planificador.paso).toBe(2)
    expect(avanzar(f, agente('ejecutor'))).not.toHaveProperty('ultimoAgente')
  })

  test('nodos copia configs solo con dato', async () => {
    const f = flujoEn(5, {
      totalExploradores: 2,
      planes: 1,
      ejecuciones: 1,
      revisiones: { 3: 0, 5: 2 },
      detalleExploradores: [{ id: 'a', descripcion: 'Explorar uno', config: ['Haiku 5.5 high', 'Haiku 5.5 max'] }, { id: 'b', descripcion: 'Explorar dos', config: [] }],
      configs: {
        1: { explorador: ['Haiku 5.5 high', 'Haiku 5.5 max'] },
        2: { planificador: ['Opus 5.5 high'] },
        3: { 'revisor-plan': [] },
        5: { ejecutor: ['Sonnet 5.5 high'], revisor: ['Sonnet 5.5 high', 'Sonnet 5.5 medium'] },
        6: { revisor: ['Opus 5.5 high'] },
      },
    })
    const lista = nodos(f, 9_000)

    expect(lista[1]?.configs).toEqual({ explorador: ['Haiku 5.5 high', 'Haiku 5.5 max'] })
    expect(lista[1]?.porExplorador).toEqual([{ descripcion: 'Explorar uno', config: ['Haiku 5.5 high', 'Haiku 5.5 max'] }, { descripcion: 'Explorar dos' }])
    expect(lista[1]?.porExplorador?.[1]).not.toHaveProperty('config')
    expect(lista[2]?.configs).toEqual({ planificador: ['Opus 5.5 high'] })
    expect(lista[5]?.configs).toEqual({ ejecutor: ['Sonnet 5.5 high'], revisor: ['Sonnet 5.5 high', 'Sonnet 5.5 medium'] })

    // Lista vacía: sin la clave. Un paso pendiente no lleva las configs de su índice.
    expect(lista[3]).not.toHaveProperty('configs')
    expect(lista[6]).toMatchObject({ etiqueta: 'Verificación final', estado: 'pendiente' })
    expect(lista[6]).not.toHaveProperty('configs')

    // Las líneas del panel usan lo observado.
    expect(detallePaso(lista[5] as Nodo, undefined, 30)).toEqual(['ejecutor · Sonnet 5.5 high', 'revisor · Sonnet high, medium'])
    expect(detallePaso(lista[1] as Nodo, undefined, 47)).toEqual(['uno · Haiku high, max', 'dos · Haiku high'])

    // Sin configs, el nodo es el de siempre: sin la clave.
    const sin = nodos(flujoEn(5, { planes: 1 }))
    expect(sin[2]).toEqual({ etiqueta: 'Plan', estado: 'pasado', veces: 1 })
    expect(sin[5]).toEqual({ etiqueta: 'Ejecución', estado: 'actual' })

    for (const nodo of sin) expect(nodo).not.toHaveProperty('configs')
  })
})

describe('gasto por paso (puro)', () => {
  const enCurso = (paso: number, resto: Partial<Flujo> = {}): Flujo => ({ nombre: 'implementador', paso, ejecuto: false, estado: 'en curso', inicio: 0, desde: 0, tiempos: {}, fin: null, ...resto })
  const pasado = (etiqueta: string, resto: Partial<Nodo> = {}): Nodo => ({ etiqueta, estado: 'pasado', ...resto })

  test('sumarGasto: sin flujo, terminado o sin uso devuelve lo mismo y no anota gasto', async () => {
    expect(sumarGasto(null, USO)).toBeNull()

    const f = enCurso(0)
    expect(sumarGasto(f, null)).toBe(f)
    expect(sumarGasto(f, undefined)).toBe(f)
    expect(sumarGasto(f, { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 })).toBe(f)
    expect('gasto' in (sumarGasto(f, null) as Flujo)).toBe(false)

    for (const estado of ['completo', 'detenido', 'interrumpido'] as const) {
      const fin = enCurso(3, { estado, fin: 9 })
      expect(sumarGasto(fin, USO)).toBe(fin)
      expect('gasto' in (sumarGasto(fin, USO) as Flujo)).toBe(false)
    }
  })

  test('sumarGasto: acumula por paso, conserva los anteriores y cuenta 0 el campo que no es número', async () => {
    const una = sumarGasto(enCurso(0), USO) as Flujo
    expect(una.gasto).toEqual({ 0: [100_000, 2_000] })

    const dos = sumarGasto(una, USO) as Flujo
    expect(dos.gasto).toEqual({ 0: [200_000, 4_000] })

    const otro = sumarGasto({ ...dos, paso: 2 }, USO) as Flujo
    expect(otro.gasto).toEqual({ 0: [200_000, 4_000], 2: [100_000, 2_000] })

    const roto = { input_tokens: Number.NaN, output_tokens: 500, cache_read_input_tokens: undefined, cache_creation_input_tokens: 10 } as unknown as Parameters<typeof sumarGasto>[1]
    expect((sumarGasto(enCurso(1), roto) as Flujo).gasto).toEqual({ 1: [510, 500] })

    const nada = { input_tokens: Number.NaN, output_tokens: undefined } as unknown as Parameters<typeof sumarGasto>[1]
    const f = enCurso(1)
    expect(sumarGasto(f, nada)).toBe(f)
  })

  test('sumarGasto: no muta un flujo congelado ni su gasto', async () => {
    const f: Flujo = Object.freeze(enCurso(1, { gasto: Object.freeze({ 1: Object.freeze([10, 2]) as unknown as [number, number] }) }))
    let r: Flujo | null = null

    expect(() => { r = sumarGasto(f, USO) }).not.toThrow()
    expect(r).not.toBe(f)
    expect((r as unknown as Flujo).gasto).toEqual({ 1: [100_010, 2_002] })
    expect(f.gasto).toEqual({ 1: [10, 2] })
  })

  test('forma anterior: flujo 0.9.3 y flujo 0.15.0 sin gasto', async () => {
    const viejo = { nombre: 'implementador', variante: null, paso: 5, ejecuto: true, estado: 'en curso' } as unknown as Flujo
    let r: Flujo | null = null

    expect(() => { r = sumarGasto(viejo, USO) }).not.toThrow()
    expect((r as unknown as Flujo).gasto).toEqual({ 5: [100_000, 2_000] })
    expect(() => nodos(r as unknown as Flujo, 9_000)).not.toThrow()
    expect(() => nodos(r as unknown as Flujo).forEach(n => detallePaso(n))).not.toThrow()
    expect(nodos(r as unknown as Flujo, 9_000)[5]?.gasto).toEqual([100_000, 2_000])

    // Sin gasto, los nodos son los de siempre y ninguno trae línea de gasto.
    const f = enCurso(2, { tiempos: { 0: 1_000, 1: 2_000 }, desde: 3_000 })
    expect(nodos(f, 5_000)).toEqual([
      { etiqueta: 'Preflight', estado: 'pasado', ms: 1_000 },
      { etiqueta: 'Exploración', estado: 'pasado', ms: 2_000 },
      { etiqueta: 'Plan', estado: 'actual', ms: 2_000 },
      { etiqueta: 'Revisión del plan', estado: 'pendiente' },
      { etiqueta: 'Aprobación', estado: 'pendiente' },
      { etiqueta: 'Ejecución', estado: 'pendiente' },
      { etiqueta: 'Verificación final', estado: 'pendiente' },
      { etiqueta: 'Cierre', estado: 'pendiente' },
      { etiqueta: 'Terminado', estado: 'pendiente' },
    ])

    for (const n of nodos(f, 5_000)) expect(detallePaso(n, 'Opus 5.5 high').some(l => l.startsWith('gasto'))).toBe(false)
  })

  test('nodos: el gasto va en los pasos con valor, con o sin hora, y no en pendientes ni en Terminado', async () => {
    const f = enCurso(2, { gasto: { 0: [5_000, 100], 1: [0, 0], 2: [100_000, 2_000], 4: [7, 1] } })

    for (const t of [undefined, 5_000]) {
      const lista = nodos(f, t)

      expect(lista[0]?.gasto).toEqual([5_000, 100])
      expect(lista[1]).not.toHaveProperty('gasto')
      expect(lista[2]?.gasto).toEqual([100_000, 2_000])
      expect(lista[4]).toMatchObject({ etiqueta: 'Aprobación', estado: 'pendiente' })
      expect(lista[4]).not.toHaveProperty('gasto')
      expect(lista.at(-1)).not.toHaveProperty('gasto')
    }

    const terminado = { ...f, estado: 'completo', fin: 9_000, paso: 7, gasto: { 7: [10, 1] } } as Flujo
    expect(nodos(terminado, 9_000).at(-1)).not.toHaveProperty('gasto')
    expect(nodos(terminado, 9_000)[7]?.gasto).toEqual([10, 1])
  })

  test('detallePaso: línea de gasto al final, también en Aprobación, y cabe en 30 caracteres', async () => {
    expect(detallePaso(pasado('Plan', { veces: 1, gasto: [100_000, 2_000] }))).toEqual(['planificador · Opus high', 'gasto 100k · sal 2k'])
    expect(detallePaso(pasado('Plan', { veces: 1, gasto: [950, 0] }))).toEqual(['planificador · Opus high', 'gasto 950'])
    expect(detallePaso(pasado('Plan', { gasto: [950, 0] }))).toEqual(['gasto 950'])
    expect(detallePaso({ etiqueta: 'Plan', estado: 'pendiente', veces: 1, gasto: [100_000, 2_000] })).toEqual([])
    expect(detallePaso(pasado('Aprobación', { ms: 1_000, gasto: [100_000, 2_000] }))).toEqual(['gasto 100k · sal 2k'])
    expect(detallePaso(pasado('Ejecución', { veces: 2, revisiones: 1, gasto: [100_000, 2_000] }))).toEqual(['ejecutor · Sonnet high', 'revisor · Sonnet high/medium', 'gasto 100k · sal 2k'])

    for (const etiqueta of ['Preflight', 'Exploración', 'Plan', 'Revisión del plan', 'Aprobación', 'Ejecución', 'Verificación final', 'Cierre']) {
      const lleno: Nodo = { etiqueta, estado: 'actual', ms: 1, veces: 9, revisiones: 9, exploradores: 99, gasto: [1_234_567_890, 999_950] }

      for (const linea of detallePaso(lleno, 'Opus 5.5 high')) expect(linea.length).toBeLessThanOrEqual(30)
      expect(detallePaso(lleno, 'Opus 5.5 high').at(-1)).toMatch(/^gasto /)
    }
  })

  test('anotarExplorador y sumarGastoDeExplorador dan lo mismo en cualquier orden', async () => {
    const f = enCurso(1, { exploradores: 2, totalExploradores: 2 })

    const nombrePrimero = sumarGastoDeExplorador(anotarExplorador(anotarExplorador(f, 'a1', { descripcion: 'Explorar x', desde: 1_000 }), 'a1', { ms: 4_000 }), 'a1', USO)
    const gastoPrimero = anotarExplorador(anotarExplorador(sumarGastoDeExplorador(f, 'a1', USO), 'a1', { ms: 4_000 }), 'a1', { descripcion: 'Explorar x', desde: 1_000 })

    expect(nombrePrimero).toEqual(gastoPrimero)
    expect((nombrePrimero as Flujo).detalleExploradores).toEqual([{ id: 'a1', descripcion: 'Explorar x', desde: 1_000, ms: 4_000, gasto: 100_000 }])

    // El gasto se acumula y el orden de los registros es el de primera aparición.
    let g = anotarExplorador(f, 'b2', { descripcion: 'Explorar y' })
    g = sumarGastoDeExplorador(g, 'a1', USO)
    g = sumarGastoDeExplorador(g, 'b2', USO)
    g = sumarGastoDeExplorador(g, 'a1', USO)
    expect((g as Flujo).detalleExploradores).toEqual([
      { id: 'b2', descripcion: 'Explorar y', gasto: 100_000 },
      { id: 'a1', gasto: 200_000 },
    ])
  })

  test('sumarGastoDeExplorador ignora el hilo principal (agentId undefined) y los subagentes sin exploradores en vuelo', async () => {
    const f = enCurso(1, { exploradores: 1 })

    expect(sumarGastoDeExplorador(null, 'a1', USO)).toBeNull()
    expect(sumarGastoDeExplorador(f, undefined, USO)).toBe(f)
    expect(sumarGastoDeExplorador(f, null, USO)).toBe(f)
    expect(sumarGastoDeExplorador(f, '', USO)).toBe(f)
    expect(sumarGastoDeExplorador(f, 'a1', null)).toBe(f)
    expect(sumarGastoDeExplorador(f, 'a1', undefined)).toBe(f)
    expect(sumarGastoDeExplorador(f, 'a1', { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 })).toBe(f)

    // Sin exploradores en vuelo (o con el campo ausente) y sin registro previo: un subagente cualquiera no cuenta.
    for (const sin of [enCurso(1, { exploradores: 0 }), enCurso(1), enCurso(1, { revisores: 2 })]) {
      expect(sumarGastoDeExplorador(sin, 'a1', USO)).toBe(sin)
      expect('detalleExploradores' in (sumarGastoDeExplorador(sin, 'a1', USO) as Flujo)).toBe(false)
    }

    // Con registro previo, suma aunque ya no haya exploradores en vuelo.
    const conRegistro = enCurso(2, { exploradores: 0, detalleExploradores: [{ id: 'a1', gasto: 5 }] })
    expect((sumarGastoDeExplorador(conRegistro, 'a1', USO) as Flujo).detalleExploradores).toEqual([{ id: 'a1', gasto: 100_005 }])
    expect(sumarGastoDeExplorador(conRegistro, 'otro', USO)).toBe(conRegistro)

    for (const estado of ['completo', 'detenido', 'interrumpido'] as const) {
      const fin = enCurso(3, { estado, fin: 9, exploradores: 1 })
      expect(sumarGastoDeExplorador(fin, 'a1', USO)).toBe(fin)
    }

    // El campo que no es número cuenta 0.
    const roto = { input_tokens: Number.NaN, output_tokens: 500, cache_read_input_tokens: undefined, cache_creation_input_tokens: 10 } as unknown as Parameters<typeof sumarGastoDeExplorador>[2]
    expect((sumarGastoDeExplorador(f, 'a1', roto) as Flujo).detalleExploradores).toEqual([{ id: 'a1', gasto: 510 }])
  })

  test('anotarExplorador: misma referencia sin flujo, terminado o con id vacío; ms por hasta − desde', async () => {
    const f = enCurso(1, { exploradores: 1 })

    expect(anotarExplorador(null, 'a1', { descripcion: 'x' })).toBeNull()
    expect(anotarExplorador(f, '', { descripcion: 'x', desde: 1 })).toBe(f)

    for (const estado of ['completo', 'detenido', 'interrumpido'] as const) {
      const fin = enCurso(3, { estado, fin: 9 })
      expect(anotarExplorador(fin, 'a1', { descripcion: 'x', desde: 1 })).toBe(fin)
    }

    // Sin nada nuevo que anotar, no se crea un registro vacío.
    expect(anotarExplorador(f, 'a1', {})).toBe(f)
    expect(anotarExplorador(f, 'a1', { descripcion: '   ', ms: -1, desde: Number.NaN })).toBe(f)
    expect(anotarExplorador(f, 'a1', { hasta: 5_000 })).toBe(f)
    expect('detalleExploradores' in (anotarExplorador(f, 'a1', {}) as Flujo)).toBe(false)

    // Lo mismo dos veces no cambia la referencia; la descripción va sin espacios en los bordes.
    const una = anotarExplorador(f, 'a1', { descripcion: '  Explorar x  ', desde: 1_000 }) as Flujo
    expect(una.detalleExploradores).toEqual([{ id: 'a1', descripcion: 'Explorar x', desde: 1_000 }])
    expect(anotarExplorador(una, 'a1', { descripcion: 'Explorar x', desde: 1_000 })).toBe(una)

    // `desde` no pisa; la descripción nueva sí; los vacíos no borran nada.
    const otra = anotarExplorador(una, 'a1', { descripcion: 'Explorar z', desde: 9_000 }) as Flujo
    expect(otra.detalleExploradores).toEqual([{ id: 'a1', descripcion: 'Explorar z', desde: 1_000 }])
    expect(anotarExplorador(otra, 'a1', { descripcion: '  ' })).toBe(otra)

    // ms = hasta − desde, nunca negativo; un `ms` válido manda sobre `hasta`; uno inválido se ignora.
    expect((anotarExplorador(una, 'a1', { hasta: 3_500 }) as Flujo).detalleExploradores?.[0]?.ms).toBe(2_500)
    expect((anotarExplorador(una, 'a1', { hasta: 500 }) as Flujo).detalleExploradores?.[0]?.ms).toBe(0)
    expect((anotarExplorador(una, 'a1', { ms: 700, hasta: 3_500 }) as Flujo).detalleExploradores?.[0]?.ms).toBe(700)
    expect((anotarExplorador(una, 'a1', { ms: 0 }) as Flujo).detalleExploradores?.[0]?.ms).toBe(0)
    expect((anotarExplorador(una, 'a1', { ms: -5, hasta: 3_500 }) as Flujo).detalleExploradores?.[0]?.ms).toBe(2_500)
    expect(anotarExplorador(una, 'a1', { ms: Number.NaN })).toBe(una)
    expect(anotarExplorador(una, 'a1', { ms: Number.POSITIVE_INFINITY })).toBe(una)

    // Con `desde` y `hasta` en la misma anotación.
    expect((anotarExplorador(f, 'b', { desde: 1_000, hasta: 4_000 }) as Flujo).detalleExploradores).toEqual([{ id: 'b', desde: 1_000, ms: 3_000 }])

    // No muta un flujo congelado.
    const congelado: Flujo = Object.freeze(enCurso(1, { detalleExploradores: Object.freeze([Object.freeze({ id: 'a1', gasto: 5 })]) as unknown as { id: string }[] }))
    let r: Flujo | null = null
    expect(() => { r = anotarExplorador(congelado, 'a1', { descripcion: 'x' }) }).not.toThrow()
    expect((r as unknown as Flujo).detalleExploradores).toEqual([{ id: 'a1', gasto: 5, descripcion: 'x' }])
    expect(congelado.detalleExploradores).toEqual([{ id: 'a1', gasto: 5 }])
  })

  test('cerrarExploradorSinId: fija ms = hasta − desde del registro abierto con esa description; si no hay, la misma referencia', async () => {
    const detalle = [
      { id: 'a', descripcion: 'Explorar uno', desde: 1_000, ms: 3_000 },
      { id: 'b', descripcion: 'Explorar dos', desde: 2_000 },
      { id: 'c', descripcion: 'Explorar dos', desde: 5_000 },
      { id: 'd', descripcion: 'Explorar tres' },
    ]
    const f = enCurso(2, { totalExploradores: 4, detalleExploradores: detalle })
    const args = { description: '  Explorar dos ', subagent_type: 'explorador' }

    // El primer registro abierto con esa description recibe el tiempo; el resto queda igual. Nunca negativo.
    const cerrado = cerrarExploradorSinId(f, args, 9_000) as Flujo
    expect(cerrado.detalleExploradores).toEqual([detalle[0], { id: 'b', descripcion: 'Explorar dos', desde: 2_000, ms: 7_000 }, detalle[2], detalle[3]])
    expect((cerrarExploradorSinId(f, args, 500) as Flujo).detalleExploradores?.[1]?.ms).toBe(0)

    // Con el tiempo fijo, la cifra no crece más: ni con el reloj en Plan o Ejecución ni al final del flujo.
    expect(nodos(cerrado, 9_000)[1]?.porExplorador?.[1]).toEqual({ descripcion: 'Explorar dos', ms: 7_000 })
    expect(nodos(cerrado, 99_000)[1]?.porExplorador?.[1]).toEqual({ descripcion: 'Explorar dos', ms: 7_000 })

    // Un segundo cierre toma el siguiente registro abierto con la misma description.
    expect((cerrarExploradorSinId(cerrado, args, 9_000) as Flujo).detalleExploradores?.[2]).toEqual({ id: 'c', descripcion: 'Explorar dos', desde: 5_000, ms: 4_000 })

    // Sin registro abierto (ya cerrado, sin `desde`, otra description, sin description o sin lista) o sin flujo vivo: nada cambia.
    expect(cerrarExploradorSinId(f, { description: 'Explorar uno' }, 9_000)).toBe(f)
    expect(cerrarExploradorSinId(f, { description: 'Explorar tres' }, 9_000)).toBe(f)
    expect(cerrarExploradorSinId(f, { description: 'Otra' }, 9_000)).toBe(f)
    expect(cerrarExploradorSinId(f, { description: '  ' }, 9_000)).toBe(f)
    expect(cerrarExploradorSinId(f, { description: 7 }, 9_000)).toBe(f)
    expect(cerrarExploradorSinId(f, undefined, 9_000)).toBe(f)
    expect(cerrarExploradorSinId(f, args, Number.NaN)).toBe(f)

    const sinLista = enCurso(2, { totalExploradores: 1 })
    expect(cerrarExploradorSinId(sinLista, args, 9_000)).toBe(sinLista)
    expect(cerrarExploradorSinId(null, args, 9_000)).toBeNull()

    for (const estado of ['completo', 'detenido', 'interrumpido'] as const) {
      const fin = enCurso(3, { estado, fin: 9, detalleExploradores: detalle })
      expect(cerrarExploradorSinId(fin, args, 9_000)).toBe(fin)
    }

    // No muta un flujo congelado.
    const congelado: Flujo = Object.freeze(enCurso(2, { totalExploradores: 4, detalleExploradores: Object.freeze(detalle.map(e => Object.freeze({ ...e }))) as unknown as { id: string }[] }))
    expect(() => cerrarExploradorSinId(congelado, args, 9_000)).not.toThrow()
    expect(congelado.detalleExploradores?.[1]).toEqual(detalle[1])
  })

  test('cerrarExploradorSinId con llamada: cierra el registro de esa llamada, nunca otro con la misma description', async () => {
    const detalle = [
      { id: 'a', descripcion: 'Explorar dos', desde: 1_000, llamada: 'tu-a' },
      { id: 'b', descripcion: 'Explorar dos', desde: 2_000, llamada: 'tu-b' },
      { id: 'c', descripcion: 'Explorar dos', desde: 3_000 },
    ]
    const f = enCurso(2, { totalExploradores: 3, detalleExploradores: detalle })
    const args = { description: 'Explorar dos', subagent_type: 'explorador' }

    // El que falla primero es el segundo lanzado: se cierra el suyo, no el primero abierto con esa description.
    const cerrado = cerrarExploradorSinId(f, args, 9_000, 'tu-b') as Flujo
    expect(cerrado.detalleExploradores).toEqual([detalle[0], { ...detalle[1], ms: 7_000 }, detalle[2]])

    // Su registro ya cerrado no deja pasar el cierre a otro.
    expect(cerrarExploradorSinId(cerrado, args, 9_500, 'tu-b')).toBe(cerrado)

    // Una llamada sin registro (su spawn no se vio) o sin llamada: solo un registro sin `llamada` (forma 0.17.0) con esa description.
    expect((cerrarExploradorSinId(f, args, 9_000, 'tu-x') as Flujo).detalleExploradores).toEqual([detalle[0], detalle[1], { ...detalle[2], ms: 6_000 }])
    expect((cerrarExploradorSinId(f, args, 9_000) as Flujo).detalleExploradores).toEqual([detalle[0], detalle[1], { ...detalle[2], ms: 6_000 }])
    const sinViejos = enCurso(2, { totalExploradores: 2, detalleExploradores: detalle.slice(0, 2) })
    expect(cerrarExploradorSinId(sinViejos, args, 9_000, 'tu-x')).toBe(sinViejos)

    // Con la llamada, la description no hace falta.
    expect((cerrarExploradorSinId(f, undefined, 9_000, 'tu-a') as Flujo).detalleExploradores?.[0]).toEqual({ ...detalle[0], ms: 8_000 })
  })

  test('anotarExplorador guarda la llamada una vez y no la pisa', async () => {
    const f = enCurso(1, { totalExploradores: 1 })
    const una = anotarExplorador(f, 'a1', { descripcion: 'Explorar x', desde: 1_000, llamada: 'tu-1' }) as Flujo
    expect(una.detalleExploradores).toEqual([{ id: 'a1', descripcion: 'Explorar x', desde: 1_000, llamada: 'tu-1' }])
    expect(anotarExplorador(una, 'a1', { llamada: 'tu-2' })).toBe(una)
    expect((anotarExplorador(f, 'a1', { descripcion: 'Explorar x', llamada: '' }) as Flujo).detalleExploradores).toEqual([{ id: 'a1', descripcion: 'Explorar x' }])
  })

  test('datosDeExplorador tolera resultados sin agentId o sin duración', async () => {
    const args = { description: '  Explorar hooks  ', subagent_type: 'explorador' }

    expect(datosDeExplorador(args, { agentId: 'a1', totalDurationMs: 4_200 })).toEqual({ id: 'a1', descripcion: 'Explorar hooks', ms: 4_200 })
    expect(datosDeExplorador(args, { agentId: 'a1' })).toEqual({ id: 'a1', descripcion: 'Explorar hooks' })
    expect(datosDeExplorador(args, { agentId: 'a1', totalDurationMs: 0 })).toEqual({ id: 'a1', descripcion: 'Explorar hooks', ms: 0 })
    expect(datosDeExplorador(args, { agentId: 'a1', totalDurationMs: -1 })).toEqual({ id: 'a1', descripcion: 'Explorar hooks' })
    expect(datosDeExplorador(args, { agentId: 'a1', totalDurationMs: '4200' })).toEqual({ id: 'a1', descripcion: 'Explorar hooks' })
    expect(datosDeExplorador(args, { agentId: 'a1', totalDurationMs: Number.NaN })).toEqual({ id: 'a1', descripcion: 'Explorar hooks' })
    expect(datosDeExplorador(undefined, { agentId: 'a1' })).toEqual({ id: 'a1' })
    expect(datosDeExplorador({ description: 7 }, { agentId: 'a1' })).toEqual({ id: 'a1' })
    expect(datosDeExplorador({ description: '  ' }, { agentId: 'a1' })).toEqual({ id: 'a1' })

    for (const resultado of [null, undefined, 'agentId: a1', 42, [], {}, { agentId: '' }, { agentId: '  ' }, { agentId: 7 }, { totalDurationMs: 5 }]) {
      expect(() => datosDeExplorador(args, resultado)).not.toThrow()
      expect(datosDeExplorador(args, resultado)).toBeNull()
    }
  })

  test('nodos: porExplorador solo con todos los lanzados descritos; si falta uno, línea total', async () => {
    const detalle = [
      { id: 'a', descripcion: 'Explorar uno', ms: 3_000, gasto: 5_000 },
      { id: 'b', descripcion: 'Explorar dos', desde: 1_000 },
    ]
    const f = enCurso(2, { totalExploradores: 2, exploradores: 0, detalleExploradores: detalle })

    // Con hora: el que no terminó lleva su tiempo hasta `t`; sin hora, sin tiempo propio.
    expect(nodos(f, 9_000)[1]?.porExplorador).toEqual([
      { descripcion: 'Explorar uno', ms: 3_000, gasto: 5_000 },
      { descripcion: 'Explorar dos', ms: 8_000 },
    ])
    expect(nodos(f)[1]?.porExplorador).toEqual([{ descripcion: 'Explorar uno', ms: 3_000, gasto: 5_000 }, { descripcion: 'Explorar dos' }])

    // Terminado: el tiempo corre hasta `fin`, no hasta `t`.
    const fin = { ...f, estado: 'completo', fin: 6_000, paso: 7 } as Flujo
    expect(nodos(fin, 99_000)[1]?.porExplorador?.[1]).toEqual({ descripcion: 'Explorar dos', ms: 5_000 })

    // Gasto 0 o ausente: el campo no se escribe.
    const sinGasto = enCurso(2, { totalExploradores: 1, detalleExploradores: [{ id: 'a', descripcion: 'Explorar uno', gasto: 0 }] })
    expect(nodos(sinGasto, 5_000)[1]?.porExplorador).toEqual([{ descripcion: 'Explorar uno' }])

    // Falta uno de los lanzados (no se lanzó con descripción, o su registro no la trae): línea total, sin el campo.
    for (const sin of [
      enCurso(2, { totalExploradores: 3, detalleExploradores: detalle }),
      enCurso(2, { totalExploradores: 2, detalleExploradores: [detalle[0] as { id: string }, { id: 'b', gasto: 7 }] }),
      enCurso(2, { totalExploradores: 2, detalleExploradores: [detalle[0] as { id: string }, { id: 'b', descripcion: '' }] }),
      enCurso(2, { totalExploradores: 2, detalleExploradores: [] }),
    ]) {
      const nodo = nodos(sin, 9_000)[1] as Nodo

      expect(nodo).not.toHaveProperty('porExplorador')
      expect(detallePaso(nodo, undefined, 30)).toEqual([`${nodo.exploradores} exploradores · Haiku high`])
    }

    // Exploración pendiente (paso 0): ni total ni detalle.
    const pendiente = nodos(enCurso(0, { totalExploradores: 2, detalleExploradores: detalle }), 9_000)[1] as Nodo
    expect(pendiente).not.toHaveProperty('porExplorador')
    expect(pendiente).not.toHaveProperty('exploradores')
  })

  test('nodos y detallePaso con atom 0.16.0 y 0.9.5 sin detalleExploradores (y con el campo malformado, no array) dibujan la línea total', async () => {
    const f016 = enCurso(2, { totalExploradores: 2, exploradores: 0, tiempos: { 1: 2_000 }, gasto: { 1: [100_000, 2_000] } })
    expect('detalleExploradores' in f016).toBe(false)
    expect(nodos(f016, 5_000)[1]).toEqual({ etiqueta: 'Exploración', estado: 'pasado', exploradores: 2, ms: 2_000, gasto: [100_000, 2_000] })
    expect(detallePaso(nodos(f016, 5_000)[1] as Nodo, undefined, 30)).toEqual(['2 exploradores · Haiku high', 'gasto 100k · sal 2k'])

    const v095 = { nombre: 'implementador', variante: null, paso: 2, ejecuto: false, estado: 'en curso', exploradores: 2 } as unknown as Flujo
    expect(() => nodos(v095, 3_000)).not.toThrow()
    expect(nodos(v095, 3_000)[1]).toMatchObject({ etiqueta: 'Exploración', estado: 'pasado', exploradores: 2 })
    expect(nodos(v095, 3_000)[1]).not.toHaveProperty('porExplorador')
    expect(detallePaso(nodos(v095, 3_000)[1] as Nodo)).toEqual(['2 exploradores · Haiku high'])

    for (const malo of ['a1', 5, true, {}, { id: 'a', descripcion: 'x' }, [null, 3, 'x', {}, { descripcion: 'sin id' }]]) {
      for (const base of [f016, v095]) {
        const roto = { ...base, detalleExploradores: malo } as unknown as Flujo

        expect(() => nodos(roto, 5_000)).not.toThrow()
        expect(nodos(roto, 5_000)[1]).not.toHaveProperty('porExplorador')
        expect(detallePaso(nodos(roto, 5_000)[1] as Nodo, undefined, 30)[0]).toBe('2 exploradores · Haiku high')
        expect(() => anotarExplorador(roto, 'a1', { descripcion: 'x' })).not.toThrow()
        expect(() => sumarGastoDeExplorador(roto, 'a1', USO)).not.toThrow()
      }
    }

    // Anotar sobre un campo malformado lo reemplaza por una lista válida.
    const roto = { ...f016, detalleExploradores: 'basura' } as unknown as Flujo
    expect((anotarExplorador(roto, 'a1', { descripcion: 'Explorar x' }) as Flujo).detalleExploradores).toEqual([{ id: 'a1', descripcion: 'Explorar x' }])
  })

  test('lineaDeExplorador a 47 y 30: cifras intactas, recorte en la descripción y largo ≤ ancho', async () => {
    const largo = { descripcion: 'Explorar hooks de register y su cableado con el motor', ms: 200_000, gasto: 96_200 }

    expect(lineaDeExplorador(largo)).toBe('hooks de register y su cableado con el motor · Haiku high · 3 min 20 s · 96,2k')
    expect(lineaDeExplorador(largo, 47)).toBe('hooks de reg… · Haiku high · 3 min 20 s · 96,2k')
    expect(lineaDeExplorador(largo, 30)).toBe('hooks de… · 3 min 20 s · 96,2k')

    for (const ancho of [47, 30]) expect(Array.from(lineaDeExplorador(largo, ancho)).length).toBeLessThanOrEqual(ancho)

    // Cabe entera: no se recorta ni se quita la config.
    expect(lineaDeExplorador({ descripcion: 'Explorar tests', ms: 5_000, gasto: 1_500 }, 47)).toBe('tests · Haiku high · 5 s · 1,5k')

    // Prefijo: sin distinguir mayúsculas; el «:» o espacios pegados se van; si no está pegado o no hay prefijo, queda tal cual.
    expect(lineaDeExplorador({ descripcion: 'EXPLORAR el repo' })).toBe('el repo · Haiku high')
    expect(lineaDeExplorador({ descripcion: 'explorar:  tests' })).toBe('tests · Haiku high')
    expect(lineaDeExplorador({ descripcion: 'Explorar : tests' })).toBe('tests · Haiku high')
    expect(lineaDeExplorador({ descripcion: 'Revisar tests' })).toBe('Revisar tests · Haiku high')
    expect(lineaDeExplorador({ descripcion: 'Exploraremos tests' })).toBe('Exploraremos tests · Haiku high')
    expect(lineaDeExplorador({ descripcion: 'Explorar' })).toBe('Explorar · Haiku high')

    // Falta una cifra: la línea omite solo esa.
    expect(lineaDeExplorador({ descripcion: 'Explorar tests', gasto: 950 })).toBe('tests · Haiku high · 950')
    expect(lineaDeExplorador({ descripcion: 'Explorar tests', ms: 45_000 })).toBe('tests · Haiku high · 45 s')
    expect(lineaDeExplorador({ descripcion: 'Explorar tests', ms: 0, gasto: 0 })).toBe('tests · Haiku high · 0 s')
    expect(lineaDeExplorador({ descripcion: 'Explorar tests' }, 14)).toBe('tests')

    // Un emoji no se parte: se cuenta por caracteres.
    const emojis = { descripcion: `Explorar ${'🔎'.repeat(30)}`, ms: 5_000, gasto: 1_500 }
    const corta = lineaDeExplorador(emojis, 47)
    expect(corta).toBe(`${'🔎'.repeat(20)}… · Haiku high · 5 s · 1,5k`)
    expect(Array.from(corta).length).toBe(47)
    expect(corta).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/)

    // Ancho corto: la descripción cae a «…» y las cifras no se tocan mientras quepan con ella.
    expect(lineaDeExplorador(largo, 22)).toBe('… · 3 min 20 s · 96,2k')
    expect(lineaDeExplorador({ ...largo, ms: 3_723_000 }, 21)).toBe('… · 1 h 2 min · 96,2k')

    // Si ni «…» cabe con las cifras, van solas: primero se va el gasto, después se recorta la duración.
    expect(lineaDeExplorador(largo, 10)).toBe('3 min 20 s')
    expect(lineaDeExplorador(largo, 18)).toBe('3 min 20 s · 96,2k')
    expect(lineaDeExplorador({ ...largo, ms: 3_723_000 }, 20)).toBe('1 h 2 min · 96,2k')
    expect(lineaDeExplorador(largo, 6)).toBe('3 min…')
    expect(lineaDeExplorador({ descripcion: 'Explorar tests', gasto: 96_200 }, 3)).toBe('96…')

    // Descripción muy corta y cifras largas: nunca pasa del ancho, a ningún ancho.
    for (const d of [largo, { descripcion: 'x', ms: 3_599_000, gasto: 999_900 }, { descripcion: 'Explorar tests' }, { descripcion: 'ab', gasto: 950 }]) {
      for (let ancho = 1; ancho <= 60; ancho++) expect(Array.from(lineaDeExplorador(d, ancho)).length).toBeLessThanOrEqual(ancho)
    }
  })

  test('detallePaso: una línea por explorador en lugar de la total; la de gasto del paso sigue', async () => {
    const exploracion = pasado('Exploración', {
      exploradores: 2,
      gasto: [150_000, 3_000],
      porExplorador: [
        { descripcion: 'Explorar hooks de register', ms: 200_000, gasto: 96_200 },
        { descripcion: 'Explorar tests', ms: 45_000 },
      ],
    })

    expect(detallePaso(exploracion)).toEqual([
      'hooks de register · Haiku high · 3 min 20 s · 96,2k',
      'tests · Haiku high · 45 s',
      'gasto 150k · sal 3k',
    ])
    expect(detallePaso(exploracion, 'Opus 5.5 high', 30)).toEqual(['hooks de… · 3 min 20 s · 96,2k', 'tests · Haiku high · 45 s', 'gasto 150k · sal 3k'])

    for (const linea of detallePaso(exploracion, undefined, 30)) expect(Array.from(linea).length).toBeLessThanOrEqual(30)

    // Sin `porExplorador` (o vacío), todo igual que antes.
    expect(detallePaso({ ...exploracion, porExplorador: undefined as never })).toEqual(['2 exploradores · Haiku high', 'gasto 150k · sal 3k'])
    expect(detallePaso(pasado('Exploración', { exploradores: 1 }))).toEqual(['1 explorador · Haiku high'])
    expect(detallePaso(pasado('Exploración', { exploradores: 2, porExplorador: [] }))).toEqual(['2 exploradores · Haiku high'])
    expect(detallePaso({ ...exploracion, estado: 'pendiente' })).toEqual([])
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

/** Una barra de fila: solo `█` y `░`. */
const esBarraDeFila = (n: { type: string; text?: string | undefined }) => n.type === 'Text' && /^[█░]+$/.test(n.text ?? '')

/**
 * Los `color` de los ■ seguidos que siguen a la etiqueta de la fila, en orden (el del principal primero).
 * La etiqueta se compara sin el relleno final; principal y subagente del mismo modelo y esfuerzo
 * van unidos en una sola fila de «Esta sesión», así que la etiqueta es única.
 */
async function coloresDe(ui: Ui, etiqueta: string): Promise<unknown[]> {
  const arbol = await ui.findAll({})
  const i = arbol.findIndex(n => n.type === 'Text' && (n.text ?? '').trimEnd() === etiqueta)
  const colores: unknown[] = []
  let j = i + 1
  while (i !== -1 && arbol[j]?.type === 'Text' && arbol[j]?.text === ' ■') colores.push(arbol[j++]?.props.color)

  return colores
}

/** El `color` del primer ■ de la fila con esa etiqueta (el del principal si la fila lo tiene). */
async function colorDe(ui: Ui, etiqueta: string): Promise<unknown> {
  return (await coloresDe(ui, etiqueta))[0]
}

describe('leyenda de colores en el panel', () => {
  function preparar(on: On) {
    mock.clock(on, { now: AHORA })
    motorMide(on)
    motorUsa(on)
    mock.store(on)
    on('session.id', () => ({ value: 's1' }))
    motorControlado(on, 'claude-opus-5-5')
  }

  /** Los Text entre «Esfuerzo» y «Esta sesión» (sin ellos). */
  async function entreEsfuerzoYSesion(ui: Ui): Promise<{ text?: string | undefined; props: Record<string, unknown> }[]> {
    const textos = await ui.findAll({ type: 'Text' })
    const desde = textos.findIndex(t => t.text === 'Esfuerzo')
    const hasta = textos.findIndex(t => t.text === 'Esta sesión')

    expect(desde).toBeGreaterThanOrEqual(0)
    expect(hasta).toBeGreaterThan(desde)

    return textos.slice(desde + 1, hasta)
  }

  test('la leyenda explica los 3 colores de las barras entre Esfuerzo y Esta sesión', async ($, on) => {
    preparar(on)
    await $.session.measure(MEDIDA)
    await paso($, 'claude-opus-5-5', 'high')

    const ui = await $.ui.mount({ ...PANE_ANCHO, surface: 'terminal' })
    const trozo = await entreEsfuerzoYSesion(ui)
    const indices = trozo.flatMap((t, i) => (t.text === '■' ? [i] : []))

    expect(indices).toHaveLength(3)
    expect(indices.map(i => trozo[i]?.props.color)).toEqual(['claude', 'cyan_FOR_SUBAGENTS_ONLY', 'purple_FOR_SUBAGENTS_ONLY'])
    expect(indices.map(i => (trozo[i + 1]?.text ?? '').trim())).toEqual(['normal', 'flujo', 'subagentes'])
    expect(indices.map(i => trozo[i + 1]?.props.dimColor)).toEqual([true, true, true])
    await ui.unmount()
  })

  test('la leyenda cabe en 32 y en 49 columnas', async ($, on) => {
    preparar(on)
    await $.session.measure(MEDIDA)
    await paso($, 'claude-opus-5-5', 'high')

    for (const pane of [PANE, PANE_ANCHO]) {
      const ui = await $.ui.mount({ ...pane, surface: 'terminal' })
      const trozo = await entreEsfuerzoYSesion(ui)
      const primero = trozo.findIndex(t => t.text === '■')
      const largo = trozo.slice(primero).reduce((n, t) => n + (t.text ?? '').length, 0)

      expect(primero).toBeGreaterThanOrEqual(0)
      expect(largo).toBeLessThanOrEqual(32)
      await ui.unmount()
    }
  })

  test('la leyenda sale aunque no haya respuestas anotadas', async ($, on) => {
    mock.clock(on, { now: AHORA })
    motorMide(on)
    motorUsa(on)
    mock.store(on)
    await $.session.measure(MEDIDA)

    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    const trozo = await entreEsfuerzoYSesion(ui)

    expect(trozo.filter(t => t.text === '■')).toHaveLength(3)
    await ui.unmount()
  })
})

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

    // Una sola fila unida: el ■ del principal primero y el del subagente después, cada uno con su estado.
    expect(await coloresDe(ui, 'Opus 5.5 high')).toEqual(['warning', 'success'])

    // Al terminar el subagente el principal sigue esperando su herramienta (hasta turn.complete o una nueva petición).
    abrirSub()
    await sub
    expect(await coloresDe(ui, 'Opus 5.5 high')).toEqual(['warning', 'subtle'])
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

  test('«Esta semana» no lleva cuadrados; «Esta sesión» lleva uno por origen en su única fila unida', async ($, on) => {
    const motor = preparar(on)
    await $.session.measure(MEDIDA)
    await paso($, 'claude-opus-5-5', 'high')
    await paso($, 'claude-opus-5-5', 'high', 'agente-1')
    motor.detener('principal')()

    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await ui.press({ key: 's-plegar' })
    const textos = (await ui.findAll({ type: 'Text' })).map(t => t.text ?? '')
    const sem = textos.indexOf('Esta semana')

    expect(textos.slice(sem).map(t => t.trimEnd())).toContain('Opus 5.5 high')
    expect(textos.slice(sem)).not.toContain(' ■')
    expect(textos.slice(0, sem).filter(t => t === ' ■')).toHaveLength(2)
    expect(await coloresDe(ui, 'Opus 5.5 high')).toEqual(['subtle', 'subtle'])
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

/**
 * Lo que el panel dibuja desde el resumen con la pestaña «Flujo» abierta en `/implementador · Ejecución`, texto por texto,
 * con los tiempos del recorrido del test (5 s, 20 s, 3 s, 1 min y 1 min 30 s en curso; `Revisión del plan` se saltó y no lleva tiempo)
 * y el conteo de exploradores lanzados (` ×1`) junto a `Exploración`, antes de su tiempo;
 * bajo su tiempo, la línea de detalle del paso (sin orquestador: el recorrido no pasa por `turn.step`).
 */
const FLUJO_EJECUCION = [
  '/implementador · Ejecución · 2 min 58 s',
  '✓ ',
  'Preflight',
  ' 5 s',
  '│',
  '✓ ',
  'Exploración',
  ' ×1',
  ' 20 s',
  '  1 explorador · Haiku high',
  '│',
  '✓ ',
  'Plan',
  ' 3 s',
  '│',
  '✓ ',
  'Revisión del plan',
  '│',
  '✓ ',
  'Aprobación',
  ' 1 min',
  '│',
  '▸ ',
  'Ejecución',
  ' 1 min 30 s',
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
  /**
   * El motor bajo los plugins: la skill y el turno responden tal cual; `Agent` espera su compuerta y puede fallar.
   * `AskUserQuestion` también: `detener('AskUserQuestion')` la retiene (el usuario aún no responde) y
   * `fallan.add('AskUserQuestion')` la hace rechazar.
   */
  function motorFlujo(on: On) {
    const llamadas: string[] = []
    const compuertas = new Map<string, Promise<void>>()
    const fallan = new Set<string>()
    /** Por `description` de un `Agent`: lo que su resultado trae además de `result` (el `agentId` y la duración). */
    const resultados = new Map<string, { agentId: string; totalDurationMs: number }>()
    /** Por `description` de un `Agent`: el `tool_use_id` de su última llamada, para lanzar el spawn con el mismo id, como hace el motor. */
    const idsDeLlamada = new Map<string, string>()
    on('skill.prompt', (_$, e) => ({ text: e.text }))
    on('tool.call', async (_$, e) => {
      llamadas.push(e.tool)
      if (e.tool === 'AskUserQuestion') {
        await compuertas.get('AskUserQuestion')
        if (fallan.has('AskUserQuestion')) throw new Error('pregunta cancelada')
      }

      if (e.tool === 'Agent') {
        // La compuerta y el fallo se piden por tipo de agente o por `description` (para distinguir exploradores en paralelo).
        const tipo = e.subagent_type ?? ''
        const descripcion = String((e as unknown as Record<string, unknown>).description ?? '')
        idsDeLlamada.set(descripcion, e.tool_use_id)
        await (compuertas.get(tipo) ?? compuertas.get(descripcion))
        if (fallan.has(tipo) || fallan.has(descripcion)) throw new Error('explorador caído')

        // Sin entrada para esta `description` el resultado es el de siempre.
        return { result: 'listo', ...resultados.get(descripcion) }
      }

      return { result: 'listo' }
    })
    on('turn.complete', (_$, e) => ({ text: e.answer }))

    /** Por `description` de un lanzamiento: el `agentId` con que responde el motor (sin entrada, responde sin `agentId`). */
    const agentIds = new Map<string, string>()
    /** Las `description` cuyo lanzamiento el motor niega o hace fallar. */
    const negados = new Set<string>()
    const spawnFallan = new Set<string>()
    on('agent.spawn', (_$, e) => {
      if (spawnFallan.has(e.description)) throw new Error('lanzamiento caído')
      if (negados.has(e.description)) return { deny: 'negado por el motor' }
      const agentId = agentIds.get(e.description)

      return { model: 'claude-haiku-5-5', ...(agentId === undefined ? {} : { agentId }) }
    })

    /** Cierra la compuerta del agente `nombre`; devuelve cómo abrirla. */
    function detener(nombre: string): () => void {
      let abrir: () => void = () => undefined
      compuertas.set(nombre, new Promise<void>(r => (abrir = r)))

      return abrir
    }

    return { llamadas, detener, fallan, resultados, idsDeLlamada, agentIds, negados, spawnFallan }
  }

  /** La hora que lee el panel es `reloj.t` (ms): arranca en AHORA y el test la mueve a mano. */
  function preparar(on: On, pedidos: string[] = [], inicial: Record<string, unknown> = {}) {
    const reloj = { t: AHORA }
    // Sin `mock.clock` (fija la hora): el reloj es de este helper; los temporizadores no corren solos.
    on('clock.now', () => ({ value: reloj.t }))
    on('clock.every', () => ({ value: undefined }))
    on('clock.after', () => ({ value: undefined }))
    motorMide(on)
    motorUsa(on, pedidos)
    on('session.id', () => ({ value: 's1' }))
    const guardados = motorStore(on, inicial)

    return { ...motorFlujo(on), guardados, reloj }
  }

  const textosDe = async (ui: Ui) => (await ui.findAll({ type: 'Text' })).map(t => t.text ?? '')

  /**
   * Los `n` textos que empiezan en el resumen del flujo. `findAll` no expone `key` en los `Text`, así que el resumen se
   * localiza por el `Box` con key `flujo-resumen` que lo envuelve.
   */
  const desdeResumen = async (ui: Ui, n: number) => {
    const arbol = await ui.findAll({})
    const i = arbol.findIndex(nodo => nodo.type === 'Box' && nodo.key === 'flujo-resumen')

    expect(i).toBeGreaterThan(-1)

    return arbol
      .slice(i)
      .filter(nodo => nodo.type === 'Text')
      .slice(0, n)
      .map(nodo => nodo.text ?? '')
  }

  const bash = ($: Engine, command: string) => $.tool.call({ tool: 'Bash', command })
  const agente = ($: Engine, subagent_type: string, description = 'prueba') =>
    $.tool.call({ tool: 'Agent', subagent_type, description, prompt: 'prueba' })
  const respuesta = (answer: string, extra: { reason?: 'answer' | 'aborted'; agentId?: string } = {}) => ({
    reason: extra.reason ?? 'answer',
    answer,
    durationMs: 10,
    isAborted: extra.reason === 'aborted',
    turnId: 't',
    ...(extra.agentId === undefined ? {} : { agentId: extra.agentId }),
  })

  test('«Flujo» muestra el orquestador real y lo que gastó el flujo, sin lo que la sesión gastó antes ni después', async ($, on) => {
    preparar(on)
    on('turn.step', async function* (_$, e) {
      return {
        turnId: e.turnId,
        index: e.index,
        answer: 'ok',
        toolUses: [],
        stopReason: 'end_turn' as const,
        usage: { ...USO, model: e.model },
      }
    })
    await $.session.measure(MEDIDA)
    const ui = await $.ui.mount({ ...PANE_ANCHO, surface: 'terminal' })
    await ui.press({ key: 'pestana-flujo' })
    /** Lo que dibuja la pestaña «Flujo»: del resumen al final (abierta, el resto del panel no se dibuja). */
    const deFlujo = async () => {
      const arbol = await ui.findAll({})
      const i = arbol.findIndex(n => n.type === 'Box' && n.key === 'flujo-resumen')

      return arbol.slice(i).filter(n => n.type === 'Text')
    }
    const textos = async () => (await deFlujo()).map(n => (n.text ?? '').trim())

    // La sesión ya gastó 100k (2k de salida) antes del flujo: no cuenta, y mientras nada gaste no hay bloque.
    await paso($, 'claude-opus-5-5', 'high')
    await $.skill.prompt({ skill: 'implementador', text: '' })
    await bash($, 'node ~/.claude/flujos/estado.mjs')
    expect(await textos()).not.toContain('consumo')
    expect(await textos()).not.toContain('orquestador Opus 5.5 high')

    // El orquestador responde con Sonnet aunque la skill pida Opus; un explorador (Haiku) responde aparte.
    await paso($, 'claude-sonnet-5-5', 'high')
    await paso($, 'claude-haiku-5-5', 'xhigh', 'agente-A')
    let t = await textos()
    expect(t).toContain('orquestador Sonnet 5.5 high')
    expect(t).toContain('consumo')
    expect(t).toContain('200k · sal 4k')
    expect(t.filter(x => x === '100k')).toHaveLength(2)
    expect(t.filter(x => x === '2k')).toHaveLength(2)
    expect(t).toContain('Sonnet 5.5 high')
    expect(t).toContain('Haiku  5.5 xhigh')
    // El subagente se reconoce por el color; el hilo principal no lleva.
    const nodos = await deFlujo()
    expect(nodos.find(n => (n.text ?? '').trim() === 'Haiku  5.5 xhigh')?.props.color).toBe('purple_FOR_SUBAGENTS_ONLY')
    expect(nodos.find(n => (n.text ?? '').trim() === 'Sonnet 5.5 high')?.props.color).toBeUndefined()

    // Al terminar queda fijo: lo que la sesión gaste después no lo mueve, y el orquestador tampoco cambia.
    await $.turn.complete(respuesta('CIERRE · x — COMPLETO'))
    await paso($, 'claude-opus-5-5', 'high')
    t = await textos()
    expect(t).toContain('200k · sal 4k')
    expect(t).not.toContain('300k · sal 6k')
    expect(t).toContain('orquestador Sonnet 5.5 high')
    await ui.unmount()
  })

  test('el hilo principal anota flujo|… solo con el flujo en curso; los subagentes, antes y después, sin marca', async ($, on) => {
    const { guardados } = preparar(on)
    on('turn.step', async function* (_$, e) {
      return {
        turnId: e.turnId,
        index: e.index,
        answer: 'ok',
        toolUses: [],
        stopReason: 'end_turn' as const,
        usage: { ...USO, model: e.model },
      }
    })
    await $.session.measure(MEDIDA)

    await paso($, 'claude-opus-5-5', 'high')
    await $.skill.prompt({ skill: 'implementador', text: '' })
    await paso($, 'claude-opus-5-5', 'high')
    await paso($, 'claude-opus-5-5', 'high', 'agente-1')
    await $.turn.complete(respuesta('CIERRE · x — COMPLETO'))
    await paso($, 'claude-opus-5-5', 'high')

    const hora = comoRegistro(guardados.get('uso:s1'))[String(inicioDeHora(AHORA))] ?? {}
    expect(Object.keys(hora).sort()).toEqual(['claude-opus-5-5|high', 'claude-opus-5-5|high|sub', 'flujo|claude-opus-5-5|high'])
    const una = [USO.input_tokens, USO.output_tokens, USO.cache_read_input_tokens, USO.cache_creation_input_tokens]
    const dos = una.map(x => x * 2)
    // Dentro del flujo, solo la respuesta del hilo principal; fuera, la de antes y la de después.
    expect(hora['flujo|claude-opus-5-5|high']).toEqual(una)
    expect(hora['claude-opus-5-5|high']).toEqual(dos)
    expect(hora['claude-opus-5-5|high|sub']).toEqual(una)
  })

  /** Un `turn.step` final que anota con qué modelo y esfuerzo llegó cada petición y responde con ese modelo. */
  function motorVisto(on: On) {
    const vistos: { model: string; effort: unknown }[] = []
    on('turn.step', async function* (_$, e) {
      vistos.push({ model: e.model, effort: e.effort })

      return {
        turnId: e.turnId,
        index: e.index,
        answer: 'ok',
        toolUses: [],
        stopReason: 'end_turn' as const,
        usage: { ...USO, model: e.model },
      }
    })

    return vistos
  }

  test('turn.step no reescribe el modelo del hilo principal con un flujo en curso', async ($, on) => {
    preparar(on)
    const vistos = motorVisto(on)
    await $.session.measure(MEDIDA)
    const ui = await $.ui.mount({ ...PANE_ANCHO, surface: 'terminal' })
    await ui.press({ key: 'pestana-flujo' })

    await $.skill.prompt({ skill: 'implementador', text: '**Pedido:** x' })
    expect((await desdeResumen(ui, 1))[0]).toBe('/implementador · Preflight · 0 s')

    // El hilo principal llega a `next` con el modelo y el esfuerzo originales; los de un subagente, igual.
    await paso($, 'claude-opus-5-5', 'high')
    expect(vistos.at(-1)).toEqual({ model: 'claude-opus-5-5', effort: 'high' })
    await paso($, 'claude-opus-5-5', 'medium')
    expect(vistos.at(-1)).toEqual({ model: 'claude-opus-5-5', effort: 'medium' })
    await paso($, 'claude-haiku-5-5', 'xhigh', 'agente-A')
    expect(vistos.at(-1)).toEqual({ model: 'claude-haiku-5-5', effort: 'xhigh' })

    // La fila «orquestador» anota el modelo real de la petición del hilo principal.
    await paso($, 'claude-opus-5-5', 'high')
    const textos = (await textosDe(ui)).map(t => t.trim())
    expect(textos).toContain('orquestador Opus 5.5 high')
    expect(textos).not.toContain('orquestador Sonnet 5.5 high')
    await ui.unmount()
  })

  test('Esta sesión y Esta semana pintan en cyan_FOR_SUBAGENTS_ONLY el tramo del orquestador; lo de fuera del flujo sigue en claude', async ($, on) => {
    const h = String(inicioDeHora(AHORA))
    preparar(on, [], { 'uso:otra': { [h]: { [clave('claude-sonnet-5-5', 'low')]: [400_000, 0, 0, 0] } } })
    on('turn.step', async function* (_$, e) {
      return {
        turnId: e.turnId,
        index: e.index,
        answer: 'ok',
        toolUses: [],
        stopReason: 'end_turn' as const,
        usage: { ...USO, model: e.model },
      }
    })
    await $.session.measure(MEDIDA)

    // Antes del flujo, dentro (hilo principal y un subagente).
    await paso($, 'claude-opus-5-5', 'high')
    await $.skill.prompt({ skill: 'implementador', text: '' })
    await paso($, 'claude-opus-5-5', 'high')
    await paso($, 'claude-opus-5-5', 'high', 'agente-1')

    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await ui.press({ key: 's-plegar' })
    const esBarra = (n: { type: string; text?: string | undefined }) => n.type === 'Text' && /^[█░]+$/.test(n.text ?? '')
    /** Los tramos `[color, texto]` de la barra de cada fila con esa etiqueta dentro de una sección. */
    const tramosDe = async (desde: string, hasta: string | null, etiqueta: (t: string) => boolean) => {
      const arbol = await ui.findAll({})
      const textos = arbol.map(n => (n.type === 'Text' ? (n.text ?? '') : ''))
      const ini = textos.indexOf(desde)
      const fin = hasta === null ? textos.length : textos.indexOf(hasta)

      return textos.flatMap((t, i) => {
        if (i <= ini || i >= fin || !etiqueta(t)) return []
        // La barra termina en el «%» de su fila; después vienen las de «por día».
        const final = textos.findIndex((x, j) => j > i && x.endsWith('%'))

        return [arbol.slice(i, final).filter(esBarra).map(n => [n.props.color, n.text])]
      })
    }
    const opus = (t: string) => t === 'Opus 5.5 high'

    // Esta sesión (25 celdas): una sola fila unida, Opus 300k (100k normal, 100k dentro del flujo y 100k de subagente).
    const sesion = await tramosDe('Esta sesión', 'Esta semana', opus)
    expect(sesion).toEqual([
      [
        ['claude', '█'.repeat(9)],
        ['cyan_FOR_SUBAGENTS_ONLY', '█'.repeat(8)],
        ['purple_FOR_SUBAGENTS_ONLY', '█'.repeat(8)],
      ],
    ])

    // Esta semana: Opus 300k de 700k (100k de flujo, 100k de subagente) y Sonnet 400k sin flujo.
    const semana = await tramosDe('Esta semana', null, t => t === 'Opus   5.5 high')
    expect(semana).toEqual([
      [
        ['claude', '█'.repeat(3)],
        ['cyan_FOR_SUBAGENTS_ONLY', '█'.repeat(4)],
        ['purple_FOR_SUBAGENTS_ONLY', '█'.repeat(4)],
        ['claude', '░'.repeat(14)],
      ],
    ])
    const sonnet = await tramosDe('Esta semana', null, t => t.trimEnd() === 'Sonnet 5.5 low')
    expect(sonnet).toEqual([[['claude', '█'.repeat(14) + '░'.repeat(11)]]])

    // Tras el cierre, lo nuevo del hilo principal va en claude: el tramo del orquestador no crece.
    await $.turn.complete(respuesta('CIERRE · x — COMPLETO'))
    await paso($, 'claude-opus-5-5', 'high')
    const tras = await tramosDe('Esta sesión', 'Esta semana', opus)
    expect(tras).toEqual([
      [
        ['claude', '█'.repeat(13)],
        ['cyan_FOR_SUBAGENTS_ONLY', '█'.repeat(6)],
        ['purple_FOR_SUBAGENTS_ONLY', '█'.repeat(6)],
      ],
    ])
    await ui.unmount()
  })

  /**
   * Una sesión con Opus 5.5 high: 100k antes del flujo, 100k del hilo principal dentro del flujo y 100k de un subagente,
   * con el panel montado con el ancho dado y «Esta semana» desplegada.
   */
  async function conFlujoYSubagente($: Engine, on: On, pane: typeof PANE | typeof PANE_ANCHO) {
    preparar(on)
    on('turn.step', async function* (_$, e) {
      return {
        turnId: e.turnId,
        index: e.index,
        answer: 'ok',
        toolUses: [],
        stopReason: 'end_turn' as const,
        usage: { ...USO, model: e.model },
      }
    })
    await $.session.measure(MEDIDA)
    await paso($, 'claude-opus-5-5', 'high')
    await $.skill.prompt({ skill: 'implementador', text: '' })
    await paso($, 'claude-opus-5-5', 'high')
    await paso($, 'claude-opus-5-5', 'high', 'agente-1')

    const ui = await $.ui.mount({ ...pane, surface: 'terminal' })
    await ui.press({ key: 's-plegar' })

    return ui
  }

  /** Los textos del panel con su `dimColor`, para distinguir el desglose de una etiqueta con el mismo texto. */
  const textosAtenuados = async (ui: Ui) =>
    (await ui.findAll({ type: 'Text' })).filter(n => n.props.dimColor === true).map(n => n.text ?? '')

  test('la fila unida de Esta sesión pinta 3 tramos y su desglose', async ($, on) => {
    const ui = await conFlujoYSubagente($, on, PANE_ANCHO)
    const arbol = await ui.findAll({})
    const textos = arbol.map(n => (n.type === 'Text' ? (n.text ?? '') : ''))
    const ses = textos.indexOf('Esta sesión')
    const sem = textos.indexOf('Esta semana')

    // Opus 300k de 300k (ancho 49 → barra de 33): 11 celdas de cada tramo.
    expect(
      arbol
        .slice(ses, sem)
        .filter(esBarraDeFila)
        .map(n => [n.props.color, n.text]),
    ).toEqual([
      ['claude', '█'.repeat(11)],
      ['cyan_FOR_SUBAGENTS_ONLY', '█'.repeat(11)],
      ['purple_FOR_SUBAGENTS_ONLY', '█'.repeat(11)],
    ])
    // El desglose va en su propia línea atenuada, bajo la barra y su %.
    const desglose = arbol.slice(ses, sem).find(n => n.type === 'Text' && n.text === 'normal 100k · flujo 100k · sub 100k')
    expect(desglose?.props.dimColor).toBe(true)
    expect(textos.slice(ses, sem).filter(t => t.endsWith('%'))).toHaveLength(1)
    expect(textos.indexOf('normal 100k · flujo 100k · sub 100k')).toBeGreaterThan(textos.findIndex((t, i) => i > ses && t.endsWith('%')))
    await ui.unmount()
  })

  test('a 32 columnas el desglose usa la forma compacta y no pasa del ancho', async ($, on) => {
    const ui = await conFlujoYSubagente($, on, PANE)
    const textos = await textosDe(ui)
    const desgloses = textos.slice(0, textos.indexOf('Esta semana')).filter(t => /^normal /.test(t))

    // 'normal 100k · flujo 100k · sub 100k' mide 35 y el ancho es 32: sin los espacios entran 31.
    expect(desgloses).toEqual(['normal 100k·flujo 100k·sub 100k'])
    expect(desgloses[0]?.length).toBeLessThanOrEqual(32)
    expect(await textosAtenuados(ui)).toContain('normal 100k·flujo 100k·sub 100k')
    await ui.unmount()

    // Más estrecho aún (20 columnas): recortado con «…», sin pasar del ancho.
    const estrecho = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: 20 }, surface: 'terminal' })
    const recortados = (await textosDe(estrecho)).filter(t => /^normal /.test(t))
    expect(recortados).toEqual(['normal 100k·flujo 1…'])
    expect(recortados[0]?.length).toBe(20)
    await estrecho.unmount()
  })

  test('Esta semana no lleva desglose', async ($, on) => {
    const ui = await conFlujoYSubagente($, on, PANE_ANCHO)
    const arbol = await ui.findAll({})
    const textos = arbol.map(n => (n.type === 'Text' ? (n.text ?? '') : ''))
    const ses = textos.indexOf('Esta sesión')
    const sem = textos.indexOf('Esta semana')

    // La semana sí tiene flujo y subagente en su barra (4 tramos); lo que falta es la línea de desglose.
    const deSemana = arbol.slice(sem)
    expect(deSemana.filter(esBarraDeFila).some(n => n.props.color === 'cyan_FOR_SUBAGENTS_ONLY')).toBe(true)
    expect(deSemana.filter(esBarraDeFila).some(n => n.props.color === 'purple_FOR_SUBAGENTS_ONLY')).toBe(true)
    expect(textos.slice(sem).filter(t => /^(normal|flujo|sub) /.test(t))).toEqual([])
    // Y la sesión sí lo lleva, así que la prueba no pasa por no tener datos.
    expect(textos.slice(ses, sem).filter(t => /^(normal|flujo|sub) /.test(t))).toEqual(['normal 100k · flujo 100k · sub 100k'])
    await ui.unmount()
  })

  test('pestañas Inicio/Flujo/Carpeta: teclas i/f/c y prefs:flujo', async ($, on) => {
    const { guardados } = preparar(on)

    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    for (const [key, hotkey, label] of [
      ['pestana-inicio', 'i', 'Inicio'],
      ['pestana-flujo', 'f', 'Flujo'],
      ['carpeta', 'c', 'Carpeta'],
    ] as const) {
      const boton = await ui.find({ type: 'Button', key })
      expect(boton?.props.hotkey).toBe(hotkey)
      expect(boton?.props.label).toBe(label)
    }
    // Ya no hay título «Flujo» ni el botón Ver/Ocultar: solo el resumen, bajo Esfuerzo.
    expect(await textosDe(ui)).not.toContain('Flujo')
    expect(await ui.find({ type: 'Button', key: 'flujo-plegar' })).toBeUndefined()
    expect(await desdeResumen(ui, 1)).toEqual(['sin flujo en esta sesión'])

    await ui.press({ key: 'pestana-flujo' })
    expect(guardados.get('prefs:flujo')).toBe(true)
    expect(await textosDe(ui)).not.toContain('Contexto')

    // Pulsada otra vez, la pestaña sigue abierta.
    await ui.press({ key: 'pestana-flujo' })
    expect(guardados.get('prefs:flujo')).toBe(true)
    expect(await textosDe(ui)).not.toContain('Contexto')
    expect(await textosDe(ui)).not.toContain('Flujo')
    expect(await ui.find({ type: 'Button', key: 'flujo-plegar' })).toBeUndefined()

    await ui.press({ key: 'pestana-inicio' })
    expect(guardados.get('prefs:flujo')).toBe(false)
    expect(await textosDe(ui)).toContain('Contexto')

    await ui.press({ key: 'pestana-inicio' })
    expect(guardados.get('prefs:flujo')).toBe(false)
    await ui.unmount()
  })

  test('la fila de pestañas va antes de «Contexto» en Inicio y antes del resumen en Flujo', async ($, on) => {
    preparar(on)
    await $.session.measure(MEDIDA)

    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    const posiciones = async (despues: (n: { type: string; key?: string; text?: string }) => boolean) => {
      const arbol = await ui.findAll({})
      const pestanas = arbol.findIndex(n => n.type === 'Button' && n.key === 'pestana-inicio')
      const otro = arbol.findIndex(despues)

      return [pestanas, otro]
    }

    const [inicioPestanas, contexto] = await posiciones(n => n.type === 'Text' && n.text === 'Contexto')
    expect(inicioPestanas).toBeGreaterThan(-1)
    expect(contexto).toBeGreaterThan(inicioPestanas)

    await ui.press({ key: 'pestana-flujo' })
    const [flujoPestanas, resumen] = await posiciones(n => n.type === 'Box' && n.key === 'flujo-resumen')
    expect(flujoPestanas).toBeGreaterThan(-1)
    expect(resumen).toBeGreaterThan(flujoPestanas)
    await ui.unmount()
  })

  test('el resumen del flujo va bajo Esfuerzo en Inicio', async ($, on) => {
    preparar(on)
    await $.session.measure(MEDIDA)

    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    const resumen = async () => {
      const arbol = await ui.findAll({})
      const i = arbol.findIndex(n => n.type === 'Box' && n.key === 'flujo-resumen')
      const esfuerzo = arbol.findIndex(n => n.type === 'Text' && n.text === 'Esfuerzo')
      const leyenda = arbol.findIndex(n => n.type === 'Text' && n.text === '■')
      const sesion = arbol.findIndex(n => n.type === 'Text' && n.text === 'Esta sesión')

      return { i, esfuerzo, leyenda, sesion, texto: arbol.slice(i).find(n => n.type === 'Text')?.text }
    }

    const sin = await resumen()
    expect(sin.texto).toBe('sin flujo en esta sesión')
    expect(sin.esfuerzo).toBeGreaterThan(-1)
    expect(sin.i).toBeGreaterThan(sin.esfuerzo)
    expect(sin.leyenda).toBeGreaterThan(sin.i)
    expect(sin.sesion).toBeGreaterThan(sin.i)

    // Los textos de la fila Esfuerzo caen entre el rótulo y el resumen, sin nada más en medio.
    const arbol = await ui.findAll({})
    const entre = arbol.slice(sin.esfuerzo + 1, sin.i).filter(n => n.type === 'Text')
    expect(entre.length).toBeGreaterThan(0)
    expect(entre.map(n => n.text).join('')).toMatch(/^ \S+( · .*)?$/)

    await $.skill.prompt({ skill: 'implementador', text: '' })
    expect((await resumen()).texto).toBe('/implementador · Preflight · 0 s')
    await ui.unmount()
  })

  test('Carpeta abre la carpeta desde la pestaña Flujo sin cambiar de pestaña', async ($, on) => {
    const { guardados } = preparar(on)
    const root = 'D:\\GitHub-Personal\\mods-claude'
    const { corridas, avisos } = motorCarpeta(on, root, {})
    await $.session.measure(MEDIDA)

    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await ui.press({ key: 'pestana-flujo' })
    expect(guardados.get('prefs:flujo')).toBe(true)

    await ui.press({ key: 'carpeta' })
    expect(corridas).toEqual([{ argv: WINDOWS, cwd: root }])
    expect(avisos).toEqual([])
    expect(guardados.get('prefs:flujo')).toBe(true)
    expect(await textosDe(ui)).not.toContain('Contexto')
    expect(await ui.find({ type: 'Button', key: 'pestana-inicio' })).toBeDefined()
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
    expect(await ui.find({ type: 'Button', key: 'pestana-inicio' })).toBeDefined()
    expect(await textosDe(ui)).not.toContain('Contexto')
    expect(await desdeResumen(ui, 1)).toEqual(['/implementador · Preflight · 0 s'])
    expect(await textosDe(ui)).toContain('Preflight')
    await ui.unmount()
  })

  test('la pestaña Flujo oculta el resto y lo restaura', async ($, on) => {
    const { guardados } = preparar(on)
    await $.session.measure(MEDIDA)

    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    const visibles = async () => {
      const textos = await textosDe(ui)

      return [textos.includes('Contexto'), textos.includes('Esta sesión'), Boolean(await ui.find({ type: 'Button', key: 'carpeta' }))]
    }
    // Inicio, el panel entero.
    expect(await visibles()).toEqual([true, true, true])

    // Abierta la pestaña no queda Contexto ni Esta sesión; Carpeta sigue, y el botón para volver, con su tecla.
    await ui.press({ key: 'pestana-flujo' })
    expect(await visibles()).toEqual([false, false, true])
    const boton = await ui.find({ type: 'Button', key: 'pestana-inicio' })
    expect(boton?.props.hotkey).toBe('i')
    expect(boton?.props.label).toBe('Inicio')
    expect(guardados.get('prefs:flujo')).toBe(true)

    await ui.press({ key: 'pestana-inicio' })
    expect(await visibles()).toEqual([true, true, true])
    expect(guardados.get('prefs:flujo')).toBe(false)
    await ui.unmount()
  })

  test('con prefs:flujo guardado en true, la pestaña abre sin «Contexto»', async ($, on) => {
    preparar(on, [], { 'prefs:flujo': true })
    on('session.model', () => ({ value: 'claude-opus-5-5' }))
    on('settings.read', () => ({ value: {} }))
    on('command.register', () => ({ value: undefined }))
    on('session.start', (_$, e) => ({ cwd: e.cwd }))
    on('ui.open', () => ({ value: { isPlaced: true } }))
    await $.session.start({ cwd: 'D:\\GitHub-Personal\\mods-claude' })

    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    const textos = await textosDe(ui)
    expect(await desdeResumen(ui, 1)).toEqual(['sin flujo en esta sesión'])
    expect(textos).not.toContain('Contexto')
    expect(textos).not.toContain('Esta sesión')
    await ui.unmount()
  })

  /**
   * Un flujo en Ejecución con 2 exploradores, planificador, revisor-plan, ejecutor y un revisor, con el orquestador en
   * `Sonnet 5.5 medium` (de longitud conocida), y la pestaña «Flujo» abierta con el ancho dado.
   */
  async function enEjecucion($: Engine, on: On, pane: typeof PANE | typeof PANE_ANCHO) {
    const { reloj } = preparar(on)
    on('turn.step', async function* (_$, e) {
      return {
        turnId: e.turnId,
        index: e.index,
        answer: 'ok',
        toolUses: [],
        stopReason: 'end_turn' as const,
        usage: { ...USO, model: e.model },
      }
    })
    await $.session.measure(MEDIDA)
    await $.skill.prompt({ skill: 'implementador', text: '' })
    await paso($, 'claude-sonnet-5-5', 'medium')
    await bash($, 'node ~/.claude/flujos/estado.mjs')
    reloj.t += 5_000
    await agente($, 'explorador', 'A')
    await agente($, 'explorador', 'B')
    reloj.t += 20_000
    await agente($, 'planificador')
    reloj.t += 3_000
    await agente($, 'revisor-plan')
    reloj.t += 2_000
    await preguntarPlan($)
    reloj.t += 1_000
    await bash($, 'node ~/.claude/flujos/estado.mjs --base')
    await agente($, 'ejecutor', 'E1')
    await agente($, 'revisor', 'R0')
    reloj.t += 60_000

    const ui = await $.ui.mount({ ...pane, surface: 'terminal' })
    await ui.press({ key: 'pestana-flujo' })

    return ui
  }

  test('bajo cada nodo van las líneas de detallePaso, con sangría de 2, tras su tiempo y antes del │', async ($, on) => {
    const ui = await enEjecucion($, on, PANE_ANCHO)
    const esperado = [
      '/implementador · Ejecución · 1 min 31 s',
      'orquestador Sonnet 5.5 medium',
      '✓ ',
      'Preflight',
      ' 5 s',
      '  orquestador Sonnet 5.5 medium',
      '  gasto 100k · sal 2k',
      '│',
      '✓ ',
      'Exploración',
      ' ×2',
      ' 0 s',
      '  2 exploradores · Haiku high',
      '│',
      '✓ ',
      'Plan',
      ' ×1',
      ' 23 s',
      '  planificador · Opus high',
      '│',
      '✓ ',
      'Revisión del plan',
      ' 2 s',
      '  revisor-plan · Sonnet medium',
      '│',
      '✓ ',
      'Aprobación',
      ' 1 s',
      '│',
      '▸ ',
      'Ejecución',
      ' ×1',
      ' · rev ×1',
      ' 1 min',
      '  ejecutor · Sonnet high',
      '  revisor · Sonnet high/medium',
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
    expect(await desdeResumen(ui, esperado.length)).toEqual(esperado)
    await ui.unmount()
  })

  for (const [columnas, pane] of [
    [32, PANE],
    [49, PANE_ANCHO],
  ] as const) {
    test(`las líneas de detalle van atenuadas y se truncan a ${columnas} columnas`, async ($, on) => {
      const ui = await enEjecucion($, on, pane)
      // Sangría de exactamente 2: las cifras del consumo, alineadas a la derecha, llevan más espacios.
      const detalles = (await ui.findAll({ type: 'Text' })).filter(n => /^ {2}\S/.test(n.text ?? ''))

      // Preflight, el gasto de Preflight, Exploración, Plan, Revisión del plan y las dos de Ejecución.
      expect(detalles).toHaveLength(7)
      for (const d of detalles) {
        expect(d.props.wrap).toBe('truncate-end')
        expect(d.props.dimColor).toBe(true)
        expect((d.text ?? '').length).toBeLessThanOrEqual(32)
      }
      await ui.unmount()
    })

    test(`la línea gasto de Preflight y de Ejecución (con un subagente) va atenuada y truncada a ${columnas} columnas`, async ($, on) => {
      const ui = await enEjecucion($, on, pane)
      // Un subagente responde dentro de Ejecución: suma ahí y no en Preflight.
      await paso($, 'claude-haiku-5-5', 'high', 'sub-1')
      const textos = await textosDe(ui)
      const gastos = (await ui.findAll({ type: 'Text' })).filter(n => /^ {2}gasto /.test(n.text ?? ''))

      expect(gastos.map(n => n.text)).toEqual(['  gasto 100k · sal 2k', '  gasto 100k · sal 2k'])
      for (const g of gastos) {
        expect(g.props.wrap).toBe('truncate-end')
        expect(g.props.dimColor).toBe(true)
        expect((g.text ?? '').length).toBeLessThanOrEqual(32)
      }
      // Preflight: tras su orquestador; Ejecución: tras las líneas de agente.
      expect(textos[textos.indexOf('  orquestador Sonnet 5.5 medium') + 1]).toBe('  gasto 100k · sal 2k')
      expect(textos[textos.indexOf('  revisor · Sonnet high/medium') + 1]).toBe('  gasto 100k · sal 2k')
      await ui.unmount()
    })
  }

  /**
   * Un flujo en Preflight con la pestaña «Flujo» abierta con el ancho dado. Cada `turn.step` responde con el modelo que pidió,
   * o con `responde` si se da; el agente que el test quiera tener en vuelo se retiene con `motor.detener`.
   */
  async function conEquipo($: Engine, on: On, pane: typeof PANE | typeof PANE_ANCHO, responde?: string) {
    const motor = preparar(on)
    on('turn.step', async function* (_$, e) {
      return {
        turnId: e.turnId,
        index: e.index,
        answer: 'ok',
        toolUses: [],
        stopReason: 'end_turn' as const,
        usage: { ...USO, model: responde ?? e.model },
      }
    })
    await $.session.measure(MEDIDA)
    await $.skill.prompt({ skill: 'implementador', text: '' })
    await bash($, 'node ~/.claude/flujos/estado.mjs')

    const ui = await $.ui.mount({ ...pane, surface: 'terminal' })
    await ui.press({ key: 'pestana-flujo' })

    return { motor, ui }
  }

  /** Lanza `tipo` con la `description` dada, lo deja en vuelo mientras corre `durante` y lo suelta. */
  async function enVuelo($: Engine, motor: ReturnType<typeof preparar>, tipo: string, description: string, durante: () => Promise<unknown>) {
    const abrir = motor.detener(description)
    const vuelo = agente($, tipo, description)
    await esperar()
    await durante()
    abrir()

    return vuelo
  }

  /** Del primer explorador al visto bueno del plan: el flujo queda a punto de ejecutar. */
  async function hastaEjecucion($: Engine) {
    await agente($, 'explorador', 'A')
    await agente($, 'planificador')
    await agente($, 'revisor-plan')
    await preguntarPlan($)
    await bash($, 'node ~/.claude/flujos/estado.mjs --base')
  }

  /** Un ejecutor que responde con sonnet high y vuelve, para dejar a Ejecución con su línea. */
  async function ejecutorObservado($: Engine, motor: ReturnType<typeof preparar>) {
    await enVuelo($, motor, 'ejecutor', 'E1', () => paso($, 'claude-sonnet-5-5', 'high', 'ag-E1'))
  }

  /** Dos revisores en vuelo a la vez, uno medium y otro high, cada uno con su `turn.step`. */
  async function dosRevisores($: Engine, motor: ReturnType<typeof preparar>) {
    const abrirR1 = motor.detener('R1')
    const abrirR2 = motor.detener('R2')
    const r1 = agente($, 'revisor', 'R1')
    const r2 = agente($, 'revisor', 'R2')
    await esperar()
    // Las configs salen en orden de aparición: primero responde R2 (high) y después R1 (medium).
    await paso($, 'claude-sonnet-5-5', 'high', 'ag-R2')
    await paso($, 'claude-sonnet-5-5', 'medium', 'ag-R1')

    return async () => {
      abrirR1()
      abrirR2()
      await Promise.all([r1, r2])
    }
  }

  test('Ejecución muestra el ejecutor y los revisores observados a 49', async ($, on) => {
    const { motor, ui } = await conEquipo($, on, PANE_ANCHO)
    await hastaEjecucion($)
    await ejecutorObservado($, motor)
    const soltar = await dosRevisores($, motor)

    const lineas = (await textosDe(ui)).filter(t => /^ {2}(ejecutor|revisor) /.test(t))
    expect(lineas).toEqual(['  ejecutor · Sonnet 5.5 high', '  revisor · Sonnet 5.5 high, medium'])
    for (const l of lineas) expect(l.length).toBeLessThanOrEqual(49)

    // Al volver los revisores, lo anotado sigue ahí.
    await soltar()
    expect((await textosDe(ui)).filter(t => /^ {2}(ejecutor|revisor) /.test(t))).toEqual(lineas)
    await ui.unmount()
  })

  test('y a 32 se acorta sin la versión', async ($, on) => {
    const { motor, ui } = await conEquipo($, on, PANE)
    await hastaEjecucion($)
    await ejecutorObservado($, motor)
    const soltar = await dosRevisores($, motor)

    const textos = await textosDe(ui)
    expect(textos).toContain('  revisor · Sonnet high, medium')
    const detalles = (await ui.findAll({ type: 'Text' })).filter(n => /^ {2}\S/.test(n.text ?? ''))
    expect(detalles.length).toBeGreaterThan(0)
    for (const d of detalles) expect((d.text ?? '').length).toBeLessThanOrEqual(32)
    await soltar()
    await ui.unmount()
  })

  test('planificador y revisor-plan observados', async ($, on) => {
    const { motor, ui } = await conEquipo($, on, PANE_ANCHO)
    await agente($, 'explorador', 'A')

    await enVuelo($, motor, 'planificador', 'P1', () => paso($, 'claude-opus-5-5', 'high', 'ag-P1'))
    expect(await textosDe(ui)).toContain('  planificador · Opus 5.5 high')

    await enVuelo($, motor, 'revisor-plan', 'RP1', () => paso($, 'claude-sonnet-5-5', 'medium', 'ag-RP1'))
    const textos = await textosDe(ui)
    expect(textos).toContain('  revisor-plan · Sonnet 5.5 medium')
    expect(textos).toContain('  planificador · Opus 5.5 high')
    await ui.unmount()
  })

  test('usa el modelo que respondió (usage.model)', async ($, on) => {
    // La petición salió como sonnet, pero respondió opus: la línea lleva el que respondió.
    const { motor, ui } = await conEquipo($, on, PANE_ANCHO, 'claude-opus-5-5')
    await hastaEjecucion($)
    await ejecutorObservado($, motor)

    const abrir = motor.detener('R1')
    const vuelo = agente($, 'revisor', 'R1')
    await esperar()
    await paso($, 'claude-sonnet-5-5', 'high', 'ag-R1')

    const textos = await textosDe(ui)
    expect(textos).toContain('  revisor · Opus 5.5 high')
    expect(textos).toContain('  ejecutor · Opus 5.5 high')
    abrir()
    await vuelo
    await ui.unmount()
  })

  test('el explorador con effort max se ve', async ($, on) => {
    const { motor, ui } = await enExploracion($, on, PANE_ANCHO)

    await exploradorConResultado($, motor, 'X', { agentId: 'agente-X', totalDurationMs: 200_000 }, () =>
      paso($, 'claude-haiku-5-5', 'max', 'agente-X'),
    )

    const lineas = (await lineasDeExploradores(ui)).filter(l => l.startsWith('  X · '))
    expect(lineas).toHaveLength(1)
    expect(lineas[0]).toMatch(/^ {2}X · Haiku max · /)
    expect(lineas[0]?.length).toBeLessThanOrEqual(49)
    await ui.unmount()
  })

  test('el orquestador no anota configs', async ($, on) => {
    const { motor, ui } = await conEquipo($, on, PANE_ANCHO)
    await hastaEjecucion($)

    const abrir = motor.detener('R1')
    const vuelo = agente($, 'revisor', 'R1')
    await esperar()
    // Sin agentId: es el hilo principal, no un revisor.
    await paso($, 'claude-opus-5-5', 'high')

    const textos = await textosDe(ui)
    expect(textos).toContain('  revisor · Sonnet high/medium')
    expect(textos.filter(t => /^ {2}revisor · /.test(t))).toEqual(['  revisor · Sonnet high/medium'])
    abrir()
    await vuelo
    await ui.unmount()
  })

  test('un turn.step de subagente que falla no se traga el error', async ($, on) => {
    const motor = preparar(on)
    const bajo = motorControlado(on, 'claude-sonnet-5-5')
    bajo.fallan.add('ag-R1')
    await $.session.measure(MEDIDA)
    await $.skill.prompt({ skill: 'implementador', text: '' })
    await bash($, 'node ~/.claude/flujos/estado.mjs')
    // El hilo principal responde antes (sin agentId) para que la fila de Esta sesión exista.
    await paso($, 'claude-sonnet-5-5', 'high')
    const ui = await $.ui.mount({ ...PANE_ANCHO, surface: 'terminal' })
    await ui.press({ key: 'pestana-flujo' })
    await hastaEjecucion($)

    const abrir = motor.detener('R1')
    const vuelo = agente($, 'revisor', 'R1')
    await esperar()
    const error = await paso($, 'claude-sonnet-5-5', 'high', 'ag-R1').then(
      () => null,
      (err: unknown) => err,
    )

    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toMatch(/turn\.step/)
    expect((error as Error).message).not.toMatch(/panel/i)

    // Sin respuesta no hay nada que anotar: la línea queda en el respaldo.
    expect(await textosDe(ui)).toContain('  revisor · Sonnet high/medium')

    // La actividad bajó: ningún ■ de la fila queda en curso.
    await ui.press({ key: 'pestana-inicio' })
    const colores = await coloresDe(ui, 'Sonnet 5.5 high')
    expect(colores.length).toBeGreaterThan(0)
    expect(colores).not.toContain('success')
    abrir()
    await vuelo
    await ui.unmount()
  })

  /** Las líneas `gasto …` de la pestaña, tal como se dibujan. */
  const lineasGasto = async (ui: Ui) => (await textosDe(ui)).filter(t => /^ {2}gasto /.test(t))

  test('una respuesta después de turn.complete no agrega ni cambia ninguna línea gasto', async ($, on) => {
    preparar(on)
    motorResponde(on, 'claude-opus-5-5')
    await $.session.measure(MEDIDA)
    const ui = await $.ui.mount({ ...PANE_ANCHO, surface: 'terminal' })
    await ui.press({ key: 'pestana-flujo' })

    await $.skill.prompt({ skill: 'implementador', text: '' })
    await paso($, 'claude-opus-5-5', 'high')
    expect(await lineasGasto(ui)).toEqual(['  gasto 100k · sal 2k'])

    await $.turn.complete(respuesta('CIERRE · x — COMPLETO'))
    const cerrado = await lineasGasto(ui)
    expect(cerrado).toEqual(['  gasto 100k · sal 2k'])
    await paso($, 'claude-opus-5-5', 'high')
    await paso($, 'claude-haiku-5-5', 'high', 'sub-1')
    expect(await lineasGasto(ui)).toEqual(cerrado)
    await ui.unmount()
  })

  test('sin uso en la respuesta no sale ninguna línea gasto', async ($, on) => {
    preparar(on)
    on('turn.step', async function* (_$, e) {
      return { turnId: e.turnId, index: e.index, answer: 'ok', toolUses: [], stopReason: 'end_turn' as const, usage: null }
    })
    await $.session.measure(MEDIDA)
    const ui = await $.ui.mount({ ...PANE_ANCHO, surface: 'terminal' })
    await ui.press({ key: 'pestana-flujo' })

    await $.skill.prompt({ skill: 'implementador', text: '' })
    await paso($, 'claude-opus-5-5', 'high')
    await paso($, 'claude-haiku-5-5', 'high', 'sub-1')
    expect(await lineasGasto(ui)).toEqual([])
    expect((await desdeResumen(ui, 1))[0]).toContain('/implementador')
    await ui.unmount()
  })

  test('si turn.step lanza un Error, paso() rechaza con el error del kit, no queda línea gasto y «Flujo» se dibuja', async ($, on) => {
    preparar(on)
    const fallo = new Error('petición caída')
    on('turn.step', async function* () {
      throw fallo
    })
    await $.session.measure(MEDIDA)
    const ui = await $.ui.mount({ ...PANE_ANCHO, surface: 'terminal' })
    await ui.press({ key: 'pestana-flujo' })

    await $.skill.prompt({ skill: 'implementador', text: '' })
    const visto = await paso($, 'claude-opus-5-5', 'high').then(
      () => null,
      (e: unknown) => e,
    )
    // El kit de pruebas convierte el fallo del motor de abajo en su propio error («no implementation
    // for turn.step»), así que el objeto lanzado no llega: el hook lo deja pasar sin envolverlo ni tragarlo.
    expect(visto).toBeInstanceOf(Error)
    expect((visto as Error).message).toMatch(/turn\.step/)
    expect((visto as Error).message).not.toMatch(/panel/i)
    expect(await lineasGasto(ui)).toEqual([])
    expect((await desdeResumen(ui, 1))[0]).toContain('/implementador')
    await ui.unmount()
  })

  test('/implementador de punta a punta: el diagrama marca cada paso con su tiempo y termina en Terminado', async ($, on) => {
    const pedidos: string[] = []
    const { detener, reloj } = preparar(on, pedidos)
    await $.session.measure(MEDIDA)
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await ui.press({ key: 'pestana-flujo' })
    const antes = pedidos.length

    await $.skill.prompt({ skill: 'implementador', text: '**Pedido:** algo' })
    await bash($, 'node ~/.claude/flujos/estado.mjs')
    reloj.t += 5_000
    const abrir = detener('explorador')
    const corriendo = agente($, 'explorador')
    await esperar()
    reloj.t += 20_000
    abrir()
    await corriendo
    reloj.t += 3_000
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
    reloj.t += 60_000
    await bash($, 'node ~/.claude/flujos/estado.mjs --base')
    reloj.t += 90_000
    // El paso en curso se refresca con el próximo evento (otro `--base` en Ejecución no cambia el paso).
    await bash($, 'node ~/.claude/flujos/estado.mjs --base')

    expect(await desdeResumen(ui, FLUJO_EJECUCION.length)).toEqual(FLUJO_EJECUCION)

    reloj.t += 30_000
    await $.turn.complete(respuesta('CIERRE · x — COMPLETO'))
    const tramo = await desdeResumen(ui, FLUJO_EJECUCION.length + 1)
    expect(tramo.slice(0, 1)).toEqual(['/implementador · Terminado · 3 min 28 s'])
    expect(tramo.slice(1, 4)).toEqual(['✓ ', 'Preflight', ' 5 s'])
    // Ejecución cerró con 90 s + 30 s; «Terminado» lleva el total de principio a fin.
    expect(tramo.slice(tramo.indexOf('Ejecución') - 1, tramo.indexOf('Ejecución') + 2)).toEqual(['✓ ', 'Ejecución', ' 2 min'])
    expect(tramo.slice(-3)).toEqual(['● ', 'Terminado', ' 3 min 28 s'])
    // Nada del flujo llama al modelo ni a $.session.usage.
    expect(pedidos).toHaveLength(antes)
    await ui.unmount()
  })

  test('el paso en curso se refresca con el evento siguiente, no antes; plegada, la línea resumen ya trae el total', async ($, on) => {
    const { reloj } = preparar(on)
    await $.skill.prompt({ skill: 'implementador', text: '' })

    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect(await desdeResumen(ui, 1)).toEqual(['/implementador · Preflight · 0 s'])

    // Sin eventos el dibujo no cambia (hasta el tick de 30 s); con uno, se pone al día.
    reloj.t += 45_000
    expect((await desdeResumen(ui, 1))[0]).toBe('/implementador · Preflight · 0 s')
    await bash($, 'node ~/.claude/flujos/estado.mjs')
    expect((await desdeResumen(ui, 1))[0]).toBe('/implementador · Preflight · 45 s')

    // En Inicio no hay nodos: ningún tiempo suelto fuera de la línea resumen.
    expect(await textosDe(ui)).not.toContain(' 45 s')
    await ui.press({ key: 'pestana-flujo' })
    reloj.t += 15_000
    await bash($, 'node ~/.claude/flujos/estado.mjs')
    expect(await desdeResumen(ui, 4)).toEqual(['/implementador · Preflight · 1 min', '▸ ', 'Preflight', ' 1 min'])
    await ui.unmount()
  })

  test('cada nodo lleva su tiempo a la derecha: etiqueta que cede y tiempo que no se trunca', async ($, on) => {
    const { reloj } = preparar(on)
    await $.skill.prompt({ skill: 'implementador', text: '' })
    reloj.t += 4_000
    await agente($, 'planificador')

    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await ui.press({ key: 'pestana-flujo' })
    const arbol = await ui.findAll({})
    const iEtiqueta = arbol.findIndex(n => n.type === 'Text' && n.text === 'Preflight')
    const etiqueta = arbol[iEtiqueta]
    const tiempo = arbol[iEtiqueta + 1]

    expect(tiempo?.text).toBe(' 4 s')
    expect(etiqueta?.props.wrap).toBe('truncate-end')
    expect(tiempo?.props.wrap).toBeUndefined()
    // La etiqueta va en un Box que crece; el tiempo, fuera de él.
    const caja = arbol.slice(0, iEtiqueta).reverse().find(n => n.type === 'Box')
    expect(caja?.props.flexGrow).toBe(1)
    // El paso que nunca corrió (Exploración) no lleva tiempo.
    const textos = await textosDe(ui)
    expect(textos.slice(textos.indexOf('Exploración'), textos.indexOf('Exploración') + 2)).toEqual(['Exploración', '│'])
    await ui.unmount()
  })

  test('mientras corre el explorador el paso es Exploración; al volver, Plan', async ($, on) => {
    const motor = preparar(on)
    await $.skill.prompt({ skill: 'implementador', text: '' })
    await bash($, 'node ~/.claude/flujos/estado.mjs')

    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect(await desdeResumen(ui, 1)).toEqual(['/implementador · Preflight · 0 s'])

    const abrir = motor.detener('explorador')
    const corriendo = agente($, 'explorador')
    await esperar()
    expect(await desdeResumen(ui, 1)).toEqual(['/implementador · Exploración · 0 s'])

    abrir()
    await corriendo
    expect(await desdeResumen(ui, 1)).toEqual(['/implementador · Plan · 0 s'])
    await ui.unmount()
  })

  test('skill.prompt y tool.call pasan intactos: mismo texto y mismo resultado', async ($, on) => {
    const motor = preparar(on)

    const texto = '**Pedido:** arreglar el panel\n\nsegunda línea'
    expect(await $.skill.prompt({ skill: 'implementador', text: texto })).toEqual({ text: texto })
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
    expect(await desdeResumen(ui, 1)).toEqual(['/implementador · Exploración · 0 s'])
    await ui.unmount()
  })

  /** Un flujo en Exploración con la pestaña «Flujo» abierta con el ancho dado y cada `turn.step` gastando USO. */
  async function enExploracion($: Engine, on: On, pane: typeof PANE | typeof PANE_ANCHO) {
    const motor = preparar(on)
    on('turn.step', async function* (_$, e) {
      return {
        turnId: e.turnId,
        index: e.index,
        answer: 'ok',
        toolUses: [],
        stopReason: 'end_turn' as const,
        usage: { ...USO, model: e.model },
      }
    })
    await $.session.measure(MEDIDA)
    await $.skill.prompt({ skill: 'implementador', text: '' })
    await bash($, 'node ~/.claude/flujos/estado.mjs')

    const ui = await $.ui.mount({ ...pane, surface: 'terminal' })
    await ui.press({ key: 'pestana-flujo' })

    return { motor, ui }
  }

  /** Las líneas de explorador que dibuja la pestaña: sangría de 2 y la config `Haiku high` si cabe, o sus cifras. */
  const lineasDeExploradores = async (ui: Ui) =>
    (await textosDe(ui)).filter(t => /^ {2}\S/.test(t) && !/^ {2}(gasto|orquestador) /.test(t))

  /**
   * Un explorador de `description` que vuelve con `agentId`: su `Agent` espera, `antes` corre mientras tanto
   * (los `turn.step` y spawns que el test quiera) y al final el resultado vuelve.
   */
  async function exploradorConResultado(
    $: Engine,
    motor: ReturnType<typeof preparar>,
    description: string,
    resultado: { agentId: string; totalDurationMs: number },
    antes: () => Promise<unknown>,
  ) {
    motor.resultados.set(description, resultado)
    const abrir = motor.detener(description)
    const vuelo = agente($, 'explorador', description)
    await esperar()
    await antes()
    abrir()

    return vuelo
  }

  test('un explorador con turn.step antes de su resultado de Agent dibuja su línea a 49', async ($, on) => {
    const { motor, ui } = await enExploracion($, on, PANE_ANCHO)

    await exploradorConResultado($, motor, 'Explorar register.tsx', { agentId: 'agente-A', totalDurationMs: 200_000 }, () =>
      paso($, 'claude-haiku-5-5', 'high', 'agente-A'),
    )

    const lineas = await lineasDeExploradores(ui)
    expect(lineas).toEqual(['  register.tsx · Haiku high · 3 min 20 s · 100k'])
    expect(lineas[0]?.length).toBeLessThanOrEqual(49)
    await ui.unmount()
  })

  test('a 32 columnas el recorte cae en la descripción y las cifras quedan enteras', async ($, on) => {
    const { motor, ui } = await enExploracion($, on, PANE)

    await exploradorConResultado($, motor, 'Explorar la lógica de los hooks del panel', { agentId: 'agente-A', totalDurationMs: 200_000 }, () =>
      paso($, 'claude-haiku-5-5', 'high', 'agente-A'),
    )

    const lineas = await lineasDeExploradores(ui)
    expect(lineas).toEqual(['  la lógica… · 3 min 20 s · 100k'])
    expect(lineas[0]?.length).toBeLessThanOrEqual(32)
    await ui.unmount()
  })

  test('dos exploradores y solo uno con agentId: el paso cae a la línea con el total', async ($, on) => {
    const { motor, ui } = await enExploracion($, on, PANE_ANCHO)

    await exploradorConResultado($, motor, 'Explorar A', { agentId: 'agente-A', totalDurationMs: 200_000 }, () =>
      paso($, 'claude-haiku-5-5', 'high', 'agente-A'),
    )
    // El segundo vuelve sin `agentId` (el resultado de siempre): no hay forma de anotarlo.
    await agente($, 'explorador', 'Explorar B')

    expect(await lineasDeExploradores(ui)).toEqual(['  2 exploradores · Haiku high'])
    await ui.unmount()
  })

  test('el resultado de Agent vuelve tal cual y su error sigue rechazando con el hook nuevo', async ($, on) => {
    const { motor, ui } = await enExploracion($, on, PANE_ANCHO)

    motor.resultados.set('Explorar A', { agentId: 'agente-A', totalDurationMs: 1_000 })
    expect(await agente($, 'explorador', 'Explorar A')).toEqual({ result: 'listo', agentId: 'agente-A', totalDurationMs: 1_000 })
    expect(await agente($, 'explorador', 'Explorar sin datos')).toEqual({ result: 'listo' })

    motor.resultados.set('Explorar B', { agentId: 'agente-B', totalDurationMs: 2_000 })
    motor.fallan.add('Explorar B')
    const error = await agente($, 'explorador', 'Explorar B').then(
      () => null,
      (err: unknown) => err,
    )

    // El kit convierte el fallo del motor de abajo en su propio error: el hook del panel no lo envuelve ni lo traga.
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).not.toMatch(/panel/i)
    // El explorador que falló no deja línea; los otros dos no tienen todos descripción y el paso muestra el total.
    expect(await lineasDeExploradores(ui)).toEqual(['  3 exploradores · Haiku high'])
    await ui.unmount()
  })

  test('un flujo 0.16.0 sin detalleExploradores se dibuja tras recargar con la línea total', async ($, on) => {
    on('session.model', () => ({ value: 'claude-opus-5-5' }))
    on('settings.read', () => ({ value: {} }))
    on('command.register', () => ({ value: undefined }))
    on('session.start', (_$, e) => ({ cwd: e.cwd }))
    on('ui.open', () => ({ value: { isPlaced: true } }))
    const { ui } = await enExploracion($, on, PANE_ANCHO)

    // Sin `agentId` ni gasto de subagente el atom no gana `detalleExploradores`: es la forma de 0.16.0.
    await agente($, 'explorador', 'Explorar A')
    await agente($, 'explorador', 'Explorar B')
    await $.session.start({ cwd: 'D:\\GitHub-Personal\\mods-claude' })

    expect(await lineasDeExploradores(ui)).toEqual(['  2 exploradores · Haiku high'])
    await ui.unmount()
  })

  /** El lanzamiento de un subagente, como lo pide el motor antes de arrancarlo; `llamada` es el `tool_use_id` del `Agent` que lo lanza. */
  const lanzar = ($: Engine, description: string, subagentType = 'explorador', llamada = `tu-${description}`) =>
    $.agent.spawn({ tool_use_id: llamada, prompt: 'prueba', description, subagentType })

  /** Un `Agent` explorador retenido en vuelo: lanza su spawn con el `tool_use_id` de la llamada, corre `ms` y suelta la herramienta. */
  async function exploradorEnVuelo($: Engine, motor: ReturnType<typeof preparar>, description: string, ms: number) {
    const abrir = motor.detener(description)
    const vuelo = agente($, 'explorador', description)
    await esperar()
    await lanzar($, description, 'explorador', motor.idsDeLlamada.get(description))
    motor.reloj.t += ms
    abrir()

    return vuelo
  }

  test('spawn antes y después del primer turn.step dan la misma línea', async ($, on) => {
    const { motor, ui } = await enExploracion($, on, PANE_ANCHO)
    motor.agentIds.set('Explorar X', 'agente-X')
    motor.agentIds.set('Explorar Y', 'agente-Y')

    // X: primero el spawn y luego su primera petición. Y: al revés. En vuelo, la línea ya lleva su tiempo desde el spawn.
    await exploradorConResultado($, motor, 'Explorar X', { agentId: 'agente-X', totalDurationMs: 60_000 }, async () => {
      await lanzar($, 'Explorar X')
      await paso($, 'claude-haiku-5-5', 'high', 'agente-X')
      motor.reloj.t += 5_000
      expect(await lineasDeExploradores(ui)).toEqual(['  X · Haiku high · 5 s · 100k'])
    })
    await exploradorConResultado($, motor, 'Explorar Y', { agentId: 'agente-Y', totalDurationMs: 60_000 }, async () => {
      await paso($, 'claude-haiku-5-5', 'high', 'agente-Y')
      await lanzar($, 'Explorar Y')
      motor.reloj.t += 5_000
      expect(await lineasDeExploradores(ui)).toEqual(['  X · Haiku high · 1 min · 100k', '  Y · Haiku high · 5 s · 100k'])
    })

    expect(await lineasDeExploradores(ui)).toEqual(['  X · Haiku high · 1 min · 100k', '  Y · Haiku high · 1 min · 100k'])
    await ui.unmount()
  })

  test('agent.spawn deja pasar deny y el error de next', async ($, on) => {
    const { motor, ui } = await enExploracion($, on, PANE_ANCHO)
    motor.agentIds.set('Explorar N', 'agente-N')
    motor.negados.add('Explorar N')
    motor.spawnFallan.add('Explorar F')

    // La negativa del motor llega tal cual, sin el hook de por medio.
    expect(await lanzar($, 'Explorar N')).toEqual({ deny: 'negado por el motor' })

    const error = await lanzar($, 'Explorar F').then(
      () => null,
      (err: unknown) => err,
    )
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).not.toMatch(/panel/i)

    // Ninguno de los dos dejó un explorador anotado: el siguiente solo ve el suyo.
    motor.agentIds.set('Explorar OK', 'agente-OK')
    await exploradorConResultado($, motor, 'Explorar OK', { agentId: 'agente-OK', totalDurationMs: 60_000 }, () => lanzar($, 'Explorar OK'))
    expect(await lineasDeExploradores(ui)).toEqual(['  OK · Haiku high · 1 min'])
    await ui.unmount()
  })

  /** Solo las líneas de exploradores (Haiku): en Plan y Ejecución la pestaña también dibuja las de los otros subagentes. */
  const lineasDeHaiku = async (ui: Ui) => (await lineasDeExploradores(ui)).filter(t => t.includes(' · Haiku'))

  test('un explorador cuyo Agent falla deja fija su cifra de tiempo aunque el flujo siga en Plan y Ejecución', async ($, on) => {
    const { motor, ui } = await enExploracion($, on, PANE_ANCHO)
    motor.agentIds.set('Explorar F', 'agente-F')

    motor.fallan.add('Explorar F')
    const error = await exploradorEnVuelo($, motor, 'Explorar F', 5_000).then(
      () => null,
      (err: unknown) => err,
    )

    // El error de `next` llega intacto y la línea queda con lo que tardó hasta el fallo.
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).not.toMatch(/panel/i)
    expect(await lineasDeExploradores(ui)).toEqual(['  F · Haiku high · 5 s'])

    // El reloj sigue corriendo por Plan y Ejecución: la cifra del explorador no crece.
    motor.reloj.t += 60_000
    await agente($, 'planificador')
    motor.reloj.t += 60_000
    expect(await lineasDeHaiku(ui)).toEqual(['  F · Haiku high · 5 s'])
    await bash($, 'node ~/.claude/flujos/estado.mjs --base')
    motor.reloj.t += 60_000
    expect(await lineasDeHaiku(ui)).toEqual(['  F · Haiku high · 5 s'])
    await ui.unmount()
  })

  test('un explorador cuyo Agent vuelve sin agentId deja fija su cifra de tiempo aunque el flujo siga en Plan y Ejecución', async ($, on) => {
    const { motor, ui } = await enExploracion($, on, PANE_ANCHO)
    motor.agentIds.set('Explorar G', 'agente-G')

    // Sin entrada en `resultados`, el Agent vuelve sin `agentId` ni duración.
    expect(await exploradorEnVuelo($, motor, 'Explorar G', 5_000)).toEqual({ result: 'listo' })
    expect(await lineasDeExploradores(ui)).toEqual(['  G · Haiku high · 5 s'])

    motor.reloj.t += 60_000
    await agente($, 'planificador')
    motor.reloj.t += 60_000
    expect(await lineasDeHaiku(ui)).toEqual(['  G · Haiku high · 5 s'])
    await bash($, 'node ~/.claude/flujos/estado.mjs --base')
    motor.reloj.t += 60_000
    expect(await lineasDeHaiku(ui)).toEqual(['  G · Haiku high · 5 s'])
    await ui.unmount()
  })

  /** Una `AskUserQuestion` con el header «Plan», como la que abre la Aprobación. */
  const preguntarPlan = ($: Engine) =>
    $.tool.call({
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

  /** Los `n` textos que empiezan en el glifo del nodo «Terminado» (el último del diagrama). */
  const deTerminado = (textos: string[], n: number) => {
    const i = textos.findIndex(t => t.startsWith('Terminado'))

    return textos.slice(i - 1, i - 1 + n)
  }

  test('la espera de AskUserQuestion va aparte: Aprobación y Terminado con « · espera», la línea plegada solo con el trabajo y el resultado intacto', async ($, on) => {
    const { detener, reloj } = preparar(on)
    await $.skill.prompt({ skill: 'implementador', text: '' })

    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await ui.press({ key: 'pestana-flujo' })

    reloj.t += 5_000
    const responder = detener('AskUserQuestion')
    const pregunta = preguntarPlan($)
    await esperar()
    reloj.t += 120_000
    responder()
    expect((await pregunta).result).toBe('listo')

    reloj.t += 10_000
    await bash($, 'node ~/.claude/flujos/estado.mjs --base')
    reloj.t += 30_000
    await $.turn.complete(respuesta('CIERRE · x — COMPLETO'))

    const textos = await textosDe(ui)
    const despues = (etiqueta: string, n: number) => textos.slice(textos.indexOf(etiqueta) + 1, textos.indexOf(etiqueta) + 1 + n)
    expect(despues('Aprobación', 3)).toEqual([' 10 s', ' · espera 2 min', '│'])
    expect(despues('Ejecución', 2)).toEqual([' 30 s', '│'])
    expect(deTerminado(textos, 4)).toEqual(['● ', 'Terminado', ' 45 s', ' · espera 2 min'])
    expect((await desdeResumen(ui, 1))[0]).toBe('/implementador · Terminado · 45 s')

    // En Inicio, solo queda la línea con el trabajo.
    await ui.press({ key: 'pestana-inicio' })
    expect(await desdeResumen(ui, 1)).toEqual(['/implementador · Terminado · 45 s'])
    expect((await textosDe(ui)).some(t => t.includes('espera'))).toBe(false)
    await ui.unmount()
  })

  test('una pregunta que responde al instante no dibuja espera', async ($, on) => {
    const { reloj } = preparar(on)
    await $.skill.prompt({ skill: 'implementador', text: '' })

    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await ui.press({ key: 'pestana-flujo' })
    reloj.t += 5_000
    await preguntarPlan($)
    reloj.t += 10_000
    await bash($, 'node ~/.claude/flujos/estado.mjs --base')

    expect((await textosDe(ui)).some(t => t.includes('espera'))).toBe(false)
    expect((await desdeResumen(ui, 1))[0]).toBe('/implementador · Ejecución · 15 s')
    await ui.unmount()
  })

  test('Escape con la pregunta abierta: Terminado · interrumpido con la espera hasta ese momento; la vuelta tardía con error llega intacta y no cambia nada', async ($, on) => {
    const { detener, fallan, reloj } = preparar(on)
    await $.skill.prompt({ skill: 'implementador', text: '' })

    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await ui.press({ key: 'pestana-flujo' })

    reloj.t += 5_000
    const responder = detener('AskUserQuestion')
    fallan.add('AskUserQuestion')
    const pregunta = preguntarPlan($).then(
      () => null,
      (err: unknown) => err,
    )
    await esperar()
    reloj.t += 60_000
    await $.turn.complete(respuesta('', { reason: 'aborted' }))

    const final = ['● ', 'Terminado · interrumpido', ' 5 s', ' · espera 1 min']
    const linea = '/implementador · Terminado · interrumpido · 5 s'
    expect((await desdeResumen(ui, 1))[0]).toBe(linea)
    expect(deTerminado(await textosDe(ui), 4)).toEqual(final)

    // La pregunta vuelve tarde, con error: el error llega intacto y el flujo no cambia.
    reloj.t += 30_000
    responder()
    const error = await pregunta
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).not.toMatch(/panel/i)
    expect((await desdeResumen(ui, 1))[0]).toBe(linea)
    expect(deTerminado(await textosDe(ui), 4)).toEqual(final)
    await ui.unmount()
  })

  test('tres exploradores en paralelo: el paso sigue en Exploración hasta que vuelve el último, en cualquier orden', async ($, on) => {
    const motor = preparar(on)
    await $.skill.prompt({ skill: 'implementador', text: '' })
    await bash($, 'node ~/.claude/flujos/estado.mjs')

    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    const abrirA = motor.detener('A')
    const abrirB = motor.detener('B')
    const abrirC = motor.detener('C')
    const a = agente($, 'explorador', 'A')
    const b = agente($, 'explorador', 'B')
    const c = agente($, 'explorador', 'C')
    await esperar()
    expect(await desdeResumen(ui, 1)).toEqual(['/implementador · Exploración · 0 s'])

    abrirB()
    await b
    expect(await desdeResumen(ui, 1)).toEqual(['/implementador · Exploración · 0 s'])

    abrirA()
    await a
    expect(await desdeResumen(ui, 1)).toEqual(['/implementador · Exploración · 0 s'])

    abrirC()
    await c
    expect(await desdeResumen(ui, 1)).toEqual(['/implementador · Plan · 0 s'])
    await ui.unmount()
  })

  test('Exploración muestra cuántos exploradores se lanzaron: ×3 en paralelo, ×4 con otra tanda y sigue tras Terminado', async ($, on) => {
    const motor = preparar(on)
    await $.session.measure(MEDIDA)
    await $.skill.prompt({ skill: 'implementador', text: '' })
    await bash($, 'node ~/.claude/flujos/estado.mjs')

    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await ui.press({ key: 'pestana-flujo' })
    const tras = async (etiqueta: string, n: number) => {
      const textos = await textosDe(ui)
      const i = textos.indexOf(etiqueta)

      return textos.slice(i + 1, i + 1 + n)
    }

    const abrirA = motor.detener('A')
    const abrirB = motor.detener('B')
    const abrirC = motor.detener('C')
    const a = agente($, 'explorador', 'A')
    const b = agente($, 'explorador', 'B')
    const c = agente($, 'explorador', 'C')
    await esperar()
    expect((await tras('Exploración', 1))[0]).toBe(' ×3')

    abrirA()
    abrirB()
    abrirC()
    await Promise.all([a, b, c])
    await agente($, 'explorador', 'D')
    expect((await tras('Exploración', 1))[0]).toBe(' ×4')

    await $.turn.complete(respuesta('CIERRE · x — COMPLETO'))
    const despues = await tras('Exploración', 2)
    expect(despues[0]).toBe(' ×4')
    expect(despues[1]).toMatch(/^ \d+ (s|min)/)
    await ui.unmount()
  })

  test('/implementador: Plan ×2, Ejecución ×2 (con una que falla) y rev ×N donde corrieron; siguen tras Terminado y no van en la línea plegada', async ($, on) => {
    const motor = preparar(on)
    await $.session.measure(MEDIDA)
    await $.skill.prompt({ skill: 'implementador', text: '' })
    await bash($, 'node ~/.claude/flujos/estado.mjs')

    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await ui.press({ key: 'pestana-flujo' })
    const tras = async (etiqueta: string, n: number) => {
      const textos = await textosDe(ui)
      const i = textos.indexOf(etiqueta)

      return textos.slice(i + 1, i + 1 + n)
    }
    const comprobar = async () => {
      expect(await tras('Plan', 1)).toEqual([' ×2'])
      expect(await tras('Ejecución', 2)).toEqual([' ×2', ' · rev ×1'])
      expect(await tras('Verificación final', 1)).toEqual([' · rev ×2'])
    }

    await agente($, 'planificador')
    await agente($, 'planificador')
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
    await agente($, 'ejecutor', 'E1')

    // La corrección falla: el error llega intacto y el lanzamiento cuenta igual.
    motor.fallan.add('E2')
    const error = await agente($, 'ejecutor', 'E2').then(
      () => null,
      (err: unknown) => err,
    )
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).not.toMatch(/panel/)

    await agente($, 'revisor', 'R0')
    await bash($, 'node ~/.claude/flujos/verificar.mjs')

    // Dos revisores en paralelo en la verificación final.
    const abrirR1 = motor.detener('R1')
    const abrirR2 = motor.detener('R2')
    const r1 = agente($, 'revisor', 'R1')
    const r2 = agente($, 'revisor', 'R2')
    await esperar()
    abrirR1()
    abrirR2()
    await Promise.all([r1, r2])
    await comprobar()

    await $.turn.complete(respuesta('CIERRE · x — COMPLETO'))
    await comprobar()
    expect((await desdeResumen(ui, 1))[0]).not.toContain('×')

    // En Inicio, ni la línea resumen ni nada más lleva los contadores.
    await ui.press({ key: 'pestana-inicio' })
    const plegada = await textosDe(ui)
    expect(plegada).not.toContain(' ×2')
    expect(plegada).not.toContain(' · rev ×1')
    expect((await desdeResumen(ui, 1))[0]).not.toContain('×')
    await ui.unmount()
  })

  test('si uno de varios exploradores falla, su error llega intacto y al volver el último el paso pasa a Plan', async ($, on) => {
    const motor = preparar(on)
    await $.skill.prompt({ skill: 'implementador', text: '' })

    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    const abrirA = motor.detener('A')
    const abrirB = motor.detener('B')
    motor.fallan.add('B')
    const a = agente($, 'explorador', 'A')
    const b = agente($, 'explorador', 'B').then(
      () => null,
      (err: unknown) => err,
    )
    await esperar()

    abrirA()
    await a
    expect(await desdeResumen(ui, 1)).toEqual(['/implementador · Exploración · 0 s'])

    // B es el último en volver y vuelve con error: cuenta como vuelto y el paso avanza.
    abrirB()
    const error = await b
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).not.toMatch(/panel/i)
    expect(await desdeResumen(ui, 1)).toEqual(['/implementador · Plan · 0 s'])
    await ui.unmount()
  })

  test('si fallan todos los exploradores en paralelo, el paso queda en Exploración', async ($, on) => {
    const motor = preparar(on)
    await $.skill.prompt({ skill: 'implementador', text: '' })

    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    const abrirA = motor.detener('A')
    const abrirB = motor.detener('B')
    motor.fallan.add('A')
    motor.fallan.add('B')
    const falla = (p: Promise<unknown>) =>
      p.then(
        () => null,
        (err: unknown) => err,
      )
    const a = falla(agente($, 'explorador', 'A'))
    const b = falla(agente($, 'explorador', 'B'))
    await esperar()

    abrirA()
    abrirB()
    expect(await a).toBeInstanceOf(Error)
    expect(await b).toBeInstanceOf(Error)
    expect(await desdeResumen(ui, 1)).toEqual(['/implementador · Exploración · 0 s'])
    await ui.unmount()
  })

  test('turn.complete de un subagente no termina el flujo; uno abortado muestra Terminado · interrumpido', async ($, on) => {
    preparar(on)
    await $.skill.prompt({ skill: 'implementador', text: '' })

    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await ui.press({ key: 'pestana-flujo' })
    await $.turn.complete(respuesta('CIERRE · x — COMPLETO', { agentId: 'agente-1' }))
    expect((await desdeResumen(ui, 1))[0]).toBe('/implementador · Preflight · 0 s')

    await $.turn.complete(respuesta('', { reason: 'aborted' }))
    expect((await desdeResumen(ui, 1))[0]).toBe('/implementador · Terminado · interrumpido · 0 s')
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

    expect(await desdeResumen(ui, 1)).toEqual(['sin flujo en esta sesión'])
    await ui.unmount()
  })

  test('session.end borra el flujo', async ($, on) => {
    preparar(on)
    on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
    await $.skill.prompt({ skill: 'implementador', text: '' })

    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect((await desdeResumen(ui, 1))[0]).toBe('/implementador · Preflight · 0 s')

    await $.session.end({ reason: 'other', sessionId: 's1', resume: { id: 's1' } })
    expect(await desdeResumen(ui, 1)).toEqual(['sin flujo en esta sesión'])
    await ui.unmount()
  })

  const HAIKU = 'claude-haiku-5-5'
  const FILA_EXPLORADOR = 'Haiku 5.5 high'

  /**
   * Los `color` de todos los ■ seguidos que siguen a la etiqueta de la fila, en orden (el del principal
   * primero si la fila lo tiene), y si tras ellos viene la cifra de total. La etiqueta se compara sin el
   * relleno final; principal y subagente van unidos en una fila, así que es única.
   */
  const cuadradosDe = async (ui: Ui, etiqueta: string) => {
    const arbol = await ui.findAll({})
    const i = arbol.findIndex(n => n.type === 'Text' && (n.text ?? '').trimEnd() === etiqueta)
    const colores: unknown[] = []
    let j = i + 1
    while (i !== -1 && arbol[j]?.type === 'Text' && arbol[j]?.text === ' ■') colores.push(arbol[j++]?.props.color)

    return { colores, total: /^ *\d/.test(arbol[j]?.text ?? ''), juntos: arbol.some(n => n.type === 'Text' && n.text === '■■■') }
  }

  /**
   * Un flujo en Exploración con tres exploradores en vuelo (A, B y C retenidos) y una petición completa
   * del modelo de un subagente, que crea la fila de «Esta sesión».
   */
  async function explorando($: Engine, on: On) {
    // Con `mock.clock` (hora fija): el `clock.every` de `preparar` deja el panel sin responder tras un session.start con llamadas retenidas.
    mock.clock(on, { now: AHORA })
    motorMide(on)
    motorUsa(on)
    on('session.id', () => ({ value: 's1' }))
    motorStore(on)
    const motor = motorFlujo(on)
    const modelo = motorControlado(on, HAIKU)
    on('session.model', () => ({ value: 'claude-opus-5-5' }))
    on('settings.read', () => ({ value: {} }))
    on('command.register', () => ({ value: undefined }))
    on('session.start', (_$, e) => ({ cwd: e.cwd }))
    on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
    on('ui.open', () => ({ value: { isPlaced: true } }))
    await $.session.measure(MEDIDA)
    await $.skill.prompt({ skill: 'implementador', text: '' })
    await bash($, 'node ~/.claude/flujos/estado.mjs')

    const ui = await $.ui.mount({ ...PANE_ANCHO, surface: 'terminal' })
    const abrir = { A: motor.detener('A'), B: motor.detener('B'), C: motor.detener('C') }
    const vuelos = { A: agente($, 'explorador', 'A'), B: agente($, 'explorador', 'B'), C: agente($, 'explorador', 'C') }
    await esperar()
    await paso($, HAIKU, 'high', 'agente-A')

    return { ui, motor, modelo, abrir, vuelos }
  }

  test('la fila de los exploradores lleva un ■ por explorador en vuelo y vuelve a uno', async ($, on) => {
    const { ui, modelo, abrir, vuelos } = await explorando($, on)
    await paso($, HAIKU, 'high')

    // Fila unida: el ■ del principal (uno) y luego los de los tres exploradores.
    let fila = await cuadradosDe(ui, FILA_EXPLORADOR)
    expect(fila.colores).toEqual(['subtle', 'subtle', 'subtle', 'subtle'])
    expect(fila.total).toBe(true)
    expect(fila.juntos).toBe(false)

    // Otra petición del subagente en vuelo: sus tres ■ cambian y el del principal no.
    const abrirPeticion = modelo.detener('agente-A')
    const peticion = paso($, HAIKU, 'high', 'agente-A')
    await esperar()
    fila = await cuadradosDe(ui, FILA_EXPLORADOR)
    expect(fila.colores).toEqual(['subtle', 'success', 'success', 'success'])

    abrir.B()
    await vuelos.B
    expect((await cuadradosDe(ui, FILA_EXPLORADOR)).colores).toEqual(['subtle', 'success', 'success'])

    abrir.A()
    abrir.C()
    await Promise.all([vuelos.A, vuelos.C])
    expect((await cuadradosDe(ui, FILA_EXPLORADOR)).colores).toEqual(['subtle', 'success'])

    abrirPeticion()
    await peticion
    expect((await cuadradosDe(ui, FILA_EXPLORADOR)).colores).toEqual(['subtle', 'subtle'])
    await ui.unmount()
  })

  test('la fila unida conserva el ■ del principal y los de los exploradores, cada uno con su estado', async ($, on) => {
    const { ui, modelo, abrir, vuelos } = await explorando($, on)
    await paso($, HAIKU, 'high')
    expect((await cuadradosDe(ui, FILA_EXPLORADOR)).colores).toEqual(['subtle', 'subtle', 'subtle', 'subtle'])

    // El principal en vuelo: su ■ (el primero) en success; los tres de los exploradores siguen grises.
    const abrirPrincipal = modelo.detener('principal')
    const enCurso = paso($, HAIKU, 'high')
    await esperar()
    expect((await cuadradosDe(ui, FILA_EXPLORADOR)).colores).toEqual(['success', 'subtle', 'subtle', 'subtle'])
    abrirPrincipal()
    await enCurso

    // El principal pide una herramienta (warning) mientras un explorador sigue en vuelo (success).
    modelo.pidenHerramienta.add('principal')
    await paso($, HAIKU, 'high')
    const abrirSub = modelo.detener('agente-A')
    const sub = paso($, HAIKU, 'high', 'agente-A')
    await esperar()
    expect((await cuadradosDe(ui, FILA_EXPLORADOR)).colores).toEqual(['warning', 'success', 'success', 'success'])

    abrirSub()
    await sub
    expect((await cuadradosDe(ui, FILA_EXPLORADOR)).colores).toEqual(['warning', 'subtle', 'subtle', 'subtle'])

    abrir.A()
    abrir.B()
    abrir.C()
    await Promise.all(Object.values(vuelos))
    await ui.unmount()
  })

  const SONNET = 'claude-sonnet-5-5'

  /**
   * Un flujo en Preflight con el panel montado y el modelo respondiendo con el modelo que se le pide
   * (la fila de un subagente sale del modelo de su petición).
   */
  async function preparandoRevision($: Engine, on: On) {
    const motor = preparar(on)
    on('turn.step', async function* (_$, e) {
      return {
        turnId: e.turnId,
        index: e.index,
        answer: 'ok',
        toolUses: [],
        stopReason: 'end_turn' as const,
        usage: { ...USO, model: e.model },
      }
    })
    on('session.model', () => ({ value: 'claude-opus-5-5' }))
    on('settings.read', () => ({ value: {} }))
    on('command.register', () => ({ value: undefined }))
    on('session.start', (_$, e) => ({ cwd: e.cwd }))
    on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
    on('ui.open', () => ({ value: { isPlaced: true } }))
    await $.session.measure(MEDIDA)
    await $.skill.prompt({ skill: 'implementador', text: '' })
    await bash($, 'node ~/.claude/flujos/estado.mjs')

    return { motor, ui: await $.ui.mount({ ...PANE_ANCHO, surface: 'terminal' }) }
  }

  /** Lleva el flujo a Verificación final (`estado --base` → ejecutor → revisor de la subtarea → `verificar`) y lanza tres revisores retenidos (R1, R2 y R3). */
  async function lanzandoRevisores($: Engine, motor: ReturnType<typeof preparar>) {
    await bash($, 'node ~/.claude/flujos/estado.mjs --base')
    await agente($, 'ejecutor', 'E1')
    await agente($, 'revisor', 'R0')
    await bash($, 'node ~/.claude/flujos/verificar.mjs')

    const abrir = { R1: motor.detener('R1'), R2: motor.detener('R2'), R3: motor.detener('R3') }
    const vuelos = { R1: agente($, 'revisor', 'R1'), R2: agente($, 'revisor', 'R2'), R3: agente($, 'revisor', 'R3') }
    await esperar()

    return { abrir, vuelos }
  }

  test('la fila de los revisores lleva un ■ por revisor en vuelo en la revisión integral y vuelve a uno', async ($, on) => {
    const { motor, ui } = await preparandoRevision($, on)
    const { abrir, vuelos } = await lanzandoRevisores($, motor)

    // El paso de un revisor llega tras los tres lanzamientos y crea la fila anotada.
    await paso($, HAIKU, 'high', 'agente-R1')
    expect((await cuadradosDe(ui, FILA_EXPLORADOR)).colores).toHaveLength(3)

    abrir.R1()
    await vuelos.R1
    expect((await cuadradosDe(ui, FILA_EXPLORADOR)).colores).toHaveLength(2)

    abrir.R2()
    abrir.R3()
    await Promise.all([vuelos.R2, vuelos.R3])
    expect((await cuadradosDe(ui, FILA_EXPLORADOR)).colores).toHaveLength(1)
    await ui.unmount()
  })

  test('un revisor que falla también baja la cuenta', async ($, on) => {
    const { motor, ui } = await preparandoRevision($, on)
    const { abrir, vuelos } = await lanzandoRevisores($, motor)
    await paso($, HAIKU, 'high', 'agente-R1')
    expect((await cuadradosDe(ui, FILA_EXPLORADOR)).colores).toHaveLength(3)

    // El revisor cae: el error llega intacto y su ■ se va igual.
    motor.fallan.add('R1')
    abrir.R1()
    const error = await vuelos.R1.then(
      () => null,
      (err: unknown) => err,
    )
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).not.toMatch(/panel/)
    expect((await cuadradosDe(ui, FILA_EXPLORADOR)).colores).toHaveLength(2)

    abrir.R2()
    abrir.R3()
    await Promise.all([vuelos.R2, vuelos.R3])
    expect((await cuadradosDe(ui, FILA_EXPLORADOR)).colores).toHaveLength(1)
    await ui.unmount()
  })

  test('en la revisión integral la fila de los exploradores no lleva los ■ de los revisores', async ($, on) => {
    const { motor, ui } = await preparandoRevision($, on)

    // La exploración con Haiku anota su fila.
    const abrirExp = { A: motor.detener('A'), B: motor.detener('B'), C: motor.detener('C') }
    const exploradores = { A: agente($, 'explorador', 'A'), B: agente($, 'explorador', 'B'), C: agente($, 'explorador', 'C') }
    await esperar()
    await paso($, HAIKU, 'high', 'agente-A')
    expect((await cuadradosDe(ui, FILA_EXPLORADOR)).colores).toHaveLength(3)

    abrirExp.A()
    abrirExp.B()
    abrirExp.C()
    await Promise.all(Object.values(exploradores))

    // Tres revisores con otro modelo: abren su propia tanda y no heredan la marca de la fila de Haiku.
    const { abrir, vuelos } = await lanzandoRevisores($, motor)
    await paso($, SONNET, 'high', 'agente-R1')
    // Con dos modelos las etiquetas salen alineadas en columnas.
    expect((await cuadradosDe(ui, 'Sonnet 5.5 high')).colores).toHaveLength(3)
    expect((await cuadradosDe(ui, 'Haiku  5.5 high')).colores).toHaveLength(1)

    abrir.R1()
    abrir.R2()
    abrir.R3()
    await Promise.all(Object.values(vuelos))
    await ui.unmount()
  })

  test('con cinco exploradores en vuelo la fila lleva cinco ■, y con más de cinco, cinco', async ($, on) => {
    const { ui, motor, abrir, vuelos } = await explorando($, on)
    const abrirD = motor.detener('D')
    const abrirE = motor.detener('E')
    const extra = [agente($, 'explorador', 'D'), agente($, 'explorador', 'E')]
    await esperar()

    // Fila solo de subagente: un ■ por explorador, con la etiqueta entera a 49 columnas.
    expect((await cuadradosDe(ui, FILA_EXPLORADOR)).colores).toHaveLength(5)

    const abrirF = motor.detener('F')
    extra.push(agente($, 'explorador', 'F'))
    await esperar()
    expect((await cuadradosDe(ui, FILA_EXPLORADOR)).colores).toHaveLength(5)

    abrirD()
    abrirE()
    abrirF()
    abrir.A()
    abrir.B()
    abrir.C()
    await Promise.all([...Object.values(vuelos), ...extra])
    await ui.unmount()
  })

  test('los ■ de más sobreviven a session.start y se van con session.end', async ($, on) => {
    const { ui, abrir, vuelos } = await explorando($, on)
    expect((await cuadradosDe(ui, FILA_EXPLORADOR)).colores).toHaveLength(3)

    // Un /reload-plugins a mitad de la exploración repite session.start: el flujo y las marcas siguen.
    await $.session.start({ cwd: 'D:\\GitHub-Personal\\mods-claude' })
    expect((await cuadradosDe(ui, FILA_EXPLORADOR)).colores).toHaveLength(3)

    // session.end borra el flujo y las marcas.
    await $.session.end({ reason: 'other', sessionId: 's1', resume: { id: 's1' } })
    expect((await cuadradosDe(ui, FILA_EXPLORADOR)).colores).toHaveLength(1)

    abrir.A()
    abrir.B()
    abrir.C()
    await Promise.all(Object.values(vuelos))
    await ui.unmount()
  })

  test('un flujo nuevo no hereda las filas: con exploradores en vuelo la fila vuelve a uno hasta que se la vea de nuevo', async ($, on) => {
    const { ui, motor, abrir, vuelos } = await explorando($, on)
    expect((await cuadradosDe(ui, FILA_EXPLORADOR)).colores).toHaveLength(3)

    await $.skill.prompt({ skill: 'implementador', text: '' })
    await bash($, 'node ~/.claude/flujos/estado.mjs')
    const abrirD = motor.detener('D')
    const abrirE = motor.detener('E')
    const d = agente($, 'explorador', 'D')
    const e = agente($, 'explorador', 'E')
    await esperar()
    expect((await cuadradosDe(ui, FILA_EXPLORADOR)).colores).toHaveLength(1)

    await paso($, HAIKU, 'high', 'agente-A')
    expect((await cuadradosDe(ui, FILA_EXPLORADOR)).colores).toHaveLength(2)

    abrirD()
    abrirE()
    abrir.A()
    abrir.B()
    abrir.C()
    await Promise.all([d, e, ...Object.values(vuelos)])
    await ui.unmount()
  })

  test('skill.prompt de /implementador con RELEVO abre flujo nuevo y vacía las filas', async ($, on) => {
    const { ui, abrir, vuelos } = await explorando($, on)
    expect(await desdeResumen(ui, 1)).toEqual(['/implementador · Exploración · 0 s'])
    expect((await cuadradosDe(ui, FILA_EXPLORADOR)).colores).toHaveLength(3)

    // Ya no hay relevo: una marca RELEVO es un pedido más, el flujo empieza de nuevo y las filas se vacían.
    await $.skill.prompt({ skill: 'implementador', text: '**Pedido:** RELEVO · inicio\nPEDIDO: x' })

    const [resumen] = await desdeResumen(ui, 1)
    expect(resumen).toBe('/implementador · Preflight · 0 s')
    expect((await cuadradosDe(ui, FILA_EXPLORADOR)).colores).toHaveLength(1)

    abrir.A()
    abrir.B()
    abrir.C()
    await Promise.all(Object.values(vuelos))
    await ui.unmount()
  })

  test('un /implementador normal con RELEVO solo en las instrucciones reinicia el flujo y no muestra el modo', async ($, on) => {
    const { reloj } = preparar(on)
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

    await $.skill.prompt({ skill: 'implementador', text: '**Pedido:** algo' })
    await bash($, 'node ~/.claude/flujos/estado.mjs')
    reloj.t += 5_000
    await agente($, 'planificador')
    expect(await desdeResumen(ui, 1)).toEqual(['/implementador · Plan · 5 s'])

    reloj.t += 10_000
    await $.skill.prompt({
      skill: 'implementador',
      text: '**Pedido:** arreglar el panel\n\n- Si el pedido empieza con `RELEVO · vuelta`, sigue en el paso 3',
    })

    expect(await desdeResumen(ui, 1)).toEqual(['/implementador · Preflight · 0 s'])
    await ui.unmount()
  })

  test('si el flujo termina con exploradores en vuelo, la fila vuelve a uno', async ($, on) => {
    const { ui, abrir, vuelos } = await explorando($, on)
    expect((await cuadradosDe(ui, FILA_EXPLORADOR)).colores).toHaveLength(3)

    await $.turn.complete(respuesta('CIERRE · x — COMPLETO'))
    expect((await cuadradosDe(ui, FILA_EXPLORADOR)).colores).toHaveLength(1)

    abrir.A()
    abrir.B()
    abrir.C()
    await Promise.all(Object.values(vuelos))
    await ui.unmount()
  })

  /**
   * Como `explorando`, pero el modelo responde con el que se le pide (la fila principal y la de subagente
   * pueden ser de modelos distintos) y el panel se monta con el ancho dado.
   */
  async function alineando($: Engine, on: On, pane: typeof PANE | typeof PANE_ANCHO) {
    const motor = preparar(on)
    on('turn.step', async function* (_$, e) {
      return {
        turnId: e.turnId,
        index: e.index,
        answer: 'ok',
        toolUses: [],
        stopReason: 'end_turn' as const,
        usage: { ...USO, model: e.model },
      }
    })
    on('session.model', () => ({ value: 'claude-opus-5-5' }))
    on('settings.read', () => ({ value: {} }))
    on('command.register', () => ({ value: undefined }))
    on('session.start', (_$, e) => ({ cwd: e.cwd }))
    on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
    on('ui.open', () => ({ value: { isPlaced: true } }))
    await $.session.measure(MEDIDA)
    await $.skill.prompt({ skill: 'implementador', text: '' })
    await bash($, 'node ~/.claude/flujos/estado.mjs')

    const ui = await $.ui.mount({ ...pane, surface: 'terminal' })
    const abrir = { A: motor.detener('A'), B: motor.detener('B'), C: motor.detener('C') }
    const vuelos = { A: agente($, 'explorador', 'A'), B: agente($, 'explorador', 'B'), C: agente($, 'explorador', 'C') }
    await esperar()
    await paso($, 'claude-haiku-5-5', 'high', 'agente-A')
    await paso($, 'claude-sonnet-5-5', 'high')

    return { ui, abrir, vuelos }
  }

  /** Cada fila de «Esta sesión»: su etiqueta, cuántos ■ lleva, si tras ellos viene el total y el color de su barra. */
  const filasDeSesion = async (ui: Ui) => {
    const arbol = await ui.findAll({})
    const ses = arbol.findIndex(n => n.type === 'Text' && n.text === 'Esta sesión')
    const sem = arbol.findIndex(n => n.type === 'Text' && n.text === 'Esta semana')
    const dentro = arbol.slice(ses, sem)

    return dentro.flatMap((n, i) => {
      if (n.type !== 'Text' || n.text === ' ■' || dentro[i + 1]?.text !== ' ■') return []

      let j = i + 1
      while (dentro[j]?.type === 'Text' && dentro[j]?.text === ' ■') j++

      return [
        {
          etiqueta: n.text ?? '',
          cuadrados: j - i - 1,
          total: /^ *\d/.test(dentro[j]?.text ?? ''),
          barra: dentro.slice(j).find(esBarraDeFila)?.props.color,
        },
      ]
    })
  }

  test('Esta sesión alinea las filas y los ■ empiezan en la misma columna', async ($, on) => {
    const { ui, abrir, vuelos } = await alineando($, on, PANE_ANCHO)

    // Con 3 exploradores en vuelo: la fila de subagente lleva 3 ■ y la principal 1, tras etiquetas del mismo largo.
    let filas = await filasDeSesion(ui)
    expect(filas.map(f => f.etiqueta).sort()).toEqual(['Haiku  5.5 high', 'Sonnet 5.5 high'])
    expect(filas.map(f => f.etiqueta.length)).toEqual([15, 15])
    expect(filas.map(f => f.cuadrados).sort()).toEqual([1, 3])
    expect(filas.every(f => f.total)).toBe(true)
    expect(filas.find(f => f.etiqueta === 'Haiku  5.5 high')?.cuadrados).toBe(3)
    expect(filas.find(f => f.etiqueta === 'Sonnet 5.5 high')?.cuadrados).toBe(1)

    // Sin exploradores en vuelo: una sola ■ en cada fila y las mismas etiquetas.
    abrir.A()
    abrir.B()
    abrir.C()
    await Promise.all(Object.values(vuelos))
    filas = await filasDeSesion(ui)
    expect(filas.map(f => f.etiqueta).sort()).toEqual(['Haiku  5.5 high', 'Sonnet 5.5 high'])
    expect(filas.map(f => f.etiqueta.length)).toEqual([15, 15])
    expect(filas.map(f => f.cuadrados)).toEqual([1, 1])
    await ui.unmount()
  })

  test('Esta sesión junta principal y subagentes del mismo modelo·esfuerzo en una fila', async ($, on) => {
    const { ui, abrir, vuelos } = await alineando($, on, PANE_ANCHO)
    await paso($, 'claude-haiku-5-5', 'high')

    const filas = await filasDeSesion(ui)
    const haiku = filas.filter(f => f.etiqueta === 'Haiku  5.5 high')
    // Una sola etiqueta y una sola fila: 1 ■ del principal y 3 de los exploradores.
    expect(filas.filter(f => f.etiqueta.startsWith('Haiku'))).toHaveLength(1)
    expect(haiku).toHaveLength(1)
    expect(haiku[0]?.cuadrados).toBe(4)
    // El hilo principal responde con el flujo en curso: su tramo es `cyan_FOR_SUBAGENTS_ONLY` (el del orquestador), antes que el de subagentes.
    expect(haiku[0]?.barra).toBe('cyan_FOR_SUBAGENTS_ONLY')
    expect(filas.some(f => f.etiqueta.includes('sub'))).toBe(false)
    expect(filas.find(f => f.etiqueta.startsWith('Sonnet'))?.barra).toBe('cyan_FOR_SUBAGENTS_ONLY')

    abrir.A()
    abrir.B()
    abrir.C()
    await Promise.all(Object.values(vuelos))
    await ui.unmount()
  })

  test('con 32 columnas las etiquetas se acortan al presupuesto y las cifras de total siguen apareciendo', async ($, on) => {
    const { ui, abrir, vuelos } = await alineando($, on, PANE)

    // Presupuesto: 32 − 14 de cifras − 2 × 3 ■ = 12 columnas para la etiqueta.
    const filas = await filasDeSesion(ui)
    expect(filas.map(f => f.etiqueta).sort()).toEqual(['Haiku  5.5… ', 'Sonnet 5.5… '])
    expect(filas.map(f => f.etiqueta.length)).toEqual([12, 12])
    expect(filas.every(f => f.total)).toBe(true)
    const textos = await textosDe(ui)
    expect(textos.slice(0, textos.indexOf('Esta semana'))).toContain('   100k')

    abrir.A()
    abrir.B()
    abrir.C()
    await Promise.all(Object.values(vuelos))
    await ui.unmount()
  })
})
