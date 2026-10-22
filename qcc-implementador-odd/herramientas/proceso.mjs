// Control del proceso de una corrida de /qcc-implementador-odd, leído del transcript del orquestador.
//
// Recorre las herramientas que usó el hilo principal en el tramo de la corrida y devuelve los desvíos de las reglas
// del SKILL.md que se ven ahí: `--plan` antes de la primera edición, ediciones con Edit o Write (no por Bash),
// `verificar.mjs` y `--diff` después de la última edición (el `--diff` no se exige en una grande con riesgo), el diferencial repetido si se editó después, un ejecutor
// pasados los 150k de contexto y lecturas con Read (no con `cat`). En una tarea grande, además: explorador, ejecutor,
// nada de código editado inline y pocos archivos leídos enteros antes de `--plan`. `odd.mjs --cierre` lo imprime
// como `PROCESO:`.

import path from 'node:path'
import { tramosExpandidos, partesDe, rutasEscritas, leeDelRepo, scriptQueEscribe, cuerposDe, rutaNativa, dentro, ESCRIBE_FS } from './guardia.mjs'
import { contextoDePedido, textoDe, miles } from './costo.mjs'

export const TOPE_CONTEXTO = 150_000
// En una tarea grande el orquestador lee los tramos del explorador: más archivos enteros que esto antes de --plan es un desvío.
const TOPE_ENTEROS = 2
const TAREAS = 'odd/tasks'
const EDITAN = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
const INTERPRETES = new Set(['node', 'python', 'python3', 'py', 'deno', 'bun', 'ruby', 'perl'])

/**
 * Las herramientas del hilo principal entre `inicio` y `hasta`, en orden: `{ nombre, entrada, cwd, resultado }`. Las
 * que negó la guardia no corrieron: no cuentan.
 */
export function usosDe(filas, { inicio, hasta }) {
  const enTramo = (t) => t && t >= inicio && t <= hasta
  const resultados = new Map()
  for (const f of filas) {
    if (f.isSidechain || f.type !== 'user' || !Array.isArray(f.message?.content)) continue
    for (const c of f.message.content) if (c?.type === 'tool_result') resultados.set(c.tool_use_id, textoDe(c.content))
  }
  const vistos = new Set()
  const usos = []
  for (const f of filas) {
    if (f.isSidechain || f.type !== 'assistant' || !enTramo(f.timestamp)) continue
    for (const c of f.message?.content ?? []) {
      if (c?.type !== 'tool_use' || vistos.has(c.id)) continue
      vistos.add(c.id)
      const resultado = resultados.get(c.id) ?? ''
      if (!/Guardia \/qcc-implementador-odd:/.test(resultado)) usos.push({ nombre: c.name, entrada: c.input ?? {}, cwd: f.cwd, resultado })
    }
  }
  return usos
}

/** El contexto más grande del orquestador entre `inicio` y `hasta`, en tokens. */
export function contextoMaximo(filas, { inicio, hasta }) {
  let max = 0
  for (const f of filas) {
    if (f.isSidechain || f.type !== 'assistant' || !f.timestamp || f.timestamp < inicio || f.timestamp > hasta) continue
    max = Math.max(max, contextoDePedido(f.message?.usage))
  }
  return max
}

/**
 * Los desvíos de proceso de la corrida: `{ desvios, contextoMax }`, con `desvios` vacío si no hubo. `filas` es el
 * transcript de la sesión; `inicio` y `hasta`, el tramo de la corrida. Con `tamano: 'grande'` exige además el
 * explorador (salvo `explorar: 'nunca'`), el ejecutor, ninguna edición de código inline y pocos archivos leídos
 * enteros antes de `--plan`. Despachar un ejecutor cuenta como edición; escribir en `odd/tasks/`, no. Con `tamano:
 * 'grande'` y un `riesgo` que no sea «ninguno» (ausente o vacío cuenta como sin riesgo), tampoco exige el `--diff` entero.
 */
