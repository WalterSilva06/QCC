# Claude Opus 5.5 vs Claude Sonnet 5.5 vs Claude Haiku 5.5

Datos al 15 oct 2026. Lo que cambió desde la versión del 11 oct está al final.

## Inteligencia por área

| Configuración | Intelligence Index | Finanzas y contabilidad | Estrategia y operaciones | Jurídico | Salud y medicina | Ingeniería | Economía |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Claude Opus 5.5 (max with fallback) | **58** | **61** | **64** | **63** | **61** | **60** | **66** |
| Claude Sonnet 5.5 (max with fallback) | 56 | 57 | 60 | 56 | 58 | 58 | 61 |
| Claude Opus 5.5 (xhigh with fallback) | 56 | 58 | 62 | 61 | -- | 59 | 63 |
| Claude Opus 5.5 (high with fallback) | 54 | 56 | 59 | 59 | -- | 56 | 61 |
| Claude Sonnet 5.5 (xhigh with fallback) | 52 | 52 | 56 | 52 | -- | 54 | 56 |
| Claude Opus 5.5 (medium with fallback) | 51 | 54 | 57 | 57 | -- | 54 | 60 |
| Claude Sonnet 5.5 (high with fallback) | 47 | 47 | 52 | 49 | -- | 48 | 52 |
| Claude Haiku 5.5 (max) | 43 | 44 | 40 | 42 | 44 | 45 | 51 |
| Claude Opus 5.5 (low with fallback) | 42 | 46 | 48 | 52 | -- | 45 | 53 |
| Claude Haiku 5.5 (xhigh) | 41 | 41 | 39 | 40 | -- | 43 | 49 |
| Claude Sonnet 5.5 (medium with fallback) | 41 | 41 | 45 | 44 | -- | 42 | 47 |
| Claude Haiku 5.5 (high) | 38 | 38 | 37 | 38 | -- | 39 | 46 |
| Claude Sonnet 5.5 (low with fallback) | 36 | 38 | 41 | 41 | -- | 38 | 44 |
| Claude Haiku 5.5 (medium) | 34 | 35 | 34 | 36 | -- | 35 | 43 |
| Claude Haiku 5.5 (low) | 29 | 29 | 28 | 31 | -- | 31 | 37 |

## Benchmarks

| Configuración | AA-Briefcase v1.1 | GDPval-AA v2.1 | AutomationBench-AA | Terminal-Bench 4.0 | SciCode | Humanity's Last Exam | GDP.pdf | CritPt | AA-Omniscience | AA-LCR v1.1 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Claude Opus 5.5 (max with fallback) | 1805 | **1866** | 69.5% | 59.6% | **66.9%** | **61.4%** | 26.2% | **31.7%** | **46** | **84.7%** |
| Claude Sonnet 5.5 (max with fallback) | **1817** | 1838 | **71.8%** | **63.6%** | 61.0% | 55.0% | 25.8% | 31.4% | 32 | 82.7% |
| Claude Opus 5.5 (xhigh with fallback) | 1764 | 1831 | 65.0% | 59.6% | 65.0% | 57.5% | 26.6% | **31.7%** | 43 | **84.7%** |
| Claude Opus 5.5 (high with fallback) | 1687 | 1704 | 63.2% | 56.6% | 60.4% | 55.6% | **28.8%** | 30.9% | 41 | 82.7% |
| Claude Sonnet 5.5 (xhigh with fallback) | 1751 | 1728 | 65.5% | 57.1% | 57.3% | 50.0% | 24.6% | 31.1% | 24 | 79.7% |
| Claude Opus 5.5 (medium with fallback) | 1625 | 1584 | 61.2% | 52.5% | 59.3% | 54.7% | 25.6% | 27.7% | 40 | 84.3% |
| Claude Sonnet 5.5 (high with fallback) | 1637 | 1549 | 59.4% | 43.9% | 53.7% | 45.8% | 25.2% | 24.6% | 21 | 78.0% |
| Claude Haiku 5.5 (max) | 1578 | 1618 | 35.4% | 32.8% | 55.0% | 44.4% | 20.8% | 18.9% | 11 | 82.7% |
| Claude Opus 5.5 (low with fallback) | 1280 | 1235 | 52.9% | 31.3% | 58.6% | 48.3% | 25.6% | 17.7% | 39 | 80.7% |
| Claude Haiku 5.5 (xhigh) | 1532 | 1513 | 36.0% | 29.3% | 51.7% | 42.7% | 18.2% | 22.6% | 6 | 78.3% |
| Claude Sonnet 5.5 (medium with fallback) | 1441 | 1323 | 54.9% | 29.8% | 52.9% | 39.8% | 20.2% | 16.9% | 20 | 76.3% |
| Claude Haiku 5.5 (high) | 1443 | 1418 | 33.7% | 21.7% | 48.7% | 37.3% | 17.2% | 18.6% | 6 | 77.3% |
| Claude Sonnet 5.5 (low with fallback) | 1272 | 1175 | 49.4% | 20.7% | 49.1% | 36.2% | 16.0% | 11.4% | 19 | 76.0% |
| Claude Haiku 5.5 (medium) | 1372 | 1275 | 28.6% | 15.2% | 49.0% | 33.8% | 15.2% | 12.9% | 4 | 77.3% |
| Claude Haiku 5.5 (low) | 1112 | 1123 | 22.9% | 12.6% | 49.2% | 27.0% | 11.2% | 9.1% | 3 | 72.0% |

