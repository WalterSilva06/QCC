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

  const titulo = tituloDe(r)
  const roles = rolesDe(costo.roles)
  const espera = r.v === 2 ? numero(tiempos.espera) : undefined
  const lineas = Array.isArray(r.subtareas) ? r.subtareas.filter(esObjeto) : []
  const suma = (clave: 'mas' | 'menos'): number | undefined => {
    const valores = lineas.flatMap(s => numero(s[clave]) ?? [])

    return valores.length === 0 ? undefined : valores.reduce((a, b) => a + b, 0)
  }
  const mas = suma('mas')
  const menos = suma('menos')

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

/** Los roles de `costo.roles` con `usd` numérico mayor que 0, del que más gastó al que menos. */
function rolesDe(roles: unknown): { rol: string; usd: number }[] {
  if (!esObjeto(roles)) return []

  return Object.entries(roles)
    .flatMap(([rol, v]) => {
      const usd = esObjeto(v) ? numero(v.usd) : undefined

      return usd !== undefined && usd > 0 ? [{ rol, usd }] : []
    })
    .sort((a, b) => b.usd - a.usd)
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

const ROLES_CORTOS: Record<string, string> = {
  orquestador: 'orq',
  planificador: 'plan',
  'revisor-plan': 'rplan',
  ejecutor: 'ejec',
  revisor: 'rev',
  explorador: 'expl',
}

/** `texto` cortado a `ancho` caracteres (no unidades de código) con «…» al final si no cabe. */
function cortar(texto: string, ancho: number): string {
  const letras = Array.from(texto)
  if (letras.length <= ancho) return texto
  if (ancho <= 0) return ''

  return `${letras.slice(0, ancho - 1).join('').trimEnd()}…`
}

/**
 * Las líneas de un flujo, de 1 a 3, ninguna más larga que `ancho` caracteres: la de `lineaHistorial`; con `titulo`, `  <título>`; y con algún dato,
 * `  ` y las partes unidas con ` · `: cada rol como `<corto> $x,xx`, `espera <n>m` y `+<mas> −<menos>`. Las líneas 2 y 3 terminan en «…» si no caben.
 */
export function lineasHistorial(f: FilaHistorial, ancho: number): string[] {
  const lineas = [lineaHistorial(f, ancho)]
  const partes = [
    ...(f.roles ?? []).map(r => `${ROLES_CORTOS[r.rol] ?? r.rol} ${cifraUsd(r.usd)}`),
    ...(f.espera === undefined ? [] : [`espera ${cifraMinutos(f.espera)}`]),
    ...(f.mas === undefined && f.menos === undefined ? [] : [`+${f.mas ?? 0} −${f.menos ?? 0}`]),
  ]

  if (f.titulo !== undefined) lineas.push(cortar(`  ${f.titulo}`, ancho))
  if (partes.length > 0) lineas.push(cortar(`  ${partes.join(' · ')}`, ancho))

  return lineas
}
