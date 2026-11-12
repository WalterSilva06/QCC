# Pendientes

Lo que queda abierto, una línea por ítem. Lo resuelto se borra.

- `fusionarExploraciones` (`estado.mjs`) descarta una DUDA `no explorado:` si otro informe cita el archivo, aunque haya leído otra parte: comparar por rango de líneas si se pierden DUDAS reales.
- Correcciones en paralelo de un lote (`comun.md` §6, `pasos.md` paso 5): a lo sumo 4 de 152 flujos tuvieron 2 o más subtareas corregidas; decidir si se quitan y quedan solo las correcciones de a una.
- Paso 5b «Corre esto»: 1 de los 30 flujos de `historial/` trajo comandos `(objetivo)`; decidir si se mantiene.
- `qcc-panel/hooks/flujo.ts` conserva el dibujo de la pestaña «Flujo», que no se muestra (`detallePaso`, `lineaDeExplorador`, `cuadradosDeFila`, `TOPE_EN_VUELO`, casi todo `AGENTE_DE_PASO`), y el soporte de `revisor-plan`, que `/impl` no lanza: borrarlos con sus tests de `panel.test.tsx`.
- `PONYTAIL_SUBAGENT_MATCHER` sin probar en Windows: si el envoltorio de PowerShell se traga el stdin del hook, ponytail vuelve a inyectarse en todos los subagentes.
