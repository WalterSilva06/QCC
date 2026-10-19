// Historial de flujos: lee `~/.claude/flujos/registros/flujos.jsonl` y arma las líneas de la pestaña «Flujo». Puro: sin `$`, para poder probarlo solo.

import type { FilaHistorial } from '../types'

/**
 * La ruta de `flujos.jsonl` bajo la carpeta personal; `null` si `home` está vacío. El separador es `\` si `home` lo contiene y `/` si no;
 * los separadores finales de `home` se quitan.
 */
export function rutaHistorial(home: string): string | null {
  const base = home.trim()
  if (base === '') return null

  const sep = base.includes('\\') ? '\\' : '/'

  return [base.replace(/[\\/]+$/, ''), '.claude', 'flujos', 'registros', 'flujos.jsonl'].join(sep)
}

/** «CRÍTICO (#1, #5)» o «sin criterios», sin la explicación que sigue; con cualquier otro texto, sus primeros 30 caracteres (igual que costos.mjs). */
export function clasificacionCorta(texto: unknown): string {
  const t = typeof texto === 'string' ? texto : texto == null ? '' : String(texto)

  return /^(CRÍTICO(?:\s*\([^)]*\))?|sin criterios)/i.exec(t.trim())?.[1] ?? t.slice(0, 30)
}

function esObjeto(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x)
}

function numero(x: unknown): number | undefined {
  return typeof x === 'number' && Number.isFinite(x) ? x : undefined
}

/**
 * Una fila del archivo reducida a `FilaHistorial`; `null` si no es una fila de flujo (no es objeto, trae `tipo` como las filas `defecto`,
 * o `t` no es texto). Los minutos salen de `tiempos.activo` (en segundos) en las filas v2 y de `costo.minutos` en las v1.
 */
export function filaDeRegistro(r: unknown): FilaHistorial | null {
  if (!esObjeto(r) || r.tipo !== undefined || typeof r.t !== 'string') return null

  const costo = esObjeto(r.costo) ? r.costo : {}
  const tiempos = esObjeto(r.tiempos) ? r.tiempos : {}
  const veredictos = esObjeto(costo.veredictos) ? costo.veredictos : {}
  const final = Array.isArray(veredictos.final) ? veredictos.final : []
  const resultado = typeof r.resultado === 'string' ? r.resultado : ''
  const cancelado = resultado.startsWith('CANCELADO')
  const activo = r.v === 2 ? numero(tiempos.activo) : undefined
  const subtareas = Array.isArray(r.subtareas) ? r.subtareas.length : numero(r.subtareas)
  const bloqueada = Array.isArray(r.subtareas) && r.subtareas.some(s => esObjeto(s) && s.estado === 'BLOQUEADO')
  const raiz = typeof r.raiz === 'string' ? r.raiz.split(/[\\/]/).filter(p => p !== '').pop() : undefined
  const fila: FilaHistorial = {
    t: r.t,
    repo: raiz ?? '?',
    revision: cancelado || resultado.startsWith('DETENIDO') ? '✗' : final.length > 1 ? '↻' : final.length === 1 ? '✓' : '·',
    clasificacion: clasificacionCorta(r.clasificacion),
    aviso: cancelado || bloqueada,
  }
  const usd = numero(costo.usd)
  const minutos = activo !== undefined ? activo / 60 : numero(costo.minutos)

  if (usd !== undefined) fila.usd = usd
  if (minutos !== undefined) fila.minutos = minutos
  if (subtareas !== undefined) fila.subtareas = subtareas

  return fila
}

/**
 * Las últimas `cuantos` filas de flujo del texto de `flujos.jsonl`, la más reciente primero. Las líneas vacías o rotas y las filas que no son de flujo
 * (`defecto`) se saltan.
 */
export function leerHistorial(texto: string, cuantos = 5): FilaHistorial[] {
  const filas: FilaHistorial[] = []

  for (const linea of texto.split('\n')) {
    if (linea.trim() === '') continue

    try {
      const fila = filaDeRegistro(JSON.parse(linea))
      if (fila) filas.push(fila)
    } catch {
      // línea rota: se salta
    }
  }

  return filas.slice(-Math.max(cuantos, 0)).reverse()
}

