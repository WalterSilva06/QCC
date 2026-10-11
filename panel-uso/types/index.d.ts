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
  /** Quién respondió: el hilo principal o un subagente. Las filas se separan por origen. */
  origen: 'principal' | 'subagente'
  /** Entrada + salida + caché leída + caché escrita. */
  total: number
  salida: number
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

/** El flujo `/implementador`, `/implementador-ligero` o `/documentar` de la sesión y dónde va. */
export type Flujo = {
  /** La skill que lo inició. */
  nombre: 'implementador' | 'implementador-ligero' | 'documentar'
  /** `auditar`: `/documentar` con pedido de auditoría (otros pasos); `null` en el resto. */
  variante: 'auditar' | null
  /** Índice del paso actual dentro de los pasos de su flujo (0 es Preflight). */
  paso: number
  /** Ya salió algún agente `ejecutor`: distingue la verificación del Preflight de la final. */
  ejecuto: boolean
  /** `en curso`, o cómo terminó: `completo`, `detenido` (CIERRE … DETENIDO) o `interrumpido`. */
  estado: 'en curso' | 'completo' | 'detenido' | 'interrumpido'
}

declare module 'claude-code' {
  interface PluginState {
    'panel-uso': {
      medida: Medida | null
      esfuerzo: Esfuerzo | null
      ahora: number
      desglose: Desglose | null
      precisando: boolean
      semana: Semana | null
      /** Lo mismo que `semana`, solo con lo anotado por la sesión actual (desde su inicio). */
      sesion: Semana | null
      /** «Esta semana» desplegada; se recuerda en el store con la clave `prefs:semana`. */
      semanaAbierta: boolean
      /** Qué filas de «Esta sesión» tienen una petición en curso o esperan a otra; solo de esta terminal. */
      actividad: Actividad
      /** El flujo `/implementador`, `/implementador-ligero` o `/documentar` en curso o ya terminado; `null` si la sesión no inició ninguno. */
      flujo: Flujo | null
      /** La sección «Flujo» desplegada; se recuerda en el store con la clave `prefs:flujo`. */
      flujoAbierto: boolean
    }
  }
}
