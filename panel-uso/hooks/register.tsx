import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionContextUsage, SessionRateLimit } from 'claude-code'

import type { Esfuerzo, Medida, Semana } from '../types'
import { comandoCarpeta, tipoDeRuta } from './carpeta'
import type { SistemaCarpeta } from './carpeta'
import {
  aDesglose,
  barra,
  cuando,
  falta,
  marcador,
  nombreCorto,
  nombreVentana,
  ordenar,
  pct,
  relleno,
  tokens,
  tono,
  tramos,
} from './formato'
import { PREFIJO, RETENCION_MS, anotar, clave, comoRegistro, etiquetaDia, inicioSemana, podar, resumir } from './semana'
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

/** Fuera del prefijo `uso:`: la poda y la suma de la semana no la tocan. */
const PREF_SEMANA = 'prefs:semana'

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
    await update($, semana, () => resumir(registros, inicioSemana(m?.limites ?? [], t), t))
    await update($, sesion, () => resumir([deEsta], 0))
  } catch {
    // Sin store la sección queda como estaba.
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
      const guardada = await $.store.get(PREF_SEMANA)
      await update($, semanaAbierta, () => guardada === true)
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

    const r = yield* next(e)
    if (r.usage !== null) {
      try {
        await anotarUso($, r.usage.model || e.model, e.effort, e.agentId !== undefined, r.usage)
      } catch {
        // Perder una cuenta es mejor que frenar la respuesta.
      }
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
    const abierta = await read($, semanaAbierta)
    await read($, ahora)
    const t = await $.clock.now()

    const ancho = Math.max(6, Math.min(40, e.props.bodyColumns))

    // Fila de un día: etiqueta (6) + espacio (1) + barra + total (7) = `ancho`.
    const anchoBarraDia = Math.max(1, ancho - 6 - 1 - 7)
    const maxDia = (s: Semana) => Math.max(1, ...s.dias.map(x => x.total))

    /**
     * Tokens por modelo y esfuerzo: la misma tabla para la sesión y la semana.
     * Bajo cada fila va su barra con el % de la sección (barra + % = ancho).
     * Con `plegable`, plegada muestra solo el título, el total y el botón.
     */
    const tabla = (
      titulo: string,
      prefijo: string,
      s: Semana | null,
      desde: string | null,
      plegable?: { abierta: boolean },
    ) => {
      const visible = plegable === undefined || plegable.abierta

      return (
        <Box key={plegable === undefined ? undefined : CLAVE_SEMANA} flexDirection="column" marginTop={1}>
          <Box>
            <Box flexGrow={1}>
              <Text bold>{titulo}</Text>
            </Box>
            {s !== null && s.total > 0 && <Text>{tokens(s.total)}</Text>}
            {plegable !== undefined && <Text> </Text>}
            {plegable !== undefined && (
              <Button
                key={`${prefijo}-plegar`}
                hotkey="s"
                label={plegable.abierta ? 'Ocultar' : 'Ver'}
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
              {s.filas.map(f => {
                const parte = s.total > 0 ? (f.total / s.total) * 100 : 0

                return (
                  <Box key={`${prefijo}-${f.modelo}-${f.esfuerzo}-${f.origen}`} flexDirection="column">
                    <Box>
                      <Box flexGrow={1}>
                        <Text wrap="truncate-end">{`${f.modelo} ${f.esfuerzo}${f.origen === 'subagente' ? ' · sub' : ''}`}</Text>
                      </Box>
                      <Text>{tokens(f.total).padStart(7)}</Text>
                      <Text dimColor>{tokens(f.salida).padStart(7)}</Text>
                    </Box>
                    <Box>
                      <Text color="claude">{barra(parte, Math.max(1, ancho - 7))}</Text>
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
            <Text dimColor>{[desde, s.total > 0 ? 'total incluye caché' : null].filter(Boolean).join(' · ')}</Text>
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
        {tabla('Esta sesión', 'n', ses, null)}

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
