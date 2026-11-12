// Lectura del plan del planificador (puro): subtareas, campos, permitidos, permisos, lotes y DECISIONES.

import { coincide, regexDePermiso, motivoFijoDe } from './guardia.mjs'
import { WIN, listaPermitidos, enAlcance } from './estado-base.mjs'

// ── Plan ────────────────────────────────────────────────────────────────────

export const CAMPOS_SUBTAREA = ['Crítica', 'Archivos permitidos', 'Hecho cuando', 'Tests', 'Riesgos', 'Reversión']

export const sinMarcas = (s) => String(s).replace(/\*\*/g, '').replace(/`/g, '').trim()

const RE_SUBTAREA = /^\s*(?:#{1,6}\s+)?(?:\*\*)?S(\d+)\s*·\s*(.*?)(?:\*\*)?\s*$/

const RE_PIE = /^\s*(?:\*\*)?(PERMISOS A APROBAR|Verificación final|Queda para ti|Costo)(?:\*\*)?\s*:/i

const RE_SIN_CAMBIOS = /^\s*(?:\*\*)?Sin cambios(?:\*\*)?\s*:/i

/** Valor del campo `nombre` (`- Crítica: …`, con o sin negritas) en esas líneas; null si no está. */
export function campoDe(lineas, nombre) {
  const re = new RegExp(`^\\s*(?:[-*]\\s+)?(?:\\*\\*)?${nombre}(?:\\*\\*)?\\s*:(?:\\*\\*)?\\s*(.*)$`, 'i')
  for (const l of lineas) {
    const m = re.exec(l)
    if (m) return sinMarcas(m[1])
  }
  return null
}

const RE_COSTO = /^\s*(?:\*\*)?Costo(?:\*\*)?\s*:/i

/** Quita del texto del plan las líneas posteriores a «Costo:» que no sean un campo del pie, `S<n> ·` ni «Sin cambios» (prosa que sobra). El resto queda tal cual. */
export function recortarPie(texto) {
  let trasCosto = false
  return String(texto).split('\n').filter((l) => {
    if (trasCosto && !RE_PIE.test(l) && !RE_SUBTAREA.test(l) && !RE_SIN_CAMBIOS.test(l)) return false
    if (RE_COSTO.test(l)) trasCosto = true
    else if (RE_SUBTAREA.test(l)) trasCosto = false
    return true
  }).join('\n')
}

/** Plan en texto → `{ cabecera, subtareas: [{ n, objetivo, lineas }], pie }`, con el formato de plan.md §3. La línea «Sin cambios» de un re-plan se descarta, y la prosa tras «Costo:» también. */
export function partesDelPlan(texto) {
  const cabecera = []
  const subtareas = []
  const pie = []
  let actual = cabecera
  for (const l of recortarPie(String(texto).replace(/\r\n/g, '\n')).split('\n')) {
    if (RE_SIN_CAMBIOS.test(l)) continue
    const s = RE_SUBTAREA.exec(l)
    if (s) {
      const nueva = { n: Number(s[1]), objetivo: sinMarcas(s[2]), lineas: [l] }
      subtareas.push(nueva)
      actual = nueva.lineas
    } else {
      if (RE_PIE.test(l)) actual = pie
      actual.push(l)
    }
  }
  for (const s of subtareas) while (s.lineas.length && !s.lineas.at(-1).trim()) s.lineas.pop()
  return { cabecera, subtareas, pie }
}

/** Parte el texto en los «;» fuera de paréntesis (`a.mjs; b.mjs (x; y)` → dos partes). */
function partirPorPuntoYComa(texto) {
  const partes = ['']
  let profundidad = 0
  for (const c of texto) {
    if (c === '(') profundidad++
    else if (c === ')') profundidad = Math.max(0, profundidad - 1)
    if (c === ';' && profundidad === 0) partes.push('')
    else partes[partes.length - 1] += c
  }
  return partes
}

/** Rutas de «Archivos permitidos», sin comillas, marcas ni explicaciones; parte por «,» y por «;» fuera de paréntesis. */
export function permitidosDe(valor) {
  return partirPorPuntoYComa(String(valor ?? '').replace(/`/g, ''))
    .flatMap((parte) => listaPermitidos(parte))
    .map((p) => p.replace(/\s+[—–]\s+.*$/, '').trim())
    .filter((p) => p && !/^(ninguno|nada)$/i.test(p))
}

