import { sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

// The tenant root (database.md §7). No tenant_id column — this table IS the
// tenant. Not RLS-enabled: membership/visibility is enforced via company_users
// at the application layer, not row-level tenant filtering (there is no
// "other tenant's row" concept for this table the way there is elsewhere).
export const companies = pgTable(
  "companies",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuid_generate_v7()`),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    locale: text("locale").notNull().default("en-US"),
    currencyCode: text("currency_code").notNull().default("USD"),
    settings: jsonb("settings").notNull().default({}),
    entitlements: jsonb("entitlements").notNull().default({}),
    // Holding structures (FR-PLAT-9), nullable/unused at MVP.
    parentCompanyId: uuid("parent_company_id").references((): AnyPgColumn => companies.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [uniqueIndex("ux_companies_slug").on(table.slug)],
);
