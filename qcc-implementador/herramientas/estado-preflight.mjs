// Preflight de estado.mjs (candado, mapa, contexto del proyecto, autoprueba de la guardia), `--reglas` y `--guia`.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { evaluar, rolDeAgente, configDe, RAIZ } from './guardia.mjs'
import { pasosDe } from './verificar.mjs'
import { AGENTES, TOPE_SUCIOS, TOPE_MAPA, TOPE_NOMBRES, git, corto, foto, FLUJO, leerTexto, leerEstado, sesionActual, tramoNuevo, avanceDe, flujoAbierto, nuevoFlujo, lanzarInicial, agruparPorCarpeta } from './estado-base.mjs'
import { MAX_EXPLORADORES, MAX_REINTENTO } from './estado-exploracion.mjs'
import { TERMINADA } from './estado-avance.mjs'
import { archivarFlujo } from './estado-cierre.mjs'

// ── Modos ───────────────────────────────────────────────────────────────────

/** `hooks/hooks.json` del plugin. */
const HOOKS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'hooks', 'hooks.json')

/** Por qué `hooks/hooks.json` no deja la guardia puesta para las herramientas que vigila (Bash, Edit, Read…); null si está bien. */
function hooksSinGuardia() {
  let entradas
  try {
    entradas = JSON.parse(fs.readFileSync(HOOKS, 'utf8'))?.hooks?.PreToolUse
  } catch (e) {
    return `no se pudo leer hooks/hooks.json: ${e.message}`
  }
  const guardias = (Array.isArray(entradas) ? entradas : []).filter((h) => (h?.hooks ?? []).some((x) => x?.type === 'command' && /guardia\.mjs/.test(String(x.command))))
  for (const herramienta of ['Bash', 'PowerShell', 'Edit', 'Write', 'NotebookEdit', 'Read', 'Glob', 'Grep']) {
    if (!guardias.some((h) => new RegExp('^(?:' + (h.matcher ?? '.*') + ')$').test(herramienta))) return `hooks/hooks.json no declara la guardia para ${herramienta}`
  }
  return null
}

function autoprueba() {
  const avisos = []
  try {
    const casos = [
      [{ tool_name: 'Bash', tool_input: { command: 'git push' } }, 'ejecutor', true],
      [{ tool_name: 'Bash', tool_input: { command: 'git status --short' } }, 'ejecutor', false],
      [{ tool_name: 'Write', tool_input: { file_path: '.claude/settings.json' } }, 'ejecutor', true],
      [{ tool_name: 'Edit', tool_input: { file_path: 'src/x.ts' } }, 'revisor', true],
    ]
    for (const [evento, rol, debeNegar] of casos) {
      if (Boolean(evaluar({ ...evento, cwd: RAIZ }, rol, RAIZ).motivo) !== debeNegar) {
        return `FALLA (${rol} ${evento.tool_name} ${JSON.stringify(evento.tool_input)})`
      }
    }
    for (const rol of ['explorador', 'planificador', 'ejecutor', 'revisor']) {
      if (rolDeAgente(`impl:qcc-${rol}`) !== rol) return `FALLA (la guardia no reconoce al agente impl:qcc-${rol})`
    }
    // Los agentes de un plugin ignoran `hooks:`: sin `hooks/hooks.json` declarando la guardia, correrían sin ella.
    const sinGuardia = hooksSinGuardia()
    if (sinGuardia) return `FALLA (${sinGuardia})`
    // Una copia vieja en ~/.claude/agents duplica a los agentes del plugin y llama a una guardia que ya no está.
    for (const agente of ['explorador', 'planificador', 'ejecutor', 'revisor']) {
      if (fs.existsSync(path.join(AGENTES, `qcc-${agente}.md`))) avisos.push(`~/.claude/agents/qcc-${agente}.md es una copia vieja del agente: instalar.mjs --limpiar la archiva`)
    }
    if (configDe(RAIZ).invalido) avisos.push(`${configDe(RAIZ).nombre} no es JSON válido: rigen los valores por defecto`)
    return avisos.length ? `OK con avisos: ${avisos.join(' · ')}` : 'OK'
  } catch (e) {
    return `FALLA (${e.message})`
  }
}

const BYTES_POR_TOKEN = 3.5

const TOPE_IMPORTS = 5

const UMBRAL_CONTEXTO = 10_000

// Agentes típicos de un flujo que escriben el contexto del proyecto en caché: explorador, planificador, revisión final,
// 3 ejecutores y el orquestador.
const AGENTES_TIPICOS = 7

