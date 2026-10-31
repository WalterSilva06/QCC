// Qué implementadores hay instalados: decide qué pestañas y qué entradas muestra el panel. Puro: sin `$`, para poder probarlo solo.
// Invariante: ante un fallo de detección se muestra todo; solo se oculta con certeza («no está»).

import type { Instalados } from '../types'

export type { Instalados }

/** Lo que usa la vista del panel: qué pestañas y entradas se muestran. */
export type Vista = { flujo: boolean; historial: boolean; orquestador: boolean }

/** La evidencia de uso que gana sobre la detección: hay un flujo en la sesión, o filas de historial. */
export type Uso = { flujo: boolean; historial: boolean }

/** Lo que `detectar` recibe: los ajustes leídos (`null` si falló) y si existe el `SKILL.md` del flujo (`null` si no se pudo comprobar). */
export type Entrada = { ajustes: unknown; normal: boolean | null }

export const NOMBRE_NORMAL = 'impl'

/** El nombre viejo, con el que la instalación manual dejó su carpeta en `~/.claude/skills`. */
export const COPIA_NORMAL = 'qcc-implementador'

/**
 * La ruta de `<home>/.claude/skills/<nombre>/SKILL.md`; `null` si `home` está vacío. El separador es `\` si `home` lo contiene y `/` si no;
 * los separadores finales de `home` se quitan.
 */
export function rutaSkill(home: string, nombre: string): string | null {
  const base = home.trim()
  if (base === '') return null

  const sep = base.includes('\\') ? '\\' : '/'

  return [base.replace(/[\\/]+$/, ''), '.claude', 'skills', nombre, 'SKILL.md'].join(sep)
}

/** Si `clave` es `nombre` pelado o `nombre@<mercado>`. */
function esClaveDe(clave: string, nombre: string): boolean {
  return clave === nombre || clave.startsWith(`${nombre}@`)
}

/**
 * `true` si los ajustes habilitan el plugin `nombre`; `false` solo si `enabledPlugins` es un objeto presente y ninguna
 * clave habilitada coincide; `null` (dudoso) si los ajustes no se pudieron leer o `enabledPlugins` falta o no es un objeto.
 */
function porAjustes(ajustes: unknown, nombre: string): boolean | null {
  if (typeof ajustes !== 'object' || ajustes === null || Array.isArray(ajustes)) return null

  const plugins = (ajustes as Record<string, unknown>).enabledPlugins
  if (typeof plugins !== 'object' || plugins === null || Array.isArray(plugins)) return null

  return Object.entries(plugins).some(([clave, valor]) => valor === true && esClaveDe(clave, nombre))
}

/** Une los dos caminos: `true` si alguno lo halla; `false` solo si ambos dicen que no; en otro caso `null` (dudoso). */
function unir(ajustes: boolean | null, archivo: boolean | null): boolean | null {
  if (ajustes === true || archivo === true) return true
  if (ajustes === false && archivo === false) return false

  return null
}

/**
 * Qué implementadores están instalados: por los ajustes (`enabledPlugins` en `true` del plugin) o por el `SKILL.md`
 * de la instalación manual. `false` solo si los dos caminos se comprobaron bien y ninguno lo halla; si algo falló, o los ajustes no traen
 * `enabledPlugins`, `null`.
 */
export function detectar({ ajustes, normal }: Entrada): Instalados {
  return { normal: unir(porAjustes(ajustes, NOMBRE_NORMAL), normal) }
}

/**
 * Qué muestra el panel. `inst` `null` o sin definir (aún sin detectar) lo muestra todo; la evidencia de uso gana sobre un «no está».
 * El historial sale también si ya hay filas.
 */
export function vistaDe(inst: Instalados | null | undefined, uso: Uso): Vista {
  const normal = inst?.normal !== false || uso.flujo

  return { flujo: normal, historial: normal || uso.historial, orquestador: normal }
}
