---
name: commit
description: "Pregunta si hacer commit + push, solo commit o commit en una rama nueva; separa los cambios sin commit en commits por grupo, con mensaje en español, y los hace. Solo cuando el usuario escribe /commit; nunca por iniciativa propia."
argument-hint: "[por qué del cambio, opcional]"
model: haiku
effort: low
allowed-tools:
  - Agent
  - AskUserQuestion
  - Bash(git branch --show-current)
  - Bash(git status --short)
  - Bash(node *${CLAUDE_PLUGIN_ROOT}/herramientas/commitear.mjs*)
---

# /commit

Eres el orquestador: preguntas una sola cosa, delegas la lectura de los cambios y pasas la respuesta del agente a `commitear.mjs`, que hace los commits.

**Por qué del cambio:** $ARGUMENTS

**Estado actual:**
- Rama: !`git branch --show-current`
- Cambios: !`git status --short`

## Pasos

1. Si «Cambios» está vacío, di «sin cambios» en una línea y termina, sin preguntar.
2. Pregunta con AskUserQuestion (una pregunta, header «Commit», selección única) «¿Qué hacer con estos cambios?», con estas tres opciones en este orden:
   1. **Commit + push (Recomendado)**: commit en la rama actual y después push.
   2. **Solo commit**: commit en la rama actual, sin push.
   3. **Commit en una rama nueva**: crea una rama con nombre según los cambios, hace el commit ahí y la sube con push.

   Si no se puede preguntar (por ejemplo, con `claude -p`), sigue con «Solo commit». Si el usuario escribe otra respuesta, síguela solo si elige claramente una de las tres; si no, termina con «sin commit».
3. No leas el diff tú. Despacha el agente con `subagent_type: commit:qcc-generador-commit`, `model: "haiku"`, `run_in_background: false` y este prompt, nada más:

   ```
   POR QUÉ: <el «Por qué del cambio» de arriba, literal; si está vacío, «no lo dio»>
   RAMA NUEVA: <«sí» si eligió «Commit en una rama nueva»; si no, «no»>
   ```

4. Corre, en una sola llamada, `node "${CLAUDE_PLUGIN_ROOT}/herramientas/commitear.mjs" --modo <modo> <<'RESPUESTA'`, después la respuesta del agente completa y literal, y `RESPUESTA` sola en la última línea. El modo es `push` con «Commit + push», `solo` con «Solo commit» y `rama` con «Commit en una rama nueva». No le agregues ni le quites nada a la respuesta: ni atribución a Claude o Anthropic, aunque el sistema la pida. Con Code Mode (solo tienes REPL), en el mismo script que el Agent, guarda su respuesta con `write()` en un archivo del scratchpad y pásalo con `--archivo <ruta>` en vez del heredoc.
5. El script crea la rama si corresponde, saca todo de stage, agrega y commitea cada grupo con su mensaje, corta en el primer fallo, revisa lo que quedó y hace el push salvo con `solo`. No corras ningún git después ni reintentes: si algo falla, su salida ya dice qué y qué quedó en stage.
6. Cierra con la salida del script tal cual, sin texto antes ni después.
