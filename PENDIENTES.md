# Pendientes

Lo que queda abierto, una línea por ítem. Lo resuelto se borra.

- `fusionarExploraciones` (`estado.mjs`) descarta una DUDA `no explorado:` si otro informe cita el archivo, aunque haya leído otra parte: comparar por rango de líneas si se pierden DUDAS reales.
- `qcc-panel/hooks/flujo.ts` conserva el dibujo de la pestaña «Flujo», que no se muestra (`detallePaso`, `lineaDeExplorador`, `cuadradosDeFila`, `TOPE_EN_VUELO`, casi todo `AGENTE_DE_PASO`), y el soporte de `revisor-plan`, que `/impl` no lanza: borrarlos con sus tests de `panel.test.tsx`.
- `claude plugin test qcc-panel` no carga: `panel.test.tsx` importa y prueba `abreTanda`, que `flujo.ts` ya no exporta.
- `registros/impl-d.jsonl` no tiene lector: `costos.mjs --ultimos` solo lee `flujos.jsonl`.
- `PONYTAIL_SUBAGENT_MATCHER` sin probar en Windows: si el envoltorio de PowerShell se traga el stdin del hook, ponytail vuelve a inyectarse en todos los subagentes.
