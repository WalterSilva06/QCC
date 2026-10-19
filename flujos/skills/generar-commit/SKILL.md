---
name: generar-commit
description: "Genera el mensaje de commit (resumen y descripción en español) de los cambios sin commit y hace el commit sin preguntar. Solo cuando el usuario escribe /generar-commit; nunca por iniciativa propia."
argument-hint: "[por qué del cambio, opcional]"
model: haiku
effort: high
allowed-tools:
  - Agent
  - Bash(git add -A)
  - Bash(git commit -F -*)
---

# /generar-commit

Eres el orquestador: delegas la lectura de los cambios y haces el commit sin preguntar al usuario.

**Por qué del cambio:** $ARGUMENTS

## Pasos

1. No leas el diff tú. Despacha el agente con `subagent_type: generador-commit`, `model: "haiku"`, `run_in_background: false` y este prompt, nada más:

   ```
   POR QUÉ: <el «Por qué del cambio» de arriba, literal; si está vacío, «no lo dio»>
   ```

2. Si responde `ALCANCE: sin cambios`, dilo en una línea y termina.
3. Si la NOTA nombra archivos con aspecto de secreto y el alcance es `todo`, no hagas el commit: muestra la NOTA, di que no se agregó nada y cierra con «sin commit».
4. Si no, haz el commit con Bash, sin preguntar: `git add -A` solo con `ALCANCE: todo`, y después `git commit -F - <<'EOF'` … `EOF` con el mensaje exacto: resumen, línea en blanco y viñetas (sin la línea en blanco ni viñetas si la descripción es «ninguna»). Nunca `--amend`, `--no-verify` ni push.
5. Si el commit falla, muestra el error y no reintentes. Si ya hiciste `git add -A`, avisa que esos archivos quedaron en stage.
6. Cierra con el mensaje en un bloque de código, la NOTA fuera de él si no es «ninguna», y una línea con el hash corto y el resumen, tomados de la salida de `git commit`, o «sin commit».
