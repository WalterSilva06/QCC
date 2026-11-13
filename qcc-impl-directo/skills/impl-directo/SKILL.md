---
name: impl-directo
description: "Flujo /impl-directo: sin plan ni aprobación; explora con Haiku, la sesión implementa (Opus medium), verifica y cierra con una revisión independiente (Opus high). Solo cuando el usuario escribe /impl-directo; nunca por iniciativa propia."
argument-hint: "<qué cambiar>"
model: opus
effort: medium
allowed-tools:
  - Read
  - Glob
  - Grep
  - Edit
  - Write
  - Agent
  - AskUserQuestion
  - Bash(git status*)
  - Bash(git diff*)
  - Bash(git log*)
---

# /impl-directo

Implementas tú el pedido, sin planificador, plan ni aprobación. La exploración y la revisión van a subagentes: lo que lees tú se paga en cada pedido.

**Pedido:** $ARGUMENTS

**Sucios previos** (no son del cambio): !`git status --short`

## 0. Preflight

- Pedido vacío → responde `Uso: /impl-directo <qué cambiar>` y termina. Si no pide cambios (revisar, analizar, auditar), dilo y termina.
- Si tu herramienta Agent no tiene el parámetro `run_in_background`, fork mode está activo y la revisión perdería Opus: dilo (se apaga con `"CLAUDE_CODE_FORK_SUBAGENT": "0"` en `env` de `~/.claude/settings.json`, reiniciando Claude Code) y termina.
- **Verificación:** los `cmd` de `verificar` en `.claude/qcc-implementador.json` (si no existe, `.claude/implementador.json`); sin ese archivo, los comandos de verificación del CLAUDE.md o AGENTS.md del proyecto. Sin ninguno, AskUserQuestion qué comandos verifican el proyecto, o seguir solo con revisión.
- **Reglas del proyecto:** carpeta `.claude/qcc-implementador/` (respaldo `.claude/implementador/`): tú lees `planificar.md` y `ejecutor.md`, el explorador recibe `buscar.md` y el revisor `revisor.md`. Con un archivo `.claude/qcc-implementador.md` (respaldo `.claude/implementador.md`), ese archivo para todos. Mandan junto con el CLAUDE.md.

## 1. Exploración

Agent `Explore` con `model: "haiku"`, `effort: "low"` y `run_in_background: false`: uno por área del pedido, sin solapar, hasta 4 en un mismo mensaje. Si el pedido nombra los archivos y son pocos, sin exploración: los lees tú. El prompt, nada más:

```
PEDIDO: <literal>
ÁREA: <carpetas o archivos>
REGLAS: <ruta de buscar.md o de .claude/qcc-implementador.md | ninguna>
Ubica lo que toca el pedido; no propongas cómo implementarlo. No leas node_modules/, dist/, .git/ ni .env*. Responde ≤ 20 líneas, cada una `ruta:línea — hecho`, en ARCHIVOS, TESTS (los que cubren lo que cambia), ACOPLAMIENTOS (tipos, espejos, guardianes y documentación que cambian junto) y DUDAS.
```

## 2. Implementación

- Editas tú. Un test por cada camino público nuevo o cambiado; la documentación que el cambio deja vieja, según las reglas del proyecto.
- Nunca git que escriba (commit, add, stash, checkout, reset, push), ni `.env*`. AskUserQuestion antes de un comando irreversible o externo (migración, deploy, borrado, servicio vivo); si no se aprueba, va a «Queda para ti».

## 3. Verificación

- Cada comando en su propia llamada a Bash, con `timeout: 600000`; los que llevan `rutas`, solo si el cambio toca alguna; los `paralelo: true`, juntos en un mismo mensaje.
- ROJO por el cambio → corriges. Si tras 2 correcciones sigue ROJO, cierras `DETENIDO` sin revisión. Un fallo ajeno al cambio no se corrige: va a la revisión como «ya fallaba», con su motivo.
- No declaras éxito sin un VERDE posterior al último cambio.

## 4. Revisión

Agent `impl-directo:qcc-revisor-directo`, sin overrides y con `run_in_background: false`. El prompt, nada más:

```
PEDIDO: <literal>
REGLAS: <ruta de revisor.md o de .claude/qcc-implementador.md | ninguna>
SUCIOS PREVIOS: <los de arriba | ninguno>
VERIFICACIÓN: <una línea por comando: VERDE | ROJO (ya fallaba: motivo) | SIN PASOS>
NOTAS: <lo que decidiste y lo que no hiciste, ≤ 5 líneas | ninguna>
```

- RECHAZADO → corriges solo sus PROBLEMAS, verificas de nuevo y lanzas otro revisor con el mismo prompt más `REVISIÓN ANTERIOR: <su reporte>`. Hasta 2 ciclos: un segundo RECHAZADO cierra `DETENIDO` con los problemas abiertos.
- Las OBSERVACIONES no se corrigen: van a «Riesgos pendientes». Un revisor sin `VEREDICTO` se relanza una vez.

## 5. Cierre

```
Resultado: COMPLETO | DETENIDO (<motivo>)
Cambios: <ruta — qué>, una por línea
Verificación: <resultado por comando>
Revisión: APROBADO en ciclo <n> | RECHAZADO (<problemas abiertos>) | sin revisión
Riesgos pendientes: <OBSERVACIONES | ninguno>
Queda para ti: <`! <comando>  # requiere …`, una por línea | nada>
```
