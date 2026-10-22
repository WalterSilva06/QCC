# Panel de inicio minimalista
Objetivo: el Inicio del panel usa filas de una línea al estilo de los límites, sin perder información · Rama: master · Tests: `claude plugin test qcc-panel` (tests/panel.test.tsx)

## Specs
S1. Contexto es una fila como las de los límites — «esto es genial 5h    █░░░░░░░░░░░ 10% 4 h 31 min» — `ctx   ██████░░░░░░  48% 96,2k/200k`: etiqueta `ctx  ` (5 col), barra de 3 a 12 celdas, cifra de 4 col, cola dim. Sin medición: barra vacía (subtle), cifra `   —` y cola ` 1M · tras 1.ª respuesta` (sin ventana: ` tras 1.ª respuesta`); la cola se suelta si la barra no llega a 3 celdas. Con desglose, la barra de la fila lleva los tramos por categoría (`tramos`/`relleno`) con su ancho. Función pura `lineaContexto` en formato.ts. · Hecho cuando: tests de `lineaContexto` (medido, sin medir con y sin ventana, ancho 20/32/40) en verde.
S2. El desglose de Contexto va justo debajo de la fila, sin líneas en blanco entre sus bloques — «mas minimalista sin perder informacion» — conserva las partes (marcador, nombre, tokens, %), «% sobre la ventana de compactación (N)», «Lo más pesado» con sus 3 elementos y el botón «Precisar» con «contando / exacto / estimado». · Hecho cuando: tests del desglose y de «Precisar» siguen en verde (ajustados solo en lo que cambia la fila).
S3. Esfuerzo y flujo en filas con etiqueta de 5 columnas, como los límites — «favor adaptar lo demas»: `esf   high · claude-opus-5-5 · según ajustes` (el nivel en `claude`, el modelo dim y truncado), `esf   —` sin dato; `flujo ` + `resumenFlujo(fl, t)` si hay flujo y `flujo —` si no (el texto «sin flujo en esta sesión» sigue en la pestaña Flujo y en `resumenFlujo`). · Hecho cuando: tests de las filas `esf`/`flujo` en verde.
S4. La leyenda «■ directo  ■ orquestador  ■ subagentes» solo se dibuja en Inicio cuando «Esta sesión» tiene filas, y sin línea en blanco previa. En Gasto semanal queda igual. · Hecho cuando: test de Inicio vacío sin leyenda y con filas con leyenda (3 ■).
S5. «Esta sesión» sin línea en blanco previa y, vacía, en una sola línea `Esta sesión · sin respuestas anotadas` (título bold, resto dim; L3); con filas, la tabla de hoy. «Esta semana» no cambia. · Hecho cuando: test de Inicio vacío y de semana vacía (semana igual que antes).
S6. Lo que no es el Inicio no cambia: fila de límites y `bloqueLimites`, pestañas, Esta semana, Gasto semanal, Flujo, Historial y los datos/atoms. · Hecho cuando: `claude plugin test qcc-panel` pasa entero.

## Tasks
- [x] T1 (S1) · ejecutor (contrato compartido: la función pura que consume T2) · ÁREA formato · RED→GREEN de `lineaContexto`
  Qué: formato.ts — agregar `export function lineaContexto(m: { tokens?: number, ventana: number, porcentaje?: number } | null, ancho: number): { etiqueta, barra, cifra, cola, medido }` junto a `lineaLimite` (formato.ts:203), reusando `barra`, `tokens` y la misma regla de ancho (barra = min(12, max(3, ancho − 5 − 1 − 4 − cola.length)); si con 3 no cabe, cola ''). `etiqueta` = `'ctx'.padEnd(5)`, `cifra` = `${porcentaje}%`.padStart(4) o `'—'.padStart(4)`. La barra devuelta es la vacía/llena según el %; la fila de register.tsx recalcula tramos con `barra.length`. Tests en panel.test.tsx junto a los de `lineaLimite` (239-262): tabla de casos (medido; sin medir con ventana; sin medir sin ventana (m null o ventana 0); ancho 20/32/40; porcentaje 0 y 100).
- [x] T2 (S1–S6) · ejecutor (misma unidad: render + tests + docs de register.tsx) · ÁREA contexto, esfuerzo-flujo, leyenda, sesión · RED→GREEN de cada literal del Inicio
  Qué: register.tsx — el `ui.render` del Inicio (1293-1389): (a) reemplaza título «Contexto» + %, barra y línea de tokens (1297-1322) por una sola fila `ctx` con `lineaContexto` (tono del % en barra y cifra como en `bloqueLimites`; cola dim; con `d !== null` los `tramos(d.partes, w)` con `w = linea.barra.length`; sin medida `barra(0, w)` en `subtle`); (b) quita los `marginTop={1}` del desglose, «Lo más pesado» y «Precisar»; (c) fila Esfuerzo (1368-1377) con la etiqueta `esf  ` y fila de flujo (1378-1382) con `flujo ` y `—` sin flujo; (d) la leyenda se dibuja solo si `ses` tiene filas y sin `marginTop` en Inicio (en Gasto semanal sigue igual: parametriza el `marginTop` de `leyenda`, 1211-1246); (e) `tabla` (902-1013): para `prefijo === 'n'` sin `marginTop` y, sin filas, título + « · sin respuestas anotadas todavía» en una línea; semana igual. Tests (panel.test.tsx): ajusta solo los que fijan los literales cambiados (FIJAN del Mapa) y agrega uno por regla S2–S5. Docs: MODS.md líneas 39, 95 y 96 describen Contexto/Esfuerzo/flujo del Inicio: actualízalas a la nueva fila. Decisión técnica: la tabla de filas de «Esta sesión» (modelo, total, salida, barra, %, desglose) no cambia; solo su marco.

