import { sql } from "drizzle-orm";
import { check, date, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { tenantColumns } from "./columns";
import { companies } from "./companies";
import { documents } from "./documents";
import { files } from "./files";
import { projects } from "./projects";
import { suppliers } from "./procurement";
import { subcontractors } from "./subcontractors";
import { users } from "./users";

// database.md §23 / spec.md §13.18 (M19, FR-CLOSE-1). No auto-seeding of
// standard categories on project creation this pass — a PM adds items
// manually (including the standard categories the check constraint
// anticipates); flagged, not silently dropped, same treatment as
// Payment Applications' materials_stored/retainage_pct gaps.
export const closeoutChecklistItems = pgTable(
  "closeout_checklist_items",
  {
    ...tenantColumns(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    category: text("category").notNull(),
    title: text("title").notNull(),
    status: text("status").notNull().default("pending"),
    documentId: uuid("document_id").references(() => documents.id),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    completedBy: uuid("completed_by").references(() => users.id),
  },
  (table) => [
    check(
      "ck_closeout_checklist_items_category",
      sql`${table.category} in ('as_built_drawings', 'om_manuals', 'warranty_certificates', 'permits_certificate_of_occupancy', 'training_signoff', 'lien_waivers', 'other')`,
    ),
    check("ck_closeout_checklist_items_status", sql`${table.status} in ('pending', 'complete', 'not_applicable')`),
    index("ix_closeout_checklist_items_project").on(table.projectId),
  ],
);

// FR-CLOSE-2/3. One row per assembly attempt, not per project — an
// append-only history (no update/delete path this pass; a re-assembly
// after a renewed checklist item is a new row, same "a new state produces
// a new row" precedent as finance_alerts/compliance_alerts). `fileId` is
// a real generated file (FileUploadService.storeGeneratedFile) — a JSON
// manifest of the checklist's linked documents and current warranties,
// not a merged PDF/zip bundle; actual document-merging is a follow-up,
// same "explicit scope cut" treatment as api.md §18 documents for
// client delivery.
export const closeoutPackages = pgTable(
  "closeout_packages",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => companies.id),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    status: text("status").notNull().default("assembled"),
    fileId: uuid("file_id")
      .notNull()
      .references(() => files.id),
    assembledBy: uuid("assembled_by")
      .notNull()
      .references(() => users.id),
    assembledAt: timestamp("assembled_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("ck_closeout_packages_status", sql`${table.status} in ('assembled', 'delivered')`),
    index("ix_closeout_packages_project_assembled").on(table.projectId, table.assembledAt.desc()),
  ],
);

// FR-CLOSE-4. Due-state (active/expiring_soon/expired) is computed on
// read from start_date + duration_months, same "no reconciliation job"
// pattern as certifications/maintenance_schedules — not a stored column.
export const warranties = pgTable(
  "warranties",
  {
    ...tenantColumns(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    scope: text("scope").notNull(),
    warrantyType: text("warranty_type").notNull(),
    responsiblePartyType: text("responsible_party_type").notNull(),
    responsibleSubcontractorId: uuid("responsible_subcontractor_id").references(() => subcontractors.id),
    responsibleSupplierId: uuid("responsible_supplier_id").references(() => suppliers.id),
    startDate: date("start_date").notNull(),
    durationMonths: integer("duration_months").notNull(),
    documentId: uuid("document_id").references(() => documents.id),
  },
  (table) => [
    check("ck_warranties_type", sql`${table.warrantyType} in ('labor', 'material', 'manufacturer')`),
    check(
      "ck_warranties_responsible_party_type",
      sql`${table.responsiblePartyType} in ('subcontractor', 'supplier', 'manufacturer')`,
    ),
    index("ix_warranties_project").on(table.projectId),
  ],
);

// FR-CLOSE-5. Claims are project-portal-scoped (dual-path: internal
// permission or a share on the warranty's project — mirrors
// PortalMessagesService's authorizeCreate/authorizeRead exactly), not
// per-warranty shares — requiring a PM to grant a share per warranty
// would be unworkable friction for something this routine.
export const warrantyClaims = pgTable(
  "warranty_claims",
  {
    ...tenantColumns(),
    warrantyId: uuid("warranty_id")
      .notNull()
      .references(() => warranties.id),
    description: text("description").notNull(),
    status: text("status").notNull().default("submitted"),
    resolutionNotes: text("resolution_notes"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (table) => [
    check(
      "ck_warranty_claims_status",
      sql`${table.status} in ('submitted', 'acknowledged', 'in_progress', 'resolved', 'rejected')`,
    ),
    index("ix_warranty_claims_warranty").on(table.warrantyId),
  ],
);
