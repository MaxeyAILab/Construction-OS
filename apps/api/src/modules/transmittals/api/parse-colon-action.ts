// api.md §20 documents these routes with a literal single colon between
// the resource id and the action verb (e.g. `/transmittals/{id}:send`).
// Nest/Fastify's `:id::action` decorator syntax (meant to produce exactly
// that literal colon) doesn't work the way it looks: find-my-way captures
// the *entire* remaining segment as one opaque param value rather than
// splitting id from the literal suffix, so `@Param("id")` is always
// undefined, and two such routes sharing a resource+id position collide
// at registration (FST_ERR_DUPLICATED_ROUTE). Registering a single plain
// param (e.g. `:idAction`) sidesteps both problems while producing the
// exact same wire URL; this helper splits the captured "id:action" value
// back apart. Safe because ids here are UUIDv7s (database.md's own PK
// convention), which never contain a colon.
export function parseColonAction(raw: string): { id: string; action: string } {
  const separatorIndex = raw.indexOf(":");
  if (separatorIndex === -1) return { id: raw, action: "" };
  return { id: raw.slice(0, separatorIndex), action: raw.slice(separatorIndex + 1) };
}
