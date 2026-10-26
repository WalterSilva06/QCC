/** Una ventana de límite de uso: `five_hour`, `seven_day` u otra que informe la API. */
export type Ventana = { kind: string; percentUsed: number; resetsAt?: string }

/** La última medición de la sesión: ventana de contexto y límites de uso. */
export type Medida = {
  /** Tokens de entrada de la última respuesta; ausente antes de la primera. */
  tokens?: number
  /** Tamaño de la ventana de contexto del modelo, en tokens. */
  ventana: number
  /** `tokens` sobre `ventana`, 0 a 100; ausente antes de la primera respuesta. */
  porcentaje?: number
  limites: Ventana[]
}

/** El esfuerzo con que salió la última petición del hilo principal. */
export type Esfuerzo = {
  nivel: string
  modelo: string
  /** `turno`: leído de una petición real; `ajustes`: deducido de settings.json. */
  origen: 'turno' | 'ajustes'
}

/** Una categoría del contexto, como la lista `/context`. */
export type Parte = {
  /** Nombre ya traducido para mostrar. */
  nombre: string
  tokens: number
  /** `tokens` sobre la ventana medida, 0 a 100 con un decimal. */
  porcentaje: number
  /** Color del tema con que `/context` la dibuja. */
  color: string
  /** `usado` ocupa la ventana; `libre` es lo que queda; `reserva` es el colchón de la auto-compactación. */
  tipo: 'usado' | 'libre' | 'reserva'
}

/** Un archivo, servidor MCP, skill o agente que pesa en el contexto. */
export type Pesado = { nombre: string; tokens: number }

/** El contexto por categoría. */
export type Desglose = {
  partes: Parte[]
  /** La ventana contra la que se mide (puede ser la de compactación, menor que la del modelo). */
  ventana: number
  pesados: Pesado[]
  /** `true`: contado con la API de conteo (botón «Precisar»); `false`: estimado en local. */
  exacto: boolean
}

/** Los tokens de una familia de modelo con un esfuerzo, en la semana. */
export type FilaSemana = {
  /** Familia y versión: «Opus 5.5», «Sonnet 3.5», «Fable 5.1»; solo la familia sin versión, o el id tal cual si no se reconoce. */
  modelo: string
  /** «bajo», «medio», «alto», «muy alto», «máximo»; «—» para un modelo sin esfuerzo. */
  esfuerzo: string
  /** Quién respondió: el hilo principal o un subagente. Las filas del registro vienen separadas por origen; al dibujar, «Esta sesión» y «Esta semana» las unen (origen 'principal'). */
  origen: 'principal' | 'subagente'
  /** Entrada + salida + caché leída + caché escrita. */
  total: number
  salida: number
  /** Tokens de subagente dentro de `total`; solo lo pone `unirOrigenes`, que se aplica al dibujar «Esta sesión» y «Esta semana». */
  sub?: number
  /** Tokens del hilo principal durante un flujo en curso, dentro de `total`; solo en filas `principal` y solo si los hay. */
  flujo?: number
}

/** Los tokens de un día local. */
export type DiaSemana = {
  /** Comienzo del día local (ms), a las 00:00 de la zona horaria de la máquina. */
  inicio: number
  /** Entrada + salida + caché leída + caché escrita de ese día (como `FilaSemana.total`); 0 si no hubo uso. */
  total: number
}

/** Tokens de todas las sesiones (hilo principal y subagentes) desde `desde`. */
export type Semana = {
  /** Inicio de la ventana (ms): la del límite semanal, o 7 días atrás sin él. */
  desde: number
  filas: FilaSemana[]
  total: number
  salida: number
  /** La hora más vieja guardada (ms); si es posterior a `desde`, la semana está incompleta. */
  registroDesde: number | null
  /**
   * Total por día local, de más viejo a más nuevo, sin huecos (los días sin uso valen 0) y
   * con tope de 7 días (los más recientes). Vacía si no hay uso.
   */
  dias: DiaSemana[]
}

/** La actividad de una fila de «Esta sesión»: peticiones al modelo en curso y si espera una herramienta. */
export type ActividadFila = {
  /** Peticiones de esta fila que salieron y aún no vuelven (nunca negativo). */
  enVuelo: number
  /** Su última respuesta pidió una herramienta: la fila espera a que se ejecute y siga el turno. */
  pendiente: boolean
  /** Hora (ms) del último cambio de esta fila; sirve para caducar la espera. */
  desde: number
}

/** La actividad por id de fila (`Opus 5.5|high|principal`, igual al de las filas de `Semana`). */
export type Actividad = Record<string, ActividadFila>

