# Límites de uso

En un plan de suscripción lo que se agota es el % de la ventana de 5 horas y el % semanal, no dólares. Este archivo junta qué miden esos límites, qué se quitó de `/impl` por eso y cómo se anota ahora el % que gasta cada corrida y cada una de sus fases. Las reglas generales del repo están en [AGENTS.md](AGENTS.md); el flujo, en [FLUJOS.md](FLUJOS.md), y el panel, en [MODS.md](MODS.md).

## 1. Qué miden

### Lo oficial (Anthropic)

- **Ventana de 5 horas:** empieza con el primer mensaje y se reinicia entera 5 horas después.
- **Semanal:** se reinicia en un momento fijo asignado a la cuenta.
- Las dos cuentan todos los modelos juntos: cambiar de modelo no las restablece. Los límites «Opus» y «Sonnet» son pools aparte por familia.
- Lo que más gasta: el largo de la conversación, el modelo, el esfuerzo, las herramientas y conectores, y los subagentes (sus pedidos también cuentan).
- Anthropic no publica una cifra en tokens ni en horas, ni cuánto pesa la caché.
- El dato del % usado llega a la status line por stdin (`rate_limits.five_hour.used_percentage`, `rate_limits.seven_day.used_percentage` y sus `resets_at`, en epoch en segundos). Solo para suscriptores, solo tras la primera respuesta de la API en la sesión, y cada ventana puede faltar por separado.

Fuentes:

