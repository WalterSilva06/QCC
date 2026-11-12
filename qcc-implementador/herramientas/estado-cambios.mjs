// `estado.mjs --cambios` y `--diff`: qué cambió desde una foto, el alcance, los avisos de tipos y la reversión.

import fs from 'node:fs'
import path from 'node:path'
import { RAIZ } from './guardia.mjs'
import { salidasDe, cambiosDe } from './verificar.mjs'
import { WIN, TOPE_DIFF, TOPE_CAMBIOS, TOPE_REVERSION, EDICIONES, enAlcance, git, corto, foto, leerRegistro, FLUJO, leerEstado, agruparPorCarpeta } from './estado-base.mjs'
import { cerrarFlujo } from './estado-cierre.mjs'

const EXT_TS = ['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'mts', 'cts']

// [patrón, texto del aviso, regex de la justificación en el resto de la línea]
const PATRONES_TS = [
  [/:\s*any\b/, ': any', /\/\/\s*\S|\/\*\s*\S/],
  [/\bas\s+any\b/, 'as any', /\/\/\s*\S|\/\*\s*\S/],
  [/\bany\[\]/, 'any[]', /\/\/\s*\S|\/\*\s*\S/],
  [/@ts-ignore/, '@ts-ignore', /^\s*[^\s*/]/],
  [/eslint-disable/, 'eslint-disable', /--\s*\S/],
]

const TOPE_AVISOS_TS = 20

/**
 * Líneas `+` con `: any`, `as any`, `any[]`, `@ts-ignore` o `eslint-disable` sin un comentario de justificación (en la misma línea o
 * en la anterior) del diff `base`..foto, solo en archivos de código dentro de `permitidos`. Heurístico: avisa, no frena. Un `any` suelto no avisa.
 */
export function avisosDeTipos(base, permitidos, etiqueta) {
  try {
    const crudo = git(['-c', 'core.quotepath=off', 'diff', '-U1', '--no-color', '--no-renames', base, foto(permitidos), '--', ...EXT_TS.map((e) => `*.${e}`)])
    const avisos = []
    let ruta = null
    let cabecera = false
    let n = 0
    let previa = ''
    for (const l of crudo.split(/\r?\n/)) {
      if (l.startsWith('diff --git ')) {
        ruta = null
        cabecera = true
        continue
      }
      const arch = cabecera ? /^\+\+\+ b\/(.+)$/.exec(l) : null
      if (arch) {
        ruta = enAlcance(arch[1], permitidos) ? arch[1] : null
        continue
      }
      const hunk = /^@@ -\S+ \+(\d+)/.exec(l)
      if (hunk) {
        cabecera = false
        n = Number(hunk[1])
        previa = ''
        continue
      }
      if (cabecera || !ruta || !/^[ +]/.test(l)) continue
      const texto = l.slice(1)
      if (l[0] === '+') {
        for (const [re, nombre, just] of PATRONES_TS) {
          const m = re.exec(texto)
          if (!m) continue
          const previaVale = /^\s*(\/\/|\/\*|\*)\s*\S/.test(previa) && !PATRONES_TS.some(([r]) => r.test(previa))
          if (!just.test(texto.slice(m.index + m[0].length)) && !previaVale) avisos.push(`AVISO: ${etiqueta} · ${ruta}:${n} · «${nombre}» sin justificación`)
          break
        }
      }
      previa = texto
      n++
    }
    for (const a of avisos.slice(0, TOPE_AVISOS_TS)) console.log(a)
    if (avisos.length > TOPE_AVISOS_TS) console.log(`AVISO: ${etiqueta} · y ${avisos.length - TOPE_AVISOS_TS} más sin justificación`)
  } catch {
    // Solo un aviso: sin él, el --cambios sigue.
  }
}

/** Comillas simples de bash para una ruta. */
const comillas = (r) => `'${String(r).replace(/'/g, `'\\''`)}'`

/**
 * Los comandos que dejan los archivos del flujo como en la foto `base`: restaurar los modificados y borrados,
 * borrar los nuevos y avisar lo que git no ve. Con pocos archivos van en la línea; con muchos, en `reversion.sh`.
 */
function reversion(base, restaurar, borrar, aMano) {
  if (!restaurar.length && !borrar.length && !aMano.length) {
    console.log('REVERSIÓN: nada que deshacer')
    return
  }
  const comandos = []
  if (restaurar.length) comandos.push(`git restore --source=${base} --worktree -- ${restaurar.map(comillas).join(' ')}`)
  if (borrar.length) comandos.push(`rm -- ${borrar.map(comillas).join(' ')}`)
  if (restaurar.length + borrar.length <= TOPE_REVERSION && !aMano.length) {
    console.log(`REVERSIÓN: ${comandos.join(' && ')}`)
    return
  }
  const archivo = path.join(FLUJO, 'reversion.sh')
  try {
    fs.mkdirSync(FLUJO, { recursive: true })
    const notas = aMano.map((r) => `# a mano, git no la ve: ${r}`)
    fs.writeFileSync(archivo, ['#!/usr/bin/env bash', `# Deja los archivos del flujo como en la foto ${corto(base)}. Revísalo antes de correrlo.`, ...comandos, ...notas, ''].join('\n'))
    console.log(`REVERSIÓN: ${restaurar.length} a restaurar · ${borrar.length} a borrar${aMano.length ? ` · ${aMano.length} a mano` : ''} → bash ${archivo.replace(/\\/g, '/')}`)
  } catch (e) {
    console.log(`REVERSIÓN: no se pudo escribir ${archivo} (${e.message})`)
  }
}