/** Rutas `@ruta` que importa un CLAUDE.md, fuera de bloques ``` y de `código`. */
function importsDe(texto) {
  const limpio = texto.replace(/^(```|~~~)[\s\S]*?^\1[^\n]*$/gm, '').replace(/`[^`\n]*`/g, '')
  return [...limpio.matchAll(/(?:^|\s)@(\S+)/g)].map((m) => m[1].replace(/[.,;:)\]]+$/, '')).filter(Boolean)
}

/**
 * Lo que Claude Code carga como instrucciones del proyecto en cada agente: CLAUDE.md, .claude/CLAUDE.md y CLAUDE.local.md de
 * la raíz, más los `@ruta` que importen (relativos al archivo que importa, `~/` es la carpeta del usuario; hasta 5 niveles,
 * sin repetir, saltando los que no existen). AGENTS.md cuenta si no hay ningún CLAUDE.md (supuesto tomado de lo observado:
 * Claude Code lo cargó como instrucciones del proyecto; no está confirmado que lo cargue junto a un CLAUDE.md) o si
 * algún archivo cargado lo importa. Tokens ≈ bytes / 3,5. `{ tokens, archivos }`, con `archivos` relativos a la raíz.
 */
export function contextoDelProyecto(raiz) {
  const raices = ['CLAUDE.md', path.join('.claude', 'CLAUDE.md'), 'CLAUDE.local.md'].map((r) => path.join(raiz, r))
  const hayClaude = raices.slice(0, 2).some((r) => fs.existsSync(r))
  if (!hayClaude) raices.push(path.join(raiz, 'AGENTS.md'))
  const vistos = new Set()
  const archivos = []
  let bytes = 0
  const cargar = (archivo, nivel) => {
    const clave = path.resolve(archivo)
    if (vistos.has(clave)) return
    vistos.add(clave)
    let buffer
    try {
      if (!fs.statSync(clave).isFile()) return
      buffer = fs.readFileSync(clave)
    } catch {
      return
    }
    bytes += buffer.length
    const rel = path.relative(raiz, clave)
    archivos.push(rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel.replace(/\\/g, '/') : clave.replace(/\\/g, '/'))
    if (nivel >= TOPE_IMPORTS) return
    for (const ruta of importsDe(buffer.toString('utf8'))) {
      const destino = ruta.startsWith('~/') ? path.join(os.homedir(), ruta.slice(2)) : path.resolve(path.dirname(clave), ruta)
      cargar(destino, nivel + 1)
    }
  }
  for (const r of raices) cargar(r, 0)
  return { tokens: Math.round(bytes / BYTES_POR_TOKEN), archivos }
}

/** Líneas del preflight sobre el contexto del proyecto: siempre `CONTEXTO DEL PROYECTO`, y un `AVISO` si pasa de 10.000 tokens. */
function lineasDelProyecto(raiz) {
  const { tokens, archivos } = contextoDelProyecto(raiz)
  const lineas = [`CONTEXTO DEL PROYECTO: ~${tokens} tokens por agente (${archivos.length ? archivos.join(', ') : 'ningún CLAUDE.md ni AGENTS.md'})`]
  if (tokens > UMBRAL_CONTEXTO) {
    lineas.push(`AVISO: contexto del proyecto pesado: ~${tokens * AGENTES_TIPICOS} tokens por flujo solo en escribirlo en caché (${AGENTES_TIPICOS} agentes típicos); acórtalo o mueve lo largo a archivos que se lean a demanda`)
  }
  return lineas
}

/** Reglas del proyecto, en este orden y solo la primera que exista: la carpeta o el `.md` con el nombre nuevo y luego los viejos. */
const REGLAS_CANDIDATAS = [
  { ruta: '.claude/qcc-implementador/', carpeta: true },
  { ruta: '.claude/qcc-implementador.md', carpeta: false },
  { ruta: '.claude/implementador/', carpeta: true },
  { ruta: '.claude/implementador.md', carpeta: false },
]

/** `{ ruta, carpeta }` de las reglas que rigen en `raiz`, o `null` si no hay ninguna. */
export function reglasDe(raiz) {
  return REGLAS_CANDIDATAS.find((c) => fs.existsSync(path.join(raiz, c.ruta.replace(/\/$/, '')))) ?? null
}

