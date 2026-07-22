import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { tenantColumns } from "./columns";
import { files } from "./files";
import { projects } from "./projects";

// M18 Platform/Admin (FR-PLAT-7, NFR-21). architecture.md §9: "queues =
// units of work with retries/backoff/priorities/DLQ (report render,
// import, accounting sync, ...)" — export_jobs/import_jobs are the
// Postgres-side job records the BullMQ export/import workers update as
// they run, same shape as every other job-backed feature this session
// (schedule recalc, file processing).
export const exportJobs = pgTable(
  "export_jobs",
  {
    ...tenantColumns(),
    // "projects" is a company-wide entity export; the rest are project-
    // scoped entities but exported tenant-wide across every project — a
    // full-export job is meant for "everything we have" (A8 no lock-in),
    // not one project's slice.
    entityType: text("entity_type").notNull(),
    status: text("status").notNull().default("queued"),
    // Set once the worker finishes writing the CSV artifact — a `files`
    // row created directly with status='clean' (FileUploadService.
    // storeGeneratedFile), since this content is server-generated, not
    // user-uploaded, so it never needs the virus-scan pipeline.
    fileId: uuid("file_id").references(() => files.id),
    rowCount: integer("row_count"),
    error: text("error"),
  },
  (table) => [
    check(
      "ck_export_jobs_entity_type",
      sql`${table.entityType} in ('projects', 'cost_codes', 'budget_lines', 'change_orders', 'rfis', 'tasks')`,
    ),
    check("ck_export_jobs_status", sql`${table.status} in ('queued', 'running', 'completed', 'failed')`),
    index("ix_export_jobs_tenant_status").on(table.tenantId, table.status),
  ],
);

// api.md §14: "Guided import: upload -> POST /imports/{id}/map -> /validate
// (dry-run report) -> /commit (202)". v1 supports entity_type='cost_codes'
// only (flat, no parent_id hierarchy resolution yet — a CSV can't natively
// reference another row's DB-generated id within the same batch; resolving
// a "parent code" text column against sibling rows is real follow-up work,
// flagged rather than built half-way). project_id is required for this
// entity type since cost codes are project-scoped; nullable on the column
// itself so a future tenant-wide entity type isn't forced to carry one.
export const importJobs = pgTable(
  "import_jobs",
  {
    ...tenantColumns(),
    entityType: text("entity_type").notNull(),
    projectId: uuid("project_id").references(() => projects.id),
    // The uploaded CSV, via the existing Files presigned-upload + virus-
    // scan pipeline (architecture.md §13) — reused as-is rather than
    // building a second upload path; a CSV needs scanning exactly like any
    // other user-supplied file.
    fileId: uuid("file_id")
      .notNull()
      .references(() => files.id),
    status: text("status").notNull().default("uploaded"),
    // { [targetField]: sourceColumnHeader } — set by POST /imports/{id}/map.
    fieldMapping: jsonb("field_mapping"),
    // { totalRows, validRows, errors: [{ row, field, message }] } — set by
    // POST /imports/{id}/validate (dry-run, no writes).
    validationReport: jsonb("validation_report"),
    // { created, skipped, errors: [{ row, message }] } — set by POST
    // /imports/{id}/commit. Partial-success by design: one bad row doesn't
    // fail the whole batch, matching how a human re-uploading a corrected
    // CSV for just the failed rows actually works.
    commitResult: jsonb("commit_result"),
  },
  (table) => [
    check("ck_import_jobs_entity_type", sql`${table.entityType} in ('cost_codes')`),
    check(
      "ck_import_jobs_status",
      sql`${table.status} in ('uploaded', 'mapped', 'validated', 'committed', 'failed')`,
    ),
    index("ix_import_jobs_tenant_status").on(table.tenantId, table.status),
  ],
);