/**
 * Lo que dejó `verificar.mjs` y sigue igual en `ahora`: `Map` de ruta (en minúsculas en Windows) a `{ paso, generado }`.
 * Cuenta una salida de la misma ruta y el mismo blob, anotada desde `desde` (si hay). Un cambio a mano posterior
 * tiene otro blob y no entra. Tampoco entra una salida cuya ventana `[inicio ?? t, t]` se cruza con la de una fase en paralelo
 * (`paralelos`, abierta hasta `hasta` o hasta ahora): otro agente pudo editar el archivo mientras corría verificar, así que
 * cae en el camino normal y sale FUERA. Si no se puede comparar, queda vacío (todo lo de fuera sigue siendo FUERA).
 */
function salidasVigentes(base, ahora, desde, clave, paralelos = []) {
  const vigentes = new Map()
  try {
    const inicio = desde ? Date.parse(desde) : Number.NaN
    const fases = paralelos.map((p) => [Date.parse(p.desde), p.hasta === undefined ? Date.now() : Date.parse(p.hasta)])
    const cruzaFase = (s) => {
      const fin = Date.parse(s.t)
      const comienzo = Number.isFinite(Date.parse(s.inicio)) ? Date.parse(s.inicio) : fin
      return fases.some(([d, h]) => comienzo <= h && fin >= d)
    }
    const salidas = salidasDe(RAIZ).filter((s) => !(inicio > Date.parse(s.t)) && !cruzaFase(s))
    if (!salidas.length) return vigentes
    const blobs = new Map(cambiosDe(RAIZ, base, ahora).map((c) => [clave(c.ruta), c.blob]))
    for (const s of salidas) {
      if (blobs.get(clave(s.ruta)) === s.blob) vigentes.set(clave(s.ruta), { paso: String(s.paso ?? 'verificar'), generado: s.generado === true })
    }
  } catch {
    // Sin la comparación, nada se perdona: todo lo de fuera sale FUERA.
  }
  return vigentes
}

/** Las líneas de la salida de verificar fuera de los permitidos: una por archivo, o por carpeta si pasan de `TOPE_CAMBIOS`. */
function lineasDeSalidas(salidas) {
  const nota = (lista) => {
    const pasos = [...new Set(lista.flatMap((s) => s.paso.split(', ')))].join(', ')
    return `(salida de verificar: ${pasos}${lista.every((s) => s.generado) ? '' : ', no generado'})`
  }
  if (salidas.length <= TOPE_CAMBIOS) return salidas.map((s) => `  ~ ${s.estado} ${s.ruta}   ← ${nota([s])}`)
  const porRuta = new Map(salidas.map((s) => [s.ruta, s]))
  return agruparPorCarpeta(salidas.map((s) => s.ruta)).map((g) => `  ~ ${g.carpeta} — ${g.rutas.length} archivo(s)   ← ${nota(g.rutas.map((r) => porRuta.get(r)))}`)
}

/**
 * Qué cambió desde `base` y qué cae fuera de `permitidos`. Con permitidos, nada fuera y sin cerrar, va en una línea
 * `CAMBIOS` agrupada por carpeta (más lo que solo está en el registro, uno por uno); si no, con muchos archivos
 * dentro del alcance van agrupados por carpeta, y lo de fuera y lo que solo está en el registro, uno por uno. Lo que
 * dejó `verificar.mjs` fuera de los permitidos no es FUERA, salvo que corriera con agentes en paralelo (`paralelos`).
 * En el cierre (`paso` 7) agrega `REVERSIÓN`.
 */