/** ¿Una ruta permitida tiene pinta de frase y no de ruta? Con espacios o terminada en «.». */
export function noPareceRuta(p) {
  return /\s/.test(p) || p.endsWith('.')
}

/**
 * Campo opcional «Depende de» de la subtarea `n` → `{ depende, aviso }`. `ninguna` da `[]` y `S1, S2` da `[1, 2]`, siempre que sean
 * subtareas anteriores del plan (`existentes`); `valor` null (falta) o inválido da `depende` undefined, y el inválido trae `aviso`.
 * Sin valor, la subtarea depende de la anterior.
 */
export function dependeDe(valor, n, existentes) {
  if (valor === null) return {}
  const texto = valor.replace(/\s+[—–]\s+.*$/, '').replace(/\s*\([^)]*\)/g, '').trim()
  if (/^ninguna$/i.test(texto)) return { depende: [] }
  const numeros = texto.split(',').map((p) => {
    const m = /^S(\d+)$/i.exec(p.trim())
    return m ? Number(m[1]) : NaN
  })
  if (numeros.every((k) => existentes.includes(k) && k < n)) return { depende: [...new Set(numeros)].sort((a, b) => a - b) }
  return { aviso: `S${n} · Depende de: «${valor}» no es «ninguna» ni subtareas anteriores del plan; se trata como ausente (depende de la anterior)` }
}

/**
 * Bloque «PERMISOS A APROBAR:» del pie → `[{ id, rol, sub?, comando, servicio, reversible, queHace, paraQue }]`. Cada permiso es una
 * línea `P<n> · <ejecutor S<n> | orquestador | post-revisión> ·\`comando\`[ nota] · <servicio> · reversible: sí | no` con las líneas sangradas
 * `Qué hace:` y `Para qué:`. `rol` es la primera palabra de «quién» en minúsculas; lo que falta queda '' (y `reversible`
 * false: sin él cuenta como no). `comando` es lo que va entre comillas invertidas.
 */