export function preflight(forzar) {
  const desde = new Date().toISOString()
  const rama = git(['rev-parse', '--abbrev-ref', 'HEAD'], { opcional: true })?.trim() ?? '?'
  const head = git(['log', '-1', '--format=%h %s'], { opcional: true })?.trim() || '(sin commits)'
  const sucios = git(['status', '--porcelain=v1', '--untracked-files=all']).split('\n').filter(Boolean)
  const base = foto()
  const config = configDe(RAIZ)
  const reglas = reglasDe(RAIZ)
  const { pasos, origen } = pasosDe(RAIZ)
  let flujo = FLUJO
  let mapa = 'MAPA: ninguno (la carpeta del flujo no se preparó)'
  let preparada = false
  const abierto = forzar ? null : flujoAbierto()
  if (abierto) {
    const hora = new Date(abierto.inicio).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })
    const plan = abierto.titulo ? `«${abierto.titulo}», ` : abierto.plan ? 'con plan, ' : 'sin plan todavía, '
    if (abierto.cortado) console.log(`AVISO: hay un flujo cortado en este repo (${plan}empezó a las ${hora}, sin actividad hace ${Math.round(abierto.minutos / 60)} h). No vacié su carpeta.`)
    else console.log(`AVISO: hay otro flujo abierto en este repo (${plan}empezó a las ${hora}, BASE_GLOBAL ${corto(abierto.base_global)}, sin cierre, con actividad hace ${Math.round(abierto.minutos)} min). Si sigue corriendo en otra sesión (o esperando su aprobación), los dos se pisan los archivos y la carpeta del flujo, que no vacié. Si ya no corre, repite el preflight con --forzar.`)
    if (abierto.plan) {
      const hechas = Object.values(avanceDe(abierto)).filter((a) => TERMINADA.has(a.estado)).length
      console.log(`REANUDAR: estado.mjs --reanudar --paso 0 sigue ese flujo sin vaciar su carpeta (plan guardado${abierto.aprobacion ? ' y aprobado' : ', sin aprobar'}, ${hechas}/${(abierto.subtareas ?? []).length} subtareas terminadas)`)
    }
    flujo = '(ocupada por el flujo anterior: repite el preflight con --forzar si ya no corre)'
    mapa = 'MAPA: ninguno (la carpeta del flujo está ocupada por el flujo anterior)'
  } else {
    try {
      // Un flujo con plan y sin cierre no se pierde: con --forzar se archiva (sin fila en flujos.jsonl) antes de vaciarlo.
      const previo = forzar ? leerEstado() : {}
      if (previo.base_global && previo.plan && !previo.cierre) archivarFlujo(new Date().toISOString())
      nuevoFlujo({ inicio: desde, raiz: RAIZ, rama, base_global: base, desde_global: desde, fotos: [], sesiones: [sesionActual(desde)], limites: [tramoNuevo(0)] })
      const escrito = escribirMapa()
      mapa = escrito.linea
      preparada = true
    } catch (e) {
      flujo = `(no se pudo preparar: ${e.message}; despacha copiando el plan)`
    }
  }
  console.log(`PROYECTO: ${RAIZ}`)
  console.log(`RAMA: ${rama} · HEAD ${head}`)
  if (!sucios.length) console.log('SUCIOS PREVIOS: ninguno')
  else {
    console.log(`SUCIOS PREVIOS (${sucios.length}):`)
    for (const s of sucios.slice(0, TOPE_SUCIOS)) console.log(`  ${s}`)
    if (sucios.length > TOPE_SUCIOS) console.log(`  … y ${sucios.length - TOPE_SUCIOS} más`)
  }
  console.log(`BASE_GLOBAL=${base} DESDE_GLOBAL=${desde}`)
  console.log(`FLUJO: ${flujo}`)
  console.log(mapa)
  console.log(lineaExploradores())
  console.log(`REGLAS DEL PROYECTO: ${reglas?.ruta ?? 'ninguna (no hay .claude/qcc-implementador/ ni .claude/qcc-implementador.md; rigen CLAUDE.md y las reglas comunes)'}`)
  for (const linea of lineasDelProyecto(RAIZ)) console.log(linea)
  console.log(`CONFIG: ${config.archivo ? config.nombre : 'no hay; guardia con valores por defecto'}${config.pm ? ` · gestor JS: ${config.pm}` : ''}`)
  console.log(`VERIFICACIÓN (${origen}): ${pasos.length ? pasos.map((p) => p.cmd).join(' → ') : 'SIN PASOS'}`)
  if (preparada) console.log(`VERIFICACIÓN INICIAL: ${lanzarInicial(pasos.length > 0)}`)
  console.log(`GUARDIA: ${autoprueba()}`)
}