export function cambios(base, desde, permitidos, paso, tokens, resultado, paralelos = []) {
  const ahora = foto(permitidos)
  const mapa = new Map()
  const clave = (r) => (WIN ? r.toLowerCase() : r)
  const vigentes = salidasVigentes(base, ahora, desde, clave, paralelos)
  for (const linea of git(['diff', '--name-status', '--no-renames', base, ahora]).split('\n')) {
    const m = /^([A-Z])\d*\t(.+)$/.exec(linea.trim())
    if (m) mapa.set(clave(m[2]), { estado: m[1], ruta: m[2], soloRegistro: false })
  }
  const filas = desde ? leerRegistro(desde) : []
  for (const f of filas) {
    if (f.rol !== 'ejecutor' || f.decision !== 'permitido' || !EDICIONES.has(f.herramienta) || !f.objetivo) continue
    // Ruta absoluta = fuera del repo: un temporal del ejecutor (scripts de medición), que no es del alcance.
    if (path.isAbsolute(f.objetivo)) continue
    if (!mapa.has(clave(f.objetivo))) mapa.set(clave(f.objetivo), { estado: '·', ruta: f.objetivo, soloRegistro: true })
  }
  const lista = [...mapa.values()].sort((a, b) => a.ruta.localeCompare(b.ruta))
  const marcaDentro = permitidos.length ? '✓' : ' '
  let fuera = 0
  const lineas = []
  const agrupables = []
  const restaurar = []
  const borrar = []
  const aMano = []
  const deVerificar = []
  for (const c of lista) {
    const dentro = enAlcance(c.ruta, permitidos)
    const salida = !dentro && !c.soloRegistro ? vigentes.get(clave(c.ruta)) : undefined
    if (salida) {
      deVerificar.push({ ...c, ...salida })
      if (c.estado === 'A') borrar.push(c.ruta)
      else restaurar.push(c.ruta)
      continue
    }
    if (!dentro) fuera++
    else if (c.soloRegistro) aMano.push(c.ruta)
    else (c.estado === 'A' ? borrar : restaurar).push(c.ruta)
    const nota = [
      dentro ? '' : 'FUERA DE ALCANCE',
      c.soloRegistro ? 'solo en el registro: ruta ignorada por git o edición sin efecto' : '',
    ]
      .filter(Boolean)
      .join(' · ')
    if (dentro && !nota) agrupables.push(c)
    lineas.push({ texto: `  ${dentro ? marcaDentro : '✗'} ${c.estado} ${c.ruta}${nota ? `   ← ${nota}` : ''}`, suelta: !dentro || Boolean(nota) })
  }
  if (permitidos.length && !fuera && paso !== 7) {
    const partes = agruparPorCarpeta(agrupables.map((c) => c.ruta)).map((g) => `${g.carpeta} ${g.rutas.length}`)
    if (deVerificar.length) partes.push(`salida de verificar ${deVerificar.length}`)
    if (aMano.length) partes.push(`solo en el registro ${aMano.length}`)
    console.log(`CAMBIOS desde ${corto(base)} (${lista.length})${partes.length ? `: ${partes.join(' · ')}` : ''}`)
    for (const l of lineas) if (l.suelta) console.log(l.texto)
  } else {
    console.log(`CAMBIOS desde ${corto(base)} (${lista.length}):`)
    if (agrupables.length <= TOPE_CAMBIOS) for (const l of lineas) console.log(l.texto)
    else {
      const porRuta = new Map(agrupables.map((c) => [c.ruta, c]))
      for (const g of agruparPorCarpeta(agrupables.map((c) => c.ruta))) {
        const cuenta = {}
        for (const r of g.rutas) cuenta[porRuta.get(r).estado] = (cuenta[porRuta.get(r).estado] ?? 0) + 1
        const detalle = Object.entries(cuenta).map(([e, n]) => `${e} ${n}`).join(', ')
        console.log(`  ${marcaDentro} ${g.carpeta} — ${g.rutas.length} archivo(s) (${detalle})`)
      }
      for (const l of lineas) if (l.suelta) console.log(l.texto)
    }
  }
  for (const l of lineasDeSalidas(deVerificar)) console.log(l)
  const negados = filas.filter((f) => f.decision === 'negado')
  if (negados.length) {
    console.log(`GUARDIA: ${negados.length} negación(es) desde ${desde}:`)
    for (const f of negados.slice(-5)) console.log(`  - ${f.rol} ${f.herramienta} «${String(f.objetivo ?? '').slice(0, 100)}» → ${f.motivo}`)
  }
  if (paso === 7) {
    const { base_global: global } = leerEstado()
    if (global && global !== base) console.log(`AVISO: el cierre va con BASE_GLOBAL=${global} y DESDE_GLOBAL; esta foto (${corto(base)}) no cubre todo el flujo`)
    reversion(base, restaurar, borrar, aMano)
    cerrarFlujo(base, desde, tokens, resultado)
  }
  if (!permitidos.length) console.log('ALCANCE: (sin lista de permitidos)')
  else console.log(fuera ? `ALCANCE: FUERA (${fuera})` : 'ALCANCE: OK')
}

