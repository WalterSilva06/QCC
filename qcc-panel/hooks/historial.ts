// Historial de flujos: lee `~/.claude/flujos/registros/flujos.jsonl` y arma las líneas de la pestaña «Historial»; arma también el snapshot de
// límites que lee /impl (`qcc-limites.json`). Puro: sin `$`, para poder probarlo solo.

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
  const lista = veredictos.final
  const final = Array.isArray(lista) ? lista : []
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
  // Las filas viejas traen `costo.usd`: se ignora.
  const minutos = activo !== undefined ? activo / 60 : numero(costo.minutos)

  if (minutos !== undefined) fila.minutos = minutos
  if (subtareas !== undefined) fila.subtareas = subtareas

  const titulo = tituloDe(r)
  const limites = esObjeto(r.limites) ? r.limites : {}
  const cinco = esObjeto(limites.five_hour) ? limites.five_hour : {}
  // Solo un gasto completo: sin dato, con reinicio o con un tramo sin lectura no se muestra.
  const cincoHoras = cinco.incompleto === true ? undefined : numero(cinco.gasto)
  const espera = r.v === 2 ? numero(tiempos.espera) : undefined
  const lineas = Array.isArray(r.subtareas) ? r.subtareas.filter(esObjeto) : []
  const suma = (clave: 'mas' | 'menos'): number | undefined => {
    const valores = lineas.flatMap(s => numero(s[clave]) ?? [])

    return valores.length === 0 ? undefined : valores.reduce((a, b) => a + b, 0)
  }
  const mas = suma('mas')
  const menos = suma('menos')

  // Los tokens del flujo: `uso.tokens` en flujos.jsonl.
  const uso = esObjeto(r.uso) ? r.uso : {}
  const fuente = uso.tokens
  const total = tokensDe(fuente)
  const salida = esObjeto(fuente) ? numero(fuente.salida) : undefined

  if (total !== undefined) fila.tokens = total
  if (salida !== undefined) fila.salida = salida
  if (titulo !== undefined) fila.titulo = titulo
  if (cincoHoras !== undefined) fila.cincoHoras = cincoHoras
  if (espera !== undefined && espera > 0) fila.espera = espera / 60
  if (mas !== undefined) fila.mas = mas
  if (menos !== undefined) fila.menos = menos

  const sesiones = numero(r.sesiones)
  if (sesiones !== undefined && sesiones > 1) fila.sesiones = sesiones

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

/**
 * Las últimas `cuantos` filas de flujo del texto de `flujos.jsonl`, la más reciente primero.
 * Las líneas vacías o rotas y las filas que no son de flujo (`defecto`) se saltan.
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

/** La media de los minutos de las filas que los traen; el campo falta si ninguna los trae. */
export function promedioHistorial(filas: readonly FilaHistorial[]): { minutos?: number } {
  const valores = filas.flatMap(f => (f.minutos === undefined ? [] : [f.minutos]))

  return valores.length === 0 ? {} : { minutos: valores.reduce((s, v) => s + v, 0) / valores.length }
}

/** `5h +7%` o `5h +7,5%`: el % de la ventana de 5 h que gastó un flujo. */
function cifraCincoHoras(n: number): string {
  return `5h +${String(Math.round(n * 10) / 10).replace('.', ',')}%`
}

/** `<config>/qcc-limites.json`, el snapshot de límites que lee /impl: la carpeta de la cuenta es `configDir` (`CLAUDE_CONFIG_DIR`) o `<home>/.claude`; `null` sin ninguna. */
export function rutaLimites(home: string, configDir?: string): string | null {
  const config = configDir?.trim() ?? ''
  if (config !== '') return [config.replace(/[\\/]+$/, ''), 'qcc-limites.json'].join(config.includes('\\') ? '\\' : '/')

  const base = home.trim()
  if (base === '') return null

  return [base.replace(/[\\/]+$/, ''), '.claude', 'qcc-limites.json'].join(base.includes('\\') ? '\\' : '/')
}

/**
 * El snapshot que lee `estado.mjs` de /impl al abrir y al cerrar cada flujo: `{ t, five_hour?: { pct, resetsAt }, seven_day?: … }`, con `t` en ISO.
 * Cada ventana va solo si la medición la trae; `null` si no trae ninguna (sin suscripción o antes de la 1.ª respuesta).
 */
