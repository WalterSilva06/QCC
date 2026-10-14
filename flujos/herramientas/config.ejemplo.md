# Configurar un proyecto para /implementador

Todo es opcional: sin nada, los flujos detectan la verificación (scripts de `package.json`, Cargo, Go o pytest) y la guardia usa sus valores por defecto. `node ~/.claude/flujos/estado.mjs` (desde el repo) muestra qué tomó.

## `.claude/implementador.json`

```jsonc
{
  // Pasos de verificación, en orden. Corren con CI=1 desde la raíz del repo.
  // Sin esta clave se detectan; con [] el proyecto queda «SIN PASOS».
  "verificar": [
    { "nombre": "typecheck", "cmd": "pnpm run typecheck" },
    { "nombre": "build", "cmd": "pnpm run build" },
    { "nombre": "test", "cmd": "pnpm run test" }
  ],
  "guardia": {
    // Archivos o carpetas (con / final) o globs que ningún subagente escribe, con el motivo.
    // Se suman a los de siempre: lockfiles, node_modules/, dist/, .env*, .claude/, .git/.
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
  }
}
```

El archivo real es JSON sin comentarios.

## `.claude/implementador.md`

Reglas del proyecto en prosa. Las skills lo inyectan y los agentes lo leen. Secciones útiles:

- **Clasificación:** rutas concretas para cada criterio CRÍTICO de `comun.md` §2.
- **Cómo buscar:** carpetas que Grep no ve, dónde viven los tests, guardianes, archivos que no se leen o que solo se leen con Grep.
- **Plan:** convención de migraciones, infraestructura de tests, riesgos típicos, qué queda para el usuario.
- **Ejecutor:** reglas de tipos, test puntual, particularidades de la verificación.
- **Revisor: rechaza también por:** reglas del repo que justifican un rechazo.