// Colores fijos para `--color-moved`: así la detección no depende de la configuración de color del usuario.
const COLORES_MOVIDO = ['color.diff.oldMoved=magenta', 'color.diff.newMoved=cyan', 'color.diff.old=red', 'color.diff.new=green']

const RE_MOVIDA = /^\x1b\[(35m-|36m\+)/

const RE_ANSI = /\x1b\[[0-9;]*m/g

const MIN_MOVIDAS = 4

/**
 * Colapsa las tiradas de `minimo` o más líneas que git marcó como movidas sin cambios (`--color-moved=plain` con los colores de
 * `COLORES_MOVIDO`) en una sola línea `~ <n> líneas quitadas|agregadas aquí, movidas sin cambios…`, y quita los colores de las demás.
 * Una línea movida y editada sale como diff normal. Devuelve `{ lineas, colapsadas }`.
 */
export function colapsarMovidos(crudas, minimo = MIN_MOVIDAS) {
  const lineas = []
  let colapsadas = 0
  for (let i = 0; i < crudas.length; ) {
    const signo = RE_MOVIDA.exec(crudas[i])?.[1]
    let j = i + 1
    if (signo) while (j < crudas.length && RE_MOVIDA.exec(crudas[j])?.[1] === signo) j++
    if (signo && j - i >= minimo) {
      lineas.push(signo.endsWith('-')
        ? `~ ${j - i} líneas quitadas aquí, movidas sin cambios a otro lugar del diff`
        : `~ ${j - i} líneas agregadas aquí, movidas sin cambios desde otro lugar del diff`)
      colapsadas += j - i
    } else for (let k = i; k < j; k++) lineas.push(crudas[k].replace(RE_ANSI, ''))
    i = j
  }
  return { lineas, colapsadas }
}

/** Con `destino`, el diff entero (sin el corte de `TOPE_DIFF`) va a ese archivo en vez de a la salida. */
export function diff(base, permitidos, rutas, destino) {
  const ahora = foto(permitidos)
  const filtro = ['--', ...rutas]
  const stat = git(['diff', '--stat=150', '--no-renames', base, ahora, ...filtro]).trimEnd()
  const crudo = git([...COLORES_MOVIDO.flatMap((c) => ['-c', c]), 'diff', '--no-renames', '--color=always', '--color-moved=plain', '--color-moved-ws=no', base, ahora, ...filtro]).trimEnd()
  const salida = [`DIFF ${corto(base)} → árbol actual${rutas.length ? ` (${rutas.join(', ')})` : ''}`]
  if (!crudo) salida.push('(sin cambios)')
  else {
    salida.push(stat)
    const { lineas, colapsadas } = colapsarMovidos(crudo.split('\n'))
    if (colapsadas) salida.push(`MOVIDO SIN CAMBIOS: ${colapsadas} líneas colapsadas en «~ …» (git --color-moved); para ver un bloque, lee el archivo`)
    salida.push('', ...(destino ? lineas : lineas.slice(0, TOPE_DIFF)))
    if (!destino && lineas.length > TOPE_DIFF) {
      salida.push(`\n… recortado: ${lineas.length - TOPE_DIFF} líneas más. Pide por ruta: --diff ${corto(base)} --permitidos "…" -- <ruta>`)
    }
  }
  if (destino) fs.writeFileSync(destino, salida.join('\n') + '\n')
  else console.log(salida.join('\n'))
}