/** La media de los dólares y de los minutos de las filas que traen cada valor; el campo falta si ninguna lo trae. */
export function promedioHistorial(filas: readonly FilaHistorial[]): { usd?: number; minutos?: number } {
  const media = (valores: number[]): number | undefined => (valores.length === 0 ? undefined : valores.reduce((s, v) => s + v, 0) / valores.length)
  const usd = media(filas.flatMap(f => (f.usd === undefined ? [] : [f.usd])))
  const minutos = media(filas.flatMap(f => (f.minutos === undefined ? [] : [f.minutos])))
  const promedio: { usd?: number; minutos?: number } = {}

  if (usd !== undefined) promedio.usd = usd
  if (minutos !== undefined) promedio.minutos = minutos

  return promedio
}

/** `$0,98`: dos decimales con coma; `$—` sin dato. */
export function cifraUsd(n?: number): string {
  return n === undefined ? '$—' : `$${n.toFixed(2).replace('.', ',')}`
}

/** `12m`: minutos redondeados; `—m` sin dato. */
export function cifraMinutos(n?: number): string {
  return n === undefined ? '—m' : `${Math.round(n)}m`
}

function dos(n: number): string {
  return String(n).padStart(2, '0')
}

/** `dd/mm hh:mm` en hora local; `??/?? ??:??` si `t` no se puede leer. */
function fechaLocal(t: string): string {
  const ms = Date.parse(t)
  if (Number.isNaN(ms)) return '??/?? ??:??'

  const d = new Date(ms)

  return `${dos(d.getDate())}/${dos(d.getMonth() + 1)} ${dos(d.getHours())}:${dos(d.getMinutes())}`
}

/** Los primeros `sobra - 1` caracteres más «…» (el texto en caracteres, no en unidades de código). */
function recortar(caracteres: string[], sobra: number): string[] {
  return [caracteres.slice(0, sobra - 1).join('').trimEnd(), '…']
}

/**
 * La línea de un flujo: `dd/mm hh:mm <repo> <$> <min> <rev> <clasificación> ×<n>[ ⚠]` (`×<n>` solo con subtareas). Si no cabe en `ancho`
 * (columnas, por caracteres como `lineaDeExplorador`) se acorta primero el repo con «…» (con menos de 2 caracteres se quita junto con su espacio),
 * después la clasificación igual, y si ni así cabe la línea se corta a `ancho`. Fecha, cifras, glifo, `×n` y ⚠ no se recortan antes que el texto.
 */
export function lineaHistorial(f: FilaHistorial, ancho: number): string {
  const cifras = ` ${cifraUsd(f.usd)} ${cifraMinutos(f.minutos)} ${f.revision}`
  const cola = `${f.subtareas === undefined ? '' : ` ×${f.subtareas}`}${f.aviso ? ' ⚠' : ''}`
  const armar = (repo: string[], clas: string[]): string =>
    `${fechaLocal(f.t)}${repo.length > 0 ? ` ${repo.join('')}` : ''}${cifras}${clas.length > 0 ? ` ${clas.join('')}` : ''}${cola}`
  const medir = (texto: string): number => Array.from(texto).length
  const repo = Array.from(f.repo)
  const clas = Array.from(f.clasificacion)

  if (medir(armar(repo, clas)) <= ancho) return armar(repo, clas)

  const sobraRepo = ancho - medir(armar([], clas)) - 1
  if (sobraRepo >= 2) return armar(recortar(repo, sobraRepo), clas)
  if (medir(armar([], clas)) <= ancho) return armar([], clas)

  const sobraClas = ancho - medir(armar([], [])) - 1
  if (sobraClas >= 2) return armar([], recortar(clas, sobraClas))

  const sin = armar([], [])

  return medir(sin) <= ancho ? sin : Array.from(sin).slice(0, Math.max(ancho, 0)).join('')
}
