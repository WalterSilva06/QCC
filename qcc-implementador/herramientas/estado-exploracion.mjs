// Lectura de los informes del explorador (puro): hallazgos, DUDAS, avisos y la unión de varios informes.

import path from 'node:path'
import { configDe, coincide, RAIZ } from './guardia.mjs'
import { criticosDe, rutasDeTexto } from './estado-plan.mjs'

/** Hallazgos de un informe de exploración: `[{ seccion, linea }]`, sin encabezados, renglones vacíos ni «ninguno». */
export function hallazgosDe(texto) {
  const hallazgos = []
  let seccion = null
  for (const linea of sinProsaFinal(texto)) {
    const encabezado = RE_ENCABEZADO.exec(linea)
    if (encabezado) seccion = encabezado[1]
    else if (seccion && linea.trim() && !RE_NINGUNO.test(linea)) hallazgos.push({ seccion, linea: linea.trim().replace(/^[-*]\s+/, '') })
  }
  return hallazgos
}

/** Avisos `SIN EXPLORAR: <línea>` de las DUDAS marcadas `no explorado:` (o `No exploradas:`, `**no explorado**:`, con viñeta o negrita). Solo DUDAS. */
export function sinExplorarDe(hallazgos) {
  return hallazgos.filter((h) => h.seccion === 'DUDAS' && RE_NO_EXPLORADO.test(h.linea)).map((h) => `SIN EXPLORAR: ${h.linea}`)
}

/** ¿La ruta citada cae en `permitidos`? También abreviada, como la escribe el explorador: `billing/x.ts` calza con `src/billing/x.ts`. */
const citaPermitido = (ruta, permitidos) => coincide(ruta, permitidos) || permitidos.some((p) => p.endsWith(`/${ruta}`))

/** Los hallazgos que citan alguna ruta dentro de `permitidos`, como `- [SECCIÓN] …`: el CONTEXTO del ejecutor. Sin permitidos, ninguno. */
export function contextoDe(hallazgos, permitidos) {
  if (!permitidos.length) return []
  return hallazgos.filter((h) => rutasDeTexto(h.linea).some((r) => citaPermitido(r, permitidos))).map((h) => `- [${h.seccion}] ${h.linea}`)
}

/**
 * Rutas de ACOPLAMIENTOS (solo las que traen carpeta) que no caen en ningún permitido ni se nombran en «Fuera de alcance»
 * (por ruta o por nombre de archivo): `pasos.md` pide que cada acoplado tenga uno de los dos.
 */
export function acopladosSinCubrir(hallazgos, permitidos, fueraDeAlcance) {
  const fuera = String(fueraDeAlcance ?? '')
  const rutas = hallazgos.filter((h) => h.seccion === 'ACOPLAMIENTOS').flatMap((h) => rutasDeTexto(h.linea)).filter((r) => r.includes('/'))
  return [...new Set(rutas)].filter((r) => !citaPermitido(r, permitidos) && !fuera.includes(r) && !fuera.includes(path.posix.basename(r)))
}

/**
 * Qué criterios de `criticos` tocan las rutas de la exploración: «ninguna» solo si el proyecto declara `criticos` y
 * ninguna ruta citada cae en ellos. Una regla condicional (`si`) cuenta como crítica.
 */
export function criticasDeExploracion(texto) {
  const { criticos } = configDe(RAIZ)
  if (!criticos.length) return 'el proyecto no declara «criticos»'
  const porCriterio = new Map()
  for (const ruta of rutasDeTexto(texto)) {
    const { fijos, condicionales } = criticosDe(ruta, criticos)
    for (const n of [...fijos, ...condicionales.flatMap((c) => c.ns)]) if (!porCriterio.has(n)) porCriterio.set(n, ruta)
  }
  if (!porCriterio.size) return 'ninguna'
  return [...porCriterio.keys()].sort((a, b) => a - b).map((n) => `#${n} (${porCriterio.get(n)})`).join(', ')
}

const SECCIONES_EXPLORACION = ['ARCHIVOS', 'TESTS', 'ACOPLAMIENTOS', 'DATOS', 'DUDAS']

