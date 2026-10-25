# Panel: sección de contexto inspirada en context-bar
Objetivo: cabecera con punto de compactación, glifos, colores y leyenda al estilo de context-bar (hamzafer) en la sección ctx del panel · Rama: master · Tests: `claude plugin test qcc-panel` (vitest del panel)

## Specs
S1. Cabecera del desglose: una línea sobre la leyenda con `NN% · usados / ventana · compacta en punto` — «cabecera con usados, ventana, punto de auto-compactación y %»
  - Función pura `resumenContexto(d: Desglose)` en formato.ts → `{ usados, ventana, punto, porcentaje, compacta }`. `usados` = suma de tokens de partes `usado`; `punto` = `d.ventana` − suma de tokens de partes `reserva`; `compacta` = hay alguna parte `reserva` con tokens > 0; `porcentaje` = `Math.round(usados / punto * 100)`, 0 si `punto <= 0`.
  - Función pura `tonoCompactacion(p: number)`: `success` bajo 70, `warning` de 70 a 89, `error` desde 90. El `tono` existente (límites y fila ctx, 60/85) no cambia.
  - Texto con `tokens()` de formato.ts, p. ej. `54% · 90,1k / 200k · compacta en 167k` (fixture DESGLOSE: usados 90 100 sobre punto 167 000). Sin `compacta`, se omite « · compacta en …». El % va primero, coloreado con `tonoCompactacion`, y el resto en `dimColor`; la línea se trunca por el final (`wrap="truncate-end"`).
  - Se dibuja como primera línea del bloque `desglose` en register.tsx, solo si hay desglose.
  · Hecho cuando: test de `resumenContexto` (tabla con bordes) y de `tonoCompactacion` (69→success, 70→warning, 89→warning, 90→error) en panel.test.tsx, y un test de render del Inicio con desglose que ve la línea `54% · 90,1k / 200k · compacta en 167k` para el fixture DESGLOSE (el % de la cabecera sale de las partes, no de la medición de la fila ctx).
S2. Glifos como en context-bar: libre `─`, reserva `░` — «Free space is a thin gray line (─). The compaction buffer is hatched (░)»
  - `relleno()`: usado `█`, libre `─`, reserva `░`. `marcador()`: usado `■`, libre `─`, reserva `░`.
  · Hecho cuando: tests de `relleno` y `marcador` con los tres tipos, y el test de render que fija `[█▒░]` (panel.test.tsx ~1469) actualizado a `[█─░]`.
S3. Colores de categoría: mensajes en naranja del tema, libre y reserva en gris del tema — «messages are orange»
  - En `aDesglose`: la parte cuyo nombre de motor es `Messages` sale con color `claude`; la `libre`, `subtle`; la `reserva`, `inactive`. Cualquier otra conserva el color que trae el motor. Todo son tokens del tema, como el resto del panel, nunca hex.
  · Hecho cuando: test de `aDesglose` (fixture DESGLOSE) que ve `Mensajes`→`claude`, `Libre`→`subtle`, `Reserva compactación`→`inactive` y que `Prompt del sistema`, `Herramientas` y `Memoria` conservan `promptBorder`, `inactive` y `claude` del motor.
S4. Leyenda: libre y reserva sin porcentaje, y `<0,1%` para lo usado que pesa menos de 0,1 — «Free and buffer entries show their glyph and omit the share … `<0.1%` for tiny non-zero values»
  - Función pura `pctParte(p: Parte): string` en formato.ts: `''` para `libre` y `reserva`; para `usado`, `<0,1%` si `0 < porcentaje < 0.1`, si no `pct(porcentaje)`. La leyenda en register.tsx la usa en lugar de `pct(p.porcentaje)`.
  · Hecho cuando: test de `pctParte` (tabla: usado con porcentaje 10.7→`10,7%`, usado 0.05→`<0,1%`, usado 0→`0,0%`, libre→`''`, reserva→`''`) y el test de render del Inicio ve la leyenda sin % en `Libre` y `Reserva compactación`.

## Fuera de alcance
- Comando `/context-bar` o equivalente para ocultar/mostrar — lo excluyó el usuario: «no incluyas el comando»
- Cambiar el % ni el `tono` de la fila `ctx` ni de los límites — el usuario: «deja ambos»; el pedido no lo pide
- Sistema de bandas ordenables, `bands.json`, dibujar sobre el prompt — no aplica a un panel lateral
- Empaquetar la leyenda en varias líneas, paleta de 9 colores fijos, hex — el pedido no lo pide
- Cambiar cómo se mide el desglose (`medirDesglose`, `precisar`, eventos de refresco) — el pedido no lo pide

