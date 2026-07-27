import { sql } from "drizzle-orm";
import { check, date, index, integer, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { tenantColumns } from "./columns";
import { contacts } from "./crm";
import { documents } from "./documents";
import { projects } from "./projects";

// database.md §16 (M3), roadmap.md "Submittals + annotations + drawing
// compare" (FR-DOC-4) — the Phase 2 row rfis.ts's own comment flagged as
// deliberately split off from RFIs. "version chain to document_versions"
// (database.md) is satisfied by pointing at a `documents` row and reusing
// its existing immutable version history (each resubmission is just a new
// document_version) rather than inventing a parallel versioning scheme —
// same "reuse Documents' accumulating versions" precedent as Payment
// Applications' generated PDF.
export const submittals = pgTable(
  "submittals",
  {
    ...tenantColumns(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    number: integer("number").notNull(),
    specSection: text("spec_section").notNull(),
    title: text("title").notNull(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id),
    status: text("status").notNull().default("draft"),
    // External A/E reviewer (CRM contacts, M1) — same pattern as
    // rfis.assignedToContactId.
    reviewerContactId: uuid("reviewer_contact_id").references(() => contacts.id),
    dueDate: date("due_date"),
    reviewComments: text("review_comments"),
  },
  (table) => [
    check(
      "ck_submittals_status",
      sql`${table.status} in ('draft', 'submitted', 'reviewed', 'approved', 'rejected', 'resubmit')`,
    ),
    uniqueIndex("ux_submittals_tenant_project_number").on(table.tenantId, table.projectId, table.number),
    index("ix_submittals_project_status").on(table.projectId, table.status),
  ],
);
