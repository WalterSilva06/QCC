// Pestaña «Agentes»: los subagentes vistos en la sesión (con sus herramientas) y los archivos que se editaron. Puro: sin `$`, para poder probarlo solo.

import type { AgenteVisto, ArchivoTocado } from '../types'
import { duracion, tokens } from './formato'
import { rolDeAgente } from './flujo'

/** Cuántos agentes se guardan: al pasarse se caen primero los terminados más viejos. */
export const TOPE_AGENTES = 40

/** Cuántos archivos distintos se guardan: se cae el que se tocó hace más. */
export const TOPE_ARCHIVOS = 10

/** Una línea de agente de la pestaña: glifo y color de su estado, rol, descripción, la cola con el tiempo y las herramientas, y el detalle con los tokens y el modelo ('' si no hay). */
export type LineaAgente = {
  glifo: '▸' | '✓' | '✗'
  color: 'warning' | 'success' | 'error'
  rol: string
  descripcion: string
  cola: string
  detalle: string
}

/** El uso de una respuesta, como lo cuenta Claude Code. */
type UsoAgente = {
  input_tokens?: unknown
  output_tokens?: unknown
  cache_read_input_tokens?: unknown
  cache_creation_input_tokens?: unknown
}

/** Una línea de archivo de la pestaña: su ruta (recortada por delante si no cabe) y la cola con las ediciones y el último agente. */
export type LineaArchivo = { ruta: string; cola: string }

/** Un texto limpio de espacios; lo que no es texto vale ''. */
function texto(x: unknown): string {
  return typeof x === 'string' ? x.trim() : ''
}

/**
 * Anota un agente recién lanzado, en curso y sin herramientas. Un `id` que no es un texto no vacío, o que ya está anotado, deja la lista como estaba.
 * Con más de `TOPE_AGENTES` se cae el terminado más viejo; si ninguno terminó, el más viejo de todos. Nunca muta `lista`.
 */
export function anotarAgente(
  lista: readonly AgenteVisto[] | undefined,
  nuevo: { id: unknown; tipo?: unknown; descripcion?: unknown; llamada?: unknown; t: number },
): AgenteVisto[] {
  const actual = lista ?? []
  const id = texto(nuevo.id)

  if (id === '' || actual.some(a => a.id === id)) return [...actual]

  const llamada = texto(nuevo.llamada)
  const agente: AgenteVisto = {
    id,
    tipo: texto(nuevo.tipo),
    descripcion: texto(nuevo.descripcion),
    desde: nuevo.t,
    estado: 'corriendo',
    herramientas: 0,
    ...(llamada !== '' ? { llamada } : {}),
  }
  const todos = [...actual, agente]

  if (todos.length <= TOPE_AGENTES) return todos

  const terminados = todos
    .map((a, i) => ({ i, hora: a.fin ?? a.desde, terminado: a.estado !== 'corriendo' }))
    .filter(x => x.terminado)
    .sort((x, y) => x.hora - y.hora)
  const fuera = terminados[0]?.i ?? 0

  return todos.filter((_, i) => i !== fuera)
}

/** Suma una herramienta al agente `id`. Un agente desconocido (o un `id` que no es texto) deja la lista como estaba: no lo crea. Nunca muta `lista`. */
export function anotarHerramienta(lista: readonly AgenteVisto[] | undefined, id: unknown): AgenteVisto[] {
  const actual = lista ?? []

  if (typeof id !== 'string' || !actual.some(a => a.id === id)) return [...actual]

  return actual.map(a => (a.id === id ? { ...a, herramientas: a.herramientas + 1 } : a))
}

/** Una cantidad de tokens: lo que no es un número finito ≥ 0 vale 0. */
function cantidad(x: unknown): number {
  return typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : 0
}

/**
 * Suma al agente `id` los tokens de una respuesta (`salida` y `total`, con la caché) y guarda el último `modelo` visto. Un agente desconocido
 * (o un `id` que no es texto) deja la lista como estaba: no lo crea. Sin tokens y sin modelo tampoco cambia nada. Nunca muta `lista`.
 */