const SIN_REGLAS = '(Este proyecto no tiene .claude/qcc-implementador/ ni .claude/qcc-implementador.md: rigen las reglas comunes, el CLAUDE.md del proyecto y lo que leas del repo.)'

/**
 * Las reglas del proyecto que lee el orquestador, encabezadas por la línea `REGLAS DEL PROYECTO` que llevan los despachos:
 * los archivos que haya de la primera que exista entre `.claude/qcc-implementador/`, `.claude/qcc-implementador.md`,
 * `.claude/implementador/` y `.claude/implementador.md`.
 */
export function imprimirReglas() {
  const reglas = reglasDe(RAIZ)
  if (reglas?.carpeta) {
    const carpeta = path.join(RAIZ, reglas.ruta)
    const partes = ['clasificacion.md', 'buscar.md', 'planificar.md'].map((a) => leerTexto(path.join(carpeta, a))?.trimEnd()).filter((t) => t !== undefined)
    console.log(`REGLAS DEL PROYECTO: ${reglas.ruta}\n`)
    console.log(partes.length ? partes.join('\n\n') : '(no tiene clasificacion.md, buscar.md ni planificar.md: rigen las reglas comunes y el CLAUDE.md del proyecto.)')
    return
  }
  const unico = reglas ? leerTexto(path.join(RAIZ, reglas.ruta))?.trimEnd() : undefined
  console.log(`REGLAS DEL PROYECTO: ${unico === undefined ? 'ninguna' : reglas.ruta}\n`)
  console.log(unico ?? SIN_REGLAS)
}

const GUIAS = ['comun', 'pasos']

/**
 * Imprime `comun.md` o `pasos.md` (junto a este archivo) con `${CLAUDE_PLUGIN_ROOT}` cambiado por la carpeta del plugin, con `/`.
 * Claude Code solo resuelve esa variable en el texto de la skill, no en lo que ella inyecta con un comando, y el Bash del
 * modelo no la tiene: así las rutas de estos archivos llegan completas.
 */
