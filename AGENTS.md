# claude-config

Herramientas personales para Claude Code, en dos partes separadas:

- **`panel-uso/`**: mod (plugin) con un panel lateral que muestra el contexto de la sesión, los límites de uso, el esfuerzo y el consumo de tokens. Ver [MODS.md](MODS.md).
- **`flujos/`**: los flujos `/implementador`, `/implementador-ligero` y `/documentar`, con sus agentes y herramientas. Se instalan copiándolos a `~/.claude`. Ver [FLUJOS.md](FLUJOS.md).

[README.md](README.md) es la entrada al repo: resume la instalación y enlaza a todo.

## Estructura

```
README.md                         entrada al repo e índice
AGENTS.md                         reglas generales (este archivo)
MODS.md                           documentación del mod panel-uso
FLUJOS.md                         documentación de los flujos
.claude/implementador.json        pasos de verificación para /implementador
.claude/implementador.md          reglas de /implementador para este repo (clasificación, plan, revisor)
.claude/documentar.md             reglas de /documentar para este repo
.claude/documentar/cobertura.md   mapa de cobertura de la documentación
flujos/
  instalar.mjs                    copia los flujos a ~/.claude (o los trae con --traer)
  skills/<nombre>/SKILL.md        → ~/.claude/skills/<nombre>/SKILL.md
  agents/<nombre>.md              → ~/.claude/agents/<nombre>.md
  herramientas/                   → ~/.claude/flujos/ (estado, verificar, guardia, guardia.test, comun.md, config.ejemplo.md)
panel-uso/
  .claude-plugin/plugin.json      manifiesto (nombre, versión, types)
  .claude-plugin/marketplace.json marketplace «mods-locales»
  hooks/hooks.json                { "modules": ["./register.tsx"] }
  hooks/register.tsx              hooks, estado (atoms) y dibujo del panel
  hooks/semana.ts                 puro: registro de tokens por hora, resumen por modelo·esfuerzo
  hooks/formato.ts                puro: barras, cifras, tiempos, desglose del contexto
  hooks/carpeta.ts                puro: validar la ruta y elegir el comando que abre la carpeta
  hooks/flujo.ts                  puro: qué flujo corre y en qué paso, a partir de los eventos
  types/index.d.ts                tipos y contrato de $.state (PluginState['panel-uso'])
  tests/panel.test.tsx            único archivo de tests
```

## Verificar

```
claude plugin validate panel-uso
claude plugin test panel-uso
node --test flujos/herramientas/guardia.test.mjs
```

Los tres tienen que terminar sin errores antes de dar algo por hecho. Qué no prueban los tests del panel está en [MODS.md](MODS.md#verificar).

## Convenciones

- Código, comentarios, nombres y textos de UI en **español** (`medida`, `releerSemana`, «sin respuestas anotadas todavía»). Los términos técnicos y los niveles de esfuerzo quedan en inglés.
- Estilo: sin punto y coma, comillas simples y JSDoc breve en español. La línea en blanco antes de `return` solo la sigue el código de `panel-uso/`.
- Las del panel (atoms, hotkeys, versión) están en [MODS.md](MODS.md#convenciones-del-panel).

## Flujo con /implementador

`.claude/implementador.json` define la verificación (validate → test → test flujos). Las reglas propias del repo (qué es CRÍTICO, cómo buscar, motivos de rechazo) están en `.claude/implementador.md` y mandan sobre las comunes. Para cambios de documentación o pequeños, conviene trabajar directo en vez de usar el flujo completo.

## Pendiente de confirmar

- ¿La línea en blanco antes de `return` debe regir también en `flujos/`? Hoy no se cumple en 64 sitios (`estado.mjs`, `verificar.mjs`, `guardia.mjs` y `guardia.test.mjs`). Si debe regir, hay que reformatear ese código; si no, la regla queda solo para `panel-uso/`, como está escrita ahora.
