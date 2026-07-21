import { sql } from "drizzle-orm";
import { pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { citext } from "./types";

// Global identity (database.md §7): a person may belong to several tenants
// (e.g. a sub working for two GCs). Not tenant-owned — membership lives in
// company_users. No RLS: there is no tenant_id to filter on.
export const users = pgTable(
  "users",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuid_generate_v7()`),
    email: citext("email").notNull(),
    passwordHash: text("password_hash"),
    mfaSecretEnc: text("mfa_secret_enc"),
    fullName: text("full_name").notNull(),
    phone: text("phone"),
    avatarUrl: text("avatar_url"),
    locale: text("locale").notNull().default("en-US"),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [uniqueIndex("ux_users_email").on(table.email)],
);
