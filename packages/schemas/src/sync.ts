import { z } from "zod";
import { isoDateTimeSchema, uuidSchema } from "./common";

// api.md §16.2 (architecture.md §14.2). The sync engine's own mechanics
// (mutation log, idempotency, delta pull, conflict queue) are
// entity-agnostic; daily_reports/time_entries are the roadmap's "Daily
// reports + time + weather (offline)" row — photos/field_issues are still
// later, separate rows.
export const syncEntityTypeSchema = z.enum(["tasks", "daily_reports", "time_entries"]);
export type SyncEntityType = z.infer<typeof syncEntityTypeSchema>;

export const syncMutationOpSchema = z.enum(["create", "update", "delete"]);
export type SyncMutationOp = z.infer<typeof syncMutationOpSchema>;

// architecture.md §14.2's mutation record: "{client_id, mutation_id (uuid),
// entity, op, field_changes, base_version, captured_at}". entity_id is the
// row being mutated — client-generated for 'create' (mobile can mint
// UUIDv7s offline, database.md §1), server-known for 'update'/'delete'.
// base_version is required for 'update' (maps onto the same optimistic-
// locking `updated_seq` every REST PATCH already uses); absent for
// 'create'/'delete'.
export const syncMutationInputSchema = z.object({
  mutationId: uuidSchema,
  clientId: z.string().min(1),
  entity: syncEntityTypeSchema,
  entityId: uuidSchema,
  op: syncMutationOpSchema,
  changes: z.record(z.string(), z.unknown()).optional(),
  baseVersion: z.number().int().optional(),
  capturedAt: isoDateTimeSchema,
});
export type SyncMutationInput = z.infer<typeof syncMutationInputSchema>;

export const syncMutationBatchSchema = z.object({
  mutations: z.array(syncMutationInputSchema).min(1).max(200),
});
export type SyncMutationBatchInput = z.infer<typeof syncMutationBatchSchema>;

export const syncMutationResultSchema = z.object({
  mutationId: uuidSchema,
  result: z.enum(["applied", "merged", "conflict", "rejected"]),
  message: z.string().optional(),
});
export type SyncMutationResult = z.infer<typeof syncMutationResultSchema>;

// api.md §16.2: "GET /sync/delta?since_seq=&scopes=". scopes is left
// unconstrained (comma-separated entity names) rather than reusing
// syncEntityTypeSchema strictly — a client asking about a scope the server
// doesn't sync yet should get an empty result for it, not a 400.
export const syncDeltaQuerySchema = z.object({
  sinceSeq: z.coerce.number().int().min(0).default(0),
  scopes: z.string().optional(),
});
export type SyncDeltaQuery = z.infer<typeof syncDeltaQuerySchema>;

// api.md §16.2: "POST /sync/conflicts/{id}/resolve". accept_client re-runs
// the mutation ignoring the version mismatch (the field worker's edit
// wins); accept_server discards the offline mutation (the server's
// current state wins); manual lets the human supply the reconciled fields
// directly — three real outcomes, never a silent fourth.
export const resolveSyncConflictSchema = z.object({
  resolution: z.enum(["accept_client", "accept_server", "manual"]),
  manualChanges: z.record(z.string(), z.unknown()).optional(),
});
export type ResolveSyncConflictInput = z.infer<typeof resolveSyncConflictSchema>;
