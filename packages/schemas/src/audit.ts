import { z } from "zod";
import { isoDateTimeSchema, paginationQuerySchema, uuidSchema } from "./common";

// api.md §15: `GET /admin/audit-log` — "Filter: actor, entity, action, date;
// export". CSV export is a separate, not-yet-built concern (FR-PLAT-7's
// general export job, not specific to audit) — this covers the filtered
// read.
export const listAuditLogQuerySchema = paginationQuerySchema.extend({
  actorId: uuidSchema.optional(),
  entityType: z.string().optional(),
  entityId: uuidSchema.optional(),
  action: z.string().optional(),
  occurredFrom: isoDateTimeSchema.optional(),
  occurredTo: isoDateTimeSchema.optional(),
});
export type ListAuditLogQuery = z.infer<typeof listAuditLogQuerySchema>;