const RE_ENCABEZADO = /^\s*(?:#{1,6}\s*)?(?:\*\*)?(ARCHIVOS|TESTS|ACOPLAMIENTOS|DATOS|DUDAS)(?:\*\*)?(?:\s*\(.*\))?(?:\*\*)?\s*:?\s*$/

const RE_NINGUNO = /^\s*(?:[-*]\s*)?ninguno\.?\s*$/i

/** Tope de líneas de hallazgos de cada explorador y máximo de exploradores en total y en el reintento: fijos, el orquestador elige cuántos según el pedido. */
export const TOPE_LINEAS_EXPLORADOR = 20

export const MAX_EXPLORADORES = 24

export const MAX_REINTENTO = 4

const RE_RUTA_LINEA = /[^\s`—]+:\d+/

/** Líneas del informe sin la prosa que sobra: en la última sección, tras un renglón vacío, solo quedan viñetas («-», «*») y líneas con `ruta:línea`. */
function sinProsaFinal(texto) {
  const lineas = String(texto ?? '').split('\n')
  const ultimo = lineas.findLastIndex((l) => RE_ENCABEZADO.test(l))
  if (ultimo < 0) return lineas
  let hayVacio = false
  return lineas.filter((l, i) => {
    if (i <= ultimo) return true
    if (!l.trim()) hayVacio = true
    return !hayVacio || !l.trim() || /^\s*[-*]/.test(l) || RE_RUTA_LINEA.test(l)
  })
}

/** Líneas `LARGO:` de los informes `[{ id, texto }]` que pasan de `tope` hallazgos (líneas no vacías sin los 5 encabezados). */
export function avisosDeLargo(informes, tope) {
  const avisos = []
  for (const { id, texto } of informes) {
    const lineas = sinProsaFinal(texto).filter((l) => l.trim() && !RE_ENCABEZADO.test(l) && !RE_NINGUNO.test(l))
    if (lineas.length > tope) avisos.push(`LARGO: agente ${id} con ${lineas.length} hallazgos (tope ${tope})`)
  }
  return avisos
}

/** Una DUDA `no explorado:` (o `No exploradas:`, `**no explorado**:`), ya sin la viñeta. */
const RE_NO_EXPLORADO = /^[*_`\s]*no explorad[oa]s?\**\s*:/i

const RE_RUTA_LINEAS = /[^\s`—;,()]+:\d+(?:-\d+)?/g

const RE_ARCHIVO = /[\w@.\\/-]*\w\.[a-z]{1,5}\b/gi

const conBarras = (ruta) => ruta.replaceAll('\\', '/').replace(/^\.\//, '')

/**
 * Clave para no repetir un hallazgo de `seccion`: el primer `ruta:líneas` (con su rango) de lo que va antes de « — », o
 * todos si es un acoplamiento (`→`: cada destino cuenta); sin rutas, el texto antes de « — ». `\` y `/` valen igual.
 */
function claveDeHallazgo(seccion, linea) {
  const cabeza = linea.split(' — ')[0]
  const rutas = (cabeza.match(RE_RUTA_LINEAS) ?? linea.match(RE_RUTA_LINEAS))?.map(conBarras)
  if (rutas) return `${seccion} ruta:${(cabeza.includes('→') ? rutas : rutas.slice(0, 1)).join(' ')}`
  return `${seccion} texto:${cabeza.replace(/^\s*[-*]\s*/, '').trim()}`
}

/** Archivos (con extensión) que nombra una línea, con `/`. */
const archivosDe = (linea) => (linea.match(RE_ARCHIVO) ?? []).map(conBarras)

/** Si `archivo` (ruta o solo el nombre) está entre los `citados`: iguales, o uno termina en `/` más el otro. */
const citado = (archivo, citados) => citados.some((c) => c === archivo || c.endsWith(`/${archivo}`) || archivo.endsWith(`/${c}`))

/**
 * Une los informes de varios exploradores (`[{ id, texto }]`) en uno solo: las secciones ARCHIVOS, TESTS, ACOPLAMIENTOS,
 * DATOS y DUDAS, en ese orden, con los hallazgos en el orden de llegada. Un hallazgo se descarta solo si otro informe ya
 * trajo, en la misma sección, la misma clave (`claveDeHallazgo`; gana la primera aparición); los de un mismo informe quedan
 * todos. Una DUDA `no explorado:` se descarta si otro informe cita, fuera de DUDAS, todos los archivos que nombra.
 * Devuelve `{ texto, incompletos }`; `incompletos` son los `{ id, faltan }` de los informes sin alguna sección.
 */
export function fusionarExploraciones(informes) {
  const porSeccion = new Map(SECCIONES_EXPLORACION.map((s) => [s, []]))
  const vistas = new Map()
  const incompletos = []
  const citadosPor = new Map(informes.map((i) => [i.id, []]))
  for (const { id, texto } of informes) {
    const presentes = new Set()
    let actual = null
    for (const linea of sinProsaFinal(texto)) {
      const encabezado = RE_ENCABEZADO.exec(linea)
      if (encabezado) {
        actual = encabezado[1]
        presentes.add(actual)
        continue
      }
      if (!actual || !linea.trim() || RE_NINGUNO.test(linea)) continue
      if (actual !== 'DUDAS') citadosPor.get(id).push(...archivosDe(linea))
      const clave = claveDeHallazgo(actual, linea)
      if ((vistas.get(clave) ?? id) !== id) continue
      vistas.set(clave, id)
      porSeccion.get(actual).push({ id, linea: linea.trimEnd() })
    }
    const faltan = SECCIONES_EXPLORACION.filter((s) => !presentes.has(s))
    if (faltan.length) incompletos.push({ id, faltan })
  }
  // shortcut: cubre por nombre de archivo, no por rango de líneas; si otro explorador citó solo otra parte del archivo, la DUDA igual se va.
  const cubierta = ({ id, linea }) => {
    const archivos = archivosDe(linea)
    const otros = informes.filter((i) => i.id !== id).flatMap((i) => citadosPor.get(i.id))
    return RE_NO_EXPLORADO.test(linea.trim().replace(/^[-*]\s+/, '')) && archivos.length > 0 && archivos.every((a) => citado(a, otros))
  }
  porSeccion.set('DUDAS', porSeccion.get('DUDAS').filter((h) => !cubierta(h)))
  const bloques = SECCIONES_EXPLORACION.map((s) => [s, ...(porSeccion.get(s).length ? porSeccion.get(s).map((h) => h.linea) : ['- ninguno'])].join('\n'))
  return { texto: bloques.join('\n\n'), incompletos }
}
