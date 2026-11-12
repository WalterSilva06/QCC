#!/usr/bin/env node
// Estado git del flujo /impl (nivel usuario: sirve para
// cualquier proyecto con git). El proyecto es el repo que contiene el directorio actual.
// Este archivo es la entrada (opciones y despacho); el código vive en los módulos hermanos `estado-*.mjs`:
// base (git, fotos, estado.json), plan, exploracion, guardar, avance, despachos, preflight, cambios y cierre.
//
//   node <plugin>/herramientas/estado.mjs [--paso <n>] [--forzar]  preflight + foto global; abre la carpeta del flujo
//   node <plugin>/herramientas/estado.mjs --base [--paso <n>]   foto nueva: BASE=<sha> DESDE=<iso>
//   node <plugin>/herramientas/estado.mjs --base --sub <n> [--paso <n>]   foto de la subtarea n, guardada en la carpeta del flujo (si ya hay, conserva la primera)
//   node <plugin>/herramientas/estado.mjs --cambios <BASE> --desde <iso> --permitidos "<a,b>" [--paso <n>] [--tokens "<rol>=<n>,…"] [--resultado COMPLETO|DETENIDO:<0-7>]
//   node <plugin>/herramientas/estado.mjs --cambios --sub <n>|--global [--permitidos "<ampliados>"] [--omitida] [--paso <n>] [--tokens "…"] [--resultado …]   BASE, DESDE y permitidos salen de la carpeta del flujo; --sub anota el avance de sus subtareas (--omitida: OMITIDA) e imprime los despachos del lote siguiente o de la revisión final; --global en el paso 6, el del ciclo siguiente de la revisión
//   node <plugin>/herramientas/estado.mjs --diff <BASE> [--permitidos "<a,b>"] [--paso <n>] [-- <rutas>]
//   node <plugin>/herramientas/estado.mjs --guardar <agentId>[,<agentId>…] plan|exploracion|revision [--ajuste] [--paso <n>]   el plan imprime también las DECISIONES (ciclos, CRÍTICO, ASPECTOS); la exploración, la VERIFICACIÓN INICIAL (espera hasta 570 s), avisa con SIN EXPLORAR, y solo en la primera corrida con LARGO y REINTENTO (en la segunda, INCOMPLETO, CORTADO y SIN EXPLORAR salen solo de los ids nuevos). La lista con comas es solo para exploracion: une los informes en un exploracion.md y avisa con INCOMPLETO del que le falte una sección. La revisión final va a revision-<ciclo>.md (también sola: la guardan --estado, --reanudar, --tanda y el --cambios --global de los pasos 6 y 7)
//   node <plugin>/herramientas/estado.mjs --aprobado [--ajustes "<texto>"] [--sumar "S<n>:<ruta>,<ruta>;S<m>:…"] [--permisos P1,P2] [--paso <n>]   anota que el usuario aprobó el plan, con los AJUSTES AL PLAN y los permisos aprobados; --sumar agrega rutas a los permitidos y reimprime LOTES:; imprime los despachos del primer lote
//   node <plugin>/herramientas/estado.mjs --estado [--paso <n>]  qué lleva el flujo en curso (con las DECISIONES del plan, la VERIFICACIÓN INICIAL y la línea SIGUE)
//   node <plugin>/herramientas/estado.mjs --reanudar [--paso <n>]  sigue un flujo cortado en esta sesión sin vaciar su carpeta: lo de --estado más el PEDIDO y lo pendiente
//   node <plugin>/herramientas/estado.mjs --permiso-nuevo "<comando> · <servicio> · reversible: sí|no · Qué hace: … · Para qué: …" --sub <n> [--paso <n>]  agrega un permiso N<k> ya aprobado al ejecutor de la subtarea n
//   node <plugin>/herramientas/estado.mjs --tanda <n> [--sub <lista>] [--paso <n>]  abre una tanda de correcciones; --sub anota en en_curso las subtareas cuyos permisos valen
//   node <plugin>/herramientas/estado.mjs --cancelar [--paso <n>]  cierra un flujo abierto sin subtareas ejecutadas (resultado CANCELADO) y libera el candado
//   node <plugin>/herramientas/estado.mjs --reglas                reglas del proyecto para el orquestador
//   node <plugin>/herramientas/estado.mjs --guia comun|pasos [--parte 1|2]   imprime comun.md (entero o partido en «## 5.») o pasos.md con `${CLAUDE_PLUGIN_ROOT}` ya resuelto (los inyecta la skill)
//
// `--paso <n>` (0 a 7) anota en qué paso del flujo se llama; la salida no cambia. Otro valor
// se avisa con `AVISO:` y se ignora.
//
// Una "foto" es un commit suelto con todo el árbol (versionados + nuevos no ignorados),
// armado con un índice temporal: no toca el índice ni los archivos del usuario y git lo
// recoge solo. Así el diff de una subtarea sale exacto aunque haya cambios sin commit.
// Los archivos permitidos que viven en rutas ignoradas se fuerzan dentro de la foto; lo que
// el ejecutor escribió en otras rutas ignoradas aparece por el registro de la guardia.
//
// La verificación inicial: el preflight lanza `verificar.mjs` en segundo plano (desacoplado, con su salida en
// `verificacion-inicial.log` de la carpeta del flujo; `FLUJOS_INICIAL=0` la desactiva) y anota su pid en
// `estado.json`. `--guardar … exploracion` y `--estado` esperan a que termine y dan su resultado.
//
// La carpeta del flujo (`<git-dir>/qcc-impl/registro-flujo/`) guarda `estado.json` (fotos, plan,
// cierre), `mapa.md` (los archivos del repo por carpeta, que el preflight deja para el explorador), el informe
// del explorador, el plan y un `S<n>.md` por subtarea; el preflight la vacía, salvo
// que otro flujo del repo siga abierto (sin cierre y con actividad en los últimos 20 min, o 6 h si ya tiene
// plan): entonces avisa con el título del plan y pide `--forzar`. Un flujo con plan y sin cierre nunca se vacía solo:
// pasadas 6 h sin actividad avisa que quedó cortado, y `--forzar` lo archiva en `historial/` antes de vaciarlo.
// El cierre (`--cambios … --paso 7`) anota en `<carpeta global>/flujos.jsonl` (`~/.claude/flujos/registros`) una fila v2 (consumo en tokens,
// veredictos, tiempos, subtareas y calidad: costos.mjs; y el % de los límites de uso que gastó, ver LIMITES.md), imprime el CONTEXTO del
// hilo principal y archiva el flujo en `<carpeta global>/historial/` (las 30 carpetas más recientes).
// Límites: el preflight y cada `--reanudar` anotan en `limites` del estado un tramo con la lectura inicial del snapshot del panel
// (`<config de la cuenta>/qcc-limites.json`); cada comando con `--paso` pone al día su lectura final (y, si cambió el paso, anota
// una lectura por fase), y el cierre la fija, suma los tramos e imprime el % de cada fase (`LÍMITES POR FASE:`).
// `--guardar` toma el informe de un agente de su transcript, en `projects/*/*/subagents/agent-<id>.jsonl`
// dentro de `CLAUDE_CONFIG_DIR` (o `~/.claude`). Con `exploracion` acepta varios ids separados por coma y une sus informes.

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { RAIZ } from './guardia.mjs'
import { WIN, listaPermitidos, git, foto, exigirBase, FLUJO, leerEstado, anotarEstado, anotarLimites, paralelosDe, cerrarParalelos } from './estado-base.mjs'
import { guardar, guardarRevisionesNuevas } from './estado-guardar.mjs'
import { mostrarEstado, reanudar, aprobar, anotarAvance, fotoDeSubtarea, abrirTanda, aprobarPermiso, permisoNuevo, contextoDelFlujo } from './estado-avance.mjs'
import { despachosTrasLote, despachoRevision } from './estado-despachos.mjs'
import { preflight, imprimirReglas, imprimirGuia } from './estado-preflight.mjs'
import { avisosDeTipos, cambios, diff } from './estado-cambios.mjs'
import { cancelar } from './estado-cierre.mjs'
export { listaPermitidos, enAlcance, transcriptDe, textoFinalDe, agruparPorCarpeta } from './estado-base.mjs'
export { campoDe, recortarPie, partesDelPlan, permitidosDe, noPareceRuta, dependeDe, permisosDe, permitidosDeSubtarea, parecenExternas, comandosParaTi, lotesDe, criticosDe, fusionarPlanes, decisionesDelPlan, aprobacionDe, rutasDeTexto } from './estado-plan.mjs'
export { hallazgosDe, sinExplorarDe, contextoDe, acopladosSinCubrir, avisosDeLargo, fusionarExploraciones } from './estado-exploracion.mjs'
export { siguienteDe } from './estado-avance.mjs'
export { contextoDelProyecto, reglasDe, imprimirGuia, mapaDelRepo } from './estado-preflight.mjs'
export { colapsarMovidos } from './estado-cambios.mjs'
export { filaDelFlujo, tokensDe, anotarFlujo } from './estado-cierre.mjs'

