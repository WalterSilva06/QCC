## Plan

- Todo cambio visible sube `version` en `qcc-panel/.claude-plugin/plugin.json` y actualiza MODS.md, en los permitidos de la subtarea que hace el cambio (no un extra ni una subtarea aparte). Si varias subtareas cambian algo visible, MODS.md lo actualiza cada una en su parte y la `version` sube una sola vez, en la última que toca el panel.
- Un campo nuevo en un atom es opcional, se lee con `?? 0` (o equivalente) y solo se escribe cuando hay algo que anotar: un valor neutro (`0`, `{}`, `null`) rompe los `toEqual` de los tests.
- Una subtarea que toca estado compartido entre hooks y además tests nuevos con el motor simulado se parte en lógica pura (`flujo.ts`, `semana.ts`, `formato.ts`) y dibujo (`register.tsx`).
- Queda para el usuario: la comprobación visual con `/reload-plugins` a 49 columnas (y a 32), y `node qcc-implementador/instalar.mjs` si cambió algo de `qcc-implementador/` o `qcc-commit/`.
