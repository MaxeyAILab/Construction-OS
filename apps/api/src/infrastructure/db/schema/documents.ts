import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { tenantColumns } from "./columns";
import { files } from "./files";
import { projects } from "./projects";

// database.md §16 (M3): "project tree (adjacency list), inherited_acl jsonb
// NULL for folder-level shares" — inherited_acl isn't consumed by anything
// yet (no folder-level share UI/enforcement built), kept as a forward-
// compatible column per the same "flag it, don't build the consumer"
// precedent used throughout this session.
export const folders = pgTable(
  "folders",
  {
    ...tenantColumns(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    name: text("name").notNull(),
    parentId: uuid("parent_id"),
    inheritedAcl: jsonb("inherited_acl"),
  },
  (table) => [index("ix_folders_project_parent").on(table.projectId, table.parentId)],
);

// database.md §16: "documents: logical doc ... current_version_id (FK,
// deferred)." folder_id is nullable — a document can be "unfiled" (not yet
// placed in a folder) rather than requiring an auto-created root folder
// per project, which nothing in the specs asks for.
export const documents = pgTable(
  "documents",
  {
    ...tenantColumns(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    folderId: uuid("folder_id").references(() => folders.id),
    name: text("name").notNull(),
    category: text("category").notNull(),
    // Circular FK to document_versions (defined below) — drizzle resolves
    // this via the lazy `.references()` callback; FR-DOC-2: "current is a
    // single FK — unambiguous by construction."
    currentVersionId: uuid("current_version_id").references((): AnyPgColumn => documentVersions.id),
  },
  (table) => [
    check(
      "ck_documents_category",
      sql`${table.category} in ('drawing', 'spec', 'contract', 'permit', 'submittal', 'photo_album', 'report', 'other')`,
    ),
    index("ix_documents_project_folder").on(table.projectId, table.folderId),
    index("ix_documents_name_trgm").using("gin", sql`${table.name} gin_trgm_ops`),
  ],
);

// database.md §16: "immutable — version_no, object_key, size, mime,
// checksum sha256, uploaded_by, drawing_meta jsonb, text_extracted bool,
// page_count." object_key/size/mime/checksum/uploaded_by all already live
// on `files` (architecture.md §13's reusable upload/scan pipeline; its own
// schema comment names "Documents' versions" as the intended consumer via
// file_id) — file_id here avoids duplicating them. created_by (from
// tenantColumns) serves as uploaded_by. Rows are created once, at
// version-complete time, and never updated — true immutability.
export const documentVersions = pgTable(
  "document_versions",
  {
    ...tenantColumns(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id),
    versionNo: integer("version_no").notNull(),
    fileId: uuid("file_id")
      .notNull()
      .references(() => files.id),
    // Sheet no, discipline, revision, scale — only meaningful for
    // category='drawing' documents, but not enforced at the DB level (no
    // other category needs it; a plain nullable jsonb is simplest).
    drawingMeta: jsonb("drawing_meta"),
    textExtracted: boolean("text_extracted").notNull().default(false),
    pageCount: integer("page_count"),
  },
  (table) => [
    uniqueIndex("ux_docversions_doc_version").on(table.documentId, table.versionNo),
    index("ix_docversions_doc").on(table.documentId, table.versionNo),
  ],
);

// database.md §16: "Named issued sets ... junction to specific
// document_versions; the field working set pins one set (FR-DOC-5 offline
// determinism)." Partial unique index enforces "one published set per
// project" the same way budgets enforces "one active budget per project."
export const drawingSets = pgTable(
  "drawing_sets",
  {
    ...tenantColumns(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    name: text("name").notNull(),
    isPublished: boolean("is_published").notNull().default(false),
  },
  (table) => [
    uniqueIndex("ux_drawing_sets_tenant_project_published")
      .on(table.tenantId, table.projectId)
      .where(sql`${table.isPublished} = true`),
  ],
);

export const drawingSetSheets = pgTable(
  "drawing_set_sheets",
  {
    ...tenantColumns(),
    drawingSetId: uuid("drawing_set_id")
      .notNull()
      .references(() => drawingSets.id),
    documentVersionId: uuid("document_version_id")
      .notNull()
      .references(() => documentVersions.id),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (table) => [index("ix_drawing_set_sheets_set").on(table.drawingSetId, table.sortOrder)],
);