/** Valor de `--sub`: un entero ≥ 1, o una lista `1,2,3` de enteros ≥ 1 sin repetir (ordenada); null si no vale. */
function subDe(texto) {
  if (!/^\d+(,\d+)*$/.test(texto ?? '')) return null
  const numeros = texto.split(',').map(Number)
  if (numeros.some((n) => !Number.isSafeInteger(n) || n < 1) || new Set(numeros).size !== numeros.length) return null
  return numeros.length === 1 ? numeros[0] : numeros.sort((a, b) => a - b)
}

/**
 * Argumentos → `{ modo, base, desde, permitidos, rutas, paso, aviso, tokens, resultado, agente, tipo, ajuste, forzar }`. Las opciones
 * valen solo antes de `--`; lo de después son rutas. Precedencia: --reglas > --guia > --reanudar > --estado > --aprobado > --cancelar > --guardar > --permiso > --permiso-nuevo > --tanda > --base > --cambios > --diff > preflight.
 * `paso` es un entero de 0 a 7 o null (con `aviso` si venía y no valía). `tokens` es el valor crudo de `--tokens`;
 * `resultado`, el de `--resultado` (`''` si el flag viene sin valor; undefined si no viene); `agente` y `tipo`, los dos valores que siguen a `--guardar` (`agente` es el texto crudo: varios ids van separados por coma, sin espacios).
 * `--guia <nombre>` agrega `guia` (el nombre, `''` si falta) y, con `--parte <k>`, `parte` (el texto crudo). `--omitida` agrega `omitida: true`; `--aprobado` agrega `ajustes` (el valor de `--ajustes`, `''` si falta) y, con `--sumar` o `--permisos`, `sumar` o `permisos` (el valor crudo, `''` si falta). `--permiso <Pn|Nn[,Pm…]> aprobado` es el modo `permiso` y agrega `permiso` (el id, o los ids separados por coma, en mayúsculas; null si no vale) y `accion` (la palabra que sigue, `''` si falta). `--permiso-nuevo "<texto>"` es el modo `permisoNuevo` y agrega `permisoNuevo` (el texto crudo, `''` si falta). `--tanda <n>` es el modo `tanda` y agrega `tanda` (el entero ≥ 1; null si no vale). `--sub <n>` agrega `sub` (el entero ≥ 1; `1,2` da la lista `[1, 2]` de un lote; null si no vale) y `--global` agrega `global: true`; sin el flag no aparece la clave.
 * En modo `cambios` con alguno de los dos, `base` queda undefined si lo que sigue a `--cambios` es otra opción.
 */