- [How do usage and length limits work](https://support.claude.com/en/articles/11647753-how-do-usage-and-length-limits-work)
- [Costs (Claude Code)](https://code.claude.com/docs/en/costs)
- [Status line (Claude Code)](https://code.claude.com/docs/en/statusline)
- [Errors (Claude Code)](https://code.claude.com/docs/en/errors.md)

### Estimación de terceros (no oficial)

Una sola persona, con 61 observaciones en 2 días, una cuenta, modelos mezclados y porcentajes enteros (ruidosos): **1 % de la ventana de 5 h ≈ 166k tokens nuevos u 11M de lectura de caché** (la lectura de caché pesaría ~1/67 de un token nuevo). Fuente: [How many tokens is 1% of your Claude Code limit](https://dev.to/samstull9007/how-many-tokens-is-1-of-your-claude-code-limit-232n). Sirve de orden de magnitud, no como regla.

### Lo que no se sabe

- Cuánto pesa cada modelo.
- Si la escritura de caché de 1 h pesa más que la de 5 min.
- Si el pool semanal pondera distinto que la ventana de 5 h.

## 2. Qué se quitó: los costos en dólares

Hasta la 0.4.2, `costos.mjs` tenía una tabla de precios por millón de tokens (`PRECIOS`, `HAIKU_LARGO`, `precioDe`, `costoDePedido`) y con ella calculaba el costo en USD de cada pedido, rol, subtarea y flujo. Lo mostraban el cierre (`COSTO: $…`), `costos.mjs --ultimos` y `--fuga`, el `AVISO` de contexto pesado del preflight, la línea `CONTEXTO` (lo que costaría reescribir el contexto en Opus), el `Estimado: ~$…` de la aprobación de planes grandes y el historial del panel (`$1,29 · 11m …` y `promedio $0,98`).

Se quitó todo porque el plan es de suscripción: el dinero no se gasta por pedido y la tabla de precios de la API no dice cuánto % de ventana consume nada. Lo que no era dinero se queda:

- tokens (entrada, leídos de caché, escritos en caché, salida y thinking), en total y por rol;
- minutos, pedidos por rol, Clasificación, subtareas, veredictos y tiempos por fase;
- la `fuga` (lo gastado tras el cierre), ahora en pedidos y tokens.

Compatibilidad: el campo de la fila sigue llamándose `costo` (nombre histórico; trae `inicio`, `minutos`, `roles` y `veredictos`, sin `usd`). Las filas viejas de `flujos.jsonl` con `usd` y `sinPrecio` se siguen leyendo en `costos.mjs` y en el panel, y esos campos se ignoran. No se escriben más.

La línea `Costo: <n> ejecutor(es) · revisión final` del plan no es dinero (cuenta agentes) y se queda. [comparativa-claude-5-5.md](comparativa-claude-5-5.md) conserva los precios de la API como dato de referencia de los modelos, no como cálculo del flujo.

## 3. Cómo se registra ahora el % por corrida

### De dónde sale el dato

`estado.mjs` corre como un proceso Node lanzado por Bash: no recibe el JSON de la status line ni el de los hooks. Lo recibe el panel: cada `session.measure` trae `rateLimits` (`five_hour` y `seven_day`, con `percentUsed` y `resetsAt`). Por eso **el panel escribe un snapshot** y `estado.mjs` lo lee:

- **Archivo:** `<carpeta de la cuenta>/qcc-limites.json`, donde la carpeta de la cuenta es `CLAUDE_CONFIG_DIR` (si la sesión la tiene) o `~/.claude`. Cada cuenta escribe y lee el suyo: los porcentajes son por cuenta. (`QCC_LIMITES` cambia la ruta; lo usan los tests.)
- **Formato:** `{ "t": "<ISO>", "five_hour": { "pct": 23, "resetsAt": "<ISO>" }, "seven_day": { "pct": 61, "resetsAt": "<ISO>" } }`. Cada ventana va solo si la medición la trae.
- **Cuándo:** en cada medición con límites; con los mismos valores, a lo sumo una vez por minuto. Sin límites (sin suscripción o antes de la primera respuesta) no escribe. Según los tipos del motor de plugins (build 2.1.322), `session.measure` llega «después de cada turno del hilo principal y cuando una ventana se mueve un punto entero», con los límites de «la última respuesta de la API». Un `/impl` es un solo turno largo, así que durante el flujo el snapshot cambia solo cuando una ventana sube un punto entero (ver «Por fase», más abajo).

Se descartaron: un script de status line (la de la cuenta ya es un script propio fuera del repo, y habría que cambiarlo en cada cuenta) y buscar el dato en `~/.claude` (no hay ningún archivo con los porcentajes; `.claude.json` solo trae el tier).

### Qué hace `/impl`, sin trabajo extra del orquestador

1. **Preflight** (`estado.mjs --paso 0`): anota en el estado del flujo un tramo con la lectura inicial, que es también su primera lectura por fase (paso 0).
2. **Cada comando con `--paso`:** pone al día la lectura final del tramo (solo si trae dato y cambió). Así un tramo cortado conserva lo último que vio. Si el paso no es el de la última lectura por fase del tramo, además la anota en `fases` (aunque no traiga dato); el `--paso 7` no abre fase.
3. **`--reanudar`** desde otra sesión: abre un tramo nuevo con su propia lectura inicial, anotada como lectura por fase del paso que dice `SIGUE:`. Lo gastado entre sesiones (fuera del flujo) no cuenta. En la misma sesión sigue con el tramo que tenía.
4. **Cierre** (`--cambios … --paso 7` y `--cancelar`): toma la lectura final, suma los tramos, imprime `LÍMITES: 5h +7 % · sem +1 %` y `LÍMITES POR FASE: …`, y los anota en la fila del flujo.

Una lectura es **«sin dato»** si no hay snapshot, si está roto o si tiene más de 10 minutos (el panel no corrió, o la sesión no tuvo respuesta todavía). Nunca se rellena con ceros. En el desglose por fase, una lectura sin dato une su fase con la siguiente (ver «Por fase»).

Límites conocidos: cada lectura es el último snapshot, que puede no reflejar todavía hasta casi un punto ya gastado (ver «Por fase»), y el mensaje final del cierre no entra. El % llega con a lo sumo un decimal (a veces entero): un flujo chico puede salir `+0 %` o `+1 %`.

### Por fase

El orquestador ya llama a `estado.mjs` con `--paso <n>` en cada fase, así que el desglose sale solo, sin trabajo extra. Cada tramo guarda una lectura por cambio de paso, y lo que sube el % entre una lectura y la siguiente (o la final del tramo) se anota en la fase del paso de la primera. Los pasos que se repiten (varios lotes en el 5, ciclos de la revisión en el 6, un 6 → 5 → 6 por una corrección) y los tramos de un flujo reanudado se suman en su fase.

El mapa paso → fase es la constante `FASES` de `costos.mjs`, la única:

| Paso | Fase | Qué cae ahí |
|---|---|---|
| 0, 1 | `exploración` | del preflight al primer `--paso 2`: los exploradores (ningún comando lleva `--paso 1`) |
| 2, 3 | `plan` | del primer `--guardar … exploracion` al primer comando del paso 4: el reintento de exploradores, el planificador, la revisión del plan del orquestador y la pregunta «Plan» (y un re-plan pedido por un ajuste) |
| 4 | `aprobación` | del `--aprobado` (o del `--guardar plan --ajuste`) al primer `--base --sub`: los permisos y las dependencias |
| 5 | `ejecución` | los ejecutores, sus correcciones y los `verificar.mjs` de cada lote |
| 6 | `revisión` | la revisión final, sus tandas de correcciones y sus ciclos |
| 7 | `cierre` | solo lo que sigue a un `--reanudar` cuyo `SIGUE:` ya es el cierre |

Lo que pasa del primer `--paso 7` en adelante es la lectura final del tramo, no una fase.

Casos, sin inventar números:

- **Lectura sin dato** (sin snapshot, roto o de más de 10 minutos) **en un cambio de paso:** las dos fases que toca (la que termina ahí y la que empieza) se unen en una sola, que se llama con las dos (`plan+aprobación`; con varias lecturas sin dato seguidas, `plan+aprobación+ejecución`). Su gasto es la diferencia entre las dos lecturas válidas de alrededor, sin repartirla: abarca varias fases y no se sabe cuánto es de cada una. La fase unida va en el orden de la primera de sus fases, y la suma de todas sigue siendo el total. Si la lectura sin dato es la primera del tramo, no tiene con quién unirse y su fase queda `s/d`.
- **Una ventana que falta** en una lectura: `s/d` solo en esa ventana.
- **Reinicio entre dos lecturas** (bajó el %, la lectura es posterior al `resetsAt` anterior, o el `resetsAt` cambió más de un minuto, como en el total): esa fase de esa ventana da la **cota mínima**, el % de la lectura final (tras el reinicio se gastó al menos eso), y sale con `≥+`. Las demás fases conservan su número.
- **Reanudar en otra cuenta:** como en el total, cada tramo resta lecturas de su propia cuenta y las fases suman % de ventanas distintas.
- **Flujos empezados antes de la 0.5.1** (tramos sin `fases`): `LÍMITES POR FASE: s/d (el flujo empezó sin lecturas por fase)` y la fila no lleva `fases`.

Invariante (lo comprueba `costos.test.mjs`): con todas las lecturas válidas y sin reinicio, la suma de las fases de cada ventana es el gasto total de `LÍMITES:`, porque las restas por fase se encadenan de la lectura inicial a la final de cada tramo.

Qué no puede decir el desglose:

1. **Retraso de hasta un punto, no de una fase.** El snapshot no se mueve solo con el hilo principal: según los tipos del motor, `session.measure` también llega cuando una ventana sube un punto entero, con los límites de la última respuesta de la API. Comprobado en esta máquina el 2026-11-10: con el hilo principal parado (su transcript sin cambios desde las 15:08:45 UTC) mientras un solo subagente trabajaba, `qcc-limites.json` pasó de 30 a 31 a las 15:11:16 y llegó a 36 a las 15:17:35, sin otra sesión activa de esa cuenta en esta máquina. O sea que lo gastado por los subagentes sí llega al snapshot mientras corren, y cada fase de subagentes queda en su fase. Lo que no está escrito es si la API cuenta el % de los subagentes igual que el del hilo principal; eso no se pudo comprobar aparte. Lo que sí se corre a la fase siguiente es lo que todavía no sumó un punto entero en el momento de la lectura: hasta casi 1 punto por ventana y por límite de fase.
2. **Resolución.** El % llega con a lo sumo un decimal, y en la máquina de arriba llegó entero (30, 31… 36); durante el flujo el snapshot cambia de a un punto entero. Una fase corta (`aprobación`, a veces `exploración` en un pedido chico) puede salir `+0 %` o llevarse el punto que otra empezó. Mira promedios de varios flujos, no una fase suelta.
3. **Por rol, no.** La fuente da un solo % por ventana para toda la cuenta: la fase `ejecución` incluye al orquestador y a los ejecutores juntos, y el orquestador está en todas las fases. Para el reparto por rol siguen los tokens por rol de la fila (`costo.roles.<rol>.tokens`, sección 4).
4. **Espera larga en la aprobación.** Durante la pregunta «Plan» nadie gasta, el snapshot no se reescribe y puede pasar de 10 minutos. Si el `--aprobado` lo lee así, sale sin dato y `plan` y `aprobación` salen unidas como `plan+aprobación` en ese flujo (el total no se ve afectado, porque la lectura final se toma después). No se toma un snapshot viejo como válido porque no se puede distinguir de un panel que dejó de correr.

### La espera por el límite de 5 h no es tiempo activo

Cuando la ventana de 5 h se agota, Claude Code avisa en el transcript («You've hit your … limit») y la sesión queda parada hasta el reinicio. Ese tramo no es trabajo: `costos.mjs` lo resta del tiempo activo y de la fase en que cae, y lo suma a `espera`. Es una espera del hilo principal o de un subagente: del aviso (una entrada que no es del usuario: un mensaje del usuario o un resultado de herramienta que lo citen no abren nada) a la primera entrada posterior con «limit has reset» o, si no llega, al siguiente mensaje del usuario del hilo principal. Si un subagente muere en el límite sin reinicio, cierra en ese mensaje del usuario (o en su última entrada si no hay ninguno); solo el hilo principal sin cierre llega hasta el final del tramo. Se une con las otras esperas (`AskUserQuestion` y turno cerrado con texto) sin contar dos veces lo que se solapa: el aviso suele cerrar un turno con texto, que ya era una espera.

**Riesgo, formato no confirmado:** el texto real del aviso no se verificó contra un transcript. Se asumió que una entrada cuyo texto contiene «You've hit your» y «limit» abre la espera, y que «limit has reset» la cierra. Si el formato real es otro, la espera no se resta (el tiempo queda como activo) hasta ajustar `esperasDeLimite` en `costos.mjs` y su test.

### La fila de `flujos.jsonl`

```json
"limites": {
  "five_hour": { "gasto": 12 },
  "seven_day": { "gasto": 4, "incompleto": true },
  "fases": [
    { "fase": "exploración", "five_hour": { "gasto": 2 }, "seven_day": { "gasto": 4, "incompleto": true } },
    { "fase": "plan+aprobación", "five_hour": { "gasto": 3 }, "seven_day": { "gasto": 0.5 } },
    { "fase": "ejecución", "five_hour": { "gasto": 7, "incompleto": true }, "seven_day": { "gasto": 1 } }
  ],
  "tramos": [
    {
      "inicio": { "t": "…", "cuenta": ".claude-cuenta1", "edad": 20, "five_hour": { "pct": 40, "resetsAt": "…" }, "seven_day": { "pct": 10, "resetsAt": "…" } },
      "fases": [
        { "paso": 0, "t": "…", "cuenta": ".claude-cuenta1", "edad": 20, "five_hour": { "pct": 40, "resetsAt": "…" }, "seven_day": { "pct": 10, "resetsAt": "…" } },
        { "paso": 2, "t": "…", "cuenta": ".claude-cuenta1", "edad": 700, "sinDato": "snapshot viejo" }
      ],
      "fin":    { "t": "…", "cuenta": ".claude-cuenta1", "edad": 15, "five_hour": { "pct": 45, "resetsAt": "…" }, "seven_day": { "pct": 12, "resetsAt": "…" } }
    }
  ]
}
```

(Las cifras de este bloque son de ejemplo, no de un flujo real, y no cuadran entre sí.)

- `gasto`: la suma, por tramo, de `fin.pct − inicio.pct`, redondeada a 0,1.
- `incompleto: true`: a algún tramo le faltó dato o se reinició (de un reinicio entra la cota mínima, el % de su lectura final); el gasto es una cota inferior. Sale `≥+`.
- `gasto: null` con `motivo: "sin dato"`: ninguna lectura sirvió. Un reinicio ya no da `null`: da la cota mínima con `incompleto`. Las filas viejas con `motivo: "reinicio"` se siguen leyendo y `resumenDeLimites` las muestra como `reinicio`.
- `fases`: el gasto de cada fase, en el orden de `FASES` (una fase unida, `plan+aprobación`, va tras la primera de sus fases), con las mismas marcas (`gasto`, `incompleto`, `motivo`); solo las fases que tuvieron alguna lectura. Falta en los flujos empezados antes de la 0.5.1.
- `tramos`: las lecturas crudas (hora, cuenta, antigüedad en segundos, `pct` y `resetsAt` de cada ventana), o `sinDato: <motivo>` en vez de las ventanas; `tramos[].fases`, las lecturas por fase con su `paso` (la primera es la `inicio`).

**Reinicio de ventana:** la resta de un tramo no vale para una ventana si el % bajó, si la lectura final es posterior al `resetsAt` de la inicial o si el `resetsAt` cambió más de un minuto. En ese caso no se inventa un número negativo: se anota la cota mínima, el % de la lectura final (tras el reinicio se gastó al menos eso), con `incompleto: true`.

Un flujo reanudado en otra cuenta suma tramos de cuentas distintas (cada `tramo` dice su `cuenta`): el total es la suma de % de ventanas distintas.

### Cómo se lee

```
node qcc-implementador/herramientas/costos.mjs --ultimos 10
```

Cada flujo trae `5h +X % · sem +Y %`; `≥+X %` si el gasto quedó incompleto (faltó dato o la ventana se reinició: es la cota mínima), `s/d` sin dato (también en las filas de antes de la 0.5.0) y `reinicio` solo en las filas viejas que lo anotaron así. Debajo, los flujos con desglose traen una línea `por fase:` con las mismas marcas; las filas sin desglose (las de antes de la 0.5.1) no imprimen nada más. El `PROMEDIO` final promedia cada ventana solo con los flujos de gasto completo y dice cuántos son: `5h +6,5 % (4)`.

Ejemplo de salida (cifras inventadas, solo para mostrar el formato):

```
FLUJOS (últimos 2 de 188):
  2026-11-12 10:05 · mi-repo · 31,0 min · 18,2M tokens (90 % caché) · … · 5h +11 % · sem +2 % · CRÍTICO (#1) · 3 subtarea(s) · final APROBADO · COMPLETO
    por fase: exploración: 5h +1 % · sem +0 % | plan: 5h +2 % · sem +0 % | aprobación: 5h +0 % · sem +0 % | ejecución: 5h +5 % · sem +1 % | revisión: 5h +3 % · sem +1 %
  2026-11-12 14:40 · mi-repo · 12,0 min · 6,1M tokens (88 % caché) · … · 5h +4 % · sem +1 % · sin criterios · 1 subtarea(s) · final APROBADO · COMPLETO
    por fase: exploración: 5h +1 % · sem +0 % | plan+aprobación: 5h +1 % · sem +0 % | ejecución: 5h +1 % · sem +0 % | revisión: 5h +1 % · sem +0 %
PROMEDIO: 21,5 min · orquestador 14,0 pedidos · 5h +7,5 % (2) · sem +1,5 % (2)
```

El cierre imprime lo mismo en `LÍMITES POR FASE:` (y el informe lo copia en `Límites por fase:`).

El historial del panel muestra `5h +N%` en la línea de cifras de cada flujo, solo si el gasto de 5 h está completo; el semanal, los `s/d` y el desglose por fase quedan para `costos.mjs` (el panel ignora `fases`).

## 4. Cómo medir qué rol consume más límite en tu cuenta

El % se mide por flujo y por fase, no por rol: la API da un solo porcentaje por ventana. Las fases ya separan bastante (`exploración` ≈ exploradores, `plan` ≈ planificador, `ejecución` ≈ ejecutores, `revisión` ≈ revisión final y sus correcciones), pero el orquestador está en todas. Para atribuirlo:

1. **Junta flujos con dato:** corre varios `/impl` con el panel abierto (que haya respondido al menos una vez) y mira que `costos.mjs --ultimos` no diga `s/d`.
2. **Compara con los tokens por rol** que ya trae cada fila (`costo.roles.<rol>.tokens`): un flujo con más tokens nuevos de ejecutor que otro y más `5h +%` apunta al ejecutor. Separa tokens nuevos (entrada, escritos y salida) de lectura de caché: según la estimación de terceros de arriba, la lectura pesaría mucho menos.
3. **Aísla un rol** cuando haga falta: dos flujos parecidos que solo difieran en un rol (por ejemplo, con más o menos exploradores) muestran la diferencia de % que pone ese rol.
4. **Contrasta con la medición en dólares de antes:** con `costos.mjs`, los exploradores (Haiku) eran ~1–6 % del costo en flujos completos y 22–37 % en flujos cancelados con muchos exploradores; el ejecutor, ~40–55 %. Eso era en dólares y con precios de la API; el % real por corrida dirá si en límites pesa igual.

Con pocos flujos y porcentajes enteros el ruido es grande: conviene mirar promedios de varios flujos y no uno suelto.
