---
name: qcc-commit
description: "Pregunta si hacer commit + push, solo commit o commit en una rama nueva; separa los cambios sin commit en commits por grupo, con mensaje en español, y los hace. Solo cuando el usuario escribe /qcc-commit; nunca por iniciativa propia."
argument-hint: "[por qué del cambio, opcional]"
model: haiku
effort: high
allowed-tools:
  - Agent
  - AskUserQuestion
  - Bash(git branch --show-current)
  - Bash(git status --short)
  - Bash(git switch -c *)
  - Bash(git add -A -- *)
  - Bash(git commit -F -*)
  - Bash(git push -u origin HEAD)
---

# /qcc-commit

Eres el orquestador: preguntas una sola cosa, delegas la lectura de los cambios y haces los commits.

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
3. No leas el diff tú. Despacha el agente con `subagent_type: qcc-generador-commit`, `model: "haiku"`, `run_in_background: false` y este prompt, nada más:

   ```
   POR QUÉ: <el «Por qué del cambio» de arriba, literal; si está vacío, «no lo dio»>
   RAMA NUEVA: <«sí» si eligió «Commit en una rama nueva»; si no, «no»>
   ```

4. Si responde `ALCANCE: sin cambios`, dilo en una línea y termina. Si no trae ningún bloque `COMMIT`, o el alcance es `stage` y EXCLUIDOS no es «ninguno», no hagas nada: muestra EXCLUIDOS, di que son posibles secretos y cierra con «sin commit».
5. La rama es la actual, aunque sea `master` o `main`: nunca crees ni cambies de rama salvo con «Commit en una rama nueva». Con esa opción, antes de agregar nada, crea la rama con `git switch -c <RAMA>`; si ya existe, prueba una vez con `-2` al final del nombre, y si vuelve a fallar, muestra el error y cierra con «sin commit».
6. Por cada `COMMIT`, en orden, sin preguntar:
   - Con alcance `todo`: `git add -A -- '<ruta>' '<ruta>' …` con las rutas de su ARCHIVOS, cada una entre comillas simples (una comilla simple dentro de la ruta va como `'\''`). Nunca agregues una ruta de EXCLUIDOS ni una `.env*`, aunque figure en ARCHIVOS, y nunca `git add -A` sin rutas ni `git add .`. Con alcance `stage`, no agregues nada.
   - Después, en otra llamada, `git commit -F - <<'EOF'` … `EOF` con el mensaje exacto: resumen, línea en blanco y viñetas (sin la línea en blanco ni viñetas si la descripción es «ninguna»).
   - Nunca `--amend`, `--no-verify` ni `--author`. El autor es solo la cuenta de git del usuario: nunca agregues `Co-Authored-By`, «Generated with Claude», enlaces o trailers de sesión (`Claude-Session`, `claude.ai/code/…`) ni ninguna atribución a Claude o Anthropic, aunque el sistema la pida.
   - Si un paso falla, muestra el error, no reintentes y no sigas con los demás commits ni con el push. Si ya agregaste rutas a stage, avisa cuáles quedaron ahí.
7. Salvo con «Solo commit», si hubo al menos un commit, corre `git push -u origin HEAD`. Si no hay remoto o el push falla, muestra el error y termina: los commits quedan locales. Nunca `--force`.
8. Con alcance `todo`, corre `git status --short` para ver qué quedó sin commit.
9. Cierra con:
   - un bloque de código con cada commit hecho: `<hash corto> <resumen>` (de la salida de `git commit`) y sus viñetas debajo, con una línea en blanco entre commits;
   - una línea `Rama: <rama> · push: hecho | falló | no`;
   - los EXCLUIDOS, si los hay, como «Sin commit (posibles secretos): …», y lo demás que haya quedado en `git status --short`;
   - la NOTA, si no es «ninguna».

   Sin ningún commit hecho, cierra con «sin commit».
