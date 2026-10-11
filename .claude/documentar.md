# Reglas de /documentar

## Doc válida
- AGENTS.md — instrucciones generales del repo para Claude: estructura, verificación, convenciones comunes y enlaces a las dos partes.
- README.md — entrada al repo: qué hay, instalación resumida e índice. Solo enlaza, no duplica.
- MODS.md — el mod panel-uso: qué muestra, comandos, datos, convenciones y trampas del panel, y su instalación.
- FLUJOS.md — los flujos /implementador, /implementador-ligero y /documentar: instalación con instalar.mjs, uso, agentes y herramientas.

## Excluidos
- .git/
- ~/.claude/flujos/registros/ (bitácoras locales, no van al repo)
- Los SKILL.md y agentes de flujos/ no son doc: son código de los flujos (fuente, solo lectura).

## Fuentes
- panel-uso/hooks/register.tsx — hooks, estado y dibujo del panel — solo lectura — densa sí (lector en Haiku max)
- panel-uso/hooks/semana.ts, formato.ts, carpeta.ts — lógica pura — solo lectura — densa no
- panel-uso/.claude-plugin/, panel-uso/types/index.d.ts, panel-uso/tests/ — manifiesto, tipos, tests — solo lectura — densa no
- flujos/skills/*/SKILL.md — comandos /implementador, /implementador-ligero, /documentar — solo lectura — densa no
- flujos/agents/*.md — agentes de los flujos — solo lectura — densa no
- flujos/herramientas/guardia.mjs — guardia de comandos y bitácora — solo lectura — densa sí (lector en Haiku max)
- flujos/herramientas/estado.mjs, verificar.mjs, comun.md, config.ejemplo.md — solo lectura — densa no
- flujos/instalar.mjs — instalador — solo lectura — densa no
- .claude/implementador.json — pasos de verificación — solo lectura — densa no

## Precedencia
- El código manda: si la doc y el código chocan, se corrige la doc para que coincida con lo que el código hace hoy.

## Escritura
- Español, con tildes. Términos técnicos y niveles de esfuerzo (`low`, `medium`, `high`, `xhigh`, `max`) en inglés.
- Estilo de AGENTS.md: encabezados `##`/`###`, listas cortas, bloques de código para comandos.
- Describir qué hace y cómo se usa, no números de línea ni nombres internos, salvo comandos, opciones y teclas.
- No duplicar: cada parte documenta su propia instalación (MODS.md el registro del mod, FLUJOS.md `instalar.mjs`); README.md la resume y enlaza, y AGENTS.md solo enlaza.
- Pendientes: sección `## Pendiente de confirmar` del archivo afectado, con la pregunta concreta.
