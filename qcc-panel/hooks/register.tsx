import { atom, read, update } from 'claude-code'
import type { Color, EngineInterface, Register, SessionContextUsage, SessionRateLimit, TurnStepResult } from 'claude-code'

import type { Actividad, Esfuerzo, FilaSemana, Flujo, Medida, Pestana, Semana } from '../types'
import {
  agentesEnCurso,
  anotarAgente,
  anotarArchivo,
  anotarGasto,
  anotarHerramienta,
  cerrarAgente,
  anotarFondo,
  esperaFondo,
  pasarAEspera,
  quitarFondo,
  filasEnEspera,
  resumenAgentes,
} from './agentes'
import { anotarCache, decidirAvisoContexto, restante, tasaAciertos, TTL_CACHE_MS } from './cache'
import { comandoCarpeta, tipoDeRuta } from './carpeta'
import type { SistemaCarpeta } from './carpeta'
import { decidirFreno } from './freno'
import {
  AGENTE_DE_PASO,
  abreTanda,
  abrirEspera,
  anotarConfig,
  anotarExplorador,
  anotarFilaExplorador,
  avanzar,
  baseDeUso,
  cerrarEspera,
  cerrarExploradorSinId,
  congelarConsumo,
  datosDeExplorador,
  iniciarFlujo,
  marcarAgente,
  marcarOrquestador,
  nombreOrquestador,
  resumenFlujo,
  rolDeAgente,
  senalAlTerminar,
  senalDeHerramienta,
  sumarGasto,
  sumarGastoDeExplorador,
  terminarFlujo,
} from './flujo'
import type { Senal } from './flujo'
import { cifraMinutos, cifraUsd, leerHistorial, lineasHistorial, promedioHistorial, rutaHistorial, unirHistorial } from './historial'
import { COPIA_NORMAL, detectar, rutaSkill, vistaDe } from './instalados'
import {
  aDesglose,
  barra,
  barraTramos,
  conOnda,
  cuando,
  cuotaUsado,
  desgloseTramos,
  etiquetasAlineadas,
  falta,
  historialVigente,
  lineaContexto,
  lineaLimite,
  marcador,
  nombreCorto,
  ordenar,
  ordenLeyenda,
  pct,
  pctParte,
  pestanaValida,
  relleno,
  repartir,
  resumenContexto,
  tokens,
  tono,
  tonoCompactacion,
  totalConSalida,
  tramos,
  unirPorColor,
} from './formato'
import type { TrozoBarra } from './formato'
import {
  PREFIJO,
  RETENCION_MS,
  anotar,
  clave,
  comoRegistro,
  estadoActividad,
  estadoDeFila,
  etiquetaDia,
  familia,
  idFila,
  idsDeActividad,
  inicioSemana,
  iniciarPeticion,
  limpiarPendientes,
  podar,
  resumir,
  unirOrigenes,
  terminarPeticion,
} from './semana'
import type { NivelEsfuerzo, Registro, Uso } from './semana'

const PANEL = 'qcc-panel'
const COLUMNAS = 40
/** Columnas que se lleva cada tarjeta: el borde (1 + 1) y el hueco interior (1 + 1). */
const MARCO = 4
/** Columnas que pide al abrirse: el marco del dock se lleva algunas y el interior de las tarjetas tiene que quedar en `COLUMNAS`. */
const COLUMNAS_APERTURA = 48
const TICK_MS = 30_000
const SCROLL_MS = 150
/** Cada cuánto avanza una celda la onda de las barras de «Esta sesión» con una petición en curso. */
const ONDA_MS = 120

/** `key` de la fila de pestañas, para apuntarle con `$.ui.scroll` al cambiar de pestaña. */
const CLAVE_PESTANAS = 'pestanas'

const medida = atom({ plugin: 'panel', key: 'medida' } as const, null)
const esfuerzo = atom({ plugin: 'panel', key: 'esfuerzo' } as const, null)
const ahora = atom({ plugin: 'panel', key: 'ahora' } as const, 0)
const desglose = atom({ plugin: 'panel', key: 'desglose' } as const, null)
const precisando = atom({ plugin: 'panel', key: 'precisando' } as const, false)
const semana = atom({ plugin: 'panel', key: 'semana' } as const, null)
const sesion = atom({ plugin: 'panel', key: 'sesion' } as const, null)
const pestana = atom({ plugin: 'panel', key: 'pestana' } as const, 'inicio')
const actividad = atom({ plugin: 'panel', key: 'actividad' } as const, {})
const flujo = atom({ plugin: 'panel', key: 'flujo' } as const, null)
const filasExploradores = atom({ plugin: 'panel', key: 'filasExploradores' } as const, [])
const historial = atom({ plugin: 'panel', key: 'historial' } as const, null)
const home = atom({ plugin: 'panel', key: 'home' } as const, null)
const freno = atom({ plugin: 'panel', key: 'freno' } as const, null)
const instalados = atom({ plugin: 'panel', key: 'instalados' } as const, null)
const cache = atom({ plugin: 'panel', key: 'cache' } as const, null)
const avisoContexto = atom({ plugin: 'panel', key: 'avisoContexto' } as const, 0)
const agentes = atom({ plugin: 'panel', key: 'agentes' } as const, [])
const archivos = atom({ plugin: 'panel', key: 'archivos' } as const, [])
const fase = atom({ plugin: 'panel', key: 'fase' } as const, 0)

/** Color de cada ■ de «Esta sesión» según el estado de su origen (el del principal y el del subagente pueden diferir). */
const COLOR_ACTIVIDAD = { activo: 'success', espera: 'warning', inactivo: 'subtle' } as const

/** El estado de toda la sesión en la cabecera del panel: el de la fila más activa de «Esta sesión». */
const TEXTO_ACTIVIDAD = { activo: '● trabajando', espera: '◐ esperando', inactivo: '○ en reposo' } as const

/** La pestaña abierta. Fuera del prefijo `uso:`: la poda y la suma de la semana no la tocan. Las claves viejas (`prefs:semana`, `prefs:flujo`, `prefs:historial`) se ignoran. */
const PREF_PESTANA = 'prefs:pestana'

/** Color del tramo de subagentes en las dos tablas («Esta sesión» y «Esta semana»). */
const COLOR_SUB = 'purple_FOR_SUBAGENTS_ONLY'

/** Color del tramo del hilo principal durante un flujo en las barras de «Esta sesión» y «Esta semana»; distinto de `claude`, de `COLOR_SUB` y de success/warning/subtle de los ■. */
const COLOR_FLUJO = 'cyan_FOR_SUBAGENTS_ONLY'

/** Columnas de las cifras de cada fila: total (7) + salida (7). */
const COLUMNAS_CIFRAS = 14

// Las escrituras al store van en fila: el hilo principal y los subagentes responden a la vez.
let cola: Promise<unknown> = Promise.resolve()

function enFila<T>(trabajo: () => Promise<T>): Promise<T> {
  const hecho = cola.then(trabajo)
  cola = hecho.catch(() => undefined)

  return hecho
}

/**
 * Una clave por sesión: dos terminales abiertas no se pisan la misma clave.
 * Se cuenta todo lo que la API informó, hilo principal y subagentes.
 */
async function anotarUso(
  $: EngineInterface,
  modelo: string,
  nivel: NivelEsfuerzo,
  subagente: boolean,
  deFlujo: boolean,
  uso: Uso,
) {
  await enFila(async () => {
    const k = `${PREFIJO}${await $.session.id()}`
    const t = await $.clock.now()
    const antes = comoRegistro(await $.store.get(k))
    await $.store.set(k, anotar(antes, t, clave(modelo, nivel, subagente, deFlujo), uso))
  })
  await releerSemana($)
}

/** Si hay un flujo en curso en esta sesión. Nunca rechaza: ante un fallo dice que no. */
async function enFlujo($: EngineInterface): Promise<boolean> {
  try {
    const f = await read($, flujo)

    return f !== null && f.estado === 'en curso'
  } catch {
    return false
  }
}

/**
 * Suma todas las sesiones del store (lee también lo que otras terminales escribieron)
 * y, aparte, solo la clave de esta sesión, entera.
 */
async function releerSemana($: EngineInterface) {
  try {
    const t = await $.clock.now()
    const m = await read($, medida)
    const propia = `${PREFIJO}${await $.session.id()}`
    const registros: Registro[] = []
    let deEsta: Registro = {}
    for (const k of await $.store.keys()) {
      if (!k.startsWith(PREFIJO)) continue
      const r = comoRegistro(await $.store.get(k))
      registros.push(r)
      if (k === propia) deEsta = r
    }
    await update($, semana, () => unirOrigenes(resumir(registros, inicioSemana(m?.limites ?? [], t), t)))
    await update($, sesion, () => resumir([deEsta], 0))
  } catch {
    // Sin store la sección queda como estaba.
  }
}

/**
 * Cambia la actividad de las filas con la hora actual. Nunca rechaza: un fallo del panel
 * no puede frenar ni cambiar una petición al modelo.
 */
