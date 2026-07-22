import { sql } from "drizzle-orm";
import { check, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
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
  },
  (table) => [
    uniqueIndex("ux_company_users").on(table.tenantId, table.userId),
    check("ck_company_users_kind", sql`${table.kind} in ('internal', 'external')`),
  ],
);