## Mapa
ÁREA contexto (solo Inicio):
  hooks/register.tsx:1297-1322 (editar) título «Contexto», % con tono, barra (tramos/barra/subtle), línea «N de M tokens» / «ventana M · se mide tras la 1.ª respuesta»
  hooks/register.tsx:1324-1366 (editar) desglose por partes, «% sobre la ventana de compactación», «Lo más pesado», botón «Precisar»
  FIRMA: barra(porcentaje, ancho) → █/░, acotado 0-100; tono(p) → success <60, warning 60-84, error ≥85; tokens(n) → «950», «96,2k», «200k», «1M»; tramos(d.partes, ancho) suma exactamente `ancho` si hay tokens; relleno █ ▒ ░; marcador ■ ▒ □
  USOS: barra → formato.ts:211 (lineaLimite); tono → register.tsx:1082-1083 (límites)
  TESTS: panel.test.tsx 375-391, 393-404, 420-439, 441-458, 461-476, 540-560
ÁREA formato:
  hooks/formato.ts:199-212 (editar: agregar lineaContexto aquí) lineaLimite
  FIRMA: lineaLimite(kind, pct, reinicio, ahora, ancho) → {etiqueta 5 col, barra 3-12, cifra 4 col, cola}
  TESTS: panel.test.tsx 239-262
ÁREA esfuerzo-flujo (solo Inicio):
  hooks/register.tsx:1368-1382 (editar)
  FIRMA: resumenFlujo(flujo|null, t?) → null: «sin flujo en esta sesión»
  USOS: resumenFlujo → register.tsx:1097 (pestaña Flujo), 1380
  TESTS: panel.test.tsx 822-932, 1004-1113, 4790-4811 (desdeResumen), 2436
ÁREA leyenda (Inicio y Gasto semanal):
  hooks/register.tsx:1211-1246 (editar) `leyenda` con marginTop 1; usada en 1274 (Gasto semanal) y 1384 (Inicio)
  TESTS: panel.test.tsx 4040-4116, 4231-4251
ÁREA sesión (tabla compartida con Esta semana):
  hooks/register.tsx:902-1013 (editar) `tabla()`: marginTop 1 en 933, vacío en 940-941; Inicio `tabla('Esta sesión', 'n', …, true, true)` en 1387; semana `(false, false, true)` en 1276-1288
  TESTS: panel.test.tsx 1373-1411, 1145-1175, 4727-4788, 4858-4913, 4977-4995
ÁREA docs:
  MODS.md:39, 95, 96 (editar)

## Log
L1 2026-10-22 pedido (literal):
> La idea es repazar todo el panel de inicio para que sea mas minimalista sin perder informacion, ejempo esto es genial 5h    █░░░░░░░░░░░ 10% 4 h 31 min
> sem   ██████░░░░░░ 52% 4 d 5 h, favor adaptar lo demas,Contexto
> ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
> ventana 1M · se mide tras la 1.ª respuesta
>
> Esfuerzo —
> sin flujo en esta sesión
>
> ■ directo  ■ orquestador  ■ subagentes
>
> Esta sesión
> sin respuestas anotadas todavía
L2 2026-10-22 decisión: la tabla de filas de «Esta sesión» queda como está (solo cambia su marco); la cola sin medir se acorta a «tras 1.ª respuesta» para que quepa la barra en 40 columnas.
L5 2026-10-22 pedido (literal):
> pero no todo pegado
Decisión: tres grupos separados por una línea en blanco (contexto · esfuerzo y flujo · leyenda + Esta sesión); dentro de cada grupo, sin líneas en blanco.
L4 2026-10-22 cierre: verificar.mjs VERDE (validate, test 306, flujos, qcc-commit, odd); revisor ítem 3 RECHAZADO (S5 y MODS.md sin la decisión registrada) → corregido → APROBADO.
L3 2026-10-22 decisión: «Esta sesión · sin respuestas anotadas todavía» mide 45 columnas y se envuelve a 40; en el Inicio queda «Esta sesión · sin respuestas anotadas» (37); «Esta semana» conserva «sin respuestas anotadas todavía». La cola sin medir de `lineaContexto` se degrada ` 1M · tras 1.ª respuesta` → ` 1M` → '' para no perder la ventana en 32 columnas.