/** El flujo `/impl` de la sesión y dónde va. */
export type Flujo = {
  /** La skill que lo inició. */
  nombre: 'impl'
  /** Índice del paso actual dentro de los pasos de su flujo (0 es Preflight). */
  paso: number
  /** Ya salió algún agente `ejecutor`: distingue la verificación del Preflight de la final. */
  ejecuto: boolean
  /** Salió un `revisor` desde el último `ejecutor` de Ejecución, así que el próximo `verificar.mjs` es el final (paso 6). Si falta, `false`. */
  reviso?: boolean
  /** Ya hubo la verificación final desde el último `estado.mjs --base`; los `ejecutor` siguientes son correcciones del cierre y conservan `reviso`. Si falta, `false`. */
  cierre?: boolean
  /** Exploradores en vuelo (salieron y aún no vuelven); si falta, 0. */
  exploradores?: number
  /** Exploradores lanzados en todo el flujo, de todas las tandas; no baja al volver. Si falta, cuentan los que están en vuelo. */
  totalExploradores?: number
  /** Algún explorador de la tanda en curso volvió sin error; si falta, `false`. */
  exploro?: boolean
  /** Planificadores lanzados en todo el flujo, con los re-planes; solo `/impl`. Si falta, 0. */
  planes?: number
  /** Ejecutores lanzados en todo el flujo, con las correcciones. Si falta, 0, o 1 si `ejecuto`. */
  ejecuciones?: number
  /** Revisores lanzados, por índice del paso en que queda el flujo al lanzarlos. Si falta, ninguno. */
  revisiones?: Record<number, number>
  /** Revisores en vuelo (salieron y aún no vuelven); si falta, 0. */
  revisores?: number
  /** `en curso`, o cómo terminó: `completo`, `detenido` (CIERRE … DETENIDO) o `interrumpido`. */
  estado: 'en curso' | 'completo' | 'detenido' | 'interrumpido'
  /** Hora (ms) en que empezó el flujo. */
  inicio: number
  /** Hora (ms) en que empezó el tramo abierto de trabajo del paso actual (con una pregunta abierta, no corre). */
  desde: number
  /** Ms de trabajo acumulados por índice de paso, sin contar el tramo abierto ni la espera al usuario; falta el paso que nunca se visitó. */
  tiempos: Record<number, number>
  /** Ms esperando al usuario (`AskUserQuestion`) por índice de paso, sin la espera abierta; no está en `tiempos`. Si falta, 0. */
  esperaUsuario?: Record<number, number>
  /** Tokens por índice de paso, `[total, salida]`: suma del usage de cada petición (hilo principal y subagentes) que respondió con el flujo en curso en ese paso. Falta si no hubo ninguna; falta el paso sin gasto. */
  gasto?: Record<number, [number, number]>
  /**
   * Un registro por explorador, por `agentId`, en orden de primera aparición. `descripcion` es la que se le dio al lanzarlo; `desde` la hora (ms) del lanzamiento;
   * `ms` su duración final; `gasto` el total de los cuatro campos del usage de sus `turn.step` (nunca `totalTokens`); `llamada` el `tool_use_id`
   * del `Agent` que lo lanzó (falta en los registros de la 0.17.0), para cerrar el suyo si vuelve sin `agentId`;
   * `config` los modelos y esfuerzos observados de sus peticiones («Haiku 5.5 high»), en orden de primera aparición y sin repetir.
   * Cada campo falta hasta que se conoce. Si falta el campo entero (atom 0.16.0 o anterior) o no es una lista, no hay detalle por explorador.
   */
  detalleExploradores?: { id: string; descripcion?: string; desde?: number; ms?: number; gasto?: number; llamada?: string; config?: string[] }[]
  /** Hora (ms) en que empezó la espera abierta al usuario; `null` o ausente si no hay. */
  preguntaDesde?: number | null
  /** Ms que el flujo pasó interrumpido antes de reanudarse (un turno cortado, p. ej. por el límite de uso); no es trabajo ni espera. Si falta, 0. */
  pausa?: number
  /** Hora (ms) en que terminó; `null` mientras está en curso. */
  fin: number | null
  /** Lo que la sesión llevaba gastado al empezar el flujo, por fila de «Esta sesión» (`modelo|esfuerzo|origen`): `[total, salida]`. Si falta, 0 en cada fila. */
  usoBase?: Record<string, [number, number]>
  /** Lo que gastó el flujo, fijado al terminar (con el hilo principal y los subagentes por separado); falta si no gastó nada o si terminó antes de existir este campo. */
  consumo?: FilaSemana[]
  /** Modelo y esfuerzo del hilo principal (el orquestador) en su última petición durante el flujo, p. ej. «Opus 5.5 high». Falta hasta la primera. */
  orquestador?: string
  /** `subagent_type` del último `Agent` que lanzó el hilo principal durante el flujo; sirve para atribuir las peticiones de los subagentes. Falta hasta el primero. */
  ultimoAgente?: string
  /**
   * Modelo y esfuerzo observados de cada agente, por índice de paso y por agente (`planificador`, `revisor-plan`, `ejecutor`, `revisor`, `explorador`),
   * en orden de primera aparición y sin repetir: `{ 5: { revisor: ['Sonnet 5.5 high', 'Sonnet 5.5 medium'] } }`. Solo se escribe lo observado: nunca `{}` ni `[]`.
   */
  configs?: Record<number, Record<string, string[]>>
}

