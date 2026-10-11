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

/** Tokens de todas las sesiones (hilo principal y subagentes) desde `desde`. */
export type Semana = {
  /** Inicio de la ventana (ms): la del límite semanal, o 7 días atrás sin él. */
  desde: number
  filas: FilaSemana[]
  total: number
  salida: number
  /** La hora más vieja guardada (ms); si es posterior a `desde`, la semana está incompleta. */
  registroDesde: number | null
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
    }
  }
}
