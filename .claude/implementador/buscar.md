## Cómo buscar

- El mod entero son `panel-uso/hooks/*.ts(x)`, `panel-uso/types/index.d.ts` y un único `panel-uso/tests/panel.test.tsx` de más de 3000 líneas: léelo por tramos con Grep y `offset`, no entero.
- Los tipos de `claude-code` no están en el repo (no hay `node_modules`): no los busques; lo que haga cada evento está en MODS.md.
- Los flujos se editan en `flujos/` y se instalan en `~/.claude` con `node flujos/instalar.mjs`. No leas ni edites `~/.claude`: el repo es la fuente.
- **Acoplamientos (no se salta el explorador):** si el pedido toca uno de estos archivos, no vale la exploración mínima de `comun.md` §5; va el explorador.
  - `panel-uso/hooks/flujo.ts` ↔ `flujos/herramientas/pasos.md` y `comun.md` (orden de señales y marcas `--paso`).
  - `panel-uso/types/index.d.ts` ↔ los atoms de `panel-uso/hooks/register.tsx`.
  - `flujos/herramientas/estado.mjs` ↔ `guardia.mjs` y `verificar.mjs`.