/**
 * Una fila del historial de flujos (`~/.claude/flujos/registros/flujos.jsonl` o `~/.claude/flujos-odd/registros/odd.jsonl`), ya reducida
 * a lo que muestra la pestaña «Historial».
 */
export type FilaHistorial = {
  /** Hora de cierre del flujo, ISO. */
  t: string
  /** Nombre de la carpeta del repo (último tramo de `raiz`); `?` si falta. */
  repo: string
  /** Qué flujo fue: `normal` (`/impl`, de `flujos.jsonl`) u `odd` (`/odd`, de `odd.jsonl`). Si falta (caché de una versión anterior), `normal`. */
  flujo?: 'normal' | 'odd'
  /** Costo real en dólares; falta si no se anotó. */
  usd?: number
  /** Minutos activos; falta si no se anotaron. */
  minutos?: number
  /** Revisión final: `✓` aprobó a la primera, `↻` hubo rechazos, `✗` flujo detenido o cancelado, `·` sin dato. */
  revision: '✓' | '↻' | '✗' | '·'
  /** Clasificación corta: «CRÍTICO (#1, #5)», «sin criterios» o los primeros 30 caracteres. */
  clasificacion: string
  /** Cuántas subtareas anotó el flujo; falta si no hubo dato. */
  subtareas?: number
  /** El flujo se canceló o alguna subtarea quedó BLOQUEADA. */
  aviso: boolean
  /** Título del flujo (o la primera línea del pedido); falta si no hay. */
  titulo?: string
  /** Costo por rol (`orquestador`, `ejecutor`…) en dólares, del mayor al menor y solo con `usd` mayor que 0; falta si no hay. `tokens` es el total de entrada, leídos, escritos y salida del rol; falta si la fila no lo anotó. */
  roles?: { rol: string; usd: number; tokens?: number }[]
  /** Minutos de espera (v2), solo si son más de 0. */
  espera?: number
  /** Líneas añadidas en total por las subtareas; falta si ninguna lo anotó. */
  mas?: number
  /** Líneas quitadas en total por las subtareas; falta si ninguna lo anotó. */
  menos?: number
  /** Total de tokens del flujo (entrada, leídos, escritos y salida); falta si la fila no lo anotó. */
  tokens?: number
  /** Tokens de salida del flujo; falta si la fila no lo anotó. */
  salida?: number
}

/** El historial leído de los dos registros: la suma de sus fechas de modificación (ms; la de uno que no existe cuenta 0) y las últimas filas, la más reciente primero. */
export type Historial = {
  /** Forma de lo guardado: `5` trae los tokens de cada fila y no trae `totales`. Una caché sin `v`, o con `2`, `3` o `4`, se vuelve a leer. */
  v?: 5
  mtimeMs: number
  filas: FilaHistorial[]
}

/** Qué implementadores hay instalados: `true` está, `false` no está (con certeza), `null` dudoso (algo de la detección falló). */
export type Instalados = {
  /** `/impl`. */
  normal: boolean | null
  /** `/odd`. */
  odd: boolean | null
}

/** Las pestañas del panel: «Inicio», «Gasto semanal», «Historial» y «Agentes». «Carpeta» es un botón, no una pestaña. «Historial» puede estar oculta si no hay un implementador instalado; «Agentes» solo aparece si hay algún agente anotado. Un `flujo` guardado por una versión anterior ya no es una pestaña: abre «Inicio». */
export type Pestana = 'inicio' | 'semana' | 'historial' | 'agentes'

/** Un subagente visto en la sesión (de cualquier flujo), tal como lo muestra la pestaña «Agentes». */
export type AgenteVisto = {
  /** Su `agentId`, el que trae el resultado de `agent.spawn` y el `agentId` de sus herramientas. */
  id: string
  /** Su `subagent_type` tal cual (`impl:qcc-ejecutor`); vacío si no vino. */
  tipo: string
  /** La `description` con que se lanzó; vacía si no vino. */
  descripcion: string
  /** Hora (ms) en que se lanzó. */
  desde: number
  /** Hora (ms) en que volvió; falta mientras corre. */
  fin?: number
  /** `corriendo`, `listo` (su `Agent` volvió bien) o `fallo` (su `Agent` falló). */
  estado: 'corriendo' | 'listo' | 'fallo'
  /** Herramientas que llamó (los `tool.call` con su `agentId`). */
  herramientas: number
  /** El `tool_use_id` del `Agent` que lo lanzó, para cerrarlo si su resultado vuelve sin `agentId`. Falta si no vino. */
  llamada?: string
}

