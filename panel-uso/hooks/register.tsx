import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionContextUsage, SessionRateLimit, TurnStepResult } from 'claude-code'

import type { Actividad, Esfuerzo, Flujo, Medida, Semana } from '../types'
import { comandoCarpeta, tipoDeRuta } from './carpeta'
import type { SistemaCarpeta } from './carpeta'
import { anotarFilaExplorador, avanzar, cuadradosDeFila, iniciarFlujo, nodos, resumenFlujo, senalAlTerminar, senalDeHerramienta, terminarFlujo } from './flujo'
import {
  aDesglose,
  barra,
  barraPartida,
  cuando,
  duracion,
  etiquetasAlineadas,
  falta,
  marcador,
  nombreCorto,
  nombreVentana,
  ordenar,
  pct,
  relleno,
  tokens,
  tono,
  totalConSalida,
  tramos,
} from './formato'
import {
  PREFIJO,
  RETENCION_MS,
  anotar,
  clave,
  comoRegistro,
  estadoActividad,
  etiquetaDia,
  idDeFila,
  idFila,
  inicioSemana,
  iniciarPeticion,
  limpiarPendientes,
  podar,
  resumir,
  unirOrigenes,
  terminarPeticion,
} from './semana'
import type { NivelEsfuerzo, Registro, Uso } from './semana'

const PANEL = 'panel-uso'
const COLUMNAS = 36
const TICK_MS = 30_000
const SCROLL_MS = 150

/** `key` de la sección plegable «Esta semana», para apuntarle con `$.ui.scroll`. */
const CLAVE_SEMANA = 'semana'

const medida = atom({ plugin: 'panel-uso', key: 'medida' } as const, null)
const esfuerzo = atom({ plugin: 'panel-uso', key: 'esfuerzo' } as const, null)
const ahora = atom({ plugin: 'panel-uso', key: 'ahora' } as const, 0)
const desglose = atom({ plugin: 'panel-uso', key: 'desglose' } as const, null)
const precisando = atom({ plugin: 'panel-uso', key: 'precisando' } as const, false)
const semana = atom({ plugin: 'panel-uso', key: 'semana' } as const, null)
const sesion = atom({ plugin: 'panel-uso', key: 'sesion' } as const, null)
const semanaAbierta = atom({ plugin: 'panel-uso', key: 'semanaAbierta' } as const, false)
const actividad = atom({ plugin: 'panel-uso', key: 'actividad' } as const, {})
const flujo = atom({ plugin: 'panel-uso', key: 'flujo' } as const, null)
const flujoAbierto = atom({ plugin: 'panel-uso', key: 'flujoAbierto' } as const, false)
const filasExploradores = atom({ plugin: 'panel-uso', key: 'filasExploradores' } as const, [])

/** Color de los ■ de cada fila de «Esta sesión» según su actividad (todos de la fila llevan el mismo). */
const COLOR_ACTIVIDAD = { activo: 'success', espera: 'warning', inactivo: 'subtle' } as const

/** Fuera del prefijo `uso:`: la poda y la suma de la semana no la tocan. */
const PREF_SEMANA = 'prefs:semana'

/** Igual que `PREF_SEMANA`: la sección «Flujo» desplegada o plegada. */
const PREF_FLUJO = 'prefs:flujo'

/** Color del glifo de «Terminado» según cómo terminó el flujo. */
const COLOR_FIN = { completo: 'success', detenido: 'warning', interrumpido: 'error' } as const