export function imprimirGuia(nombre, parte) {
  const herramientas = path.dirname(fileURLToPath(import.meta.url))
  const leido = GUIAS.includes(nombre) ? leerTexto(path.join(herramientas, `${nombre}.md`)) : null
  if (leido === null) {
    console.log(`ERROR: --guia pide ${GUIAS.join(' o ')} y que el archivo exista`)
    process.exitCode = 2
    return
  }
  let texto = leido
  if (parte !== undefined) {
    // Claude Code guarda aparte lo inyectado de más de 30.000 caracteres: comun.md entra en dos partes, cortada en «## 5.».
    const corte = leido.search(/^## 5\./m)
    if (nombre !== 'comun' || !['1', '2'].includes(parte) || corte < 0) {
      console.log('ERROR: --parte vale solo con --guia comun y es 1 o 2')
      process.exitCode = 2
      return
    }
    texto = parte === '1' ? leido.slice(0, corte) : leido.slice(corte)
  }
  process.stdout.write(texto.replaceAll('${CLAUDE_PLUGIN_ROOT}', () => path.dirname(herramientas).replaceAll('\\', '/')))
}

/** Extensión de una ruta (`.ts`); `(sin ext)` si el nombre no tiene. */
const extensionDe = (ruta) => {
  const nombre = ruta.slice(ruta.lastIndexOf('/') + 1)
  const i = nombre.lastIndexOf('.')
  return i > 0 ? nombre.slice(i) : '(sin ext)'
}

/**
 * Las líneas del mapa del repo para el explorador: una por carpeta (con los nombres si los archivos están en ella,
 * resumida por extensión si hay subcarpetas). Con `lineasPorRuta` (`{ ruta: n }`) suma líneas por carpeta y lista los
 * `.md` de más de 300 líneas (con `bytesDe(ruta)`, también sus KB); una ruta ausente cuenta 0. Nunca más de `tope + 3` líneas.
 */
export function mapaDelRepo(rutas, tope = TOPE_MAPA, lineasPorRuta = null, bytesDe = null) {
  const grupos = agruparPorCarpeta(rutas, tope)
  const miles = (n) => String(n).replace(/\B(?=(\d{3})+$)/g, '.')
  const suma = (lista) => lista.reduce((s, r) => s + (lineasPorRuta[r] ?? 0), 0)
  const lineas = [
    `MAPA · ${rutas.length} archivos${lineasPorRuta ? ` · ${miles(suma(rutas))} líneas` : ''} (git ls-files: versionados y nuevos, sin ignorados) · ${grupos.length} carpeta(s)`,
    'Las carpetas resumidas se exploran con Glob; lo ignorado por git no aparece.',
  ]
  if (lineasPorRuta) {
    const docs = rutas.filter((r) => r.endsWith('.md') && (lineasPorRuta[r] ?? 0) > 300)
      .sort((a, b) => lineasPorRuta[b] - lineasPorRuta[a]).slice(0, 20)
    const kb = (r) => (bytesDe ? ` · ${miles(Math.ceil(bytesDe(r) / 1024))} KB` : '')
    if (docs.length) lineas.push(`Documentos de más de 300 líneas: ${docs.map((r) => `${r} (${miles(lineasPorRuta[r])}${kb(r)})`).join(', ')}`)
  }
  const mostrados = grupos.length > tope ? grupos.slice(0, Math.max(0, tope - 1)) : grupos
  for (const { carpeta, rutas: lista } of mostrados) {
    const prefijo = carpeta === './' ? '' : carpeta
    const nombres = lista.map((r) => r.slice(prefijo.length))
    if (nombres.every((n) => !n.includes('/'))) {
      const resto = nombres.length - TOPE_NOMBRES
      const cuenta = lineasPorRuta ? `${lista.length} archivos · ${miles(suma(lista))} líneas: ` : ''
      lineas.push(`${carpeta} — ${cuenta}${nombres.slice(0, TOPE_NOMBRES).join(', ')}${resto > 0 ? `, … y ${resto} más` : ''}`)
      continue
    }
    const subcarpetas = new Set(lista.map((r) => r.slice(0, r.lastIndexOf('/') + 1)).filter((c) => c !== prefijo))
    const extensiones = new Map()
    for (const r of lista) extensiones.set(extensionDe(r), (extensiones.get(extensionDe(r)) ?? 0) + 1)
    const top = [...extensiones].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 5)
    const conLineas = lineasPorRuta ? ` · ${miles(suma(lista))} líneas` : ''
    lineas.push(`${carpeta} — ${lista.length} archivos en ${subcarpetas.size} subcarpetas${conLineas} (${top.map(([e, c]) => `${e} ${c}`).join(', ')})`)
  }
  if (mostrados.length < grupos.length) {
    const sobran = grupos.slice(mostrados.length)
    const cuentaSobran = sobran.flatMap((g) => g.rutas)
    lineas.push(`… y ${sobran.length} carpetas más (${cuentaSobran.length} archivos${lineasPorRuta ? ` · ${miles(suma(cuentaSobran))} líneas` : ''})`)
  }
  return lineas
}

/** Líneas por archivo (`{ ruta: n }`) según `git grep -c`, o null si git falla. Vacíos y binarios no salen: cuentan 0. */
function lineasPorArchivo() {
  try {
    const porRuta = {}
    for (const fila of git(['grep', '-z', '-c', '-I', '--untracked', '']).split('\n')) {
      const i = fila.lastIndexOf('\0')
      if (i > 0) porRuta[fila.slice(0, i)] = Number(fila.slice(i + 1))
    }
    return porRuta
  } catch {
    return null
  }
}

/** Escribe `<FLUJO>/mapa.md` con los archivos del repo (versionados y nuevos, sin ignorados) y devuelve la línea `MAPA:` del preflight y el total de archivos (null si no hay mapa). */
function escribirMapa() {
  try {
    const rutas = [...new Set(git(['ls-files', '-z', '--cached', '--others', '--exclude-standard']).split('\0').filter(Boolean))].sort()
    const archivo = path.join(FLUJO, 'mapa.md')
    fs.writeFileSync(archivo, mapaDelRepo(rutas, TOPE_MAPA, lineasPorArchivo(), (r) => fs.statSync(path.join(RAIZ, r)).size).join('\n') + '\n')
    return { linea: `MAPA: ${archivo} (${rutas.length} archivos)`, total: rutas.length }
  } catch (e) {
    return { linea: `MAPA: ninguno (${String(e.message).split('\n')[0]})`, total: null }
  }
}

/** Línea `EXPLORADORES:` del preflight: los máximos fijos de la primera ronda y del reintento; cuántos despacha el orquestador depende del pedido. */
function lineaExploradores() {
  return `EXPLORADORES: hasta ${MAX_EXPLORADORES - MAX_REINTENTO} (según el pedido) · reintento: hasta ${MAX_REINTENTO}`
}
