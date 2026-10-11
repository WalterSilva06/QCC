# Cobertura de documentación

| Tema | Fuentes | Doc § | Estado | Fecha |
|---|---|---|---|---|
| Reorganizar la doc en panel y flujos | AGENTS.md (anterior), encabezados del repo | AGENTS.md, README.md, MODS.md, FLUJOS.md | dudoso | 2026-10-11 |
| Uso de /implementador, /implementador-ligero y /documentar | flujos/skills/*/SKILL.md | FLUJOS.md § Comandos | pendiente | |
| Agentes de los flujos | flujos/agents/*.md | FLUJOS.md § Agentes | pendiente | |
| Herramientas de los flujos (estado, verificar, guardia) | flujos/herramientas/ | FLUJOS.md § Herramientas | pendiente | |
| Configuración de los flujos (implementador.json, documentar.md) | .claude/implementador.json, flujos/herramientas/config.ejemplo.md | FLUJOS.md § Configuración | pendiente | |
| Panel: qué muestra, comandos, datos | panel-uso/hooks/ | MODS.md | leído | 2026-10-11 |
| AGENTS.md § Intro | panel-uso/.claude-plugin/plugin.json, flujos/ | AGENTS.md § Intro | leído | 2026-10-11 |
| AGENTS.md § Estructura | git ls-files, panel-uso/, flujos/instalar.mjs | AGENTS.md § Estructura | leído | 2026-10-11 |
| AGENTS.md § Verificar | los 3 comandos de verificación | AGENTS.md § Verificar | leído | 2026-10-11 |
| AGENTS.md § Convenciones | panel-uso/hooks/*, flujos/**/*.mjs | AGENTS.md § Convenciones | dudoso | 2026-10-11 |
| AGENTS.md § Flujo con /implementador | .claude/implementador.json | AGENTS.md § Flujo con /implementador | leído | 2026-10-11 |
| MODS.md § Intro | panel-uso/.claude-plugin/plugin.json | MODS.md § Intro | leído | 2026-10-11 |
| MODS.md § Cómo está armado | panel-uso/hooks/ | MODS.md § Cómo está armado | leído | 2026-10-11 |
| MODS.md § Verificar | panel-uso/tests/panel.test.tsx | MODS.md § Verificar | leído | 2026-10-11 |
| MODS.md § Instalación | claude plugin list, panel-uso/.claude-plugin/ | MODS.md § Instalación | leído | 2026-10-11 |
| MODS.md § Qué muestra | register.tsx, formato.ts, semana.ts | MODS.md § Qué muestra | dudoso | 2026-10-11 |
| MODS.md § Comandos | register.tsx | MODS.md § Comandos | leído | 2026-10-11 |
| MODS.md § Datos | register.tsx, semana.ts | MODS.md § Datos | leído | 2026-10-11 |
| MODS.md § Convenciones del panel | register.tsx, types/index.d.ts | MODS.md § Convenciones del panel | leído | 2026-10-11 |
| MODS.md § Trampas conocidas | carpeta.ts, register.tsx | MODS.md § Trampas conocidas | leído | 2026-10-11 |
| FLUJOS.md § Intro | AGENTS.md#estructura, flujos/ | FLUJOS.md § Intro | leído | 2026-10-11 |
| FLUJOS.md § Comandos | flujos/skills/*/SKILL.md | FLUJOS.md § Comandos | leído | 2026-10-11 |
| FLUJOS.md § Instalación | flujos/instalar.mjs, flujos/skills/*/SKILL.md | FLUJOS.md § Instalación | leído | 2026-10-11 |
| FLUJOS.md § Pendiente de confirmar | flujos/agents/, flujos/herramientas/, .claude/ | FLUJOS.md § Pendiente de confirmar | dudoso | 2026-10-11 |

## Fichas

### Reorganizar la doc en panel y flujos — 2026-10-11
Objetivo: separar la doc por parte, sin perder contenido ni duplicarlo · Audiencia: Claude (AGENTS.md) y quien llega al repo (README.md) · Fuentes: AGENTS.md actual y los encabezados del repo · Destino: AGENTS.md (general), README.md (índice), MODS.md (panel), FLUJOS.md (flujos) · Fuera de alcance: uso detallado de comandos, agentes y herramientas; cambios de código · Supuestos: las convenciones específicas del panel van a MODS.md y las generales se quedan; el contenido se mueve tal cual, sin reescribirlo; cada parte documenta su propia instalación y README resume y enlaza; se agrega MODS.md a la doc válida de las reglas.