async function marcarActividad($: EngineInterface, cambio: (a: Actividad, t: number) => Actividad) {
  try {
    const t = await $.clock.now()
    await update($, actividad, a => cambio(a, t))
  } catch {
    // Sin seguimiento los cuadrados quedan como estaban.
  }
}

/** Lo de hace más de 15 días se borra: la semana del límite nunca mira tan atrás. */
async function podarStore($: EngineInterface) {
  await enFila(async () => {
    const desde = (await $.clock.now()) - RETENCION_MS
    for (const k of await $.store.keys()) {
      if (!k.startsWith(PREFIJO)) continue
      const queda = podar(comoRegistro(await $.store.get(k)), desde)
      if (queda === null) await $.store.delete(k)
      else await $.store.set(k, queda)
    }
  })
}

/**
 * `summary` estima en local: 0 tokens y 0 peticiones. `full` cuenta con la API de conteo,
 * una petición por herramienta y archivo de memoria (como `/context`): solo a pedido.
 */
async function medirDesglose($: EngineInterface, detalle: 'summary' | 'full') {
  try {
    const uso = await $.session.usage({ breakdown: detalle })
    const b = uso.context.breakdown
    if (b !== undefined) await update($, desglose, () => aDesglose(b, detalle === 'full'))
  } catch {
    // Sin desglose el panel sigue con la barra simple.
  }
}

/**
 * Lleva la fila de pestañas al borde de arriba de la ventana del panel, para que el contenido
 * de la pestaña nueva se vea desde su principio. Un fallo o un `{ deny }` no importan: el panel sigue como estaba.
 */
async function mostrarPestanas($: EngineInterface) {
  try {
    await $.ui.scroll({ in: PANEL, to: { key: CLAVE_PESTANAS }, block: 'start' })
  } catch {
    // Sin desplazamiento el usuario sube con la rueda.
  }
}

/** La lectura del historial en vuelo, compartida: otra petición mientras tanto espera a esta en vez de abrir una segunda. */
let lecturaHistorial: Promise<void> | null = null

/** La fecha de modificación (ms) de `ruta`; `null` si no existe o no se puede mirar. */
async function fechaDeRegistro($: EngineInterface, ruta: string): Promise<number | null> {
  try {
    return (await $.fs.stat(ruta)).mtimeMs
  } catch {
    return null
  }
}

/** El pedido de la carpeta personal en vuelo, compartido: la detección de implementadores y el historial no abren dos `node -p`. */
let lecturaCasa: Promise<string> | null = null

/** Pide la carpeta personal a `node` si aún no se conoce (`''` si falla y no se repite). Nunca rechaza. */
async function pedirCarpetaPersonal($: EngineInterface): Promise<string> {
  try {
    const guardada = (await read($, home)) ?? null
    if (guardada !== null) return guardada

    let pedida = ''
    try {
      const r = await $.process.run(['node', '-p', 'require("os").homedir()'], { timeoutMs: 5_000 })
      if (r.exitCode === 0) pedida = r.stdout.trim()
    } catch {
      // Sin la carpeta personal no hay historial.
    }
    await update($, home, () => pedida)

    return pedida
  } catch {
    return ''
  }
}

/** La carpeta personal (`''` si no se supo). Otra petición mientras tanto espera a la que va en vuelo. */
function carpetaPersonal($: EngineInterface): Promise<string> {
  if (lecturaCasa === null) {
    lecturaCasa = pedirCarpetaPersonal($).finally(() => {
      lecturaCasa = null
    })
  }

  return lecturaCasa
}

/**
 * Lee `flujos.jsonl` si cambió desde la última vez: pide la carpeta personal una vez (`''` si falla y no se repite),
 * mira la fecha del archivo y solo lo lee si es otra. Un fallo, o que el archivo no exista, deja el historial como estaba.
 */
async function leerArchivoHistorial($: EngineInterface) {
  try {
    const casa = await carpetaPersonal($)

    const ruta = rutaHistorial(casa)
    if (ruta === null) return

    const mtimeMs = await fechaDeRegistro($, ruta)
    // El archivo no existe: el historial queda como estaba.
    if (mtimeMs === null) return

    const actual = (await read($, historial)) ?? null
    // Una caché sin `v: 6` viene de una versión anterior (con filas de otro registro, sin los tokens de cada fila o con `totales`): se vuelve a leer.
    if (historialVigente(actual, mtimeMs)) return

    // Un archivo que existe y no se deja leer deja el historial como estaba (lanza).
    const texto = await $.fs.read(ruta)
    if (typeof texto !== 'string') return

    // En pantalla van solo las 10 filas más recientes.
    const filas = unirHistorial([leerHistorial(texto, 10)], 10)

    await update($, historial, () => ({ v: 6, mtimeMs, filas }))
  } catch {
    // Sin archivo o sin lectura el historial queda como estaba.
  }
}

/** Relee el historial. Nunca rechaza: un fallo del panel no puede frenar una pulsación, un turno ni el arranque. */
function releerHistorial($: EngineInterface): Promise<void> {
  if (lecturaHistorial === null) {
    lecturaHistorial = leerArchivoHistorial($).finally(() => {
      lecturaHistorial = null
    })
  }

  return lecturaHistorial
}

/** Si existe `ruta`: `true` o `false`; `null` si no se pudo comprobar (dudoso, no «no está»). */
async function existeArchivo($: EngineInterface, ruta: string | null): Promise<boolean | null> {
  if (ruta === null) return null
  try {
    const r: unknown = await $.fs.exists(ruta)

    return typeof r === 'boolean' ? r : null
  } catch {
    return null
  }
}

/**
 * Detecta qué implementadores hay instalados (ajustes y `SKILL.md`) y actualiza el atom solo si el resultado cambió.
 * Nunca rechaza: un fallo del panel no puede frenar el arranque ni el tick, y un fallo de detección deja todo visible.
 */
async function detectarInstalados($: EngineInterface): Promise<void> {
  try {
    let ajustes: unknown = null
    try {
      ajustes = await $.settings.read()
    } catch {
      // Sin ajustes legibles la detección es dudosa.
    }
    const casa = await carpetaPersonal($)
    const normal = await existeArchivo($, rutaSkill(casa, COPIA_NORMAL))
    const nuevo = detectar({ ajustes, normal })
    const actual = (await read($, instalados)) ?? null
    if (actual !== null && actual.normal === nuevo.normal) return

    await update($, instalados, () => nuevo)
  } catch {
    // Sin detección el panel muestra todo.
  }
}

/**
 * Cambia el flujo en curso con la hora actual (para el tiempo de cada paso). Nunca rechaza:
 * un fallo del panel no puede frenar una skill, una herramienta ni el fin de un turno.
 */
async function marcarFlujo($: EngineInterface, cambio: (f: Flujo | null, t: number) => Flujo | null) {
  try {
    const t = await $.clock.now()
    await update($, flujo, f => cambio(f, t))
  } catch {
    // Sin seguimiento la sección queda como estaba.
  }
}

/** Lo gastado por esta sesión, fila por fila. Nunca rechaza: sin ello el consumo del flujo queda sin dato. */
async function readSesion($: EngineInterface): Promise<Semana | null> {
  try {
    return await read($, sesion)
  } catch {
    return null
  }
}

/**
 * Anota la fila de una petición de subagente si hay exploradores o revisores en vuelo. Nunca rechaza:
 * un fallo del panel no puede frenar una petición al modelo.
 */
async function marcarExplorador($: EngineInterface, id: string) {
  try {
    const f = await read($, flujo)
    await update($, filasExploradores, x => anotarFilaExplorador(x, f, id))
  } catch {
    // Sin la marca la fila dibuja un solo ■.
  }
}

/** Vacía las filas de exploradores. Nunca rechaza: no puede frenar una skill ni el cierre de la sesión. */
async function vaciarFilasExploradores($: EngineInterface) {
  try {
    await update($, filasExploradores, () => [])
  } catch {
    // Sin vaciar, el ■ de más solo se ve con un flujo en curso y exploradores en vuelo.
  }
}

/**
 * Vacía las filas anotadas cuando la señal abre una tanda de exploradores o revisores, antes de que
 * se pida al modelo cualquier subagente de la tanda. Nunca rechaza: no puede frenar una herramienta.
 */
async function vaciarAlAbrirTanda($: EngineInterface, s: Senal) {
  try {
    if (abreTanda(await read($, flujo), s)) await update($, filasExploradores, () => [])
  } catch {
    // Sin vaciar, la fila nueva puede heredar la marca de la tanda anterior.
  }
}

/** Suma una herramienta al subagente que la llama (un agente desconocido no cambia nada). Nunca rechaza: no puede frenar una herramienta. */
async function contarHerramienta($: EngineInterface, agentId: string | null | undefined, enFondo = false) {
  try {
    if (typeof agentId === 'string') {
      await update($, agentes, antes => anotarHerramienta(antes ?? [], agentId))
      // Una tarea en segundo plano suya: su próximo turno sin herramientas será una espera.
      if (enFondo) await update($, agentes, antes => anotarFondo(antes ?? [], agentId))
    }
  } catch {
    // Sin la cuenta, la línea del agente queda con una herramienta menos.
  }
}

