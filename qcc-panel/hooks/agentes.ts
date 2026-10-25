// Pestaña «Agentes»: los subagentes vistos en la sesión (con sus herramientas) y los archivos que se editaron. Puro: sin `$`, para poder probarlo solo.

import type { AgenteVisto, ArchivoTocado } from '../types'
import { duracion } from './formato'
import { rolDeAgente } from './flujo'

/** Cuántos agentes se guardan: al pasarse se caen primero los terminados más viejos. */
export const TOPE_AGENTES = 40

/** Cuántos archivos distintos se guardan: se cae el que se tocó hace más. */
export const TOPE_ARCHIVOS = 10

/** Una línea de agente de la pestaña: glifo y color de su estado, rol, descripción y la cola con el tiempo y las herramientas. */
export type LineaAgente = { glifo: '▸' | '✓' | '✗'; color: 'warning' | 'success' | 'error'; rol: string; descripcion: string; cola: string }

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

/**
 * Lo que dibuja la pestaña, en la hora `t` y con `ancho` columnas: el resumen («3 agentes · 1 corriendo · 12 herramientas»), una línea por
 * agente y una por archivo, la más reciente primero. El tiempo de un agente en curso corre hasta `t`; el de uno terminado queda fijo.
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
    })),
    archivos: [...(archivos ?? [])].reverse().map(a => {
      const cola = ` ×${a.veces} · ${a.agente}`

      return { ruta: rutaCorta(a.ruta, Math.max(1, ancho - cola.length)), cola }
    }),
  }
}