export function anotarGasto(
  lista: readonly AgenteVisto[] | undefined,
  id: unknown,
  uso: UsoAgente | null | undefined,
  modelo: unknown,
): AgenteVisto[] {
  const actual = lista ?? []

  if (typeof id !== 'string' || !actual.some(a => a.id === id)) return [...actual]

  const salida = cantidad(uso?.output_tokens)
  const total = cantidad(uso?.input_tokens) + salida + cantidad(uso?.cache_read_input_tokens) + cantidad(uso?.cache_creation_input_tokens)
  const nombre = texto(modelo)

  if (total <= 0 && nombre === '') return [...actual]

  return actual.map(a =>
    a.id === id
      ? {
          ...a,
          ...(total > 0 ? { salida: (a.salida ?? 0) + salida, total: (a.total ?? 0) + total } : {}),
          ...(nombre !== '' ? { modelo: nombre } : {}),
        }
      : a,
  )
}

/**
 * Cierra un agente en curso: por su `id` y, si no hay o no está, por la `llamada` (el `tool_use_id` del `Agent` que lo lanzó). `bien` decide
 * `listo` o `fallo`; `t` es su hora de fin. Un agente desconocido o que ya terminó deja la lista como estaba. Nunca muta `lista`.
 */
export function cerrarAgente(
  lista: readonly AgenteVisto[] | undefined,
  quien: { id?: unknown; llamada?: unknown },
  bien: boolean,
  t: number,
): AgenteVisto[] {
  const actual = lista ?? []
  const id = texto(quien.id)
  const llamada = texto(quien.llamada)
  const porId = id === '' ? -1 : actual.findIndex(a => a.id === id)
  const indice = porId !== -1 ? porId : llamada === '' ? -1 : actual.findIndex(a => a.llamada === llamada)
  const agente = actual[indice]

  if (agente === undefined || agente.estado !== 'corriendo') return [...actual]

  return actual.map((a, i) => (i === indice ? { ...a, estado: bien ? ('listo' as const) : ('fallo' as const), fin: t } : a))
}

/** Marca que el agente `id` lanzó una tarea en segundo plano. Un agente desconocido (o un `id` que no es texto) deja la lista como estaba. Nunca muta `lista`. */
export function anotarFondo(lista: readonly AgenteVisto[] | undefined, id: unknown): AgenteVisto[] {
  const actual = lista ?? []

  if (typeof id !== 'string' || !actual.some(a => a.id === id)) return [...actual]

  return actual.map(a => (a.id === id ? { ...a, fondo: true as const } : a))
}

/** Si el agente `id` espera una tarea suya en segundo plano. */
export function esperaFondo(lista: readonly AgenteVisto[] | undefined, id: string): boolean {
  return (lista ?? []).some(a => a.id === id && a.estado === 'corriendo' && a.fondo === true)
}

/** El agente `id` terminó su turno esperando su tarea de fondo: quita `fondo` (su siguiente turno sin herramientas ya es el final) y anota `espera` con su fila `fila`. Nunca muta `lista`. */
export function pasarAEspera(lista: readonly AgenteVisto[] | undefined, id: string, fila: string): AgenteVisto[] {
  return (lista ?? []).map(a => {
    if (a.id !== id || a.fondo !== true) return a
    const { fondo: _fondo, ...resto } = a

    return { ...resto, espera: fila }
  })
}

/** Las filas de actividad de los agentes en curso que esperan su tarea de fondo. */
export function filasEnEspera(lista: readonly AgenteVisto[] | undefined): string[] {
  return (lista ?? []).flatMap(a => (a.estado === 'corriendo' && a.espera !== undefined ? [a.espera] : []))
}

/** Cuántos agentes siguen `corriendo` con el modelo·esfuerzo `config` («Sonnet 5.5 high»); los sin `modelo` aún no cuentan. */
export function agentesEnCurso(lista: readonly AgenteVisto[], config: string): number {
  return lista.filter(a => a.estado === 'corriendo' && a.modelo === config).length
}