export function opcionesDe(args) {
  const corte = args.indexOf('--')
  const opciones = corte >= 0 ? args.slice(0, corte) : args
  const rutas = corte >= 0 ? args.slice(corte + 1) : []
  const valor = (nombre, salto = 1) => {
    const k = opciones.indexOf(nombre)
    return k >= 0 ? opciones[k + salto] : undefined
  }
  let modo = 'preflight'
  let base
  if (opciones.includes('--reglas')) modo = 'reglas'
  else if (opciones.includes('--guia')) modo = 'guia'
  else if (opciones.includes('--reanudar')) modo = 'reanudar'
  else if (opciones.includes('--estado')) modo = 'estado'
  else if (opciones.includes('--aprobado')) modo = 'aprobado'
  else if (opciones.includes('--cancelar')) modo = 'cancelar'
  else if (opciones.includes('--guardar')) modo = 'guardar'
  else if (opciones.includes('--permiso')) modo = 'permiso'
  else if (opciones.includes('--permiso-nuevo')) modo = 'permisoNuevo'
  else if (opciones.includes('--tanda')) modo = 'tanda'
  else if (opciones.includes('--base')) modo = 'base'
  else if (opciones.includes('--cambios')) {
    modo = 'cambios'
    base = valor('--cambios')
  } else if (opciones.includes('--diff')) {
    modo = 'diff'
    base = valor('--diff')
  }
  const conSub = opciones.includes('--sub')
  const conGlobal = opciones.includes('--global')
  if (modo === 'cambios' && (conSub || conGlobal) && String(base ?? '').startsWith('--')) base = undefined
  let paso = null
  let aviso
  if (opciones.includes('--paso')) {
    const v = valor('--paso')
    if (/^\d+$/.test(v ?? '') && Number(v) <= 7) paso = Number(v)
    else aviso = `--paso ${v ?? ''} no es un paso (0–7); se ignora`
  }
  return {
    modo,
    base,
    desde: valor('--desde'),
    permitidos: listaPermitidos(valor('--permitidos')),
    rutas,
    paso,
    aviso,
    tokens: valor('--tokens'),
    resultado: opciones.includes('--resultado') ? (valor('--resultado') ?? '') : undefined,
    agente: modo === 'guardar' ? valor('--guardar') : undefined,
    tipo: modo === 'guardar' ? valor('--guardar', 2) : undefined,
    ajuste: opciones.includes('--ajuste'),
    forzar: opciones.includes('--forzar'),
    ...(conSub ? { sub: subDe(valor('--sub')) } : {}),
    ...(conGlobal ? { global: true } : {}),
    ...(modo === 'guia' ? { guia: valor('--guia') ?? '', ...(opciones.includes('--parte') ? { parte: valor('--parte') ?? '' } : {}) } : {}),
    ...(opciones.includes('--omitida') ? { omitida: true } : {}),
    ...(modo === 'aprobado' ? { ajustes: /^--/.test(valor('--ajustes') ?? '--') ? '' : valor('--ajustes') } : {}),
    ...(modo === 'aprobado' && opciones.includes('--sumar') ? { sumar: /^--/.test(valor('--sumar') ?? '--') ? '' : valor('--sumar') } : {}),
    ...(modo === 'aprobado' && opciones.includes('--permisos') ? { permisos: /^--/.test(valor('--permisos') ?? '--') ? '' : valor('--permisos') } : {}),
    ...(modo === 'tanda' ? { tanda: /^[1-9]\d*$/.test(valor('--tanda') ?? '') ? Number(valor('--tanda')) : null } : {}),
    ...(modo === 'permisoNuevo' ? { permisoNuevo: valor('--permiso-nuevo') ?? '' } : {}),
    ...(modo === 'permiso' ? { permiso: /^[PN][1-9]\d*(,[PN][1-9]\d*)*$/i.test(valor('--permiso') ?? '') ? valor('--permiso').toUpperCase() : null, accion: /^--/.test(valor('--permiso', 2) ?? '--') ? '' : valor('--permiso', 2) } : {}),
  }
}

