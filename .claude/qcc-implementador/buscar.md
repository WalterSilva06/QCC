## Cómo buscar

- El mod entero son `qcc-panel/hooks/*.ts(x)`, `qcc-panel/types/index.d.ts` y un único `qcc-panel/tests/panel.test.tsx` de más de 6000 líneas: léelo por tramos con Grep y `offset`, no entero.
- Los tipos de `claude-code` no están en el repo (no hay `node_modules`): no los busques; lo que haga cada evento está en MODS.md.
- Los flujos se editan en `qcc-implementador/` y `qcc-commit/` y se instalan en `~/.claude` con `node qcc-implementador/instalar.mjs` (también instala `qcc-commit/`). No leas ni edites `~/.claude`: el repo es la fuente.
- **Acoplamientos:** si el pedido toca uno de estos archivos, revisa también su pareja y repórtala en ACOPLAMIENTOS.
  - `qcc-panel/hooks/flujo.ts` ↔ `qcc-implementador/herramientas/pasos.md` y `comun.md` (orden de señales y marcas `--paso`).
  - `qcc-panel/types/index.d.ts` ↔ los atoms de `qcc-panel/hooks/register.tsx`.
  - `qcc-implementador/herramientas/estado.mjs` ↔ `guardia.mjs` y `verificar.mjs`.