export function permisosDe(pie) {
  const permisos = []
  for (const l of bloqueDe(pie, 'PERMISOS A APROBAR').split('\n').slice(1)) {
    const cabecera = /^\s*(?:[-*]\s+)?(?:\*\*)?(P\d+)(?:\*\*)?\s*·\s*(.*)$/.exec(l)
    if (cabecera) {
      const [, id, resto] = cabecera
      const m = /^(.*?)\s*·\s*(`+)(.+?)\2([^·]*)(?:·\s*(.*))?$/.exec(resto)
      const quien = (m ? m[1] : resto.split(/\s+·\s+/)[0]).trim()
      const partes = (m?.[5] ?? '').split(/\s+·\s+/).map((p) => p.trim()).filter(Boolean)
      const reversible = partes.map((p) => /^reversible\s*:\s*(sí|si|no)(?![\p{L}\d])/iu.exec(p)?.[1]).find(Boolean)
      const sub = /\bS(\d+)\b/i.exec(quien)?.[1]
      permisos.push({
        id,
        rol: quien.split(/\s+/)[0].toLowerCase(),
        ...(sub ? { sub: Number(sub) } : {}),
        comando: m ? m[3].trim() : '',
        servicio: partes.find((p) => !/^reversible\s*:/i.test(p)) ?? '',
        reversible: reversible ? /^s/i.test(reversible) : false,
        ...(reversible ? {} : { sinReversible: true }),
        queHace: '',
        paraQue: '',
      })
      continue
    }
    const campo = /^\s*(?:\*\*)?(Qué hace|Para qué)(?:\*\*)?\s*:(?:\*\*)?\s*(.*)$/i.exec(l)
    if (campo && permisos.length) permisos.at(-1)[/^qué/i.test(campo[1]) ? 'queHace' : 'paraQue'] = campo[2].trim()
  }
  return permisos
}

export const ROLES_DE_PERMISO = ['orquestador', 'post-revisión']

const RE_SERVIDOR = /\b(dev|serve|start|preview|ngrok|cloudflared)\b/i

/**
 * Avisos de los permisos leídos de un plan (`bloque`: el texto del bloque, '' si no hay). `subs`: números de las subtareas;
 * `permitidos`: los de todas. Cubre: bloque sin permisos, campo que falta, quién inválido o subtarea que no existe, comodín
 * inválido, comando que ningún permiso levanta, y un argumento del comando que es un archivo permitido de alguna subtarea.
 */
export function avisosDePermisos(permisos, bloque, subs, permitidos) {
  const avisos = []
  if (bloque && !permisos.length) avisos.push('PERMISOS A APROBAR: el bloque está pero no se leyó ningún permiso (¿quedó después de «Costo:»?)')
  for (const p of permisos) {
    const faltan = [
      ...(p.comando ? [] : ['«comando» entre comillas invertidas']),
      ...(p.servicio ? [] : ['servicio']),
      ...(p.sinReversible ? ['«reversible: sí | no» (cuenta como no)'] : []),
      ...(p.queHace ? [] : ['«Qué hace»']),
      ...(p.paraQue ? [] : ['«Para qué»']),
    ]
    if (faltan.length) avisos.push(`${p.id} · le falta ${faltan.join(', ')}`)
    if (p.rol === 'ejecutor' ? !subs.includes(p.sub) : !ROLES_DE_PERMISO.includes(p.rol)) avisos.push(`${p.id} · quién «${p.rol}${p.sub ? ` S${p.sub}` : ''}» no vale: es «ejecutor S<n>» de una subtarea del plan, «orquestador» o «post-revisión»`)
    if (p.rol === 'orquestador' && p.comando && !RE_SERVIDOR.test(p.comando)) avisos.push(`${p.id} · «${p.comando}» es del orquestador pero no parece un servidor (dev, serve, start, preview, ngrok, cloudflared): ¿es «post-revisión» o del ejecutor de una subtarea?`)
    if (!p.comando) continue
    if (!regexDePermiso(p.comando)) avisos.push(`${p.id} · «${p.comando}» no se puede aprobar: no es un comando simple o el comodín «*» cae antes de la parte literal`)
    const fijo = motivoFijoDe(p.comando)
    if (fijo) avisos.push(`${p.id} · «${p.comando}» se niega aun aprobado (${fijo})`)
    const editable = p.comando.split(/\s+/).slice(1).find((w) => !w.startsWith('-') && coincide(w, permitidos))
    if (editable) avisos.push(`${p.id} · «${editable}» está en los permitidos de una subtarea: un agente podría editarlo y correrlo con los secretos`)
  }
  return avisos
}

/** Texto de un campo con sus líneas de continuación (las más sangradas que su línea); '' si no está. */
export function bloqueDe(lineas, nombre) {
  const re = new RegExp(`^(\\s*)(?:[-*]\\s+)?(?:\\*\\*)?${nombre}(?:\\*\\*)?\\s*:`, 'i')
  const k = lineas.findIndex((l) => re.test(l))
  if (k < 0) return ''
  const sangria = re.exec(lineas[k])[1].length
  const bloque = [lineas[k]]
  for (const l of lineas.slice(k + 1)) {
    if (l.trim() && l.length - l.trimStart().length <= sangria) break
    bloque.push(l)
  }
  return bloque.join('\n')
}

/**
 * «Archivos permitidos» de la subtarea `n` con sus líneas de continuación (viñetas `-` o `*` incluidas), unidas con coma →
 * `{ permitidos, avisos }`. Sin el campo da `permitidos` vacío y sin avisos (la falta ya la avisa resumirPlan). Avisa si el campo
 * no trae ninguna ruta y por cada ruta que no parece una (`noPareceRuta`).
 */
export function permitidosDeSubtarea(lineas, n) {
  const bloque = bloqueDe(lineas, 'Archivos permitidos')
  if (!bloque) return { permitidos: [], avisos: [] }
  const texto = bloque.split('\n')
    .map((l, i) => (i === 0 ? l.replace(/^\s*(?:[-*]\s+)?(?:\*\*)?Archivos permitidos(?:\*\*)?\s*:(?:\*\*)?/i, '') : l.replace(/^\s*[-*]\s+/, '')).trim())
    .filter(Boolean)
    .join(', ')
  const permitidos = permitidosDe(texto)
  const avisos = permitidos.length
    ? permitidos.filter(noPareceRuta).map((p) => `S${n} · permitido «${p}» no parece una ruta`)
    : [`S${n} · Archivos permitidos: no se leyó ninguna ruta`]
  return { permitidos, avisos }
}

const RE_PARECE_EXTERNA =/\blocalhost\b|--env-file|\bservidor\b|\bdeploy\b|--linked/i

const RE_GET_POST = /\b(?:GET|POST)\s+a\b/

/** Lo que de «Hecho cuando», «Tests» y «Riesgos» sugiere un servicio vivo o la red (localhost, GET/POST a, --env-file, servidor, deploy, --linked); null si nada. */
export function parecenExternas(lineas) {
  const texto = ['Hecho cuando', 'Tests', 'Riesgos'].map((c) => bloqueDe(lineas, c)).join('\n')
  return RE_PARECE_EXTERNA.exec(texto)?.[0] ?? RE_GET_POST.exec(texto)?.[0] ?? null
}

/** Comandos `! …` del pie (los de «Queda para ti»), sin el comentario; salvo `git` y borrados recursivos, que se niegan aun aprobados. */
export function comandosParaTi(pie) {
  return [...pie.join('\n').matchAll(/`!\s*([^`#]*[^`#\s])/g)].map((m) => m[1]).filter((c) => !/^git\b|\brm\s+-\w*r/i.test(c))
}

const RE_GLOB = /[*?[{]/

/** Carpeta del tramo literal de un glob, antes de su primer carácter de glob: `src/a/*.ts` → `src/a/`. */
const carpetaLiteral = (p) => {
  const literal = p.slice(0, p.search(RE_GLOB))
  const carpeta = literal.slice(0, literal.lastIndexOf('/') + 1)
  return WIN ? carpeta.toLowerCase() : carpeta
}

/** ¿Se pisan dos rutas permitidas? Dos globs, si la carpeta literal de uno es prefijo de la del otro; si no, si una cae dentro de la otra. */
const pisa = (p, q) => {
  if (RE_GLOB.test(p) && RE_GLOB.test(q)) {
    const a = carpetaLiteral(p)
    const b = carpetaLiteral(q)
    return a.startsWith(b) || b.startsWith(a)
  }
  return enAlcance(p, [q]) || enAlcance(q, [p])
}

const sePisan = (a, b) => a.some((p) => b.some((q) => pisa(p, q)))

/** Tope de subtareas que editan el mismo árbol a la vez en un lote. */
const TOPE_LOTE = 4

/** ¿Hace de barrera? Sin permitidos, o con alguno que no parece una ruta: se pisa con todas. */
const esBarrera = (permitidos) => permitidos.length === 0 || permitidos.some(noPareceRuta)

/**
 * Lotes de ejecución del plan, por ondas, en orden de lote y dentro de cada uno por n: `[[1, 3], [2], [4]]`. `subtareas`:
 * `{ n, permitidos, depende }` (`depende` ausente = depende de la anterior). Cada subtarea va al primer lote con menos de
 * `TOPE_LOTE` miembros que quede después de los lotes de sus dependencias y de los de toda subtarea anterior con la que se pisa
 * (un archivo dentro de una carpeta o de un glob de la otra cuenta como pisarse). Sin permitidos, o con uno que no parece
 * una ruta, se pisa con todas y hace de barrera. Con `sola: true` (tiene un permiso irreversible) no es barrera: espera a sus
 * dependencias y a las previas con que se pisa, pero va siempre a un lote vacío y ninguna otra entra en él.
 */
export function lotesDe(subtareas) {
  const lotes = []
  const loteDeN = new Map()
  const previas = []
  const lotesSola = new Set()
  subtareas.forEach((s, i) => {
    const permitidos = Array.isArray(s.permitidos) ? s.permitidos : []
    const sola = s.sola === true
    const barrera = esBarrera(permitidos)
    const depende = Array.isArray(s.depende) ? s.depende : i > 0 ? [subtareas[i - 1].n] : []
    const despuesDe = [
      ...depende.map((n) => loteDeN.get(n)),
      ...previas.filter((p) => barrera || p.barrera || sePisan(p.permitidos, permitidos)).map((p) => p.lote),
    ].filter((k) => k !== undefined)
    let lote = Math.max(-1, ...despuesDe) + 1
    // La guardia no distingue qué ejecutor del lote llama: la `sola` no comparte lote.
    while (lotes[lote]?.length >= TOPE_LOTE || lotesSola.has(lote) || (sola && lotes[lote]?.length)) lote++
    if (!lotes[lote]) lotes[lote] = []
    if (sola) lotesSola.add(lote)
    lotes[lote].push(s.n)
    loteDeN.set(s.n, lote)
    previas.push({ permitidos, barrera, lote })
  })
  return lotes.map((l) => [...l].sort((a, b) => a - b))
}

/** Criterios que `criticos` (de `.claude/qcc-implementador.json`) pide para `ruta`: los fijos y los que dependen de una condición. */
export function criticosDe(ruta, reglas) {
  const fijos = new Set()
  const condicionales = []
  for (const r of reglas) {
    const rutas = Array.isArray(r.rutas) ? r.rutas.map(String) : []
    const excepto = Array.isArray(r.excepto) ? r.excepto.map(String) : []
    if (!rutas.length || !coincide(ruta, rutas) || (excepto.length && coincide(ruta, excepto))) continue
    const ns = (Array.isArray(r.criterios) ? r.criterios : []).map(Number).filter(Number.isInteger)
    if (r.si) condicionales.push({ ns, si: String(r.si) })
    else for (const n of ns) fijos.add(n)
  }
  return { fijos: [...fijos].sort((a, b) => a - b), condicionales }
}

/** Integra un re-plan: sus subtareas reemplazan a las del mismo número; la cabecera y el pie, solo si los trae. */
export function fusionarPlanes(previo, nuevo) {
  const a = partesDelPlan(previo)
  const b = partesDelPlan(nuevo)
  const cabecera = campoDe(b.cabecera, 'Clasificación') !== null ? b.cabecera : a.cabecera
  const porNumero = new Map(a.subtareas.map((s) => [s.n, s]))
  for (const s of b.subtareas) porNumero.set(s.n, s)
  const subtareas = [...porNumero.values()].sort((x, y) => x.n - y.n)
  // Un re-plan con pie pero sin el bloque de permisos conserva el anterior.
  const anterior = bloqueDe(a.pie, 'PERMISOS A APROBAR')
  const pie = b.pie.length ? (anterior && !bloqueDe(b.pie, 'PERMISOS A APROBAR') ? [...anterior.split('\n'), ...b.pie] : b.pie) : a.pie
  return [...cabecera, ...subtareas.flatMap((s) => [...s.lineas, '']), ...pie].join('\n').trim()
}

const RE_PRUEBAS = /(^|\/)(__tests__|tests?|specs?)\/|[._-](test|spec)\.[^/]+$/i

/**
 * Las decisiones que salen solas del plan (pasos.md paso 2, comun.md §5 y §6), como líneas listas para imprimir:
 * `{ ciclos, critico, aspectos }`. `subtareas` trae `{ n, critica, permitidos, fijos }` (`fijos`: los criterios
 * incondicionales de sus rutas críticas) y `pedidos` los criterios que piden las rutas críticas del plan (números, o `{ n, ruta }`).
 * Ante cualquier duda gana lo más estricto: sin Clasificación, o una que no empieza con «sin criterios», cuenta como CRÍTICO,
 * y también si hay pedidos o una subtarea de Crítica efectiva sí (la tiene si `critica` falta, no empieza con «no» o tiene `fijos`).
 */
export function decisionesDelPlan({ clasificacion = null, subtareas = [], pedidos = [] }) {
  const lista = Array.isArray(subtareas) ? subtareas : []
  const pedidas = (Array.isArray(pedidos) ? pedidos : [])
    .map((p) => (typeof p === 'object' && p !== null ? { n: Number(p.n), ruta: p.ruta } : { n: Number(p), ruta: undefined }))
    .filter((p) => Number.isInteger(p.n))
  const textoClasificacion = clasificacion === null || clasificacion === undefined ? null : String(clasificacion).trim()
  const criticas = lista.filter((s) => s.critica === null || s.critica === undefined || !/^no\b/i.test(String(s.critica).trim()) || (s.fijos ?? []).length > 0)
  const critico = textoClasificacion === null || !/^sin criterios/i.test(textoClasificacion) || pedidas.length > 0 || criticas.length > 0
  const delTexto = textoClasificacion === null ? [] : [...textoClasificacion.matchAll(/#(\d+)/g)].map((m) => Number(m[1]))
  const citados = [...new Set([...delTexto, ...pedidas.map((p) => p.n)])].sort((a, b) => a - b)

  const ciclos = `CICLOS DE LA REVISIÓN FINAL: ${critico ? 2 : 1}`

  let linea
  if (textoClasificacion === null) linea = 'sin Clasificación en el plan (cuenta como CRÍTICO)'
  else if (!critico) linea = 'ninguno'
  else {
    const razon = /\s[—–]\s+(.+)$/s.exec(textoClasificacion)?.[1]?.trim()
    const sinCitar = pedidas.filter((p) => !delTexto.includes(p.n))
    linea = [
      `${citados.length ? citados.map((n) => `#${n}`).join(', ') : 'sin números de criterio'}${razon ? ` — ${razon}` : ''}`,
      ...(sinCitar.length ? [`rutas críticas: ${sinCitar.map((p) => `#${p.n}${p.ruta ? ` (${p.ruta})` : ''}`).join(', ')}`] : []),
      ...(criticas.length ? [`primero ${criticas.map((s) => `S${s.n}`).join(', ')}`] : []),
    ].join(' · ')
  }

  const permitidos = lista.flatMap((s) => (Array.isArray(s.permitidos) ? s.permitidos : []))
  const soloTexto = permitidos.length > 0 && permitidos.every((p) => /\.md$/i.test(p))
  const aspectos = [
    'contratos, tipos y documentación',
    ...(permitidos.some((p) => RE_PRUEBAS.test(p)) ? ['tests'] : []),
    ...((textoClasificacion === null || citados.some((n) => [1, 2, 3, 6, 9].includes(n))) && !soloTexto ? ['casos borde y seguridad'] : []),
  ].join(', ')
  return { ciclos, critico: `CRÍTICO: ${linea}`, aspectos: `ASPECTOS: ${aspectos}` }
}

/** Las líneas de `decisiones` (de `decisionesDelPlan`) en el orden en que se imprimen. */
export const lineasDeDecisiones = (d) => [d.ciclos, d.critico, d.aspectos]

const CAMPOS_APROBACION = ['Crítica', 'Depende de', 'Archivos permitidos', 'Cómo']

/** Con un `PARA APROBAR` entero más largo que esto, va compacto (una línea por subtarea, con el «Cómo» recortado): así la salida de `--guardar plan` no pasa de 30.000 caracteres, el tope de Claude Code. */
const TOPE_APROBACION_ENTERA = 18_000

/** Con más subtareas que esto, `--guardar plan` no imprime la línea de resumen de cada una: ya van en `PARA APROBAR`. */
export const TOPE_LINEAS_RESUMEN = 20

const TOPE_COMO_COMPACTO = 160

/** `S<n> · <título> · Crítica: … · Depende de: … · permitidos: … · Cómo: …`: la línea de una subtarea en el `PARA APROBAR` compacto. */
function lineaCompacta(s) {
  const { permitidos } = permitidosDeSubtarea(s.lineas, s.n)
  const como = campoDe(s.lineas, 'Cómo')
  return [
    `S${s.n} · ${s.objetivo}`,
    `Crítica: ${campoDe(s.lineas, 'Crítica') ?? '(falta)'}`,
    `Depende de: ${campoDe(s.lineas, 'Depende de') ?? '(la anterior)'}`,
    `permitidos: ${permitidos.join(', ') || '(faltan)'}`,
    ...(como ? [`Cómo: ${como.length > TOPE_COMO_COMPACTO ? `${como.slice(0, TOPE_COMO_COMPACTO).trimEnd()}…` : como}`] : []),
  ].join(' · ')
}

/**
 * Lo que el orquestador muestra para aprobar el plan: cabecera, por subtarea su título y CAMPOS_APROBACION, y el pie sin «Verificación final».
 * Si eso pasa de `TOPE_APROBACION_ENTERA` caracteres, una línea compacta por subtarea (`lineaCompacta`): el «Cómo» entero queda en plan.md.
 */
export function aprobacionDe({ cabecera, subtareas, pie }) {
  const titulo = cabecera.find((l) => /^\s*(?:#{1,6}\s+)?(?:\*\*)?PLAN ·/i.test(l))
  const bloques = (lineas, campos) => campos.map((c) => bloqueDe(lineas, c)).filter(Boolean)
  const con = (lineas) => [
    ...(titulo ? [titulo.trim()] : []),
    ...bloques(cabecera, ['Clasificación', 'Objetivo', 'Fuera de alcance']),
    ...lineas,
    '',
    ...bloques(pie, ['PERMISOS A APROBAR', 'Queda para ti', 'Costo']),
  ].join('\n').trim()
  const entero = con(subtareas.flatMap((s) => ['', s.lineas[0].trim(), ...bloques(s.lineas, CAMPOS_APROBACION)]))
  return entero.length <= TOPE_APROBACION_ENTERA ? entero : con(['', ...subtareas.map(lineaCompacta)])
}

/** Rutas de archivo que cita un informe (`ruta:línea`, absolutas o relativas), relativas al repo cuando caen dentro. */
export function rutasDeTexto(texto) {
  const rutas = new Set()
  const patron = /(?:[A-Za-z]:)?[\w.\-\\/À-ſ]*[\\/][\w.\-À-ſ]+\.[A-Za-z0-9]{1,8}|\b[\w\-À-ſ]+\.(?:md|json|mjs|cjs|js|ts|tsx|jsx|astro|vue|svelte|css|html|ya?ml|toml|sql|py|rs|go)\b/g
  for (const m of String(texto).matchAll(patron)) {
    const ruta = listaPermitidos(m[0])[0]
    if (ruta) rutas.add(ruta)
  }
  return [...rutas]
}
