# Configurar un proyecto para /qcc-implementador

Todo es opcional: sin nada, los flujos detectan la verificación (scripts de `package.json`, Cargo, Go o pytest) y la guardia usa sus valores por defecto. `node ~/.claude/flujos/estado.mjs` (desde el repo) muestra qué tomó.

## `.claude/qcc-implementador.json`

El nombre viejo `.claude/implementador.json` sigue valiendo de respaldo.

```jsonc
{
  // Pasos de verificación, en orden. Corren con CI=1 desde la raíz del repo.
  // Sin esta clave se detectan; con [] el proyecto queda «SIN PASOS».
  // timeoutSeg (opcional): tope en segundos del paso, 600 por defecto; al vencer se corta y sale ROJO.
  "verificar": [
    { "nombre": "typecheck", "cmd": "pnpm run typecheck" },
    { "nombre": "build", "cmd": "pnpm run build", "timeoutSeg": 300 },
    { "nombre": "test", "cmd": "pnpm run test" }
  ],
  "guardia": {
    // Archivos o carpetas (con / final) o globs que ningún subagente escribe, con el motivo.
    // Se suman a los de siempre: lockfiles, node_modules/, dist/, .env*, .git/ y, en .claude/, settings*.json y agents/.
    "protegidos": { "src/routeTree.gen.ts": "lo regenera el build" },
    // Archivos con claves: ni se editan ni se nombran en un comando (cat, grep…).
    "secretos": ["CUENTAS_PRUEBA.md"],
    // Carpetas cuyos archivos versionados son inmutables (se suman a supabase/migrations/,
    // prisma/migrations/ y db/migrate/).
    "inmutables": ["migrations/"],
    // Programas negados, con el motivo (se suman a los CLIs de nube, deploy y red).
    "externos": { "deno": "las Edge Functions se despliegan a mano" },
    // Scripts del gestor JS negados (se suman a dev, start, serve, preview, watch, deploy,
    // release y publish, con sus variantes `nombre:*`).
    "scriptsNegados": ["db:*"],
    // Si está, los subagentes solo corren estos scripts (lista cerrada).
    "scriptsPermitidos": ["typecheck", "build", "test"],
    // Carpetas de scripts que pegan a servicios vivos: `node|tsx|python <ahí>` se niega.
    "nodeNegado": ["scripts/"]
  },
  // Rutas críticas, con los criterios de plan.md §2 que piden. Al guardar el plan, estado.mjs avisa si
  // una subtarea que toca una de estas rutas no es `Crítica: sí` o si la Clasificación no cita el criterio.
  // `excepto`: rutas que la regla no cubre. `si`: la regla vale solo con esa condición (se avisa para revisarla).
  "criticos": [
    { "rutas": ["supabase/migrations/", "src/db/schema.ts"], "criterios": [4], "motivo": "esquema de la base" },
    { "rutas": ["src/server/"], "excepto": ["src/server/textos.ts"], "criterios": [1], "motivo": "autorización del servidor" },
    { "rutas": ["src/pagos/**"], "criterios": [3], "motivo": "cobros" },
    { "rutas": [".claude/agents/*.md"], "criterios": [1], "si": "cambia su frontmatter", "motivo": "agentes del proyecto" }
  ]
}
```

El archivo real es JSON sin comentarios. `verificar.mjs` repite desde una caché el VERDE de los últimos 30 min si el árbol y los pasos no cambiaron (`--sin-cache` lo corre igual).

## `.claude/qcc-implementador/`

Reglas del proyecto en prosa. Las skills lo inyectan y los agentes lo leen. Un archivo por sección: cada agente lee solo los suyos. Sin la carpeta rige `.claude/qcc-implementador.md` con las mismas secciones. Los nombres viejos (`.claude/implementador/` y `.claude/implementador.md`) siguen valiendo de respaldo. Secciones útiles:

- **`clasificacion.md`** (orquestador, planificador, revisor-plan): lo que no es una ruta de cada criterio CRÍTICO de `plan.md` §2. Las rutas van en `criticos` de `.claude/qcc-implementador.json`, donde `estado.mjs` las aplica.
- **`buscar.md`** (orquestador, explorador, planificador): carpetas que Grep no ve, dónde viven los tests, guardianes, archivos que no se leen o que solo se leen con Grep.
- **`planificar.md`** (planificador, revisor-plan): convención de migraciones, infraestructura de tests, riesgos típicos, qué queda para el usuario.
- **`ejecutor.md`** (ejecutor): reglas de tipos, test puntual, patrón para acotar la salida de los tests, particularidades de la verificación.
- **`revisor.md`** (revisor y ejecutor): reglas del repo que justifican un rechazo.