/**
 * Suma al subagente la respuesta que acaba de dar (salida, total con caché y su modelo·esfuerzo); un agente desconocido no cambia nada.
 * El nombre se calcula dentro para que un error lo atrape el try. Nunca rechaza: no puede frenar una petición.
 */
async function registrarGastoAgente(
  $: EngineInterface,
  agentId: string,
  uso: TurnStepResult['usage'],
  modelo: string,
  esfuerzo: string | number | undefined,
) {
  try {
    const nombre = modelo === '' ? '' : nombreOrquestador(modelo, esfuerzo)
    await update($, agentes, antes => anotarGasto(antes ?? [], agentId, uso, nombre))
  } catch {
    // Sin la cuenta, la línea del agente queda sin cifras.
  }
}

/** Pasa a un subagente de «lanzó su tarea de fondo» a «espera su tarea» (en la fila `fila`). Nunca rechaza: no puede frenar una petición. */
async function soltarEspera($: EngineInterface, agentId: string, fila: string) {
  try {
    await update($, agentes, antes => pasarAEspera(antes ?? [], agentId, fila))
  } catch {
    // Sin soltarla, su próxima respuesta sin herramientas volvería a ser una espera.
  }
}

/** Cierra como `listo` al subagente que dio su respuesta final. Nunca rechaza: no puede frenar una petición. */
async function cerrarAlResponder($: EngineInterface, agentId: string) {
  try {
    const t = await $.clock.now()
    await update($, agentes, antes => cerrarAgente(antes ?? [], { id: agentId }, true, t))
  } catch {
    // Sin cerrarlo, sigue contando en « xN» hasta /clear.
  }
}

/**
 * Lo que anota una herramienta al volver: un `Agent` que falló cierra a su subagente como `fallo` (si salió bien lo cierra su respuesta final), y un `Edit`, `Write` o
 * `NotebookEdit` que salió bien anota su archivo con el rol de quien lo tocó. `resultado` es lo que devolvió `next` (sin él si falló).
 * Nunca rechaza: no puede cambiar el resultado ni el error de la herramienta.
 */
async function anotarAlVolver(
  $: EngineInterface,
  e: { tool: string; agentId?: string | null; tool_use_id?: unknown },
  resultado: unknown,
  bien: boolean,
) {
  try {
    if (e.tool !== 'Agent' && e.tool !== 'Edit' && e.tool !== 'Write' && e.tool !== 'NotebookEdit') return

    const t = await $.clock.now()

    if (e.tool === 'Agent') {
      // Si salió bien, el agente (en primer o segundo plano) lo cierra su respuesta final (`turn.step`); aquí solo se cierra un fallo.
      if (!bien) {
        const r = objeto(resultado)
        await update($, agentes, antes => cerrarAgente(antes ?? [], { id: r?.agentId, llamada: e.tool_use_id }, false, t))
      }

      return
    }

    if (!bien) return

    const campos = e as unknown as Record<string, unknown>
    const ruta = e.tool === 'NotebookEdit' ? (campos.notebook_path ?? campos.file_path) : campos.file_path
    const quien = e.agentId
    let rol = 'principal'
    if (typeof quien === 'string') {
      const visto = ((await read($, agentes)) ?? []).find(a => a.id === quien)
      rol = visto === undefined ? 'agente' : rolDeAgente(visto.tipo) || 'agente'
    }
    await update($, archivos, antes => anotarArchivo(antes ?? [], ruta, rol, t))
  } catch {
    // Sin la anotación, la pestaña «Agentes» queda como estaba.
  }
}

/**
 * Elige la pestaña, la recuerda entre sesiones y lleva la fila de pestañas al borde de la ventana. Pulsarla de nuevo no cambia nada.
 * Con «Historial» mira además si `flujos.jsonl` cambió.
 */
async function elegirPestana($: EngineInterface, p: Pestana) {
  await update($, pestana, () => p)
  try {
    await $.store.set(PREF_PESTANA, p)
  } catch {
    // Sin store vale solo para esta sesión.
  }
  // Las filas nuevas aún no se dibujaron: se espera un momento antes de desplazar.
  try {
    $.clock.after(SCROLL_MS, () => {
      void mostrarPestanas($)
    })
  } catch {
    // Sin reloj no hay desplazamiento.
  }
  if (p !== 'historial') return

  // Al abrir la pestaña se mira si el archivo cambió; la pestaña ya cambió, esto solo añade el historial.
  // Con la carpeta personal ya conocida solo se mira el archivo y se espera; sin ella, `node -p` puede tardar y la pulsación no lo espera.
  let conocida = false
  try {
    conocida = ((await read($, home)) ?? null) !== null
  } catch {
    // Sin saberlo, no se espera.
  }
  const lectura = releerHistorial($)
  if (conocida) await lectura
}

async function precisar($: EngineInterface) {
  let yaEstaba = false
  await update($, precisando, antes => {
    yaEstaba = antes

    return true
  })
  if (yaEstaba) return

  try {
    await medirDesglose($, 'full')
  } finally {
    await update($, precisando, () => false)
  }
}

/** Un aviso que nunca rompe: si el toast falla, no pasa nada. */
function avisar($: EngineInterface, texto: string) {
  try {
    // El tipo dice `void`, pero un motor puede devolver una promesa: si rechaza, no queda sin capturar.
    const r: unknown = $.ui.toast(texto)
    if (r instanceof Promise) r.catch(() => undefined)
  } catch {
    // Sin aviso el botón sigue sin romper nada.
  }
}

/**
 * Abre la raíz de la sesión en el explorador del sistema. La ruta va solo como `cwd`,
 * nunca como argumento ni por un shell; `onPress` nunca rechaza.
 */
async function abrirCarpeta($: EngineInterface): Promise<string> {
  try {
    const ruta = await $.session.root()
    const tipo = tipoDeRuta(ruta)
    if (tipo === null) {
      const texto = 'No se pudo abrir la carpeta: la ruta de la sesión no es válida.'
      avisar($, texto)

      return texto
    }

    let sistema: SistemaCarpeta = 'windows'
    if (tipo !== 'windows') {
      const uname = await $.process.run(['uname', '-s'], { timeoutMs: 5_000 })
      sistema = uname.stdout.trim() === 'Darwin' ? 'mac' : 'otro'
    }

    const comando = comandoCarpeta(sistema)
    const r = await $.process.run(comando, { cwd: ruta, timeoutMs: 15_000 })
    if (r.exitCode !== 0) {
      const texto = `No se pudo abrir la carpeta (${comando[0]} terminó con ${r.exitCode}).`
      avisar($, texto)

      return texto
    }

    return `Carpeta abierta: ${ruta}`
  } catch {
    avisar($, 'No se pudo abrir la carpeta.')

    return 'No se pudo abrir la carpeta.'
  }
}

function aMedida(context: SessionContextUsage, limites: readonly SessionRateLimit[]): Medida {
  return {
    tokens: context.tokens,
    ventana: context.window,
    porcentaje: context.percent,
    limites: ordenar(limites).map(l => ({ kind: l.kind, percentUsed: l.percentUsed, resetsAt: l.resetsAt })),
  }
}

function objeto(x: unknown): Record<string, unknown> | undefined {
  return typeof x === 'object' && x !== null ? (x as Record<string, unknown>) : undefined
}

/** Antes del primer turno no hay petición que leer: se deduce de settings.json. */
async function esfuerzoDeAjustes($: EngineInterface): Promise<Esfuerzo | null> {
  const modelo = await $.session.model()
  const ajustes = await $.settings.read()
  const porModelo = objeto(objeto(ajustes.modelSettings)?.[modelo])
  const nivel = porModelo?.effortLevel ?? ajustes.effortLevel

  return typeof nivel === 'string' ? { nivel, modelo, origen: 'ajustes' } : null
}

/** Tras `/clear` ya corre la sesión nueva: ventana y límites de nuevo (cifras locales, gratis). */
async function releerTrasLimpiar($: EngineInterface) {
  try {
    const uso = await $.session.usage()
    await update($, medida, () => aMedida(uso.context, uso.rateLimits))
  } catch {
    // Queda lo limpiado; el próximo turno vuelve a medir.
  }
  // La sesión nueva tiene otra clave: «Esta sesión» arranca vacía.
  await releerSemana($)
}

