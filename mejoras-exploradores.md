# Mejoras de los exploradores de /impl-d

Base: las 27 corridas de `/impl-d:n` 0.9.0 (`registros/impl-d.jsonl`, del 23 al 27 de noviembre), con 101 exploradores `impl-d:qcc-explorador-directo` (Haiku, low).

## Cómo funcionan hoy

| Medida | Valor |
|---|---|
| Exploradores por corrida | 0 a 11 (mediana 3) |
| Tiempo por ola | ~0,5 min (máximo 1 min por explorador) |
| Parte del costo de la corrida | 4 % |
| Pedidos por explorador | mediana 5, máximo 14 (`maxTurns` 25: nunca se alcanzó) |
| Contexto por explorador | mediana 34k, p90 52k, máximo 78k |
| Negaciones del hook `tope-explorador.mjs` (90k) | 0 |
| Informes con el formato pedido | 100 de 101 |
| Largo del informe | mediana 28 líneas (tope: 20 más los encabezados) |
| Rangos `ruta:desde-hasta` de más de 80 líneas | 54 de 1100 (5 %); mediana 12 líneas |
| Lecturas enteras de archivos de más de 300 líneas | 18 de 180 (10 %) |
| Informes con `no explorado` | 75 de 101; 101 entradas en total |
| Entradas `no explorado` que en realidad son «fuera de mi ÁREA» | 49 de 101 |
| Corridas con segunda ola | 5 de ~22 en las que tocaba |
| Búsquedas propias de la sesión entre la exploración y la revisión | 333, en 24 de 27 corridas (109 sobre archivos que ya citaban los informes; 47 en todo el repo) |
| Problemas del revisor en archivos que citó algún explorador | 40 de 49; los otros 9 son en su mayoría archivos nuevos del cambio (`refinadora.js`, `cascadas.js`, `pagos.mjs`) o comentarios que la sesión tocó por su cuenta |

La exploración encuentra lo que hay que tocar y es barata. Lo que falla es la parte del informe que dispara la segunda ola, y por eso la sesión la saltea y busca por su cuenta.

## Recomendaciones, en orden

### 1. `no explorado` solo para lo que está dentro del ÁREA

**Problema:** la mitad de las entradas `no explorado` (49 de 101) son archivos de otra área: «fuera de mi ÁREA», «otro explorador debe cubrirlo». El agente ya dice que lo de fuera va a ACOPLAMIENTOS sin explorarlo y que DUDAS lleva lo que el pedido toca dentro del ÁREA y no se exploró, pero Haiku no lo cumple. Como resultado, la sesión recibe dudas sobre archivos que otro explorador sí cubrió, y la segunda ola parece necesaria en casi todas las corridas.

**Cambio** en `qcc-impl-directo/agents/qcc-explorador-directo.md`, sección «Respuesta», corrigiendo la regla vigente en vez de sumar otra:
- En el bloque de formato, `- no explorado: <ruta dentro de tu ÁREA> — <por qué>`.
- Una línea junto al bloque: «Un archivo de fuera de tu ÁREA nunca va a DUDAS: va a ACOPLAMIENTOS con la ruta y el símbolo, sin línea».

**Se mide** con la proporción de `no explorado` fuera de ÁREA (hoy 49 %; la meta es ~0).

### 2. Quitar la segunda ola y permitir Grep puntual en lo que se edita

**Problema:** la regla no se cumple. Se lanzó en 5 de ~22 corridas que la necesitaban, y en 24 de 27 la sesión buscó igual por su cuenta (333 búsquedas). Las 5 corridas con segunda ola no salieron mejor: ninguna aprobó en la primera revisión (son las más complejas, así que no prueba nada en contra, pero tampoco a favor). Con el punto 1 aplicado, las dudas reales bajan a ~1 por corrida, y no justifican otra ronda de subagentes con su espera.

**Cambio:**
- `qcc-impl-directo/skills/n/SKILL.md` §1 «Con los informes»: borrar la segunda ola y «Lo que cubre esa ola no lo buscas tú…». En su lugar, permitir `Grep` con `-n` (y `head_limit`) dentro de los archivos que la sesión va a editar o cuyo símbolo necesita, para un `no explorado` o un acoplamiento sin rango; Glob, `ls` y búsquedas por carpeta siguen siendo de los exploradores.
- `qcc-impl-directo/skills/p/SKILL.md` (línea «Exploración, con los informes»): sacar «La segunda ola cubre también lo que editan los trabajadores».
- `FLUJOS.md` (sección impl-d, viñeta «Exploración»): la frase de la segunda ola.

