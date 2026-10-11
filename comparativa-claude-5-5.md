# Claude Opus 5.5 vs Claude Sonnet 5.5 vs Claude Haiku 5.5

Datos al 11 oct 2026.

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
| Claude Opus 5.5 (max with fallback) | 1807 | **1866** | 69.5% | 59.6% | **66.9%** | **61.4%** | 26.2% | **31.7%** | **46** | **84.7%** |
| Claude Sonnet 5.5 (max with fallback) | **1823** | 1838 | **71.8%** | **63.6%** | 61.0% | 55.0% | 25.8% | 31.4% | 32 | 82.7% |
| Claude Opus 5.5 (xhigh with fallback) | 1766 | 1836 | 65.0% | 59.6% | 65.0% | 57.5% | 26.6% | **31.7%** | 43 | **84.7%** |
| Claude Opus 5.5 (high with fallback) | 1690 | 1705 | 63.2% | 56.6% | 60.4% | 55.6% | **28.8%** | 30.9% | 41 | 82.7% |
| Claude Sonnet 5.5 (xhigh with fallback) | 1752 | 1730 | 65.5% | 57.1% | 57.3% | 50.0% | 24.6% | 31.1% | 24 | 79.7% |
| Claude Opus 5.5 (medium with fallback) | 1627 | 1584 | 61.2% | 52.5% | 59.3% | 54.7% | 25.6% | 27.7% | 40 | 84.3% |
| Claude Sonnet 5.5 (high with fallback) | 1638 | 1550 | 59.4% | 43.9% | 53.7% | 45.8% | 25.2% | 24.6% | 21 | 78.0% |
| Claude Haiku 5.5 (max) | 1577 | 1618 | 35.4% | 32.8% | 55.0% | 44.4% | 20.8% | 18.9% | 11 | 82.7% |
| Claude Opus 5.5 (low with fallback) | 1279 | 1234 | 52.9% | 31.3% | 58.6% | 48.3% | 25.6% | 17.7% | 39 | 80.7% |
| Claude Haiku 5.5 (xhigh) | 1533 | 1511 | 36.0% | 29.3% | 51.7% | 42.7% | 18.2% | 22.6% | 6 | 78.3% |
| Claude Sonnet 5.5 (medium with fallback) | 1442 | 1323 | 54.9% | 29.8% | 52.9% | 39.8% | 20.2% | 16.9% | 20 | 76.3% |
| Claude Haiku 5.5 (high) | 1442 | 1418 | 33.7% | 21.7% | 48.7% | 37.3% | 17.2% | 18.6% | 6 | 77.3% |
| Claude Sonnet 5.5 (low with fallback) | 1271 | 1175 | 49.4% | 20.7% | 49.1% | 36.2% | 16.0% | 11.4% | 19 | 76.0% |
| Claude Haiku 5.5 (medium) | 1372 | 1274 | 28.6% | 15.2% | 49.0% | 33.8% | 15.2% | 12.9% | 4 | 77.3% |
| Claude Haiku 5.5 (low) | 1112 | 1122 | 22.9% | 12.6% | 49.2% | 27.0% | 11.2% | 9.1% | 3 | 72.0% |

## Costo, rendimiento y características

| Configuración | Costo por tarea (USD) | Velocidad de salida (tokens/s) | Tiempo hasta el primer token (s) | Ventana de contexto |
| --- | ---: | ---: | ---: | ---: |
| Claude Opus 5.5 (max with fallback) | $5.98 | 97 | 702,99 | 1M |
| Claude Sonnet 5.5 (max with fallback) | $5.46 | 139 | 486,23 | 1M |
| Claude Opus 5.5 (xhigh with fallback) | $3.46 | 83 | 141,09 | 1M |
| Claude Opus 5.5 (high with fallback) | $1.82 | 81 | 49,71 | 1M |
| Claude Sonnet 5.5 (xhigh with fallback) | $2.01 | 106 | 35,88 | 1M |
| Claude Opus 5.5 (medium with fallback) | $1.34 | 81 | 22,54 | 1M |
| Claude Sonnet 5.5 (high with fallback) | $0.88 | 108 | 11,91 | 1M |
| Claude Haiku 5.5 (max) | $0.21 | **234** | 305,80 | 1M |
| Claude Opus 5.5 (low with fallback) | $0.55 | 78 | 10,84 | 1M |
| Claude Haiku 5.5 (xhigh) | $0.12 | 192 | 64,11 | 1M |
| Claude Sonnet 5.5 (medium with fallback) | $0.48 | 102 | 1,05 | 1M |
| Claude Haiku 5.5 (high) | $0.08 | 176 | 23,81 | 1M |
| Claude Sonnet 5.5 (low with fallback) | $0.35 | 104 | **0,70** | 1M |
| Claude Haiku 5.5 (medium) | $0.05 | 169 | 14,68 | 1M |
| Claude Haiku 5.5 (low) | **$0.02** | 176 | 9,51 | 1M |

En negrita, el mejor valor de cada métrica según la fuente. «--» = sin dato.