function abrir($: EngineInterface) {
  return $.ui.open({ id: PANEL, title: 'Uso', columns: COLUMNAS_APERTURA, rows: 3 })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    // Cada paso va aparte: si uno falla, la semana, el tick y el panel igual arrancan.
    try {
      await $.command.register({
        name: 'panel',
        description: 'Abre el panel de contexto, límites de uso y esfuerzo',
      })
    } catch {
      // Sin el comando el panel se abre igual.
    }
    try {
      const uso = await $.session.usage()
      await update($, medida, () => aMedida(uso.context, uso.rateLimits))
    } catch {
      // Sin medida el panel dice que se mide tras la 1.ª respuesta.
    }
    try {
      const inicial = await esfuerzoDeAjustes($)
      await update($, esfuerzo, actual => actual ?? inicial)
    } catch {
      // Sin esfuerzo el panel muestra «—» hasta el primer turno.
    }
    try {
      // La hora actual (no 0) cambia el valor del atom y obliga a redibujar tras un reload.
      const t = await $.clock.now()
      await update($, ahora, () => t)
      await update($, precisando, () => false)
    } catch {
      // El tick de 30 s lo corrige.
    }
    try {
      await update($, actividad, () => ({}))
    } catch {
      // Sin limpiar, la caducidad de la espera lo corrige.
    }
    try {
      // `flujo` y `filasExploradores` no se vacían aquí: un `/reload-plugins` a mitad de flujo no los pierde.
      const guardada = pestanaValida(await $.store.get(PREF_PESTANA))
      await update($, pestana, () => guardada)
    } catch {
      // Sin store arranca en «Inicio».
    }
    await medirDesglose($, 'summary')
    try {
      await podarStore($)
    } catch {
      // Podar es limpieza: si falla, se intenta en la próxima sesión.
    }
    await releerSemana($)
    // En segundo plano: pide la carpeta personal (y lee el historial) sin frenar el arranque, para que abrir la pestaña «Historial»
    // no espere a `node -p`; con la pestaña abierta desde antes, el historial se ve sin esperar al tick.
    void releerHistorial($)
    // También en segundo plano: qué implementadores hay decide las pestañas, y hasta saberlo se muestra todo.
    void detectarInstalados($)

    // Mueve la cuenta regresiva y suma lo que otras sesiones anotaron; no llama a ningún modelo.
    $.clock.every(TICK_MS, () => {
      void $.clock.now().then(t => update($, ahora, () => t))
      void releerSemana($)
      void releerHistorial($)
      void detectarInstalados($)
    })

    // La onda solo avanza (y redibuja) mientras alguna fila tiene una petición en curso; en reposo no hace nada.
    $.clock.every(ONDA_MS, () => {
      void (async () => {
        const act = (await read($, actividad)) ?? {}
        const t = await $.clock.now()
        if (Object.keys(act).some(id => estadoActividad(act, id, t) === 'activo')) await update($, fase, n => (n ?? 0) + 1)
      })().catch(() => undefined)
    })

    try {
      // Tras `/reload-plugins` el panel puede seguir con el dibujo anterior y sus botones sin efecto.
      $.ui.invalidate('ui.render')
    } catch {
      // Sin redibujo se corrige con el próximo cambio de estado.
    }

    void abrir($)

    return next(e)
  })

  on('command.run', { command: 'panel' }, async ($, e) => {
    // `/panel carpeta` abre la carpeta sin depender del foco del panel ni del ratón.
    if (e.args.trim() === 'carpeta') return { text: await abrirCarpeta($) }

    const { isPlaced } = await abrir($)

    return { text: isPlaced ? 'Panel de uso abierto.' : 'Panel de uso: ensancha la terminal para verlo.' }
  })

  on('session.measure', async ($, e, next) => {
    await update($, medida, () => aMedida(e.context, e.rateLimits))
    // Un toast al cruzar 80 % y otro al cruzar 95 %; bajo 80 % se rearma. Un error aquí no frena la medición.
    try {
      const decision: { aviso: string | null } = { aviso: null }
      await update($, avisoContexto, antes => {
        const d = decidirAvisoContexto(antes === 80 || antes === 95 ? antes : 0, e.context.percent)
        decision.aviso = d.aviso

        return d.avisado
      })
      if (decision.aviso !== null) avisar($, decision.aviso)
    } catch {
      // Sin el aviso el panel sigue midiendo.
    }
    if (e.changed.includes('context')) await medirDesglose($, 'summary')
    // El reinicio del límite semanal decide dónde empieza la semana.
    if (e.changed.includes('rateLimits')) await releerSemana($)

    return next(e)
  })

  // Frena un envío una sola vez con un aviso (el siguiente, igual, pasa). Todo el cálculo va en el try: si algo falla, el envío pasa.
  on('prompt.submit', async ($, e, next) => {
    const decision: { motivo: string | null } = { motivo: null }
    try {
      // Solo lo que escribe la persona; una notificación, un mensaje de otra sesión o un prompt de plugin nunca se frena.
      if (!e.isMeta && (e.origin.kind === 'composer' || e.origin.kind === 'bridge')) {
        const m = await read($, medida)
        const f = await read($, flujo)
        const cierre = f === null ? null : { estado: f.estado, fin: f.fin }
        await update($, freno, antes => {
          const d = decidirFreno({ texto: e.text, comando: e.command?.name }, m?.tokens, cierre, antes ?? null)
          decision.motivo = d.motivo

          return d.freno
        })
      }
    } catch {
      decision.motivo = null
    }
    if (decision.motivo !== null) return { drop: decision.motivo }

    return next(e)
  })

  // `/clear` no dispara `session.start`: sin esto el panel seguiría con el contexto anterior
  // hasta el próximo turno. Los límites son de la cuenta y siguen valiendo.
  on('session.end', async ($, e, next) => {
    try {
      // Cualquier razón: lo que estaba en vuelo ya no cuenta para la sesión que sigue.
      await update($, actividad, () => ({}))
    } catch {
      // No puede frenar el cierre.
    }
    // Cualquier razón: el flujo de esta sesión no sigue en la que viene.
    await marcarFlujo($, () => null)
    await vaciarFilasExploradores($)
    if (e.reason === 'clear') {
      try {
        await update($, medida, m => (m === null ? null : { ventana: m.ventana, limites: m.limites }))
        await update($, desglose, () => null)
        await update($, precisando, () => false)
        await update($, sesion, () => null)
        await update($, cache, () => null)
        await update($, avisoContexto, () => 0)
        await update($, agentes, () => [])
        await update($, archivos, () => [])
      } catch {
        // No puede frenar el /clear.
      }
      $.clock.after(1_000, () => {
        void releerTrasLimpiar($)
      })
    }

    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    if (e.agentId === undefined) {
      try {
        const nivel = e.effort === undefined ? 'sin esfuerzo' : String(e.effort)
        await update($, esfuerzo, () => ({ nivel, modelo: e.model, origen: 'turno' as const }))
      } catch {
        // El panel no puede frenar una petición al modelo.
      }
      // Con qué modelo trabaja el orquestador: la skill dice uno, pero la sesión puede estar en otro.
      await marcarFlujo($, f => marcarOrquestador(f, nombreOrquestador(e.model, e.effort)))
    }

    // La fila se abre y se cierra con el id de la petición, no con el de la respuesta.
    const id = idFila(e.model, e.effort, e.agentId !== undefined)
    await marcarActividad($, (a, t) => iniciarPeticion(a, id, t))
    // Antes de `next` y fuera del try/finally: no puede frenar la petición ni dejar la actividad sin bajar.
    if (e.agentId !== undefined) await marcarExplorador($, id)

    let pideHerramienta = false
    // Un subagente sin herramientas que espera una tarea suya en segundo plano no terminó: sigue en curso, esperando (amarillo).
    let esperando = false
    let r: TurnStepResult
    try {
      r = yield* next(e)
      try {
        pideHerramienta = r.toolUses.length > 0 || r.stopReason === 'tool_use'
        if (!pideHerramienta && e.agentId !== undefined) {
          const id = e.agentId
          esperando = esperaFondo(await read($, agentes), id)
          pideHerramienta = esperando
        }
      } catch {
        // Sin saberlo, la fila queda inactiva.
      }
    } finally {
      // Falle o no la petición, el contador baja; el error de `next` sigue su camino intacto.
      await marcarActividad($, (a, t) => terminarPeticion(a, id, t, pideHerramienta))
    }

    // Con qué modelo y esfuerzo respondió el subagente; el nombre se calcula dentro para que un error lo atrape marcarFlujo.
    const agentId = e.agentId
    if (agentId !== undefined) {
      await marcarFlujo($, f => anotarConfig(f, agentId, nombreOrquestador(r.usage?.model || e.model, e.effort)))
      // Una respuesta sin herramientas es la final: cierra al agente, en primer o segundo plano; si esperaba su tarea de fondo, solo suelta la marca.
      if (esperando) await soltarEspera($, agentId, id)
      else if (!pideHerramienta) await cerrarAlResponder($, agentId)
      else {
        try {
          // Si vuelve a pedir herramientas, ya no espera su tarea de fondo: su próxima respuesta sin herramientas es la final.
          await update($, agentes, antes => quitarFondo(antes ?? [], agentId))
        } catch {
          // Sin soltarla, esa respuesta final se tomaría por otra espera.
        }
      }
    }

    if (r.usage !== null) {
      // Lo que gastó el subagente en esta respuesta, para su línea de detalle en «Agentes».
      if (agentId !== undefined) await registrarGastoAgente($, agentId, r.usage, r.usage.model || e.model, e.effort)
      // El gasto cuenta hilo principal y subagentes; va antes de anotarUso para que `turn.complete` no cierre el flujo entre medio.
      const uso = r.usage
      await marcarFlujo($, f => sumarGastoDeExplorador(sumarGasto(f, uso), e.agentId, uso))
      try {
        // La marca se decide al llegar la respuesta: en la fila, `turn.complete` ya pudo cerrar el flujo.
        const deFlujo = e.agentId === undefined && (await enFlujo($))
        await anotarUso($, r.usage.model || e.model, e.effort, e.agentId !== undefined, deFlujo, r.usage)
      } catch {
        // Perder una cuenta es mejor que frenar la respuesta.
      }
      // El caché del prompt es del hilo principal; las respuestas de los subagentes no lo mueven.
      if (e.agentId === undefined) {
        try {
          const hora = await $.clock.now()
          await update($, cache, antes => anotarCache(antes ?? null, uso, hora))
        } catch {
          // Sin la cuenta regresiva la respuesta sigue igual.
        }
      }
    }

    return r
  })

  // El turno del hilo principal terminó: ninguna fila espera ya una herramienta y el flujo, si había, cierra.
  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      try {
        // Los subagentes que esperan su tarea de fondo siguen esperando: su ■ no vuelve a gris.
        const filas = filasEnEspera(await read($, agentes))
        await update($, actividad, a => limpiarPendientes(a, filas))
      } catch {
        // La espera caduca sola a los 30 min.
      }
      // Lo gastado hasta aquí queda fijo en el flujo que acaba de terminar; el trabajo que siga en la sesión no lo mueve.
      const ses = await readSesion($)
      // Si el flujo estaba en curso y este turno lo cierra; se decide dentro del callback, con el estado que `update` leyó.
      let terminoAhora = false
      let estadoFin = ''
      // Los subagentes lanzados durante el flujo que aún corren: sin ellos el corte del turno sí lo interrumpe.
      let vivos: { estado: string; desde: number }[] = []
      try {
        vivos = (await read($, agentes)) ?? []
      } catch {
        // Sin saberlo, el turno sin CIERRE interrumpe el flujo.
      }
      await marcarFlujo($, (f, t) => {
        const enVuelo = f !== null && vivos.some(a => a.estado === 'corriendo' && a.desde >= f.inicio)
        const fin = terminarFlujo(f, e.reason, e.answer, t, enVuelo)
        // Con agentes en vuelo y sin cierre, `terminarFlujo` devuelve el mismo flujo: sigue en curso.
        terminoAhora = f !== null && f.estado === 'en curso' && fin !== null && fin.estado !== 'en curso'
        estadoFin = fin === null ? '' : fin.estado

        return terminoAhora ? congelarConsumo(fin, ses) : fin
      })
      if (terminoAhora) avisar($, `Flujo terminado: ${estadoFin}`)
      // El flujo ya anotó su fila en `flujos.jsonl`; `releerHistorial` nunca rechaza.
      if (terminoAhora) await releerHistorial($)
    }

    return next(e)
  })

  // Solo observa: el texto de la skill pasa tal cual.
  on('skill.prompt', async ($, e, next) => {
    // Lo que la sesión ya gastó, para descontarlo del consumo del flujo nuevo.
    const base = baseDeUso(await readSesion($))
    await marcarFlujo($, (f, t) => iniciarFlujo(e.skill, e.text, t, base) ?? f)
    // Un flujo nuevo no hereda las filas del anterior.
    try {
      if (iniciarFlujo(e.skill, e.text) !== null) await vaciarFilasExploradores($)
    } catch {
      // Sin vaciar, el ■ de más solo se ve con un flujo en curso y exploradores en vuelo.
    }

    return next(e)
  })

  // Solo observa: la herramienta corre y su resultado vuelve tal cual (un error de `next` no se traga).
  on('tool.call', async ($, e, siguiente) => {
    // La pestaña «Agentes» anota la herramienta antes y, al volver, su archivo o el cierre de su `Agent`; el resultado y el error de `siguiente` pasan intactos.
    await contarHerramienta($, e.agentId, (e as unknown as Record<string, unknown>).run_in_background === true)
    const next: typeof siguiente = async evento => {
      let r: Awaited<ReturnType<typeof siguiente>>
      try {
        r = await siguiente(evento)
      } catch (error) {
        await anotarAlVolver($, e, undefined, false)
        throw error
      }
      await anotarAlVolver($, e, r, true)

      return r
    }

    const s = senalDeHerramienta(e.tool, e as unknown as Record<string, unknown>, e.agentId)
    if (s === null) return next(e)

    if (s.tipo === 'agente') await vaciarAlAbrirTanda($, s)

    // Una pregunta del hilo principal con el flujo en curso espera a la persona: se decide antes de que `marcarFlujo` la anote.
    const avisarPregunta = s.tipo === 'pregunta' && e.agentId === undefined && (await enFlujo($))

    await marcarFlujo($, (f, t) => {
      if (s.tipo === 'pregunta') return abrirEspera(avanzar(f, s, t), t)

      return s.tipo === 'agente' ? marcarAgente(avanzar(f, s, t), s.nombre) : avanzar(f, s, t)
    })
    if (s.tipo === 'pregunta' && avisarPregunta) avisar($, s.plan ? 'El plan espera tu aprobación' : 'El flujo te hace una pregunta')

    // Mientras la pregunta espera al usuario, ese tiempo es espera y no trabajo; se cierra siempre, también si falla o se interrumpe.
    if (s.tipo === 'pregunta') {
      try {
        return await next(e)
      } finally {
        await marcarFlujo($, (f, t) => cerrarEspera(f, t))
      }
    }

    const fin = senalAlTerminar(s)
    if (fin === null) return next(e)

    const esExplorador = s.tipo === 'agente' && s.nombre === AGENTE_DE_PASO.explorador.agente
    const llamada = typeof e.tool_use_id === 'string' ? e.tool_use_id : undefined

    // La vuelta se descuenta siempre, también si la herramienta falla; el error de `next` sigue su camino intacto.
    let bien = false
    let datos: ReturnType<typeof datosDeExplorador> = null
    try {
      const r = await next(e)
      bien = true
      try {
        // Lo que dice el resultado de un explorador (su agentId, su duración); leerlo no puede romper la herramienta.
        if (esExplorador) datos = datosDeExplorador(e, r)
      } catch {
        // Sin los datos, la línea del explorador queda sin esa cifra.
      }

      return r
    } finally {
      const d = datos
      await marcarFlujo($, (f, t) => {
        const avanzado = avanzar(f, senalAlTerminar(s, bien) ?? fin, t)

        if (d !== null) return anotarExplorador(avanzado, d.id, { descripcion: d.descripcion, ms: d.ms, hasta: t })

        // Un explorador que falló o volvió sin `agentId` no deja de contar su tiempo si no se fija aquí.
        return esExplorador ? cerrarExploradorSinId(avanzado, e, t, llamada) : avanzado
      })
    }
  })

  // Solo observa: el lanzamiento sigue su camino (nunca se niega) y su resultado, o su error, vuelve tal cual.
  on('agent.spawn', async ($, e, next) => {
    const r = await next(e)
    // Cualquier subagente (de cualquier flujo) queda anotado para la pestaña «Agentes»; sin `agentId` en el resultado no hay nada que anotar.
    try {
      const vivo = objeto(r)?.agentId
      const t = await $.clock.now()
      await update($, agentes, antes => anotarAgente(antes ?? [], { id: vivo, tipo: e.subagentType, descripcion: e.description, llamada: e.tool_use_id, t }))
    } catch {
      // Sin la anotación, la pestaña «Agentes» no lo muestra.
    }
    let id = ''
    try {
      const agentId = (r as { agentId?: unknown }).agentId
      if (typeof e.subagentType === 'string' && rolDeAgente(e.subagentType) === AGENTE_DE_PASO.explorador.agente && typeof agentId === 'string') id = agentId
    } catch {
      // Sin el id, el explorador se anota al volver su resultado.
    }
    if (id !== '') {
      const descripcion = typeof e.description === 'string' ? e.description : ''
      const llamada = typeof e.tool_use_id === 'string' ? e.tool_use_id : undefined
      await marcarFlujo($, (f, t) => anotarExplorador(f, id, { descripcion, desde: t, llamada }))
    }

    return r
  })

  on('ui.render', { component: 'Pane', requestId: PANEL }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const m = await read($, medida)
    const esf = await read($, esfuerzo)
    const d = await read($, desglose)
    const ocupado = await read($, precisando)
    const sem = await read($, semana)
    const ses = await read($, sesion)
    const act = await read($, actividad)
    const fl = await read($, flujo)
    // Atoms nuevos: tras un `/reload-plugins` el estado anterior puede no traerlos.
    const pestGuardada = (await read($, pestana)) ?? 'inicio'
    const his = (await read($, historial)) ?? null
    const inst = (await read($, instalados)) ?? null
    const cac = (await read($, cache)) ?? null
    const ags = (await read($, agentes)) ?? []
    const arcs = (await read($, archivos)) ?? []
    await read($, ahora)
    const paso = (await read($, fase)) ?? 0
    const t = await $.clock.now()

    // Qué se muestra según los implementadores instalados; la evidencia de uso gana sobre un «no está».
    const vista = vistaDe(inst, { flujo: fl !== null, historial: (his?.filas.length ?? 0) > 0 })
    // Una pestaña oculta dibuja «Inicio»; la preferencia guardada no se borra. «Agentes» solo existe con algún agente anotado.
    const pest = pestanaValida(pestGuardada, { ...vista, agentes: ags.length > 0 })

    // Todo va en tarjetas con borde: lo de dentro mide el cuerpo menos el marco.
    const interior = Math.max(1, e.props.bodyColumns - MARCO)
    const ancho = Math.max(6, Math.min(40, interior))

    // Fila de un día: etiqueta (6) + espacio (1) + barra + total (7) = `ancho`.
    const anchoBarraDia = Math.max(1, ancho - 6 - 1 - 7)
    const maxDia = (s: Semana) => Math.max(1, ...s.dias.map(x => x.total))

    /**
     * La barra de una fila: un `Text` por tramo (principal, flujo, subagente y vacío), sin los vacíos.
     * Con `activa` (petición en curso) la recorre la onda de `conOnda`, que avanza con el atom `fase`.
     */
    const barraConTramos = (parte: number, flujo: number, sub: number, anchoBarra: number, activa: boolean) => {
      const b = barraTramos(parte, flujo, sub, anchoBarra)
      const trozos: TrozoBarra[] = [
        { texto: b.principal, color: 'claude' },
        { texto: b.flujo, color: COLOR_FLUJO },
        { texto: b.sub, color: COLOR_SUB },
        { texto: b.vacio, color: 'claude' },
      ]

      return (activa ? conOnda(trozos, paso, 'text', 'claudeShimmer') : unirPorColor(trozos)).map((x, i) => (
        <Text key={`trozo-${i}`} color={x.color}>
          {x.texto}
        </Text>
      ))
    }

    /**
     * Tokens por modelo y esfuerzo: la misma tabla para la sesión y la semana.
     * Cada tabla alinea en columnas las etiquetas de sus propias filas (familia · versión · esfuerzo).
     * Bajo cada fila va su barra con el % de la sección (barra + % = ancho).
     * Con `conActividad`, cada fila lleva un solo ■ y « xN» (`agentesEnCurso`, x0 sin ninguno). El ■ lleva el color
     * de la fila (`estadoDeFila`): verde si alguna petición está en vuelo, amarillo si espera, gris si está inactiva.
     * Con `conDesglose`, bajo la barra de cada fila con flujo o subagentes va su desglose (`desgloseTramos`).
     * Con `conDias`, tras las filas va el total de cada día («por día»).
     * El encabezado lleva el total y la salida.
     */
    const tabla = (
      titulo: string,
      prefijo: string,
      s: Semana | null,
      desde: string | null,
      conActividad = false,
      conDesglose = false,
      conDias = false,
      cabecera: JSX.Element | null = null,
    ) => {
      const conSalida = s === null ? '' : totalConSalida(s.total, s.salida)
      // El « xN» de una fila: N = agentes en curso con su modelo·esfuerzo (x0 sin ninguno).
      const enCurso = (f: FilaSemana) => agentesEnCurso(ags, `${f.modelo} ${f.esfuerzo}`)
      // Las etiquetas van en columnas y dejan sitio a las cifras y, con `conActividad`, al sufijo « ■ xN».
      const anchoSufijo =
        conActividad && s !== null ? Math.max(0, ...s.filas.map(f => ' ■ x'.length + String(enCurso(f)).length)) : 0
      const etiquetas =
        s !== null ? etiquetasAlineadas(s.filas, Math.max(1, interior - COLUMNAS_CIFRAS - anchoSufijo)) : []

      return (
        <Box key={`tabla-${prefijo}`} flexDirection="column" marginTop={prefijo === 'n' ? 0 : 1}>
          <Box>
            <Box flexGrow={1}>
              {cabecera ?? <Text bold color="claude">{titulo}</Text>}
              {/* Esta sesión vacía cabe en una línea: el título y, detrás, lo que falta. */}
              {cabecera === null && prefijo === 'n' && (s === null || s.filas.length === 0) && (
                <Text dimColor>{' · sin respuestas anotadas'}</Text>
              )}
            </Box>
            {cabecera === null && s !== null && s.total > 0 && <Text>{conSalida}</Text>}
          </Box>
          {s === null || s.filas.length === 0 ? (
            prefijo === 'n' ? null : <Text dimColor>sin respuestas anotadas todavía</Text>
          ) : (
            <Box flexDirection="column">
              <Box>
                <Box flexGrow={1}>
                  <Text dimColor>modelo · esfuerzo</Text>
                </Box>
                <Text dimColor>{'total'.padStart(7)}</Text>
                <Text dimColor>{'salida'.padStart(7)}</Text>
              </Box>
              {s.filas.map((f, indice) => {
                const parte = s.total > 0 ? (f.total / s.total) * 100 : 0

                return (
                  <Box
                    key={`${prefijo}-${f.modelo}-${f.esfuerzo}-${f.origen}`}
                    flexDirection="column"
                    marginTop={prefijo === 'n' && indice > 0 ? 1 : 0}
                  >
                    <Box>
                      <Box flexGrow={1}>
                        <Text wrap="truncate-end">{etiquetas[indice] ?? ''}</Text>
                        {conActividad && (
                          <Text color={COLOR_ACTIVIDAD[estadoDeFila(act, idsDeActividad(f), t)]}>{' ■'}</Text>
                        )}
                        {conActividad && <Text dimColor>{` x${enCurso(f)}`}</Text>}
                      </Box>
                      <Text>{tokens(f.total).padStart(7)}</Text>
                      <Text dimColor>{tokens(f.salida).padStart(7)}</Text>
                    </Box>
                    <Box>
                      {barraConTramos(
                        parte,
                        ((f.flujo ?? 0) / s.total) * 100,
                        ((f.sub ?? 0) / s.total) * 100,
                        Math.max(1, ancho - 7),
                        conActividad && estadoDeFila(act, idsDeActividad(f), t) === 'activo',
                      )}
                      <Text dimColor>{pct(parte).padStart(7)}</Text>
                    </Box>
                    {conDesglose && desgloseTramos(f, ancho) !== '' && (
                      <Text dimColor wrap="truncate-end">
                        {desgloseTramos(f, ancho)}
                      </Text>
                    )}
                  </Box>
                )
              })}
            </Box>
          )}
          {conDias && s !== null && s.dias.length > 0 && (
            <Box flexDirection="column" marginTop={1}>
              <Text dimColor>por día</Text>
              {s.dias.map(dia => (
                <Box key={`dia-${dia.inicio}`}>
                  <Text>{`${etiquetaDia(dia.inicio).padEnd(6)} `}</Text>
                  <Text color="claude">{barra((dia.total / maxDia(s)) * 100, anchoBarraDia)}</Text>
                  <Text dimColor>{tokens(dia.total).padStart(7)}</Text>
                </Box>
              ))}
            </Box>
          )}
          {s !== null && (desde !== null || s.total > 0) && (
            <Box key={`nota-${prefijo}`} marginTop={prefijo === 'n' ? 1 : 0}>
              <Text dimColor wrap="truncate-end">
                {[cabecera !== null && s.total > 0 ? conSalida : null, desde, s.total > 0 ? 'total incluye caché' : null]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
            </Box>
          )}
        </Box>
      )
    }

    const limites = m?.limites ?? []
    const nivel = esf === null ? '—' : esf.nivel

    if (e.props.placement === 'inline') {
      const partes = [
        `ctx ${m?.porcentaje === undefined ? '—' : `${m.porcentaje}%`}`,
        ...limites.map(l => {
          const reinicio = l.resetsAt === undefined ? '' : ` (${falta(t, Date.parse(l.resetsAt))})`

          return `${nombreCorto(l.kind)} ${l.percentUsed}%${reinicio}`
        }),
        `esfuerzo ${nivel}`,
      ]

      return <Text wrap="truncate-end">{partes.join(' · ')}</Text>
    }

    /**
     * Los botones de las pestañas, arriba de todo en todas las vistas, repartidos en filas según el ancho (cada uno mide `[ label ]`;
     * las etiquetas son cortas para que los cuatro quepan en una fila de 40 columnas). «Carpeta» va al pie (`pieCarpeta`).
     */
    const botones = [
      { clave: 'pestana-inicio', pestana: 'inicio', hotkey: 'i', label: 'Inicio', alPulsar: () => elegirPestana($, 'inicio') },
      { clave: 'pestana-semana', pestana: 'semana', hotkey: 's', label: 'Semana', alPulsar: () => elegirPestana($, 'semana') },
      ...(vista.historial ? [{ clave: 'pestana-historial', pestana: 'historial', hotkey: 'h', label: 'Hist.', alPulsar: () => elegirPestana($, 'historial') }] : []),
      ...(ags.length > 0 ? [{ clave: 'pestana-agentes', pestana: 'agentes', hotkey: 'a', label: 'Agentes', alPulsar: () => elegirPestana($, 'agentes') }] : []),
    ]
    const filaPestanas = (
      <Box key="pestanas" flexDirection="column">
        {repartir(
          botones.map(b => `[ ${b.label} ]`.length),
          e.props.bodyColumns,
        ).map(fila => (
          <Box key={`pestanas-${fila[0]}`}>
            {fila.flatMap(i => {
              const b = botones[i]

              // La pestaña abierta va en el color de acento; las demás, tenues.
              return b === undefined
                ? []
                : [
                    b.pestana === pest ? (
                      <Button key={b.clave} hotkey={b.hotkey} label={b.label} variant="primary" onPress={b.alPulsar} />
                    ) : (
                      <Button key={b.clave} hotkey={b.hotkey} label={b.label} dimColor onPress={b.alPulsar} />
                    ),
                  ]
            })}
          </Box>
        ))}
      </Box>
    )

    /** «Carpeta», al pie de todas las vistas: abre la carpeta sin cambiar de pestaña. */
    const pieCarpeta = (
      <Box key="pie-carpeta" marginTop={1}>
        <Button key="carpeta" hotkey="c" label="Carpeta" onPress={() => abrirCarpeta($)} />
      </Box>
    )

    /** Una tarjeta: borde redondeado del color de su sección y un hueco de 1 a cada lado (`MARCO`). */
    const tarjeta = (clave: string, color: Color, contenido: JSX.Element) => (
      <Box key={clave} flexDirection="column" borderStyle="round" borderColor={color} paddingX={1}>
        {contenido}
      </Box>
    )

    /** El título de una tarjeta, en negrita y con el color de su borde; `derecha` va tenue al otro extremo. */
    const tituloTarjeta = (texto: string, color: Color, derecha = '') => (
      <Box key={`titulo-${texto}`}>
        <Box flexGrow={1}>
          <Text bold color={color}>
            {texto}
          </Text>
        </Box>
        {derecha !== '' && <Text dimColor>{derecha}</Text>}
      </Box>
    )

    // La sesión unida por modelo·esfuerzo: la tabla de Inicio y el estado de la cabecera.
    const sesionUnida = ses === null ? null : unirOrigenes(ses)
    const estadoSesion = estadoDeFila(act, (sesionUnida?.filas ?? []).flatMap(idsDeActividad), t)

    /** La cabecera del panel, en todas las vistas: el nombre y el estado de la sesión (el de su fila más activa). */
    const cabeceraPanel = (
      <Box key="cabecera-panel">
        <Box flexGrow={1}>
          <Text bold color="claude">
            {'◆ QCC'}
          </Text>
          <Text dimColor>{' · panel'}</Text>
        </Box>
        <Text color={COLOR_ACTIVIDAD[estadoSesion]}>{TEXTO_ACTIVIDAD[estadoSesion]}</Text>
      </Box>
    )

    /**
     * Los límites, bajo la fila de pestañas y en todas las vistas: una línea por límite
     * (etiqueta, mini barra, % y cuánto falta; barra y % con el tono del %). Sin límites, un aviso dim.
     * El borde lleva el tono del límite más gastado.
     */
    const colorLimites: Color = limites.length === 0 ? 'subtle' : tono(Math.max(...limites.map(l => l.percentUsed)))
    const bloqueLimites = tarjeta(
      'tarjeta-limites',
      colorLimites,
      <Box key="limites" flexDirection="column">
        {tituloTarjeta('LÍMITES', colorLimites)}
        {limites.length === 0 ? (
          <Text dimColor>límites tras la 1.ª respuesta</Text>
        ) : (
          limites.map(l => {
            const reinicio = l.resetsAt === undefined ? undefined : Date.parse(l.resetsAt)
            const linea = lineaLimite(l.kind, l.percentUsed, reinicio, t, interior)

            return (
              <Box key={`limite-${l.kind}`}>
                <Text>{`${linea.etiqueta} `}</Text>
                <Text color={tono(l.percentUsed)}>{linea.barra}</Text>
                <Text bold color={tono(l.percentUsed)}>{linea.cifra}</Text>
                {linea.cola !== '' && <Text dimColor>{linea.cola}</Text>}
              </Box>
            )
          })
        )}
      </Box>,
    )

    /**
     * La pestaña «Historial»: el promedio y, por flujo, sus líneas (la de identidad; después, dim, el título en hasta 2 líneas y las cifras
     * con dólares, tiempo, tokens y cambios). Sin filas, un aviso.
     */
    const promedio = his === null ? {} : promedioHistorial(his.filas)
    const bloqueHistorial = tarjeta(
      'tarjeta-historial',
      'suggestion',
      <Box key="historial" flexDirection="column">
        <Text bold color="suggestion">
          Historial
        </Text>
        {his === null || his.filas.length === 0 ? (
          <Text dimColor>sin flujos anotados todavía</Text>
        ) : (
          <Box flexDirection="column">
            <Text dimColor wrap="truncate-end">
              {`promedio ${cifraUsd(promedio.usd)} · ${cifraMinutos(promedio.minutos)} · ${his.filas.length} flujos`}
            </Text>
            {his.filas.map((f, i) => (
              <Box key={`historial-${i}`} flexDirection="column" marginTop={i === 0 ? 0 : 1}>
                {lineasHistorial(f, interior).map((linea, j) => (
                  <Text key={`historial-${i}-${j}`} bold={j === 0} dimColor={j > 0} wrap="truncate-end">
                    {linea}
                  </Text>
                ))}
              </Box>
            ))}
          </Box>
        )}
      </Box>,
    )

    /**
     * La pestaña «Agentes»: el resumen, por subagente una línea con el glifo de su estado, el rol, el tiempo y las herramientas y debajo su
     * descripción, y los archivos tocados, de lo más reciente a lo más viejo.
     */
    const lineasAgentes = resumenAgentes(ags, arcs, t, Math.min(interior, COLUMNAS))
    const bloqueAgentes = (
      <Box key="agentes-bloque" flexDirection="column">
        {tarjeta(
          'tarjeta-agentes',
          'permission',
          <Box key="agentes" flexDirection="column">
            {/* El resumen hace de título de la tarjeta. */}
            <Text bold color="permission" wrap="truncate-end">
              {lineasAgentes.resumen}
            </Text>
            {lineasAgentes.agentes.map((a, i) => (
              <Box key={`agente-${i}`} flexDirection="column">
                <Box>
                  <Text color={a.color}>{`${a.glifo} `}</Text>
                  <Box flexGrow={1}>
                    <Text bold wrap="truncate-end">{a.rol}</Text>
                  </Box>
                  <Box flexShrink={0}>
                    <Text dimColor>{a.cola}</Text>
                  </Box>
                </Box>
                {a.descripcion !== '' && (
                  <Text dimColor wrap="truncate-end">
                    {`  ${a.descripcion}`}
                  </Text>
                )}
                {a.detalle !== '' && (
                  <Text dimColor wrap="truncate-end">
                    {a.detalle}
                  </Text>
                )}
              </Box>
            ))}
          </Box>,
        )}
        {lineasAgentes.archivos.length > 0 &&
          tarjeta(
            'tarjeta-archivos',
            'success',
            <Box key="agentes-archivos" flexDirection="column">
              <Text bold color="success">
                Archivos tocados
              </Text>
              {lineasAgentes.archivos.map((a, i) => (
                <Box key={`archivo-${i}`}>
                  <Text wrap="truncate-end">{a.ruta}</Text>
                  <Text dimColor>{a.cola}</Text>
                </Box>
              ))}
            </Box>,
          )}
      </Box>
    )

    /**
     * Leyenda de los tramos de las barras de las dos tablas; se dibuja en «Inicio» y en «Gasto semanal».
     * Va en filas (`repartir`) y ninguna pasa de 32 columnas.
     */
    const entradasLeyenda = [
      { color: 'claude', nombre: 'directo' },
      ...(vista.orquestador ? [{ color: COLOR_FLUJO, nombre: 'orquestador' }] : []),
      { color: COLOR_SUB, nombre: 'subagentes' },
    ]
    const leyenda = (separada: boolean) => (
      <Box key="leyenda" flexDirection="column" marginTop={separada ? 1 : 0}>
        {repartir(
          entradasLeyenda.map(entrada => 2 + entrada.nombre.length),
          Math.min(interior, COLUMNAS),
          2,
        ).map(fila => (
          <Box key={`leyenda-${fila[0]}`}>
            {fila.flatMap((indice, i) => {
              const entrada = entradasLeyenda[indice]

              return entrada === undefined
                ? []
                : [
                    ...(i === 0 ? [] : [<Text key={`separador-${entrada.nombre}`}>{'  '}</Text>]),
                    <Text key={`color-${entrada.nombre}`} color={entrada.color}>
                      ■
                    </Text>,
                    <Text key={`nombre-${entrada.nombre}`} dimColor wrap="truncate-end">
                      {' ' + entrada.nombre}
                    </Text>,
                  ]
            })}
          </Box>
        ))}
      </Box>
    )

    // Cada pestaña dibuja la fila de pestañas y solo su contenido; `pestana-inicio` vuelve a «Inicio».
    if (pest === 'agentes') {
      return (
        <Box flexDirection="column">
          {cabeceraPanel}
          {filaPestanas}
          {bloqueLimites}
          {bloqueAgentes}
          {pieCarpeta}
        </Box>
      )
    }

    if (pest === 'historial') {
      return (
        <Box flexDirection="column">
          {cabeceraPanel}
          {filaPestanas}
          {bloqueLimites}
          {bloqueHistorial}
          {pieCarpeta}
        </Box>
      )
    }

    if (pest === 'semana') {
      return (
        <Box flexDirection="column">
          {cabeceraPanel}
          {filaPestanas}
          {bloqueLimites}
          {tarjeta(
            'tarjeta-semana',
            'claude',
            <Box key="semana" flexDirection="column">
              {leyenda(false)}
              {tabla(
                'Esta semana',
                's',
                sem,
                sem === null
                  ? null
                  : sem.registroDesde !== null && sem.registroDesde > sem.desde
                    ? `anotado desde ${cuando(t, sem.registroDesde)}`
                    : `desde ${cuando(t, sem.desde)}`,
                false,
                false,
                true,
              )}
            </Box>,
          )}
          {pieCarpeta}
        </Box>
      )
    }

    /**
     * La cabecera de «Esta sesión»: «SESIÓN  Opus 5.5 · high». El modelo con el esfuerzo y, con un implementador
     * instalado y un flujo en curso, el resumen del flujo. Si no cabe se recorta el flujo, nunca el modelo ni el
     * esfuerzo. El total de la sesión va en la nota de abajo, no en esta fila.
     */
    const cabeceraSesion = (
      <Box key="sesion-cabecera">
        <Box flexShrink={0}>
          <Text bold color="claude">
            {'SESIÓN  '}
          </Text>
        </Box>
        <Box flexShrink={0}>
          <Text dimColor>
            {esf === null ? '—' : `${familia(esf.modelo)} · ${nivel}`}
          </Text>
        </Box>
        {vista.flujo && fl !== null && (
          <Box>
            <Text dimColor wrap="truncate-end">
              {' · flujo '}
            </Text>
            <Box key="flujo-resumen">
              <Text dimColor wrap="truncate-end">
                {resumenFlujo(fl, t)}
              </Text>
            </Box>
          </Box>
        )}
      </Box>
    )
    // Una sola fila como las de los límites: etiqueta, barra, cifra y cola. Con desglose y medición, solo etiqueta y
    // barra a todo el ancho: la cifra y los tokens ya van en la cabecera, pegada bajo la barra, y no se repiten.
    const lineaCtx = lineaContexto(m, interior)
    const resumen = d === null ? null : resumenContexto(d)
    // El caché del prompt: cuenta regresiva a su vencimiento (TTL de 5 min desde la última respuesta) y tasa de aciertos.
    // Tras ⏱ van dos espacios: la terminal lo dibuja ancho y con uno solo se pega al texto.
    const quedaCache = restante(cac, t)
    const aciertos = tasaAciertos(cac)
    const textoCache =
      cac === null || quedaCache === null
        ? 'caché: tras la 1.ª respuesta'
        : `${quedaCache === 0 ? 'caché vencido' : `caché ⏱  ${falta(t, cac.t + TTL_CACHE_MS)}`}${aciertos === null ? '' : ` · aciertos ${aciertos} %`}`
    const colorCache = quedaCache === null ? undefined : quedaCache === 0 ? 'error' : quedaCache <= 60_000 ? 'warning' : 'success'
    const barraAncha = d !== null && lineaCtx.medido
    const anchoBarra = barraAncha ? Math.max(3, interior - lineaCtx.etiqueta.length - 1) : lineaCtx.barra.length
    // El borde del contexto lleva el tono de la compactación (o el de la medición sin desglose).
    const colorContexto: Color =
      resumen !== null ? tonoCompactacion(resumen.porcentaje) : lineaCtx.medido && m?.porcentaje !== undefined ? tono(m.porcentaje) : 'subtle'

    return (
      <Box flexDirection="column">
        {cabeceraPanel}
        {filaPestanas}
        {bloqueLimites}
        {tarjeta(
          'tarjeta-contexto',
          colorContexto,
          <Box key="contexto" flexDirection="column">
            {tituloTarjeta('CONTEXTO', colorContexto)}
            <Box key="contexto-fila">
              <Text>{`${lineaCtx.etiqueta} `}</Text>
              {d !== null ? (
                <Box>
                  {tramos(d.partes, anchoBarra).map((tr, i) => (
                    <Text key={`t${i}`} color={tr.color}>
                      {relleno(tr.tipo).repeat(tr.celdas)}
                    </Text>
                  ))}
                </Box>
              ) : lineaCtx.medido && m?.porcentaje !== undefined ? (
                <Text color={tono(m.porcentaje)}>{lineaCtx.barra}</Text>
              ) : (
                <Text color="subtle">{lineaCtx.barra}</Text>
              )}
              {!barraAncha && (lineaCtx.medido && m?.porcentaje !== undefined ? (
                <Text color={tono(m.porcentaje)}>{lineaCtx.cifra}</Text>
              ) : (
                <Text dimColor>{lineaCtx.cifra}</Text>
              ))}
              {!barraAncha && lineaCtx.cola !== '' && <Text dimColor>{lineaCtx.cola}</Text>}
            </Box>

            {resumen !== null && (
              <Box key="resumen-ctx" justifyContent="space-between">
                <Text bold color={tonoCompactacion(resumen.porcentaje)}>{`${resumen.porcentaje}%`}</Text>
                <Text wrap="truncate-end">
                  <Text>{tokens(resumen.usados)}</Text>
                  <Text dimColor>{` / ${tokens(resumen.ventana)}`}</Text>
                </Text>
              </Box>
            )}
            {resumen !== null && resumen.compacta && (
              <Box key="compactacion-ctx" justifyContent="space-between">
                <Text dimColor>{`╰ compacta en ${tokens(resumen.punto)}`}</Text>
                <Text dimColor>{`faltan ${tokens(Math.max(0, resumen.punto - resumen.usados))}`}</Text>
              </Box>
            )}
            <Box key="cache-ctx">
              {colorCache === undefined ? (
                <Text dimColor wrap="truncate-end">{textoCache}</Text>
              ) : (
                <Text color={colorCache} wrap="truncate-end">{textoCache}</Text>
              )}
            </Box>

            {d !== null && (
              <Box key="desglose" flexDirection="column" marginTop={1}>
                {ordenLeyenda(d.partes).map((p, i) => (
                  <Box key={`p-${p.nombre}`}>
                    <Text color={p.color}>{marcador(p.tipo)} </Text>
                    <Box flexGrow={1}>
                      <Text wrap="truncate-end">{p.nombre}</Text>
                    </Box>
                    <Text>{tokens(p.tokens).padStart(6)}</Text>
                    <Text dimColor>{pctParte(p).padStart(7)}</Text>
                    {i === 0 && p.tipo === 'usado' && resumen !== null && (
                      <Box marginLeft={1}>
                        <Text dimColor>{cuotaUsado(p.tokens, resumen.usados)}</Text>
                      </Box>
                    )}
                  </Box>
                ))}
                {m !== null && d.ventana !== m.ventana && (
                  <Text dimColor>% sobre la ventana de compactación ({tokens(d.ventana)})</Text>
                )}
              </Box>
            )}

            {d !== null && d.pesados.length > 0 && (
              <Box key="pesados" flexDirection="column" marginTop={1}>
                <Text dimColor>Lo más pesado</Text>
                {d.pesados.map(p => (
                  <Box key={`h-${p.nombre}`}>
                    <Box flexGrow={1}>
                      <Text wrap="truncate-end">  {p.nombre}</Text>
                    </Box>
                    <Text>{tokens(p.tokens).padStart(6)}</Text>
                  </Box>
                ))}
              </Box>
            )}

            {d !== null && (
              <Box key="precisar-fila" marginTop={1}>
                <Button
                  key="precisar"
                  hotkey="p"
                  label={ocupado ? 'Precisando…' : 'Precisar'}
                  onPress={() => precisar($)}
                />
                <Text dimColor> {ocupado ? 'contando' : d.exacto ? 'exacto' : 'estimado'}</Text>
              </Box>
            )}
          </Box>,
        )}

        {tarjeta(
          'sesion-bloque',
          'claude',
          <Box key="sesion" flexDirection="column">
            {/* La hora anotada se redondea a la hora entera: «desde» mentiría en la sesión. */}
            <Box key="sesion-tabla" flexDirection="column">
              {tabla('Esta sesión', 'n', sesionUnida, null, true, true, false, cabeceraSesion)}
            </Box>

            {sesionUnida !== null && sesionUnida.filas.length > 0 && leyenda(true)}
          </Box>,
        )}

        {pieCarpeta}
      </Box>
    )
  })
}