**Depende de** [mejoras-impl-d.md](mejoras-impl-d.md), mejora 1: allí la sesión busca con Grep en todo el repo lo que el cambio quitó o cambió. Si la segunda ola se conserva, su regla «Lo que cubre esa ola no lo buscas tú…» necesita la excepción «salvo el Grep de lo que el cambio quitó o cambió».

**Alternativa**, si se prefiere conservarla: aplicar primero el punto 1, medir 10 corridas y decidir con ese dato.

### 3. Borrar el hook `tope-explorador.mjs`

**Problema:** el hook no se disparó en 101 exploradores. El máximo fue 78k contra un tope de 90k, y `maxTurns` 25 ya acota al explorador, que terminó en 5 pedidos de mediana. Mientras tanto corre en cada Read, Glob y Grep de cualquier agente de cualquier sesión con el plugin activo, unos 90 ms por llamada. En estas 27 corridas, solo la sesión hizo 954 de esas llamadas. AGENTS.md pide borrar una regla que el historial muestra sin efecto.

**Cambio:** borrar `qcc-impl-directo/hooks/hooks.json`, `herramientas/tope-explorador.mjs` y `tope-explorador.test.mjs`. Referencias que hay que reescribir:
- `AGENTS.md:3` («Cada plugin lleva … `hooks/hooks.json`»: impl-d dejaría de llevarlo);
- `AGENTS.md:7` («y un hook con el tope de contexto del explorador»);
- `AGENTS.md:37` y `:44` (estructura);
- `FLUJOS.md:161` (piezas de impl-d) y `:178` (viñeta «Tope del explorador»).

El `node --test "qcc-impl-directo/herramientas/*.test.mjs"` del Verificar sigue andando con `corrida.test.mjs`.

**Riesgo:** sin el hook, un explorador con un área muy cargada podría pasar de 100k, donde Haiku cobra más caro. No pasó en ninguna corrida. Si se quiere mantener la red, se deja como está: cuesta poco.

## Qué no cambiar

- **Modelo y esfuerzo (Haiku low):** el 82 % de los problemas del revisor cayó en archivos que citó la exploración, y una ola tarda medio minuto.
- **Reparto de ~2.000 líneas por explorador:** con 34k de mediana y 78k de máximo, subirlo a 3.000 acercaría a los exploradores a 100k; bajarlo multiplica los informes que lee la sesión.
- **Rangos y lecturas:** el 95 % de los rangos cumple los ~80 líneas y el 90 % de las lecturas enteras es de archivos chicos. El desvío es chico y no tiene efecto medible.
- **Largo del informe:** 28 líneas de mediana contra 24 permitidas. No vale otra regla.
- **Exploración en las continuaciones:** #8 y #24 la saltearon con un MAPA de 32k líneas (#24 terminó DETENIDO). Con un solo explorador cuesta 0,2–0,4 min, así que la regla «siempre, aunque el pedido nombre archivos» se mantiene.

## Cómo medir después de aplicar

Con las próximas ~10 corridas de `/impl-d:n`:
- proporción de `no explorado` fuera de ÁREA (meta: ~0);
- búsquedas de la sesión entre la exploración y la revisión (hoy 333 en 27 corridas, 12 de mediana);
- contexto máximo de los exploradores (para confirmar que nadie pasa de ~90k sin el hook);
- aprobadas en la primera revisión (hoy 37 %) y problemas del revisor en archivos que no citó la exploración (hoy 9 de 49).

Según AGENTS.md, estas medidas van en el mensaje del commit, no en la documentación.

## Cómo se midió

El método y sus trampas (Code Mode, cuentas duplicadas) están en [mejoras-impl-d.md](mejoras-impl-d.md#cómo-se-midió). Lo propio de esta nota:
- **`no explorado` fuera de ÁREA:** las líneas de DUDAS con «no explorado» que además dicen «fuera de (mi) área/rango», «otra área» u «otro explorador».
- **Búsquedas de la sesión:** Grep, Glob y Bash con `rg`, `grep`, `find`, `ls`, `sed -n`, `cat`, `head`, `tail` (sin `git` ni `corrida.mjs`), entre el fin del último explorador y el inicio de la primera revisión. En Code Mode cuentan también las de dentro de los scripts, aunque su salida no siempre llegue al contexto.
- **Contexto del explorador:** el máximo de `input + cache_read + cache_creation` de los `usage` de su jsonl, el mismo número que mira el hook.
- **Costo del hook:** `tope-explorador.mjs` con un evento de la sesión principal, menos el costo de lanzar un comando vacío, en esta máquina.