function main() {
  const { modo, base, desde, permitidos, rutas, paso, aviso, tokens, resultado, agente, tipo, ajuste, forzar, sub, global, guia, parte, permiso, accion, permisoNuevo: textoNuevo, tanda, omitida, ajustes, sumar, permisos } = opcionesDe(process.argv.slice(2))
  if (aviso) console.log(`AVISO: ${aviso}`)
  // Ni las reglas ni el estado necesitan git: las reglas se inyectan antes del preflight.
  if (modo === 'reglas') {
    imprimirReglas()
    return
  }
  if (modo === 'guia') {
    imprimirGuia(guia, parte)
    return
  }
  // Cada comando del orquestador (lleva `--paso`) pone al día la lectura final de límites del flujo abierto.
  if (paso !== null && modo !== 'preflight' && modo !== 'reanudar') anotarLimites(paso)
  // La revisión final se guarda sola: antes de lo que la lee (la tanda, el estado, el alcance global del paso 6 y el cierre).
  if (['estado', 'reanudar', 'tanda'].includes(modo) || (modo === 'cambios' && global && (paso === 6 || paso === 7))) guardarRevisionesNuevas()
  if (modo === 'estado') {
    mostrarEstado()
    return
  }
  if (modo === 'reanudar' || modo === 'aprobado') {
    try {
      if (modo === 'reanudar') reanudar()
      else aprobar(ajustes, sumar, permisos)
    } catch (e) {
      console.log(`ERROR: ${e.message}`)
      process.exitCode = 2
    }
    return
  }
  if (modo === 'cancelar') {
    cancelar()
    return
  }
  if (modo === 'guardar') {
    try {
      guardar(agente, tipo, ajuste)
    } catch (e) {
      console.log(`AVISO: no se pudo guardar el informe (${e.message}): despacha copiando su texto, como antes`)
    }
    return
  }
  if (modo === 'permiso') {
    try {
      aprobarPermiso(permiso, accion)
    } catch (e) {
      console.log(`ERROR: ${e.message}`)
      process.exitCode = 2
    }
    return
  }
  if (modo === 'permisoNuevo') {
    try {
      permisoNuevo(textoNuevo, sub)
    } catch (e) {
      console.log(`ERROR: ${e.message}`)
      process.exitCode = 2
    }
    return
  }
  if (modo === 'tanda') {
    try {
      abrirTanda(tanda, sub)
    } catch (e) {
      console.log(`ERROR: ${e.message}`)
      process.exitCode = 2
    }
    return
  }
  try {
    if (git(['rev-parse', '--is-inside-work-tree'], { opcional: true })?.trim() !== 'true') {
      throw new Error(`${RAIZ} no es un repositorio git: los flujos necesitan git (el usuario puede hacer git init)`)
    }
    if (modo === 'base' && sub !== undefined) fotoDeSubtarea(sub)
    else if (modo === 'base') {
      const nueva = { base: foto(), desde: new Date().toISOString() }
      const { fotos } = leerEstado()
      anotarEstado({ fotos: [...(Array.isArray(fotos) ? fotos : []), nueva] })
      console.log(`BASE=${nueva.base} DESDE=${nueva.desde}`)
    } else if (modo === 'cambios') {
      const delFlujo = sub !== undefined || global
      const del = delFlujo ? contextoDelFlujo({ base, desde, permitidos, sub, global }) : { base, desde, permitidos }
      exigirBase(del.base)
      // Las fases en paralelo se leen antes de cerrarlas: este mismo comando las mide.
      const paralelos = delFlujo ? paralelosDe(leerEstado()) : []
      if (delFlujo) anotarEstado({ en_curso: undefined })
      if (tokens !== undefined && paso !== 7) console.log('AVISO: --tokens solo vale en el cierre (--cambios … --paso 7); se ignora')
      if (resultado !== undefined && paso !== 7) console.log('AVISO: --resultado solo vale en el cierre (--cambios … --paso 7); se ignora')
      if (omitida && !del.miembros?.length) console.log('AVISO: --omitida solo vale con --cambios --sub <n>; se ignora')
      // Antes de los CAMBIOS: la salida sigue terminando en ALCANCE.
      if (del.miembros?.length) anotarAvance(del.miembros, del.desde, omitida)
      if (del.miembros?.length) avisosDeTipos(del.base, del.permitidos, del.miembros.map((n) => `S${n}`).join('+'))
      // Revisión final (paso 6): el diff completo del flujo va a diff.txt, sin el corte de TOPE_DIFF, para que el revisor lo lea con Read.
      if (paso === 6 && delFlujo) {
        const todas = (Array.isArray(leerEstado().subtareas) ? leerEstado().subtareas : []).map((s) => Number(s?.n))
        if (global || (todas.length && todas.every((n) => del.miembros?.includes(n)))) {
          const destino = path.join(FLUJO, 'diff.txt')
          try {
            diff(leerEstado().base_global ?? del.base, del.permitidos, [], destino)
            console.log(`DIFF: ${destino}`)
          } catch (err) {
            console.log(`AVISO: no se pudo escribir diff.txt: ${err.message}`)
          }
        }
      }
      // El despacho de lo que sigue sale un paso antes: el Agent va en el mismo mensaje que su Bash.
      if (del.miembros?.length) for (const l of despachosTrasLote(leerEstado())) console.log(l)
      else if (global && paso === 6 && leerEstado().revisiones?.length) for (const l of despachoRevision(leerEstado())) console.log(l)
      try {
        cambios(del.base, del.desde, del.permitidos, paso, tokens, resultado, paralelos)
      } finally {
        if (delFlujo) cerrarParalelos()
      }
    } else if (modo === 'diff') diff(exigirBase(base), permitidos, rutas)
    else preflight(forzar)
  } catch (e) {
    console.log(`ERROR: ${e.message}`)
    process.exitCode = 2
  }
}

function esPrincipal() {
  if (!process.argv[1]) return false
  const a = path.resolve(process.argv[1])
  const b = fileURLToPath(import.meta.url)
  return WIN ? a.toLowerCase() === b.toLowerCase() : a === b
}

if (esPrincipal()) main()
