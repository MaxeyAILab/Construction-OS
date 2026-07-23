import { sql } from "drizzle-orm";
import { check, numeric, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { tenantColumns } from "./columns";
import { users } from "./users";

// User <-> tenant membership + employment metadata (database.md §7).
export const companyUsers = pgTable(
  "company_users",
  {
    ...tenantColumns(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    title: text("title"),
    employeeNo: text("employee_no"),
    status: text("status").notNull().default("active"),
    invitedBy: uuid("invited_by").references(() => users.id),
    // database.md §17: "Portal users are users + company_users(kind=
    // 'external') + external_shares." Added now that Client Portal (M13)
    // needs to distinguish genuine employees from external principals
    // whose record-level access is entirely driven by external_shares
    // grants, not role/permission assignment (architecture.md §11/12:
    // "external roles are share-scoped").
    kind: text("kind").notNull().default("internal"),
    // database.md §15's time_entries comment: "Approval -> cost_transactions
    // at labor rate (FR-FIELD-2)" — the spec names this rate but doesn't say
    // where it lives. Mirrors equipment's per-asset hourly_cost_rate_amount
    // (database.md §13): a per-tenant-membership rate, nullable — approval
    // still succeeds with no rate configured, it just doesn't post a cost
    // transaction (documented assumption, same treatment as tasks.priority's
    // enum values).
    hourlyRateAmount: numeric("hourly_rate_amount", { precision: 10, scale: 2 }),
  },
  (table) => [
    uniqueIndex("ux_company_users").on(table.tenantId, table.userId),
    check("ck_company_users_kind", sql`${table.kind} in ('internal', 'external')`),
  ],
);