## Costo y rendimiento

| Configuración | Costo por tarea (USD) | Velocidad de salida (tokens/s) | Tiempo hasta el primer token (s) | Respuesta de extremo a extremo (s) | Tiempo por tarea (s) | Ventana de contexto |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Claude Opus 5.5 (max with fallback) | $5.98 | 95 | 691,73 | 696,99 | 794,83 | 1M |
| Claude Sonnet 5.5 (max with fallback) | $5.46 | 131 | 425,24 | 429,07 | 951,85 | 1M |
| Claude Opus 5.5 (xhigh with fallback) | $3.46 | 82 | 139,63 | 145,69 | 506,03 | 1M |
| Claude Opus 5.5 (high with fallback) | $1.82 | 85 | 46,45 | 52,36 | 265,64 | 1M |
| Claude Sonnet 5.5 (xhigh with fallback) | $2.01 | 110 | 25,95 | 30,50 | 444,57 | 1M |
| Claude Opus 5.5 (medium with fallback) | $1.34 | 88 | 17,41 | 23,10 | 198,41 | 1M |
| Claude Sonnet 5.5 (high with fallback) | $0.88 | 111 | 12,43 | 16,95 | 226,63 | 1M |
| Claude Haiku 5.5 (max) | $0.21 | **239** | 336,91 | 339,00 | 426,64 | 1M |
| Claude Opus 5.5 (low with fallback) | $0.55 | 87 | 6,69 | 12,43 | 76,68 | 1M |
| Claude Haiku 5.5 (xhigh) | $0.12 | 183 | 67,43 | 70,16 | 296,85 | 1M |
| Claude Sonnet 5.5 (medium with fallback) | $0.48 | 113 | 2,99 | 7,44 | 124,10 | 1M |
| Claude Haiku 5.5 (high) | $0.08 | 182 | 19,77 | 22,52 | 191,59 | 1M |
| Claude Sonnet 5.5 (low with fallback) | $0.35 | 110 | **1,35** | **5,90** | 85,72 | 1M |
| Claude Haiku 5.5 (medium) | $0.05 | 173 | 9,21 | 12,10 | 119,07 | 1M |
| Claude Haiku 5.5 (low) | **$0.02** | 177 | 6,33 | 9,16 | **63,85** | 1M |

## Precios por millón de tokens (USD)

Son los mismos en todas las configuraciones de cada modelo.

| Modelo | Entrada | Salida | Lectura de caché | Escritura de caché |
| --- | ---: | ---: | ---: | ---: |
| Claude Opus 5.5 | $4.00 | $20.00 | $0.20 | $5.00 |
| Claude Sonnet 5.5 | $2.00 | $10.00 | $0.10 | $2.50 |
| Claude Haiku 5.5 | $0.10 | $0.50 | $0.01 | $0.125 |

La escritura de caché de la tabla es la de 5 minutos. Según la página oficial de precios de Anthropic (consultada el 15 oct), la de 1 hora cuesta $8 (Opus), $4 (Sonnet) y $0.20 (Haiku). Haiku 5.5 sube a $0.50 de entrada, $2.50 de salida, $0.05 de lectura y $0.625 de escritura con prompts de más de 100.000 tokens.

## Cambios desde el 11 oct

- Sin cambios: inteligencia por área, AutomationBench-AA, Terminal-Bench 4.0, SciCode, Humanity's Last Exam, GDP.pdf, CritPt, AA-Omniscience, AA-LCR y costo por tarea.
- AA-Briefcase y GDPval-AA: se movieron entre −6 y +2 puntos. La mayor baja es Sonnet max en AA-Briefcase (1823 → 1817).
- Velocidad de salida: subió en 11 de 15, sobre todo en Opus low (78 → 87 tokens/s) y Sonnet medium (102 → 113). Bajó en Sonnet max (139 → 131), Haiku xhigh (192 → 183), Opus max (97 → 95) y Opus xhigh (83 → 82).
- Tiempo hasta el primer token: bajó en 10 de 15 (Sonnet max 486,23 → 425,24 s; Sonnet xhigh 35,88 → 25,95 s). Subió en Haiku max (305,80 → 336,91 s), Haiku xhigh (64,11 → 67,43 s), Sonnet high (11,91 → 12,43 s), Sonnet medium (1,05 → 2,99 s) y Sonnet low (0,70 → 1,35 s).
- Columnas nuevas: respuesta de extremo a extremo, tiempo por tarea y precios.

En negrita, el mejor valor de cada métrica según la fuente; los precios van sin negrita. La fuente repite el mismo valor en «tiempo hasta el primer token» y «tiempo hasta el primer token de respuesta», así que va una sola columna. «--» = sin dato.
