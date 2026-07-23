import { integer, numeric, jsonb, pgTable, text, timestamp, uuid, index } from "drizzle-orm/pg-core";
import { tenantColumns } from "./columns";
import { files } from "./files";
import { projects } from "./projects";

// database.md §15 (M8, FR-FIELD-3). "Append-only ... highest-volume table"
// — the actual bytes/upload-pipeline state live on `files` (architecture
// §13's presigned/multipart/virus-scan machinery, already built); this
// table is a `photos`-specific attachment record on top, same FK reuse
// files.ts's own schema comment names Photos as the anticipated consumer
// of ("Documents' versions, Photos, ... each via its own FK to files.id").
// geo is lat/lng numeric pair rather than Postgres' native `point` type —
// same "no native drizzle point support, use a numeric pair" precedent as
// tasks.locationX/locationY.
export const photos = pgTable(
  "photos",
  {
    ...tenantColumns(),
    fileId: uuid("file_id")
      .notNull()
      .references(() => files.id),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    // Nullable: a field worker can snap a general progress photo before
    // deciding (or without ever deciding) which report/task/delivery it
    // belongs to — the attachment is optional, the project scope isn't.
    entityType: text("entity_type"),
    entityId: uuid("entity_id"),
    takenAt: timestamp("taken_at", { withTimezone: true }).notNull(),
    geoLat: numeric("geo_lat", { precision: 9, scale: 6 }),
    geoLng: numeric("geo_lng", { precision: 9, scale: 6 }),
    heading: integer("heading"),
    deviceId: text("device_id"),
    // Photo AI (FR-FIELD-7, auto-tagging/defect detection) — not built this
    // pass; column exists now so that follow-up work has somewhere to write.
    aiTags: jsonb("ai_tags"),
  },
  (table) => [
    index("ix_photos_tenant_project_taken").on(table.tenantId, table.projectId, table.takenAt),
    index("ix_photos_entity").on(table.entityType, table.entityId),
    // database.md §15 also calls for a GIN index on ai_tags — deferred
    // until Photo AI (FR-FIELD-7, not built this pass) actually populates
    // that column; an index with zero real query patterns yet isn't worth
    // adding speculatively.
  ],
);
