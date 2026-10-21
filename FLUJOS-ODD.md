# /qcc-implementador-odd

Flujo en prueba, para compararlo con `/qcc-implementador` en tareas reales. Vive en `flujos-odd/` y está **separado por completo** de `flujos/`: tiene su skill, sus agentes, sus herramientas, su instalador, su config por proyecto y su registro. No usa ningún archivo de `/qcc-implementador`, y `/qcc-implementador` no usa ninguno suyo. Las reglas generales del repo están en [AGENTS.md](AGENTS.md).

Toma las ideas del ODD (Organic Driven Development) de [gentle-ai](https://github.com/Gentleman-Programming/gentle-ai) en una versión lite, enfocada en calidad y en ahorrar tokens.

## Principio

El orquestador trabaja inline. Un subagente se lanza solo por un motivo nombrado, porque relee todo desde cero y eso cuesta tokens. La cantidad de archivos, de líneas o de tests nunca lanza uno.

| Rol | Modelo · esfuerzo | Solo cuando |
|---|---|---|
| Orquestador (la skill), que también implementa | Sonnet · high | siempre |
| `qcc-odd-explorador` | Haiku · high | entender pide más de una tanda de lectura (≤ 3 llamadas, ~10k tokens) o más de ~5 búsquedas seguidas |
| `qcc-odd-ejecutor` | Sonnet · high | 2 o más unidades independientes de más de ~100 líneas, en paralelo; o el contexto pasa ~150k tokens |
| `qcc-odd-revisor` | Opus · high | el cambio toca un ítem de riesgo |

## Fases

1. **Inicio:** `odd.mjs --inicio`. Un pedido de solo investigar o explicar se responde sin editar.
2. **Explorar:** inline, o con el explorador. Una decisión de producto abierta se pregunta una vez. Termina con dos decisiones:
   - **Tamaño:** `chico` si se puede retomar solo con el pedido y el `git diff`; `grande` si no.
   - **Riesgo:** los 6 ítems de la skill (datos o irreversible, seguridad, contratos que otros consumen, concurrencia, entrega o entorno, sin tests), más los `criticos` del proyecto.
3. **Implementar:** inline, test-first cuando hay runner. Una tarea grande lleva primero `odd/tasks/<feature>.md` en el repo del proyecto:
   - `## Specs` con `S#` que citan literal el pedido;
   - `## Tasks`;
   - `## Log`, donde `L1` es el pedido textual.

   Ese documento permite retomar la tarea en otra sesión.
4. **Revisar:** `verificar.mjs` una vez, un autochequeo sobre `odd.mjs --diff` y la línea `Riesgo:`. El revisor corre solo con un ítem nombrado. Sus correcciones:
   - un lote que corrige todos los problemas;
   - un rechequeo limitado a esos problemas;
   - una segunda corrección, solo si el mismo problema sigue fallando.

   Lo nuevo que aparezca, y lo que siga abierto, va a «Para decidir».
5. **Cierre:** `odd.mjs --cierre` y el reporte. No hace commits (para eso, `/qcc-commit`).

No tiene aprobación del plan, ni planificador, ni revisor del plan, ni candado, ni fotos por subtarea.

## Herramientas

Se instalan en `~/.claude/flujos-odd/`. La skill y los agentes las llaman por esa ruta.

- **`odd.mjs`:**
  - `--inicio` toma la foto base como commit suelto y la imprime como `ODD_BASE=<sha>`. Además muestra rama, sucios previos, `criticos`, pasos de verificación y los `odd/tasks/*.md` con tareas abiertas.
  - `--diff <BASE> [-- <rutas>]` da el cambio contra una foto nueva, archivos nuevos incluidos, recortado a 400 líneas.
  - `--cierre` anota la corrida en `registros/odd.jsonl` con su costo.
  - `--ultimos [n]` lista las últimas corridas con el promedio de costo y de minutos.
- **`verificar.mjs`:**
  - corre los pasos de `verificar` de la config, o los detecta (scripts de `package.json`, Cargo, Go o pytest);
  - corre todos aunque uno falle, con CI=1 y un tope por paso;
  - muestra una línea por paso y, solo de los que fallan, las últimas 60 líneas;
  - no tiene caché.
- **`guardia.mjs`:** hook `PreToolUse` de `qcc-odd-ejecutor` y `qcc-odd-revisor`.
  - **Niega:**
    - git que modifica o habla con el remoto;
    - instalar o quitar dependencias;
    - red;
    - borrados recursivos;
    - secretos (`.env*`, salvo `.example`, `.sample` y `.template`);
    - servidores y modos watch;
    - escribir `.git/`, `.claude/settings*.json`, `.claude/agents/`, lockfiles o fuera del repo.
  - **Al revisor,** además, escribir fuera del temporal. No expande `$(…)`, así que pide rutas temporales escritas a mano.
  - **Es lite a propósito:** ante la duda deja pasar, y un error propio nunca niega.
  - Lo que el orquestador edita inline no pasa por la guardia: queda bajo el modo de permisos del usuario.
- **`costo.mjs`:** busca en los transcripts la sesión que recibió `ODD_BASE=<sha>` y suma el costo del orquestador y de cada agente, por rol, con los precios oficiales de octubre de 2026.

Los tests de todo están en `flujos-odd/herramientas/odd.test.mjs`.

## Configurar un proyecto

Todo es opcional. Sin config, `verificar.mjs` detecta los pasos y no hay críticos propios.

`.claude/qcc-implementador-odd.json`:

```jsonc
{
  // Pasos de verificación, en orden, desde la raíz del repo. Con [] el proyecto queda «SIN PASOS».
  // timeoutSeg (opcional): tope en segundos, 600 por defecto.
  "verificar": [
    { "nombre": "typecheck", "cmd": "pnpm run typecheck" },
    { "nombre": "test", "cmd": "pnpm run test", "timeoutSeg": 300 }
  ],
  // Rutas que cuentan como riesgo. riesgo: ítems 1–6 de la skill; si: condición; excepto: rutas que no cuentan.
  "criticos": [
    { "rutas": ["src/auth/"], "excepto": ["src/auth/textos.ts"], "riesgo": [2], "motivo": "autorización" },
    { "rutas": ["supabase/migrations/"], "riesgo": [1], "motivo": "esquema de la base" }
  ]
}
```

La config de este repo está en `.claude/qcc-implementador-odd.json`.

## Instalación

```
node flujos-odd/instalar.mjs              copia a ~/.claude lo que cambió
node flujos-odd/instalar.mjs --revisar    muestra qué cambiaría, sin copiar
node flujos-odd/instalar.mjs --traer      trae al repo lo que se editó directo en ~/.claude
node flujos-odd/instalar.mjs --forzar     pisa la copia instalada aunque sea más nueva
```

Copia `skills/` a `~/.claude/skills/`, `agents/` a `~/.claude/agents/` y `herramientas/` a `~/.claude/flujos-odd/`.
- **Copia editada:** si una copia instalada es distinta y más nueva que la del repo, se editó en `~/.claude`. El instalador la frena y termina con exit 1.
- **Nunca borra** y no toca `~/.claude/flujos-odd/registros/`.
- El flujo corre desde la copia instalada: un cambio en `flujos-odd/` no rige hasta instalarlo.

## Comparar con /qcc-implementador

```
node ~/.claude/flujos-odd/odd.mjs --ultimos 10
node ~/.claude/flujos/costos.mjs --ultimos 10
```

## Pendiente

El panel no sigue este flujo: ni sus fases en vivo ni su historial, porque `qcc-panel` solo lee `/qcc-implementador` y su `flujos.jsonl`.