/** Un archivo editado (`Edit`, `Write` o `NotebookEdit`) en la sesión. */
export type ArchivoTocado = {
  ruta: string
  /** Ediciones anotadas desde que entró en la lista. */
  veces: number
  /** Rol del último agente que lo tocó, o `principal` si fue el hilo principal. */
  agente: string
  /** Hora (ms) de la última edición. */
  t: number
}

/**
 * Estado del freno de contexto de `prompt.submit`. Solo se escribe lo que tiene valor; sin campos el freno es `null`, nunca `{}`.
 */
export type Freno = {
  /** El último envío se frenó con un aviso; el siguiente pasa (es el reenvío) y borra la marca. */
  frenado?: true
  /** `fin` del último flujo cerrado cuyo primer mensaje posterior ya se vio, para avisar una sola vez por cierre. */
  cierreVisto?: number
}

/** El caché del prompt del hilo principal: lo acumulado de sus respuestas y cuándo fue la última. */
export type Cache = {
  /** Tokens de entrada leídos del caché, sumados. */
  leidos: number
  /** Tokens de entrada totales (nuevos, leídos y escritos), sumados. */
  entrada: number
  /** Hora (ms) de la última respuesta que trajo entrada; el caché vence 5 minutos después. */
  t: number
}

declare module 'claude-code' {
  interface PluginState {
    panel: {
      medida: Medida | null
      esfuerzo: Esfuerzo | null
      ahora: number
      desglose: Desglose | null
      precisando: boolean
      semana: Semana | null
      /** Lo mismo que `semana`, solo con lo anotado por la sesión actual (desde su inicio). */
      sesion: Semana | null
      /** La pestaña abierta; se recuerda en el store con la clave `prefs:pestana`. Si falta, `'inicio'`. */
      pestana?: Pestana
      /** Qué filas de «Esta sesión» tienen una petición en curso o esperan a otra; solo de esta terminal. */
      actividad: Actividad
      /** El flujo `/impl` en curso o ya terminado; `null` si la sesión no inició ninguno. */
      flujo: Flujo | null
      /** Ids de fila de subagente vistas mientras había exploradores o revisores en vuelo; solo de esta terminal; se vacía al iniciar un flujo, al abrir una tanda de exploradores o revisores y al cerrar la sesión. */
      filasExploradores: string[]
      /** Las últimas filas de `flujos.jsonl` con la fecha de modificación con que se leyeron; `null` hasta la primera lectura o si falló. Si falta (estado de una versión anterior), `null`. */
      historial?: Historial | null
      /** La carpeta personal, pedida a `node` una vez por sesión: `null` si aún no se pidió, `''` si falló (y no se vuelve a pedir). Si falta, `null`. */
      home?: string | null
      /** El freno de contexto de `prompt.submit`; `null` si no hay nada que recordar. Solo de esta terminal. Si falta (estado de una versión anterior), `null`. */
      freno?: Freno | null
      /** Hay una corrida de `/odd` en este turno: el hilo principal anota sus tokens como los de un flujo. Se borra al terminar el turno del hilo principal. Solo de esta terminal. Si falta (estado de una versión anterior), `false`. */
      corridaOdd?: boolean
      /** Los implementadores detectados (ajustes y `SKILL.md`); `null` si aún no se detectó o si la detección fue dudosa. Si falta (estado de una versión anterior), `null`. */
      instalados?: Instalados | null
      /** El caché del prompt del hilo principal; `null` hasta la primera respuesta o tras un `/clear`. Solo de esta terminal. Si falta (estado de una versión anterior), `null`. */
      cache?: Cache | null
      /** El umbral más alto de contexto ya avisado con un toast (80 o 95); 0 si ninguno, y vuelve a 0 cuando el % baja de 80. Si falta (estado de una versión anterior), 0. */
      avisoContexto?: 0 | 80 | 95
      /** Los subagentes vistos en la sesión (el más viejo primero, con tope de 40); se vacía con `/clear`. Solo de esta terminal. Si falta (estado de una versión anterior), `[]`. */
      agentes?: AgenteVisto[]
      /** Los últimos archivos editados en la sesión (el más viejo primero, con tope de 10); se vacía con `/clear`. Solo de esta terminal. Si falta (estado de una versión anterior), `[]`. */
      archivos?: ArchivoTocado[]
    }
  }
}
