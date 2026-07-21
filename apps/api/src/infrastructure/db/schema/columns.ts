import { sql } from "drizzle-orm";
import { bigint, timestamp, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies";
import { users } from "./users";

// UUIDv7 PK convention (database.md §3): time-ordered, mobile-generatable offline.
export const idColumn = {
  id: uuid("id")
    .primaryKey()
    .default(sql`uuid_generate_v7()`),
};

// Standard columns present on every tenant-owned table (database.md §3).
// updated_at / updated_seq are trigger-maintained — never set by app code.
export function tenantColumns() {
  return {
    ...idColumn,
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => companies.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by").references(() => users.id),
    updatedBy: uuid("updated_by").references(() => users.id),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    updatedSeq: bigint("updated_seq", { mode: "number" }).notNull().default(0),
  };
}
