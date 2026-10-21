// Control del proceso de una corrida de /qcc-implementador-odd, leído del transcript del orquestador.
//
// Recorre las herramientas que usó el hilo principal en el tramo de la corrida y devuelve los desvíos de las reglas
// del SKILL.md que se ven ahí: `--plan` antes de la primera edición, ediciones con Edit o Write (no por Bash),
// `verificar.mjs` y `--diff` después de la última edición, el diferencial repetido si se editó después, un ejecutor
// pasados los 150k de contexto y lecturas con Read (no con `cat`). `odd.mjs --cierre` lo imprime como `PROCESO:`.

import path from 'node:path'
import { tramosExpandidos, partesDe, rutasEscritas, leeDelRepo, rutaNativa, dentro, ESCRIBE_FS } from './guardia.mjs'
import { contextoDePedido, textoDe, miles } from './costo.mjs'

export const TOPE_CONTEXTO = 150_000
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
 * transcript de la sesión; `inicio` y `hasta`, el tramo de la corrida.
 */
export function procesoDe(filas, { raiz, inicio, hasta }) {
  const usos = usosDe(filas, { inicio, hasta })
  const contextoMax = contextoMaximo(filas, { inicio, hasta })
  const scripts = new Set()
  const marcas = { plan: -1, verificar: -1, diff: -1, diferencial: -1, primeraEdicion: -1, ultimaEdicion: -1 }
  let porBash = 0
  let conCat = 0
  let ejecutor = false
  let copia = null
  usos.forEach((u, k) => {
    const cwd = u.cwd ? path.resolve(rutaNativa(u.cwd)) : raiz
    const enRepo = (ruta) => Boolean(ruta) && !/\$|__SUST__/.test(ruta) && dentro(path.resolve(cwd, rutaNativa(ruta)), raiz)
    let edita = false
    if (EDITAN.has(u.nombre)) {
      const ruta = String(u.entrada.file_path ?? u.entrada.notebook_path ?? '')
      if (ESCRIBE_FS.test(String(u.entrada.content ?? ''))) scripts.add(path.basename(ruta).toLowerCase())
      edita = enRepo(ruta)
    } else if (u.nombre === 'Agent' || u.nombre === 'Task') {
      if (u.entrada.subagent_type === 'qcc-odd-ejecutor') ejecutor = true
    } else if (u.nombre === 'Bash' || u.nombre === 'PowerShell') {
      const cmd = String(u.entrada.command ?? '')
      const tramos = tramosExpandidos(cmd)
      const partes = tramos.map(partesDe)
      const escritas = tramos.flatMap(rutasEscritas)
      const escribeFs = ESCRIBE_FS.test(cmd)
      // Un script que escribe archivos, guardado con un heredoc para correrlo después.
      if (escribeFs) for (const r of escritas) if (/\.(c|m)?(js|ts)$|\.py$/.test(r)) scripts.add(path.basename(r).toLowerCase())
      const corre = partes.filter((p) => INTERPRETES.has(p.prog))
      const porScript = corre.length > 0 && (escribeFs || corre.some((p) => p.libres.some((a) => scripts.has(path.basename(a.replaceAll('\\', '/')).toLowerCase()))))
      if (escritas.some(enRepo) || porScript) {
        edita = true
        porBash++
      }
      if (tramos.some((t) => leeDelRepo(t, { raiz, cwd }))) conCat++
      if (/odd\.mjs\b.*--plan\b/.test(cmd)) marcas.plan = k
      if (/verificar\.mjs\b/.test(cmd)) marcas.verificar = k
      if (/odd\.mjs\b.*--diff\b/.test(cmd)) marcas.diff = k
      if (/odd\.mjs\b.*--copia-base\b/.test(cmd)) {
        copia = /ODD_COPIA=(\S+)/.exec(u.resultado)?.[1]?.split(/[\\/]/).pop() ?? copia
        marcas.diferencial = k
      } else if (copia && cmd.includes(copia) && !/--limpiar\b/.test(cmd)) marcas.diferencial = k
    }
    if (edita) {
      if (marcas.primeraEdicion < 0) marcas.primeraEdicion = k
      marcas.ultimaEdicion = k
    }
  })
  const desvios = []
  const { plan, verificar, diff, diferencial, primeraEdicion, ultimaEdicion } = marcas
  if (plan < 0) desvios.push('sin --plan')
  else if (primeraEdicion >= 0 && plan > primeraEdicion) desvios.push('--plan después de editar')
  if (porBash) desvios.push(`editó por Bash: ${porBash}`)
  if (ultimaEdicion >= 0) {
    // Una edición en el mismo comando que verifica, antes que él, no cuenta como posterior.
    if (verificar < 0) desvios.push('sin verificar.mjs')
    else if (ultimaEdicion > verificar) desvios.push('editó después del último verificar.mjs')
    if (diff < 0) desvios.push('sin --diff')
    else if (ultimaEdicion > diff) desvios.push('editó después del último --diff')
    if (diferencial >= 0 && ultimaEdicion > diferencial) desvios.push('editó después del diferencial')
  }
  if (contextoMax > TOPE_CONTEXTO && !ejecutor) desvios.push(`contexto máx. ${miles(contextoMax)} sin ejecutor`)
  if (conCat) desvios.push(`exploró con cat/head: ${conCat}`)
  return { desvios, contextoMax }
}

/** «ok» o los desvíos separados por «·». */
export const lineaDeProceso = ({ desvios }) => (desvios.length ? desvios.join(' · ') : 'ok')
