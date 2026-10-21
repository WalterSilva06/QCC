# /qcc-implementador-odd

Flujo en prueba, para compararlo con `/qcc-implementador` en tareas reales. Vive en `flujos-odd/` y está **separado por completo** de `flujos/`: tiene su skill, sus agentes, sus herramientas, su instalador, su config por proyecto y su registro. No usa ningún archivo de `/qcc-implementador`, y `/qcc-implementador` no usa ninguno suyo. Las reglas generales del repo están en [AGENTS.md](AGENTS.md).

Toma las ideas del ODD (Organic Driven Development) de [gentle-ai](https://github.com/Gentleman-Programming/gentle-ai) en una versión lite, enfocada en calidad y en ahorrar tokens.

## Principio

El orquestador trabaja inline. Un subagente se lanza solo por un motivo nombrado, porque relee todo desde cero y eso cuesta tokens. La cantidad de archivos, de líneas o de tests nunca lanza uno.

| Rol | Modelo · esfuerzo | Solo cuando |
|---|---|---|
| Orquestador (la skill), que también implementa | Sonnet · high | siempre |
| `qcc-odd-explorador` | Haiku · high | `explorar: siempre`; o un pedido que no nombra sus archivos en un repo de más de ~200 archivos de código, con más de ~8 reglas, más de ~5 archivos por leer, o que pide más de una tanda de lectura (≤ 3 llamadas, ~10k tokens). Nunca con `explorar: nunca` |
| `qcc-odd-ejecutor` | Sonnet · high | 2 o más unidades independientes de más de ~100 líneas, en paralelo; o una salida de `odd.mjs` dice `CONTEXTO` de más de 150k |
| `qcc-odd-revisor` | Opus · high | el cambio toca un ítem de riesgo |

## Fases

1. **Inicio:** `odd.mjs --inicio`. Un pedido de solo investigar o explicar se responde sin editar.
2. **Explorar:** inline, o con el explorador, que responde en ≤ 15 líneas con tramos `ruta:inicio-fin`, `USOS:` (cada llamador de una función compartida, candidato al ítem 3) y `TESTS:`. El orquestador lee solo esos tramos. Una decisión de producto abierta se pregunta una vez. Termina con `odd.mjs --plan`, que deja visibles dos decisiones:
   - **Tamaño:** `chico` si se puede retomar solo con el pedido y el `git diff`; `grande` si no.
   - **Riesgo:** los 6 ítems de la skill (datos o irreversible, seguridad, contratos que otros consumen, concurrencia, entrega o entorno, sin tests), más los `criticos` del proyecto, cada uno con `sí <motivo>` o `no`, y los bordes si hay alguno.
3. **Implementar:** inline, test-first cuando hay runner. Una tarea grande lleva primero `odd/tasks/<feature>.md` en el repo del proyecto:
   - `## Specs` con `S#` que citan literal el pedido;
   - `## Tasks`;
   - `## Log`, donde `L1` es el pedido textual.

   Ese documento permite retomar la tarea en otra sesión.
4. **Revisar:**
   - el formateador del proyecto, si hay, solo sobre lo tocado y antes de verificar;
   - `verificar.mjs` una vez, un autochequeo sobre `odd.mjs --diff` y la línea `Riesgo:`;
   - con ítem 3 por código compartido, un diferencial: el comando existente que comparte ese código corre en `odd.mjs --copia-base` y en el repo, y se comparan salida, errores y código de salida.

   El revisor corre solo con un ítem nombrado. Sus correcciones:
   - un lote que corrige todos los problemas, cada uno con un test que repite la reproducción del revisor;
   - un rechequeo limitado a esos problemas;
   - una segunda corrección, solo si el mismo problema sigue fallando.

   Lo nuevo que aparezca, y lo que siga abierto, va a «Para decidir».
5. **Cierre:** `odd.mjs --limpiar` con los temporales de la corrida, `odd.mjs --cierre` y el reporte, con su línea `PROCESO`. No hace commits (para eso, `/qcc-commit`).

No tiene aprobación del plan, ni planificador, ni revisor del plan, ni candado, ni fotos por subtarea.

## Herramientas

Se instalan en `~/.claude/flujos-odd/`. La skill y los agentes las llaman por esa ruta.

- **`odd.mjs`:**
  - `--inicio` toma la foto base como commit suelto y la imprime como `ODD_BASE=<sha>`. Además muestra rama, sucios previos, cuántos archivos de código hay y `explorar`, `criticos`, las reglas de la guardia del proyecto, pasos de verificación y los `odd/tasks/*.md` con tareas abiertas. Deja la marca de corrida abierta (`registros/activas/`), que activa la guardia del orquestador.
  - `--plan --base <BASE> --tamano chico|grande --reglas <n> --riesgo "1:sí <motivo>;2:no;…;6:no" [--bordes "…"]` imprime `TAMAÑO`, `RIESGO PREVISTO` y `BORDES`. Falta un ítem, un `sí` sin motivo o los bordes con algún `sí`: `ERROR` y código 2. Con más de 8 reglas y `chico`, avisa `AVISO: <n> reglas → grande`.
  - `--diff <BASE> [-- <rutas>]` da el cambio contra una foto nueva, archivos nuevos incluidos, recortado a 400 líneas.
  - `--cierre` borra la marca, anota la corrida en `registros/odd.jsonl` con su costo e imprime `PROCESO`: `ok`, o los desvíos que lee en el transcript (sin `--plan` o después de editar, ediciones por Bash, una edición después del último `verificar.mjs`, del último `--diff` o del diferencial, contexto de más de 150k sin ejecutor, lecturas con `cat`/`head`/`sed -n`). Lo que negó la guardia no cuenta.
  - `--plan`, `--diff` y `--cierre` imprimen `CONTEXTO: <n>k`, el del último pedido del orquestador. Pasados los 150k agregan `> 150k: lo que falta va a qcc-odd-ejecutor`.
  - `--ultimos [n]` lista las últimas corridas con el promedio de costo y de minutos. El costo es el real, hasta el siguiente mensaje del usuario (incluye el reporte), junto al anotado al cierre.
  - `--copia-base <BASE>` copia el árbol de la BASE en un temporal nuevo, sin tocar el índice del usuario, y lo imprime como `ODD_COPIA=<ruta>`. No trae lo ignorado (como `node_modules`).
  - `--limpiar -- <rutas>` borra las rutas que están dentro de un temporal, también en la forma `/tmp/…` de Git Bash. No borra el temporal mismo ni nada fuera de él: lo lista en `NO BORRADOS`.
- **`verificar.mjs`:**
  - corre los pasos de `verificar` de la config, o los detecta (scripts de `package.json`, Cargo, Go o pytest);
  - corre todos aunque uno falle, con CI=1 y un tope por paso;
  - muestra una línea por paso y, solo de los que fallan, las últimas 60 líneas;
  - no tiene caché.
- **`guardia.mjs`:** hook `PreToolUse` de `qcc-odd-ejecutor`, `qcc-odd-revisor` y la skill (rol `orquestador`).
  - **Niega:**
    - git que modifica o habla con el remoto;
    - instalar o quitar dependencias;
    - red;
    - borrados recursivos;
    - secretos (`.env*`, salvo `.example`, `.sample` y `.template`);
    - servidores y modos watch;
    - escribir `.git/`, `.claude/settings*.json`, `.claude/agents/`, lockfiles o fuera del repo;
    - las reglas del proyecto: escribir un `protegido`, editar un `inmutable` versionado y correr un `scriptsNegados`.
  - **Al revisor,** además, escribir fuera del temporal. No expande `$(…)`, así que pide rutas temporales escritas a mano.
  - **Al orquestador:** escribir en el repo por Bash o PowerShell (redirección, `sed -i`, `tee`, `cp`/`mv`, `Set-Content`, `Out-File`, o un script en línea o del temporal que escribe archivos), con el motivo `edita con Edit o Write`; y leer archivos del repo con `cat`, `head`, `tail`, `sed -n`, `Get-Content` o `type`, con el motivo `lee con Read (offset/limit) o Grep`. Las dependencias sí las instala, borra archivos sueltos y corre los scripts del proyecto. Un hook de skill sigue activo el resto de la sesión, así que este rol solo niega con una corrida abierta (la marca de `--inicio`, que borra `--cierre` y vence a las 12 h) y nunca dentro de un subagente.
  - **El cuerpo de un heredoc** es datos: no se evalúa como comandos. `=>`, `->` y `>=` no son redirecciones, ni un `>` entre comillas. Un shell anidado (`bash -c`, `cmd /c`, `powershell -Command`) se evalúa como un comando más. Las herramientas del flujo (`~/.claude*/flujos-odd/`) corren aunque escriban archivos.
  - **Es lite a propósito:** ante la duda deja pasar, y un error propio nunca niega.
- **`costo.mjs`:** busca en los transcripts la sesión que recibió `ODD_BASE=<sha>` y suma el costo del orquestador y de cada agente, por rol, con los precios oficiales de octubre de 2026. Da también el contexto actual del orquestador.
- **`proceso.mjs`:** lee las herramientas del orquestador en el transcript y arma la línea `PROCESO` de `--cierre`.

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
  // Cuándo se lanza el explorador: "siempre", "nunca" o, sin la clave, según el pedido y el repo.
  "explorar": "siempre",
  // Rutas que cuentan como riesgo. riesgo: ítems 1–6 de la skill; si: condición; excepto: rutas que no cuentan.
  "criticos": [
    { "rutas": ["src/auth/"], "excepto": ["src/auth/textos.ts"], "riesgo": [2], "motivo": "autorización" },
    { "rutas": ["supabase/migrations/"], "riesgo": [1], "motivo": "esquema de la base" }
  ],
  // Reglas de la guardia, para los tres roles. Mismo significado que en la config de /qcc-implementador:
  // una clave que falta acá se toma de .claude/qcc-implementador.json (o .claude/implementador.json).
  "guardia": {
    // Archivos, carpetas (con / final) o globs que no se escriben, con el motivo.
    "protegidos": { "src/routeTree.gen.ts": "lo regenera el build" },
    // Carpetas o globs cuyos archivos versionados no se editan (los nuevos sí).
    "inmutables": ["supabase/migrations/"],
    // Scripts del gestor JS que no se corren.
    "scriptsNegados": ["db:*", "flow:*"]
  }
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
