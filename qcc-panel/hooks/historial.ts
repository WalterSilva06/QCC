// Historial de flujos: lee `~/.claude/flujos/registros/flujos.jsonl` y `~/.claude/flujos-odd/registros/odd.jsonl` y arma las líneas de la pestaña «Historial». Puro: sin `$`, para poder probarlo solo.

import type { FilaHistorial } from '../types'
import { tokens } from './formato'

/** La ruta de un registro bajo la carpeta personal; `null` si `home` está vacío. */
function rutaRegistro(home: string, carpeta: string, archivo: string): string | null {
  const base = home.trim()
  if (base === '') return null

  const sep = base.includes('\\') ? '\\' : '/'

  return [base.replace(/[\\/]+$/, ''), '.claude', carpeta, 'registros', archivo].join(sep)
}

/**
 * La ruta de `flujos.jsonl` bajo la carpeta personal; `null` si `home` está vacío. El separador es `\` si `home` lo contiene y `/` si no;
 * los separadores finales de `home` se quitan.
 */
export function rutaHistorial(home: string): string | null {
  return rutaRegistro(home, 'flujos', 'flujos.jsonl')
}

/** La ruta de `odd.jsonl`, el registro de `/odd`, con las mismas reglas que `rutaHistorial`. */
export function rutaHistorialOdd(home: string): string | null {
  return rutaRegistro(home, 'flujos-odd', 'odd.jsonl')
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
 * `flujo` es el registro de donde viene la fila. Una corrida de `odd.jsonl` no trae `clasificacion` ni `subtareas`: la clasificación es su
 * `tamano`, las líneas salen de `cambios` y el veredicto, de `costo.veredictos.revisor` (o de `revision` si no hay veredictos).
 */
export function filaDeRegistro(r: unknown, flujo: FilaHistorial['flujo'] = 'normal'): FilaHistorial | null {
  if (!esObjeto(r) || r.tipo !== undefined || typeof r.t !== 'string') return null

  const deOdd = flujo === 'odd'
  const costo = esObjeto(r.costo) ? r.costo : {}
  const tiempos = esObjeto(r.tiempos) ? r.tiempos : {}
  const veredictos = esObjeto(costo.veredictos) ? costo.veredictos : {}
  const lista = veredictos[deOdd ? 'revisor' : 'final']
  const final = Array.isArray(lista) ? lista : []
  const resultado = typeof r.resultado === 'string' ? r.resultado : ''
  const cancelado = resultado.startsWith('CANCELADO')
  const activo = r.v === 2 ? numero(tiempos.activo) : undefined
  const subtareas = Array.isArray(r.subtareas) ? r.subtareas.length : numero(r.subtareas)
  const bloqueada = Array.isArray(r.subtareas) && r.subtareas.some(s => esObjeto(s) && s.estado === 'BLOQUEADO')
  const raiz = typeof r.raiz === 'string' ? r.raiz.split(/[\\/]/).filter(p => p !== '').pop() : undefined
  const aprobada = final.length === 0 && deOdd && r.revision === 'APROBADO'
  const fila: FilaHistorial = {
    t: r.t,
    repo: raiz ?? '?',
    flujo,
    revision: cancelado || resultado.startsWith('DETENIDO') ? '✗' : final.length > 1 ? '↻' : final.length === 1 || aprobada ? '✓' : '·',
    clasificacion: clasificacionCorta(deOdd ? r.tamano : r.clasificacion),
    aviso: cancelado || bloqueada,
  }
  const usd = numero(costo.usd)
  const minutos = activo !== undefined ? activo / 60 : numero(costo.minutos)

  if (usd !== undefined) fila.usd = usd
  if (minutos !== undefined) fila.minutos = minutos
  if (subtareas !== undefined) fila.subtareas = subtareas

  const titulo = tituloDe(r)
  const roles = rolesDe(costo.roles)
  const espera = r.v === 2 ? numero(tiempos.espera) : undefined
  const lineas = Array.isArray(r.subtareas) ? r.subtareas.filter(esObjeto) : []
  const suma = (clave: 'mas' | 'menos'): number | undefined => {
    const valores = lineas.flatMap(s => numero(s[clave]) ?? [])

    return valores.length === 0 ? undefined : valores.reduce((a, b) => a + b, 0)
  }
  const cambios = deOdd && esObjeto(r.cambios) ? r.cambios : {}
  const mas = deOdd ? numero(cambios.mas) : suma('mas')
  const menos = deOdd ? numero(cambios.menos) : suma('menos')

  // Los tokens del flujo: `costo.tokens` en odd.jsonl y `uso.tokens` en flujos.jsonl.
  const uso = esObjeto(r.uso) ? r.uso : {}
  const fuente = esObjeto(costo.tokens) ? costo.tokens : uso.tokens
  const total = tokensDe(fuente)
  const salida = esObjeto(fuente) ? numero(fuente.salida) : undefined

  if (total !== undefined) fila.tokens = total
  if (salida !== undefined) fila.salida = salida
  if (titulo !== undefined) fila.titulo = titulo
  if (roles.length > 0) fila.roles = roles
  if (espera !== undefined && espera > 0) fila.espera = espera / 60
  if (mas !== undefined) fila.mas = mas
  if (menos !== undefined) fila.menos = menos

  return fila
}

/** El título del flujo: `titulo` si es texto no vacío; si no, la primera línea no vacía de `pedido` (hasta 120 caracteres). */
function tituloDe(r: Record<string, unknown>): string | undefined {
  if (typeof r.titulo === 'string' && r.titulo.trim() !== '') return r.titulo.trim()
  if (typeof r.pedido !== 'string') return undefined

  const primera = r.pedido.split('\n').map(l => l.trim()).find(l => l !== '')
  if (primera === undefined) return undefined

  const letras = Array.from(primera)

  return letras.length > 120 ? `${letras.slice(0, 119).join('').trimEnd()}…` : primera
}

/** El total de los cuatro campos de `tokens` (entrada, leídos, escritos y salida) que son números; `undefined` si ninguno lo es. */
function tokensDe(t: unknown): number | undefined {
  if (!esObjeto(t)) return undefined

  const valores = [t.entrada, t.leidos, t.escritos, t.salida].flatMap(x => numero(x) ?? [])

  return valores.length === 0 ? undefined : valores.reduce((a, b) => a + b, 0)
}

/** Los roles de `costo.roles` con `usd` numérico mayor que 0, del que más gastó al que menos, con sus `tokens` si los trae. */
function rolesDe(roles: unknown): { rol: string; usd: number; tokens?: number }[] {
  if (!esObjeto(roles)) return []

  return Object.entries(roles)
    .flatMap(([rol, v]) => {
      const usd = esObjeto(v) ? numero(v.usd) : undefined
      if (usd === undefined || usd <= 0) return []

      const total = esObjeto(v) ? tokensDe(v.tokens) : undefined

      return [total === undefined ? { rol, usd } : { rol, usd, tokens: total }]
    })
    .sort((a, b) => b.usd - a.usd)
}

/**
 * Las últimas `cuantos` filas de flujo del texto de un registro (`flujos.jsonl`, o `odd.jsonl` con `flujo` `odd`), la más reciente primero.
 * Las líneas vacías o rotas y las filas que no son de flujo (`defecto`) se saltan.
 */
export function leerHistorial(texto: string, cuantos = 5, flujo: FilaHistorial['flujo'] = 'normal'): FilaHistorial[] {
  const filas: FilaHistorial[] = []

  for (const linea of texto.split('\n')) {
    if (linea.trim() === '') continue

    try {
      const fila = filaDeRegistro(JSON.parse(linea), flujo)
      if (fila) filas.push(fila)
    } catch {
      // línea rota: se salta
    }
  }

  return filas.slice(-Math.max(cuantos, 0)).reverse()
}

/** Las `cuantos` filas más recientes de varias listas juntas, la más reciente primero (por `t`; una fecha ilegible va al final). */
export function unirHistorial(listas: readonly (readonly FilaHistorial[])[], cuantos: number): FilaHistorial[] {
  const ms = (f: FilaHistorial): number => {
    const x = Date.parse(f.t)

    return Number.isNaN(x) ? -Infinity : x
  }

  return listas
    .flat()
    .sort((a, b) => (ms(b) === ms(a) ? 0 : ms(b) > ms(a) ? 1 : -1))
    .slice(0, Math.max(cuantos, 0))
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

/** El largo de `texto` en caracteres, no en unidades de código. */
function medir(texto: string): number {
  return Array.from(texto).length
}

/** Los primeros `sobra - 1` caracteres más «…» (el texto en caracteres, no en unidades de código). */
function recortar(caracteres: string[], sobra: number): string[] {
  return [caracteres.slice(0, sobra - 1).join('').trimEnd(), '…']
}

/**
 * La línea 1 de un flujo, con sus cuatro cifras destacadas: `dd/mm hh:mm <repo> <marca> <rev> · $x,xx · <min> · <tokens> tok · sal <salida>`.
 * La marca es `n` (`/impl`) u `odd` (`/odd`). Un dato sin valor se muestra como `—`. Las cifras no se recortan:
 * si la línea no cabe en `ancho` (columnas, por caracteres) se prueba, en este orden, con fecha y repo (entero, o acortado a 2 caracteres más «…»),
 * con fecha sin repo y sin fecha, y en cada caso con ` · ` entre las cifras y, si no cabe, con solo un espacio. Si ni así cabe, se pierde el glifo
 * de revisión (`odd $4,99 36m …`) y, si aún no cabe, la marca: quedan solo las cifras, cortadas a `ancho`.
 */
export function lineaHistorial(f: FilaHistorial, ancho: number): string {
  const dato = (n?: number): string => (n === undefined ? '—' : tokens(n))
  const cifras = (sep: string): string => [cifraUsd(f.usd), cifraMinutos(f.minutos), `${dato(f.tokens)} tok`, `sal ${dato(f.salida)}`].join(sep)
  const marca = `${f.flujo === 'odd' ? 'odd' : 'n'} ${f.revision}`
  const repo = Array.from(f.repo)
  const armar = (fecha: boolean, nombre: string[], sep: string): string =>
    `${[fecha ? fechaLocal(f.t) : '', nombre.join(''), marca].filter(p => p !== '').join(' ')}${sep}${cifras(sep)}`
  // `completo`: el repo entero; `corto`: acortado a 2 caracteres o más y «…»; `sin`: sin repo. `null` si esa forma no cabe.
  const probar = (fecha: boolean, repoEn: 'completo' | 'corto' | 'sin', sep: string): string | null => {
    const sin = armar(fecha, [], sep)
    if (medir(sin) > ancho) return null
    if (repoEn === 'sin' || repo.length === 0) return sin
    if (repoEn === 'completo') return medir(armar(fecha, repo, sep)) <= ancho ? armar(fecha, repo, sep) : null

    const sobra = ancho - medir(sin) - 1

    return sobra >= 3 ? armar(fecha, recortar(repo, sobra), sep) : null
  }

  for (const fecha of [true, false]) {
    for (const repoEn of ['completo', 'corto', 'sin'] as const) {
      for (const sep of [' · ', ' ']) {
        const linea = probar(fecha, repoEn, sep)
        if (linea !== null) return linea
      }
    }
  }

  // Ni la marca con el glifo cabe: primero se pierde el glifo y, si aun así no cabe, la marca; quedan las cifras, cortadas a `ancho` si hace falta.
  const sinGlifo = `${f.flujo === 'odd' ? 'odd' : 'n'} ${cifras(' ')}`

  return medir(sinGlifo) <= ancho ? sinGlifo : Array.from(cifras(' ')).slice(0, Math.max(ancho, 0)).join('')
}

/** `texto` cortado a `ancho` caracteres (no unidades de código) con «…» al final si no cabe. */
function cortar(texto: string, ancho: number): string {
  const letras = Array.from(texto)
  if (letras.length <= ancho) return texto
  if (ancho <= 0) return ''

  return `${letras.slice(0, ancho - 1).join('').trimEnd()}…`
}

/**
 * Las dos líneas de un flujo, ninguna más larga que `ancho` caracteres: la de `lineaHistorial` y el resumen del cambio, `  <título>` (con `⚠ `
 * antes si el flujo se canceló o quedó bloqueado; `sin título` si falta). Un título que no cabe se corta con «…». Si cabe entero, detrás van,
 * cada uno solo si cabe, `+<mas> −<menos>`, `×<subtareas>` y la clasificación, unidos con ` · `. Los roles y la espera no se dibujan.
 */
export function lineasHistorial(f: FilaHistorial, ancho: number): string[] {
  const titulo = `  ${f.aviso ? '⚠ ' : ''}${f.titulo ?? 'sin título'}`
  const cola = [f.mas === undefined && f.menos === undefined ? '' : `+${f.mas ?? 0} −${f.menos ?? 0}`, f.subtareas === undefined ? '' : `×${f.subtareas}`, f.clasificacion]
  const resumen =
    medir(titulo) > ancho
      ? cortar(titulo, ancho)
      : cola.filter(p => p !== '').reduce((acc, p) => (medir(`${acc} · ${p}`) <= ancho ? `${acc} · ${p}` : acc), titulo)

  return [lineaHistorial(f, ancho), resumen]
}