/** Color del tramo de subagentes en las barras de «Esta semana»; distinto de `claude` y de los de estado. */
const COLOR_SUB = 'suggestion'

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
async function anotarUso($: EngineInterface, modelo: string, nivel: NivelEsfuerzo, subagente: boolean, uso: Uso) {
  await enFila(async () => {
    const k = `${PREFIJO}${await $.session.id()}`
    const t = await $.clock.now()
    const antes = comoRegistro(await $.store.get(k))
    await $.store.set(k, anotar(antes, t, clave(modelo, nivel, subagente), uso))
  })
  await releerSemana($)
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
 * Lleva «Esta semana» al borde de arriba de la ventana del panel, para que sus filas
 * queden a la vista. Un fallo o un `{ deny }` no importan: el panel sigue como estaba.
 */
async function mostrarSemana($: EngineInterface) {
  try {
    await $.ui.scroll({ in: PANEL, to: { key: CLAVE_SEMANA }, block: 'start' })
  } catch {
    // Sin desplazamiento el usuario baja con la rueda.
  }
}

/** Pliega o despliega «Esta semana» y lo recuerda entre sesiones. */
async function alternarSemana($: EngineInterface) {
  let abierta = false
  await update($, semanaAbierta, antes => {
    abierta = !antes

    return abierta
  })
  try {
    await $.store.set(PREF_SEMANA, abierta)
  } catch {
    // Sin store vale solo para esta sesión.
  }
  if (!abierta) return

  // Las filas nuevas aún no se dibujaron: se espera un momento antes de desplazar.
  try {
    $.clock.after(SCROLL_MS, () => {
      void mostrarSemana($)
    })
  } catch {
    // Sin reloj no hay desplazamiento.
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

/**
 * Anota la fila de una petición de subagente si hay exploradores en vuelo. Nunca rechaza:
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

/** Pliega o despliega «Flujo» y lo recuerda entre sesiones. */
async function alternarFlujo($: EngineInterface) {
  let abierta = false
  await update($, flujoAbierto, antes => {
    abierta = !antes

    return abierta
  })
  try {
    await $.store.set(PREF_FLUJO, abierta)
  } catch {
    // Sin store vale solo para esta sesión.
  }
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
    $.ui.toast(texto)
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
  return $.ui.open({ id: PANEL, title: 'Uso', columns: COLUMNAS, rows: 3 })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    // Cada paso va aparte: si uno falla, la semana, el tick y el panel igual arrancan.
    try {
      await $.command.register({
        name: 'uso',
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
      const guardada = await $.store.get(PREF_SEMANA)
      await update($, semanaAbierta, () => guardada === true)
    } catch {
      // Sin store arranca plegada.
    }
    try {
      // `flujo` y `filasExploradores` no se vacían aquí: un `/reload-plugins` a mitad de flujo no los pierde.
      const guardada = await $.store.get(PREF_FLUJO)
      await update($, flujoAbierto, () => guardada === true)
    } catch {
      // Sin store arranca plegada.
    }
    await medirDesglose($, 'summary')
    try {
      await podarStore($)
    } catch {
      // Podar es limpieza: si falla, se intenta en la próxima sesión.
    }
    await releerSemana($)

    // Mueve la cuenta regresiva y suma lo que otras sesiones anotaron; no llama a ningún modelo.
    $.clock.every(TICK_MS, () => {
      void $.clock.now().then(t => update($, ahora, () => t))
      void releerSemana($)
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

  on('command.run', { command: 'uso' }, async ($, e) => {
    // `/uso carpeta` abre la carpeta sin depender del foco del panel ni del ratón.
    if (e.args.trim() === 'carpeta') return { text: await abrirCarpeta($) }

    const { isPlaced } = await abrir($)

    return { text: isPlaced ? 'Panel de uso abierto.' : 'Panel de uso: ensancha la terminal para verlo.' }
  })

  on('session.measure', async ($, e, next) => {
    await update($, medida, () => aMedida(e.context, e.rateLimits))
    if (e.changed.includes('context')) await medirDesglose($, 'summary')
    // El reinicio del límite semanal decide dónde empieza la semana.
    if (e.changed.includes('rateLimits')) await releerSemana($)

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
    }

    // La fila se abre y se cierra con el id de la petición, no con el de la respuesta.
    const id = idFila(e.model, e.effort, e.agentId !== undefined)
    await marcarActividad($, (a, t) => iniciarPeticion(a, id, t))
    // Antes de `next` y fuera del try/finally: no puede frenar la petición ni dejar la actividad sin bajar.
    if (e.agentId !== undefined) await marcarExplorador($, id)

    let pideHerramienta = false
    let r: TurnStepResult
    try {
      r = yield* next(e)
      try {
        pideHerramienta = r.toolUses.length > 0 || r.stopReason === 'tool_use'
      } catch {
        // Sin saberlo, la fila queda inactiva.
      }
    } finally {
      // Falle o no la petición, el contador baja; el error de `next` sigue su camino intacto.
      await marcarActividad($, (a, t) => terminarPeticion(a, id, t, pideHerramienta))
    }

    if (r.usage !== null) {
      try {
        await anotarUso($, r.usage.model || e.model, e.effort, e.agentId !== undefined, r.usage)
      } catch {
        // Perder una cuenta es mejor que frenar la respuesta.
      }
    }

    return r
  })

  // El turno del hilo principal terminó: ninguna fila espera ya una herramienta y el flujo, si había, cierra.
  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      try {
        await update($, actividad, limpiarPendientes)
      } catch {
        // La espera caduca sola a los 30 min.
      }
      await marcarFlujo($, (f, t) => terminarFlujo(f, e.reason, e.answer, t))
    }

    return next(e)
  })

  // Solo observa: el texto de la skill pasa tal cual.
  on('skill.prompt', async ($, e, next) => {
    await marcarFlujo($, (f, t) => iniciarFlujo(e.skill, e.text, t) ?? f)
    // Un flujo nuevo no hereda las filas del anterior.
    try {
      if (iniciarFlujo(e.skill, e.text) !== null) await vaciarFilasExploradores($)
    } catch {
      // Sin vaciar, el ■ de más solo se ve con un flujo en curso y exploradores en vuelo.
    }

    return next(e)
  })

  // Solo observa: la herramienta corre y su resultado vuelve tal cual (un error de `next` no se traga).
  on('tool.call', async ($, e, next) => {
    const s = senalDeHerramienta(e.tool, e as unknown as Record<string, unknown>, e.agentId)
    if (s === null) return next(e)

    await marcarFlujo($, (f, t) => avanzar(f, s, t))

    const fin = senalAlTerminar(s)
    if (fin === null) return next(e)

    // La vuelta se descuenta siempre, también si la herramienta falla; el error de `next` sigue su camino intacto.
    let bien = false
    try {
      const r = await next(e)
      bien = true

      return r
    } finally {
      await marcarFlujo($, (f, t) => avanzar(f, senalAlTerminar(s, bien) ?? fin, t))
    }
  })

  on('ui.render', { component: 'Pane', requestId: PANEL }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const m = await read($, medida)
    const esf = await read($, esfuerzo)
    const d = await read($, desglose)
    const ocupado = await read($, precisando)
    const sem = await read($, semana)
    const ses = await read($, sesion)
    const abierta = await read($, semanaAbierta)
    const act = await read($, actividad)
    const fl = await read($, flujo)
    const filasExp = await read($, filasExploradores)
    const flAbierto = await read($, flujoAbierto)
    await read($, ahora)
    const t = await $.clock.now()

    const ancho = Math.max(6, Math.min(40, e.props.bodyColumns))

    // Fila de un día: etiqueta (6) + espacio (1) + barra + total (7) = `ancho`.
    const anchoBarraDia = Math.max(1, ancho - 6 - 1 - 7)
    const maxDia = (s: Semana) => Math.max(1, ...s.dias.map(x => x.total))

    /** La barra de una fila con subagentes: un `Text` por tramo (principal, subagente y vacío), sin los vacíos. */
    const barraConSub = (parte: number, sub: number, anchoBarra: number) => {
      const b = barraPartida(parte, sub, anchoBarra)

      return [
        b.principal !== '' && (
          <Text key="principal" color="claude">
            {b.principal}
          </Text>
        ),
        b.sub !== '' && (
          <Text key="sub" color={COLOR_SUB}>
            {b.sub}
          </Text>
        ),
        b.vacio !== '' && (
          <Text key="vacio" color="claude">
            {b.vacio}
          </Text>
        ),
      ]
    }

    /**
     * Tokens por modelo y esfuerzo: la misma tabla para la sesión y la semana.
     * Cada tabla alinea en columnas las etiquetas de sus propias filas (familia · versión · esfuerzo).
     * Bajo cada fila va su barra con el % de la sección (barra + % = ancho).
     * Con `plegable`, plegada muestra solo el título, el total y el botón.
     * Con `conActividad`, cada fila lleva un ■ (verde: en curso; amarillo: espera; gris: inactiva),
     * o uno por explorador en vuelo (hasta 3, separados) si es la fila de los exploradores del flujo.
     * El encabezado lleva el total y la salida; si con el botón no caben en `ancho`,
     * queda solo el total y la salida pasa al pie.
     */
    const tabla = (
      titulo: string,
      prefijo: string,
      s: Semana | null,
      desde: string | null,
      plegable?: { abierta: boolean },
      conActividad = false,
    ) => {
      const visible = plegable === undefined || plegable.abierta
      const label = plegable?.abierta ? 'Ocultar' : 'Ver'
      const conSalida = s === null ? '' : totalConSalida(s.total, s.salida)
      // Título + total con salida + espacio + botón `[ label ]` tienen que entrar en `ancho`.
      const cabe =
        plegable === undefined || titulo.length + conSalida.length + 1 + `[ ${label} ]`.length <= ancho
      const salidaAlPie = !cabe && s !== null && s.salida > 0 ? `sal ${tokens(s.salida)}` : null
      // Las etiquetas van en columnas y dejan sitio a las cifras y, con `conActividad`, a los ■ (2 celdas cada uno).
      const maxCuadros =
        conActividad && s !== null ? Math.max(0, ...s.filas.map(f => cuadradosDeFila(fl, filasExp, idDeFila(f)))) : 0
      const etiquetas =
        s !== null ? etiquetasAlineadas(s.filas, Math.max(1, e.props.bodyColumns - COLUMNAS_CIFRAS - 2 * maxCuadros)) : []

      return (
        <Box key={plegable === undefined ? undefined : CLAVE_SEMANA} flexDirection="column" marginTop={1}>
          <Box>
            <Box flexGrow={1}>
              <Text bold>{titulo}</Text>
            </Box>
            {s !== null && s.total > 0 && <Text>{cabe ? conSalida : tokens(s.total)}</Text>}
            {plegable !== undefined && <Text> </Text>}
            {plegable !== undefined && (
              <Button
                key={`${prefijo}-plegar`}
                hotkey="s"
                label={label}
                onPress={() => alternarSemana($)}
              />
            )}
          </Box>
          {!visible ? null : s === null || s.filas.length === 0 ? (
            <Text dimColor>sin respuestas anotadas todavía</Text>
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
                  <Box key={`${prefijo}-${f.modelo}-${f.esfuerzo}-${f.origen}`} flexDirection="column">
                    <Box>
                      <Box flexGrow={1}>
                        <Text wrap="truncate-end">{etiquetas[indice] ?? ''}</Text>
                        {conActividad &&
                          Array.from({ length: cuadradosDeFila(fl, filasExp, idDeFila(f)) }, (_, i) => (
                            <Text key={`cuadrado-${i}`} color={COLOR_ACTIVIDAD[estadoActividad(act, idDeFila(f), t)]}>
                              {' ■'}
                            </Text>
                          ))}
                      </Box>
                      <Text>{tokens(f.total).padStart(7)}</Text>
                      <Text dimColor>{tokens(f.salida).padStart(7)}</Text>
                    </Box>
                    <Box>
                      {(f.sub ?? 0) > 0 ? (
                        barraConSub(parte, ((f.sub ?? 0) / s.total) * 100, Math.max(1, ancho - 7))
                      ) : (
                        <Text color={f.origen === 'subagente' ? COLOR_SUB : 'claude'}>{barra(parte, Math.max(1, ancho - 7))}</Text>
                      )}
                      <Text dimColor>{pct(parte).padStart(7)}</Text>
                    </Box>
                  </Box>
                )
              })}
            </Box>
          )}
          {plegable !== undefined && visible && s !== null && s.dias.length > 0 && (
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
          {visible && s !== null && (desde !== null || s.total > 0) && (
            <Text dimColor>
              {[salidaAlPie, desde, s.total > 0 ? 'total incluye caché' : null].filter(Boolean).join(' · ')}
            </Text>
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

    return (
      <Box flexDirection="column">
        <Box marginBottom={1}>
          <Button key="carpeta" hotkey="c" label="Abrir carpeta" onPress={() => abrirCarpeta($)} />
        </Box>
        <Box key="flujo" flexDirection="column" marginBottom={1}>
          <Box>
            <Box flexGrow={1}>
              <Text bold>Flujo</Text>
            </Box>
            <Button key="flujo-plegar" hotkey="f" label={flAbierto ? 'Ocultar' : 'Ver'} onPress={() => alternarFlujo($)} />
          </Box>
          <Text dimColor wrap="truncate-end">
            {resumenFlujo(fl, t)}
          </Text>
          {flAbierto &&
            fl !== null &&
            nodos(fl, t).flatMap((n, i, todos) => {
              const glifo =
                n.estado === 'pasado'
                  ? { texto: '✓ ', color: 'success' as const }
                  : n.estado === 'pendiente'
                    ? { texto: '○ ', color: undefined }
                    : i === todos.length - 1 && fl.estado !== 'en curso'
                      ? { texto: '● ', color: COLOR_FIN[fl.estado] }
                      : { texto: '▸ ', color: 'claude' as const }

              return [
                ...(i > 0 ? [<Text key={`flujo-sep-${i}`} dimColor>│</Text>] : []),
                <Box key={`flujo-${i}`}>
                  <Box flexGrow={1}>
                    <Text color={glifo.color} dimColor={n.estado === 'pendiente'}>
                      {glifo.texto}
                    </Text>
                    <Text bold={n.estado === 'actual'} dimColor={n.estado === 'pendiente'} wrap="truncate-end">
                      {n.etiqueta}
                    </Text>
                    {n.exploradores !== undefined && (
                      <Text dimColor wrap="truncate-end">
                        {` ×${n.exploradores}`}
                      </Text>
                    )}
                  </Box>
                  {n.ms !== undefined && <Text dimColor>{` ${duracion(n.ms)}`}</Text>}
                </Box>,
              ]
            })}
        </Box>
        <Box>
          <Box flexGrow={1}>
            <Text bold>Contexto</Text>
          </Box>
          {m?.porcentaje !== undefined && <Text color={tono(m.porcentaje)}>{m.porcentaje}%</Text>}
        </Box>
        {d !== null ? (
          <Box>
            {tramos(d.partes, ancho).map((t, i) => (
              <Text key={`t${i}`} color={t.color}>
                {relleno(t.tipo).repeat(t.celdas)}
              </Text>
            ))}
          </Box>
        ) : m?.porcentaje === undefined ? (
          <Text color="subtle">{barra(0, ancho)}</Text>
        ) : (
          <Text color={tono(m.porcentaje)}>{barra(m.porcentaje, ancho)}</Text>
        )}
        <Text dimColor>
          {m === null || m.ventana <= 0
            ? 'se mide tras la 1.ª respuesta'
            : m.porcentaje === undefined
              ? `ventana ${tokens(m.ventana)} · se mide tras la 1.ª respuesta`
              : `${tokens(m.tokens ?? 0)} de ${tokens(m.ventana)} tokens`}
        </Text>

        {d !== null && (
          <Box flexDirection="column" marginTop={1}>
            {d.partes.map(p => (
              <Box key={`p-${p.nombre}`}>
                <Text color={p.color}>{marcador(p.tipo)} </Text>
                <Box flexGrow={1}>
                  <Text wrap="truncate-end">{p.nombre}</Text>
                </Box>
                <Text>{tokens(p.tokens).padStart(6)}</Text>
                <Text dimColor>{pct(p.porcentaje).padStart(7)}</Text>
              </Box>
            ))}
            {m !== null && d.ventana !== m.ventana && (
              <Text dimColor>% sobre la ventana de compactación ({tokens(d.ventana)})</Text>
            )}
          </Box>
        )}

        {d !== null && d.pesados.length > 0 && (
          <Box flexDirection="column" marginTop={1}>
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
          <Box marginTop={1}>
            <Button
              key="precisar"
              hotkey="p"
              label={ocupado ? 'Precisando…' : 'Precisar'}
              onPress={() => precisar($)}
            />
            <Text dimColor> {ocupado ? 'contando' : d.exacto ? 'exacto' : 'estimado'}</Text>
          </Box>
        )}

        {limites.length === 0 ? (
          <Box flexDirection="column" marginTop={1}>
            <Text bold>Límites de uso</Text>
            <Text dimColor>aparecen tras la 1.ª respuesta</Text>
          </Box>
        ) : (
          limites.map(l => {
            const reinicio = l.resetsAt === undefined ? undefined : Date.parse(l.resetsAt)

            return (
              <Box key={l.kind} flexDirection="column" marginTop={1}>
                <Box>
                  <Box flexGrow={1}>
                    <Text bold>{nombreVentana(l.kind)}</Text>
                  </Box>
                  <Text color={tono(l.percentUsed)}>{l.percentUsed}%</Text>
                </Box>
                <Text color={tono(l.percentUsed)}>{barra(l.percentUsed, ancho)}</Text>
                {reinicio === undefined || Number.isNaN(reinicio) ? (
                  <Text dimColor>sin hora de reinicio</Text>
                ) : (
                  <Text dimColor>
                    reinicia {cuando(t, reinicio)} · {falta(t, reinicio)}
                  </Text>
                )}
              </Box>
            )
          })
        )}

        {/* Una sola fila; el modelo se trunca para no saltar de línea en 36 columnas. */}
        <Box marginTop={1}>
          <Text bold>Esfuerzo</Text>
          <Text color="claude">{` ${nivel}`}</Text>
          {esf !== null && (
            <Text dimColor wrap="truncate-end">
              {` · ${esf.modelo}${esf.origen === 'ajustes' ? ' · según ajustes' : ''}`}
            </Text>
          )}
        </Box>

        {/* La hora anotada se redondea a la hora entera: «desde» mentiría en la sesión. */}
        {tabla('Esta sesión', 'n', ses, null, undefined, true)}

        {tabla(
          'Esta semana',
          's',
          sem,
          sem === null
            ? null
            : sem.registroDesde !== null && sem.registroDesde > sem.desde
              ? `anotado desde ${cuando(t, sem.registroDesde)}`
              : `desde ${cuando(t, sem.desde)}`,
          { abierta },
        )}
      </Box>
    )
  })
}
