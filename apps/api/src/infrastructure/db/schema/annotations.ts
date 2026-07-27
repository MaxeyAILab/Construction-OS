import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { tenantColumns } from "./columns";
import { documentVersions } from "./documents";

// database.md §16 (M3, FR-DOC-3): "Markups on document_versions: page,
// geometry jsonb, author, kind — kept separate from bytes so versions stay
// immutable." `author` is `created_by` (tenantColumns) — no separate
// column, same reuse as document_versions' "uploaded_by". `kind` matches
// ui-design-system.md's DrawingViewer markup toolbar (pen/box/text/
// measure); `geometry` is tool-shape-dependent (path points, bounding box,
// label position, or a two-point ruler) so it stays a free-form jsonb
// rather than a rigid column set.
export const annotations = pgTable(
  "annotations",
  {
    ...tenantColumns(),
    documentVersionId: uuid("document_version_id")
      .notNull()
      .references(() => documentVersions.id),
    page: integer("page").notNull().default(1),
    kind: text("kind").notNull(),
    geometry: jsonb("geometry").notNull(),
  },
  (table) => [
    check("ck_annotations_kind", sql`${table.kind} in ('pen', 'box', 'text', 'measure')`),
    index("ix_annotations_document_version").on(table.documentVersionId, table.page),
  ],
);