export function procesoDe(filas, { raiz, inicio, hasta, tamano = null, riesgo = null, explorar = 'auto' }) {
  const usos = usosDe(filas, { inicio, hasta })
  const contextoMax = contextoMaximo(filas, { inicio, hasta })
  const scripts = new Set()
  const enteros = new Set()
  const marcas = { plan: -1, verificar: -1, diff: -1, diferencial: -1, primeraEdicion: -1, ultimaEdicion: -1 }
  let porBash = 0
  let conCat = 0
  let inline = 0
  let ejecutor = false
  let explorador = false
  let copia = null
  // El diferencial manual (`--copia-base`) se repite a mano; el de `--diferencial` lo repite verificar.mjs.
  let diferencialManual = false
  usos.forEach((u, k) => {
    const cwd = u.cwd ? path.resolve(rutaNativa(u.cwd)) : raiz
    const enRepo = (ruta) => Boolean(ruta) && !/\$|__SUST__/.test(ruta) && dentro(path.resolve(cwd, rutaNativa(ruta)), raiz)
    const enTareas = (ruta) => dentro(path.resolve(cwd, rutaNativa(ruta)), path.join(raiz, TAREAS))
    let edita = false
    if (EDITAN.has(u.nombre)) {
      const ruta = String(u.entrada.file_path ?? u.entrada.notebook_path ?? '')
      // El documento de la feature no es parte del cambio que se verifica.
      edita = enRepo(ruta) && !enTareas(ruta)
      if (edita) inline++
      // Un script que escribe archivos, guardado fuera del repo para correrlo después (los del repo son del proyecto).
      if (!enRepo(ruta) && ESCRIBE_FS.test(String(u.entrada.content ?? ''))) scripts.add(path.basename(ruta).toLowerCase())
    } else if (u.nombre === 'Read') {
      const ruta = String(u.entrada.file_path ?? '')
      if (marcas.plan < 0 && u.entrada.limit === undefined && enRepo(ruta) && !enTareas(ruta)) enteros.add(path.resolve(cwd, rutaNativa(ruta)).toLowerCase())
    } else if (u.nombre === 'Agent' || u.nombre === 'Task') {
      if (u.entrada.subagent_type === 'qcc-odd-explorador') explorador = true
      // El ejecutor edita: lo que venga después tiene que verificarlo.
      if (u.entrada.subagent_type === 'qcc-odd-ejecutor') ejecutor = edita = true
    } else if (u.nombre === 'Bash' || u.nombre === 'PowerShell') {
      const cmd = String(u.entrada.command ?? '')
      const tramos = tramosExpandidos(cmd)
      const escritas = tramos.flatMap((t) => rutasEscritas(t))
      // Un script que escribe archivos, guardado con un heredoc fuera del repo para correrlo después.
      if (ESCRIBE_FS.test(cuerposDe(cmd))) for (const r of escritas) if (!enRepo(r) && /\.[cm]?[jt]s$|\.py$/.test(r)) scripts.add(path.basename(r).toLowerCase())
      const porScript = tramos.some((t) => {
        const { prog, libres } = partesDe(t)
        return scriptQueEscribe(t, { raiz, cwd, cmd }) || (INTERPRETES.has(prog) && scripts.has(path.basename(String(libres[0] ?? '').replaceAll('\\', '/')).toLowerCase()))
      })
      if (escritas.some(enRepo) || porScript) {
        edita = true
        porBash++
        inline++
      }
      if (tramos.some((t) => leeDelRepo(t, { raiz, cwd }))) conCat++
      if (/odd\.mjs\b.*--plan\b/.test(cmd)) marcas.plan = k
      if (/verificar\.mjs\b/.test(cmd)) marcas.verificar = k
      // El --stat es el control tras un despacho: no reemplaza al diff entero del autochequeo.
      if (tramos.some((t) => /odd\.mjs\b.*--diff\b/.test(t) && !/--stat\b/.test(t))) marcas.diff = k
      if (/odd\.mjs\b.*--copia-base\b/.test(cmd)) {
        copia = /ODD_COPIA=(\S+)/.exec(u.resultado)?.[1]?.split(/[\\/]/).pop() ?? copia
        marcas.diferencial = k
        diferencialManual = true
      } else if (/odd\.mjs\b.*--diferencial\b/.test(cmd)) {
        marcas.diferencial = k
        diferencialManual = false
      } else if (copia && cmd.includes(copia) && !/--limpiar\b/.test(cmd)) {
        marcas.diferencial = k
        diferencialManual = true
      }
    }
    if (edita) {
      if (marcas.primeraEdicion < 0) marcas.primeraEdicion = k
      marcas.ultimaEdicion = k
    }
  })
  const desvios = []
  const conRiesgo = Boolean(riesgo) && !/^ninguno\b/i.test(riesgo)
  const { plan, verificar, diff, diferencial, primeraEdicion, ultimaEdicion } = marcas
  if (plan < 0) desvios.push('sin --plan')
  else if (primeraEdicion >= 0 && plan > primeraEdicion) desvios.push('--plan después de editar')
  if (porBash) desvios.push(`editó por Bash: ${porBash}`)
  if (ultimaEdicion >= 0) {
    // Una edición en el mismo comando que verifica, antes que él, no cuenta como posterior.
    if (verificar < 0) desvios.push('sin verificar.mjs')
    else if (ultimaEdicion > verificar) desvios.push('editó después del último verificar.mjs')
    // Una grande con riesgo la revisa el revisor: el diff entero en el contexto del orquestador no se exige.
    if (!(tamano === 'grande' && conRiesgo)) {
      if (diff < 0) desvios.push('sin --diff')
      else if (ultimaEdicion > diff) desvios.push('editó después del último --diff')
    }
    if (diferencialManual && diferencial >= 0 && ultimaEdicion > diferencial) desvios.push('editó después del diferencial')
  }
  if (contextoMax > TOPE_CONTEXTO && !ejecutor) desvios.push(`contexto máx. ${miles(contextoMax)} sin ejecutor`)
  if (conCat) desvios.push(`exploró con cat/head: ${conCat}`)
  if (tamano === 'grande') {
    if (!explorador && explorar !== 'nunca') desvios.push('grande sin explorador')
    if (!ejecutor) desvios.push('grande sin ejecutor')
    if (inline) desvios.push(`grande: editó código inline: ${inline}`)
    if (enteros.size > TOPE_ENTEROS) desvios.push(`leyó ${enteros.size} archivos enteros antes de --plan`)
  }
  return { desvios, contextoMax }
}

/** «ok» o los desvíos separados por «·». */
export const lineaDeProceso = ({ desvios }) => (desvios.length ? desvios.join(' · ') : 'ok')
