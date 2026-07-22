import { index, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { tenantColumns } from "./columns";

// database.md §17: "Internal polymorphic comment stream (tasks, RFIs,
// POs…): entity_type/id, body, mentions uuid[] (drives notifications)."
// Built now for its first real consumer (Tasks & Punch, M6) — the shape is
// already fully specified in the schema doc, not a speculative abstraction
// invented here; later modules (RFIs, POs) reuse the same table via this
// module's exported CommentsService rather than each growing their own.
export const comments = pgTable(
  "comments",
  {
    ...tenantColumns(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    body: text("body").notNull(),
    mentions: uuid("mentions").array().notNull().default([]),
  },
  (table) => [index("ix_comments_entity").on(table.tenantId, table.entityType, table.entityId)],
);
