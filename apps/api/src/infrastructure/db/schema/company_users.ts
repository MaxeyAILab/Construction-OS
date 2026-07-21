import { pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
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
  },
  (table) => [uniqueIndex("ux_company_users").on(table.tenantId, table.userId)],
);
