# Reglas de /implementador para claude-config

Valen para `/implementador` en este repo. Mandan sobre `~/.claude/flujos/comun.md` y `plan.md`.

## Clasificación

CRÍTICO, además de lo que diga `plan.md` §2: una subtarea que toca alguna de estas rutas es `Crítica: sí`, y el plan cita su criterio.

| Ruta | Criterio | Por qué |
|---|---|---|
| `flujos/**` (skills, agentes, `estado.mjs`, `verificar.mjs`, `guardia.mjs`, `guardia.test.mjs`, `instalar.mjs`, `comun.md`, `plan.md`, `pasos.md`), salvo la excepción de abajo | #1 y #5 | `guardia.mjs` es la seguridad de los subagentes; lo demás lo usan todos los proyectos del usuario |
| `.claude/implementador.md`, `.claude/implementador.json` | #1 | reglas y config de este flujo (`guardia` en el JSON afloja o aprieta la guardia); solo si el pedido lo dice |
| `panel-uso/hooks/flujo.ts` | #6 | máquina de estado del flujo, tiempos y esperas |
| `panel-uso/hooks/register.tsx` | #7 | hooks que envuelven `next` (`tool.call`, `turn.step`, `turn.complete`, `skill.prompt`): un fallo frena una petición al modelo o una herramienta |

- **#6 además:** cualquier cambio en la forma de un atom que sobrevive a `/reload-plugins` (`flujo`, `filasExploradores`, y los tipos de `panel-uso/types/index.d.ts`). Un flujo guardado con la forma anterior sigue vivo tras recargar.
- **Excepción en `flujos/**`:** una subtarea cuyos archivos permitidos son solo `.md` de `flujos/agents/` o `flujos/herramientas/config.ejemplo.md` es `Crítica: no` si no cambia su frontmatter (herramientas, modelo); ante la duda, `sí`. Quedan siempre `Crítica: sí`: `comun.md`, `plan.md`, `pasos.md`, `SKILL.md` (tabla de overrides y líneas `!`), cualquier `.mjs`, `.claude/implementador.md` y `.claude/implementador.json`. La Clasificación del plan sigue citando #1 y #5 (el revisor del plan corre y la revisión final Opus tiene 2 ciclos).

Sin criterios: textos, colores y anchos del panel, funciones puras de `formato.ts` y `semana.ts` con tests, FLUJOS.md, MODS.md, README, AGENTS.md.

## Cómo buscar

- El mod entero son `panel-uso/hooks/*.ts(x)`, `panel-uso/types/index.d.ts` y un único `panel-uso/tests/panel.test.tsx` de más de 3000 líneas: léelo por tramos con Grep y `offset`, no entero.
- Los tipos de `claude-code` no están en el repo (no hay `node_modules`): no los busques; lo que haga cada evento está en MODS.md.
- Los flujos se editan en `flujos/` y se instalan en `~/.claude` con `node flujos/instalar.mjs`. No leas ni edites `~/.claude`: el repo es la fuente.
- **Acoplamientos (no se salta el explorador):** si el pedido toca uno de estos archivos, no vale la exploración mínima de `comun.md` §5; va el explorador.
  - `panel-uso/hooks/flujo.ts` ↔ `flujos/herramientas/pasos.md` y `comun.md` (orden de señales y marcas `--paso`).
  - `panel-uso/types/index.d.ts` ↔ los atoms de `panel-uso/hooks/register.tsx`.
  - `flujos/herramientas/estado.mjs` ↔ `guardia.mjs` y `verificar.mjs`.

## Plan

- Todo cambio visible sube `version` en `panel-uso/.claude-plugin/plugin.json` y actualiza MODS.md; es una subtarea de documentación, no un extra.
- Un campo nuevo en un atom es opcional, se lee con `?? 0` (o equivalente) y solo se escribe cuando hay algo que anotar: un valor neutro (`0`, `{}`, `null`) rompe los `toEqual` de los tests.
- Una subtarea que toca estado compartido entre hooks y además tests nuevos con el motor simulado se parte en lógica pura (`flujo.ts`, `semana.ts`, `formato.ts`) y dibujo (`register.tsx`).
- Queda para el usuario: la comprobación visual con `/reload-plugins` a 49 columnas (y a 32), y `node flujos/instalar.mjs` si cambió algo de `flujos/`.

## Ejecutor

- `claude plugin test panel-uso` corre todo en unos 10 s y solo acepta la carpeta (no filtra por nombre ni por archivo). NO lo corras antes de `verificar.mjs`: ve primero a `verificar.mjs` (sin tubería), que ya incluye validate, test y test flujos con salida resumida. Usa el patrón de abajo solo si el paso `test` de `verificar.mjs` sale ROJO y su detalle no alcanza para entender el fallo. Córrelo siempre con Bash (no PowerShell) y con este patrón exacto:

  ```
  claude plugin test panel-uso 2>&1 | grep -vE '^\(pass\)' | tail -n 150
  ```

  Quedan la cabecera `tests\panel.test.tsx:`, cada `(fail)` con su error entero y el resumen (` N pass`, ` N fail`, `Ran N tests…`). El éxito se lee en ` N fail`, no en el código de salida (es el de `tail`). Si un error queda cortado, repite con `tail -n 400`. Nunca sin filtro ni a un archivo. `verificar.mjs` se corre sin tubería.
- Estilo de AGENTS.md: español, sin punto y coma, comillas simples, JSDoc breve y línea en blanco antes de `return` en `panel-uso/`.

## Revisor: rechaza también por

- Un atom o un tipo que cambia de forma sin tolerar la forma anterior (flujos de las versiones 0.9.3 en adelante siguen vivos tras `/reload-plugins`).
- Un test existente relajado o convertido para que pase (`toEqual` → `toMatchObject`, un assert acotado a algo que ya no comprueba lo mismo).
- Un hook que traga o cambia el error de `next`, o que puede frenar la petición al modelo.
- Un cambio visible sin subir `version` o sin tocar MODS.md.