/**
 * Anota una edición de `ruta` por el agente de rol `agente` (`principal` para el hilo principal) a la hora `t`. El archivo pasa a ser el más
 * reciente y suma una edición. Una `ruta` que no es un texto no vacío deja la lista como estaba. Con más de `TOPE_ARCHIVOS` se cae el más viejo.
 * Nunca muta `lista`.
 */
export function anotarArchivo(lista: readonly ArchivoTocado[] | undefined, ruta: unknown, agente: string, t: number): ArchivoTocado[] {
  const actual = lista ?? []

  if (typeof ruta !== 'string' || ruta.trim() === '') return [...actual]

  const previo = actual.find(a => a.ruta === ruta)
  const nuevo: ArchivoTocado = { ruta, veces: (previo?.veces ?? 0) + 1, agente, t }

  return [...actual.filter(a => a.ruta !== ruta), nuevo].slice(-TOPE_ARCHIVOS)
}

/** `ruta` en `max` caracteres: si no cabe, se recorta por delante y empieza con «…» (el nombre del archivo es lo que importa). */
function rutaCorta(ruta: string, max: number): string {
  if (ruta.length <= max) return ruta

  return max <= 1 ? '…' : `…${ruta.slice(ruta.length - (max - 1))}`
}

/** La línea de detalle de un agente: salida y total (la salida se omite si es 0) y su modelo. '' si no hay cifras ni modelo. */
function detalleDe(a: AgenteVisto): string {
  const total = cantidad(a.total)
  const salida = cantidad(a.salida)
  const modelo = texto(a.modelo)
  const cifras = total > 0 ? [...(salida > 0 ? [`sal ${tokens(salida)}`] : []), `total ${tokens(total)}`].join(' · ') : ''

  if (cifras === '' && modelo === '') return ''

  return `  ${[cifras, modelo].filter(x => x !== '').join(' · ')}`
}

/**
 * Lo que dibuja la pestaña, en la hora `t` y con `ancho` columnas: el resumen («3 agentes · 1 corriendo · 12 herramientas»), una línea por
 * agente y una por archivo, la más reciente primero. El tiempo de un agente en curso corre hasta `t`; el de uno terminado queda fijo.
 * Cada agente trae su `detalle` («  sal 2k · total 100k · Sonnet high»), con lo que se sepa de sus tokens y su modelo; '' si no se sabe nada.
 */
export function resumenAgentes(
  agentes: readonly AgenteVisto[] | undefined,
  archivos: readonly ArchivoTocado[] | undefined,
  t: number,
  ancho: number,
): { resumen: string; agentes: LineaAgente[]; archivos: LineaArchivo[] } {
  const vistos = agentes ?? []
  const corriendo = vistos.filter(a => a.estado === 'corriendo').length
  const herramientas = vistos.reduce((suma, a) => suma + a.herramientas, 0)
  const resumen = [
    `${vistos.length} ${vistos.length === 1 ? 'agente' : 'agentes'}`,
    `${corriendo} corriendo`,
    `${herramientas} ${herramientas === 1 ? 'herramienta' : 'herramientas'}`,
  ].join(' · ')

  return {
    resumen,
    agentes: [...vistos].reverse().map(a => ({
      glifo: a.estado === 'corriendo' ? '▸' : a.estado === 'listo' ? '✓' : '✗',
      color: a.estado === 'corriendo' ? 'warning' : a.estado === 'listo' ? 'success' : 'error',
      rol: rolDeAgente(a.tipo) || 'agente',
      descripcion: a.descripcion,
      cola: ` ${duracion((a.fin ?? t) - a.desde)} · ${a.herramientas} herr.`,
      detalle: detalleDe(a),
    })),
    archivos: [...(archivos ?? [])].reverse().map(a => {
      const cola = ` ×${a.veces} · ${a.agente}`

      return { ruta: rutaCorta(a.ruta, Math.max(1, ancho - cola.length)), cola }
    }),
  }
}