## Tasks
- [x] T1 (S1, S2, S3, S4) · ejecutor (código y tests puros de formato.ts) · ÁREA cálculo · evidencia: RED (tests no cargaban: `Export named 'pctParte' not found`) → GREEN `claude plugin test qcc-panel` 335 pass; `--diff --stat` formato.ts +50, panel.test.tsx +71
  Qué: formato.ts — agregar `resumenContexto`, `tonoCompactacion`, `pctParte`; cambiar `relleno`, `marcador` y el color en `aDesglose` (un `colorParte(nombreMotor, kind, colorMotor)` interno o inline; lo más simple). panel.test.tsx — tests nuevos de esas funciones y actualizar los que S2/S3 cambian: `[█▒░]` (~1469) y cualquier expectativa del color de Mensajes. No tocar register.tsx.
- [x] T2 (S1, S4) · ejecutor (dibujo; depende de T1) · ÁREA render · evidencia: `claude plugin test qcc-panel` 336 pass; test de render `54% · 90,1k / 200k · compacta en 167k` (panel.test.tsx:1570); RED no visto (test e implementación escritos juntos; el texto esperado no existía en la BASE); `--diff --stat` register.tsx +14, panel.test.tsx +99, MODS.md ±1
  Qué: register.tsx — primera línea del bloque `desglose` (~1406) con la cabecera de S1, y la leyenda con `pctParte` (S4). panel.test.tsx — tests de render del Inicio con desglose. MODS.md — documentar cabecera, glifos, colores y leyenda del desglose del contexto (la sección no los describe hoy). No cambiar tipos de types/index.d.ts (no hace falta).

## Mapa
ÁREA cálculo (formato.ts, puro):
  qcc-panel/hooks/formato.ts:102-107 tono (NO editar: umbrales 60/85 de límites y ctx)
  qcc-panel/hooks/formato.ts:219-236 lineaContexto (NO editar)
  qcc-panel/hooks/formato.ts:293-329 NOMBRES y aDesglose (editar: color por parte; aquí van las funciones nuevas, junto a `pesados`/`tramos`)
  qcc-panel/hooks/formato.ts:364-389 tramos (NO editar)
  qcc-panel/hooks/formato.ts:391-397 relleno y marcador (editar: glifos)
  FIRMA: aDesglose(b, exacto) → Desglose · orden usado, libre, reserva; diferidas fuera; `ventana` = rawMaxTokens o maxTokens. tramos(partes, ancho) → Tramo[] · suma ancho; usado con tokens ≥ 1 celda.
  USOS: tono → register.tsx:1164-1165 (límites), 1394, 1399 (ctx); aDesglose → register.tsx:238 (llamado desde 490, 627, 671); relleno → register.tsx:1389; marcador → register.tsx:1410; tramos → register.tsx:1387
  TESTS: panel.test.tsx 96-125 fixture DESGLOSE; 155-160 barra y tono; 347-364 aDesglose (nombres, orden, pct, pesados); 366- tramos
  Tipos (no editar): types/index.d.ts:23-34 Parte {nombre, tokens, porcentaje, color, tipo}; 36-47 Pesado y Desglose {partes, ventana, pesados, exacto}
ÁREA render (register.tsx):
  qcc-panel/hooks/register.tsx:1375-1404 fila ctx (NO editar)
  qcc-panel/hooks/register.tsx:1406-1422 bloque `desglose`: leyenda con marcador, nombre, tokens y `pct(p.porcentaje)`; nota «% sobre la ventana de compactación» (editar: cabecera arriba, `pctParte`)
  qcc-panel/hooks/register.tsx:1424-1448 lo más pesado y Precisar (NO editar)
  FIRMA: dentro de `ui.render` del Inicio; `d` es el Desglose o null; `m` la Medida o null.
  TESTS: panel.test.tsx 1456-1486 Inicio con desglose (regex de la fila, color de cifra = tono(48), orden exacto de cajas con marginTop); 1488-1500 sin medición ni desglose; 5092-5123 y 5201 buscan el texto «ctx   »
  FIJAN: 155-160 tono 70→warning y 90→error (no se toca `tono`); 265-309 lineaContexto; 347-364 lista exacta de 6 nombres y «Reserva compactación»; 1469 regex `[█▒░]`; 1475 orden de cajas con marginTop (la cabecera va DENTRO del bloque `desglose`, no es una caja nueva)
ÁREA docs:
  MODS.md:1-2 (Qué muestra) y hotkeys en línea 125; las líneas 51-52, 74 y 90-98 no se leyeron: el ejecutor las lee antes de editar

## Log
L1 2026-10-24 pedido (literal):
> Iplemeneta y acutaliza el panel en lña seccion de cotnexto, con mejeras de todo tipo, funciones y mejroas visual inspirados en el repo https://github.com/hamzafer/claude-code-mods, enfocado en context-bar, puedes actualizar colores iconos etc
L2 2026-10-24 pedido (literal, tras el plan):
> Aplica los cambios, y sobre tus 3 dudas, 1 no incluyas el comnado, 2 deja ambos, 3 OK
L3 decisión técnica: el punto de compactación se deriva de `d.ventana` menos los tokens de las partes `reserva`, porque el tipo del motor (`SessionContextBreakdown`) no está en el repo y no se conocen otros campos. Mapa tomado del explorador de la corrida anterior (misma sesión; sin explorador nuevo).
