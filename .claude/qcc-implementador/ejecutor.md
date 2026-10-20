## Ejecutor

- `claude plugin test qcc-panel` corre todo en unos 10 s y solo acepta la carpeta (no filtra por nombre ni por archivo). NO lo corras antes de `verificar.mjs`: ve primero a `verificar.mjs` (sin tubería), que ya incluye validate, test y test flujos con salida resumida. Usa el patrón de abajo solo si el paso `test` de `verificar.mjs` sale ROJO y su detalle no alcanza para entender el fallo. Córrelo siempre con Bash (no PowerShell) y con este patrón exacto:

  ```
  claude plugin test qcc-panel 2>&1 | grep -vE '^\(pass\)' | tail -n 150
  ```

  Quedan la cabecera `tests\panel.test.tsx:`, cada `(fail)` con su error entero y el resumen (` N pass`, ` N fail`, `Ran N tests…`). El éxito se lee en ` N fail`, no en el código de salida (es el de `tail`). Si un error queda cortado, repite con `tail -n 400`. Nunca sin filtro ni a un archivo. `verificar.mjs` se corre sin tubería.
- Estilo de AGENTS.md: español, sin punto y coma, comillas simples, JSDoc breve y línea en blanco antes de `return` en `qcc-panel/`.
