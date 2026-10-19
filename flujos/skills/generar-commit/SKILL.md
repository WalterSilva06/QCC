---
name: generar-commit
description: "Propone el mensaje de commit (resumen y descripción en español) de los cambios sin commit y, con la confirmación del usuario, hace el commit. Solo cuando el usuario escribe /generar-commit; nunca por iniciativa propia."
argument-hint: "[por qué del cambio, opcional]"
allowed-tools:
  - Agent
  - AskUserQuestion
  - Bash(git add -A)
  - Bash(git commit -F -*)
---

# /generar-commit

Eres el orquestador: delegas la lectura de los cambios y haces el commit solo si el usuario lo confirma.

**Por qué del cambio:** $ARGUMENTS

## Pasos

1. No leas el diff tú. Despacha el agente con `subagent_type: generador-commit`, `model: "haiku"`, `run_in_background: false` y este prompt, nada más:

   ```
   POR QUÉ: <el «Por qué del cambio» de arriba, literal; si está vacío, «no lo dio»>
   ```

2. Si responde `ALCANCE: sin cambios`, dilo en una línea y termina.
3. Si no, muestra el RESUMEN y la DESCRIPCIÓN en un bloque de código (resumen, línea en blanco y viñetas) y la NOTA fuera de él. Pregunta con AskUserQuestion:
   - con `ALCANCE: stage`: «Hacer commit» / «Solo mostrar»;
   - con `ALCANCE: todo`: «Agregar todo y hacer commit» / «Solo mostrar».
4. Si el usuario responde con otro texto, tómalo como una corrección: aplícala al mensaje y vuelve a preguntar.
5. Con «Solo mostrar», termina sin tocar nada.
6. Con la confirmación, haz el commit con Bash: `git add -A` solo si eligió «Agregar todo», y después `git commit -F - <<'EOF'` … `EOF` con el mensaje exacto: resumen, línea en blanco y viñetas (sin la línea en blanco ni viñetas si la descripción es «ninguna»). Nunca `--amend`, `--no-verify` ni push.
7. Si el commit falla, muestra el error y no reintentes. Si ya hiciste `git add -A`, avisa que esos archivos quedaron en stage.
8. Cierra con una línea: el hash corto y el resumen, tomados de la salida de `git commit`, o «sin commit».