export function snapshotLimites(limites: readonly { kind: string; percentUsed: number; resetsAt?: string }[], t: number): Record<string, unknown> | null {
  const ventanas = limites.filter(l => (l.kind === 'five_hour' || l.kind === 'seven_day') && Number.isFinite(l.percentUsed))
  if (ventanas.length === 0) return null

  return Object.fromEntries([['t', new Date(t).toISOString()], ...ventanas.map(l => [l.kind, { pct: l.percentUsed, resetsAt: l.resetsAt }])])
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
 * La línea de identidad de un flujo: `dd/mm hh:mm <repo> <marca> <rev>` y, detrás, la clasificación si cabe entera. La marca es `n` (`/impl`).
 * Si no cabe en `ancho` (columnas, por caracteres) se prueba, en este orden, con fecha y repo (entero, o acortado a 2 caracteres
 * más «…»), con fecha sin repo y sin fecha (con las mismas tres formas del repo). Si ni así cabe se pierde el glifo de revisión y, si aún no cabe,
 * la marca se corta a `ancho`.
 */
export function lineaIdentidad(f: FilaHistorial, ancho: number): string {
  const nombreMarca = 'n'
  const repo = Array.from(f.repo)
  const armar = (fecha: boolean, nombre: string[]): string => [fecha ? fechaLocal(f.t) : '', nombre.join(''), nombreMarca, f.revision].filter(p => p !== '').join(' ')
  const conClasificacion = (linea: string): string =>
    f.clasificacion !== '' && medir(`${linea} ${f.clasificacion}`) <= ancho ? `${linea} ${f.clasificacion}` : linea
  // `completo`: el repo entero; `corto`: acortado a 2 caracteres o más y «…»; `sin`: sin repo. `null` si esa forma no cabe.
  const probar = (fecha: boolean, repoEn: 'completo' | 'corto' | 'sin'): string | null => {
    const sin = armar(fecha, [])
    if (medir(sin) > ancho) return null
    if (repoEn === 'sin' || repo.length === 0) return sin
    if (repoEn === 'completo') return medir(armar(fecha, repo)) <= ancho ? armar(fecha, repo) : null

    const sobra = ancho - medir(sin) - 1

    return sobra >= 3 ? armar(fecha, recortar(repo, sobra)) : null
  }

  for (const fecha of [true, false]) {
    for (const repoEn of ['completo', 'corto', 'sin'] as const) {
      const linea = probar(fecha, repoEn)
      if (linea !== null) return conClasificacion(linea)
    }
  }

  return Array.from(nombreMarca).slice(0, Math.max(ancho, 0)).join('')
}

/**
 * La línea de cifras de un flujo: `<min> · <tokens> tok · sal <salida>` (un dato sin valor es `—`) y, detrás, cada uno solo si cabe,
 * `5h +<n>%` (el % de la ventana de 5 h que gastó), `+<mas> −<menos>`, `×<subtareas>` y, en un flujo reanudado, `<n> sesiones`. Las cifras van
 * con ` · ` y, si así no caben en `ancho`, con un espacio; si ni así, se cortan a `ancho`.
 */
export function lineaCifras(f: FilaHistorial, ancho: number): string {
  const dato = (n?: number): string => (n === undefined ? '—' : tokens(n))
  const cifras = (sep: string): string => [cifraMinutos(f.minutos), `${dato(f.tokens)} tok`, `sal ${dato(f.salida)}`].join(sep)
  const sep = medir(cifras(' · ')) <= ancho ? ' · ' : ' '
  const base = cifras(sep)

  if (medir(base) > ancho) return Array.from(base).slice(0, Math.max(ancho, 0)).join('')

  const cola = [
    f.cincoHoras === undefined ? '' : cifraCincoHoras(f.cincoHoras),
    f.mas === undefined && f.menos === undefined ? '' : `+${f.mas ?? 0} −${f.menos ?? 0}`,
    f.subtareas === undefined ? '' : `×${f.subtareas}`,
    f.sesiones === undefined ? '' : `${f.sesiones} sesiones`,
  ]

  return cola.filter(p => p !== '').reduce((acc, p) => (medir(`${acc}${sep}${p}`) <= ancho ? `${acc}${sep}${p}` : acc), base)
}

/** `texto` cortado a `ancho` caracteres (no unidades de código) con «…» al final si no cabe. */
function cortar(texto: string, ancho: number): string {
  const letras = Array.from(texto)
  if (letras.length <= ancho) return texto
  if (ancho <= 0) return ''

  return `${letras.slice(0, ancho - 1).join('').trimEnd()}…`
}

/** `texto` repartido en hasta `lineas` líneas de `ancho` caracteres, cortando entre palabras; lo que no cabe en la última se corta con «…». */
function partir(texto: string, ancho: number, lineas: number): string[] {
  const salida: string[] = []
  let resto = texto.replace(/\s+/g, ' ').trim()

  while (resto !== '' && ancho > 0) {
    if (salida.length === lineas - 1 || medir(resto) <= ancho) {
      salida.push(cortar(resto, ancho))
      break
    }

    const letras = Array.from(resto)
    const espacio = letras.slice(0, ancho + 1).lastIndexOf(' ')
    const corte = espacio > 0 ? espacio : ancho

    salida.push(letras.slice(0, corte).join(''))
    resto = letras.slice(corte).join('').trim()
  }

  return salida
}

/**
 * Las líneas de un flujo, ninguna más larga que `ancho` caracteres: la de `lineaIdentidad`, el título en hasta 2 líneas (con `⚠ ` antes si el
 * flujo se canceló o quedó bloqueado; `sin título` si falta; lo que no cabe se corta con «…») y la de `lineaCifras`. La espera no se dibuja.
 */
export function lineasHistorial(f: FilaHistorial, ancho: number): string[] {
  const titulo = `${f.aviso ? '⚠ ' : ''}${f.titulo ?? 'sin título'}`

  return [lineaIdentidad(f, ancho), ...partir(titulo, ancho, 2), lineaCifras(f, ancho)]
}
