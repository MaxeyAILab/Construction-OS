import { index, integer, jsonb, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
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
    // Photo AI (FR-FIELD-7, ai-spec.md §7.8): auto-tagging (trade/element/
    // material, auto-applies) and defect flagging (draft, surfaced here
    // too rather than a separate table — ai-spec §6's "draft ... visible
    // only to the user" needs no persistence beyond this reversible/
    // correctable column).
    aiTags: jsonb("ai_tags"),
  },
  (table) => [
    index("ix_photos_tenant_project_taken").on(table.tenantId, table.projectId, table.takenAt),
    index("ix_photos_entity").on(table.entityType, table.entityId),
    // database.md §15: "GIN on ai_tags" — now populated by Photo AI.
    index("ix_photos_ai_tags").using("gin", table.aiTags),
  ],
);
