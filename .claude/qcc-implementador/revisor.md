## Revisor: rechaza también por

- Un atom o un tipo que cambia de forma sin tolerar la forma anterior (flujos de las versiones 0.9.3 en adelante siguen vivos tras `/reload-plugins`).
- Un test existente relajado o convertido para que pase (`toEqual` → `toMatchObject`, un assert acotado a algo que ya no comprueba lo mismo).
- Un hook que traga o cambia el error de `next`, o que puede frenar la petición al modelo. Única excepción: `prompt.submit` puede frenar un envío si lo hace con `{ drop }` explícito, una sola vez por motivo (el reenvío pasa) y nunca por un error (ante un fallo el envío pasa).
- Un cambio visible sin subir `version` o sin tocar MODS.md.
