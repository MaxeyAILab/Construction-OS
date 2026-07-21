import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { tenantColumns } from "./columns";
import { companies } from "./companies";
import { users } from "./users";

// Platform-defined permission catalog (database.md §7): `key` is
// `module.resource.action` (api.md §1.1, architecture.md §12), seeded by
// migration. Not tenant-owned.
export const permissions = pgTable("permissions", {
  key: text("key").primaryKey(),
  module: text("module").notNull(),
  resource: text("resource").notNull(),
  action: text("action").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Tenant-scoped permission bundles (database.md §7).
export const roles = pgTable(
  "roles",
  {
    ...tenantColumns(),
    name: text("name").notNull(),
    isSystem: boolean("is_system").notNull().default(false),
  },
  (table) => [uniqueIndex("ux_roles").on(table.tenantId, table.name)],
);

// Junction: what a tenant's role grants. Lean grant-tuple (no soft-delete/
// audit columns) per database.md §7's explicit composite PK, but still
// tenant_id + RLS since it's tenant-owned data (database.md §2, "no exceptions").
export const rolePermissions = pgTable(
  "role_permissions",
  {
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => companies.id),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id),
    permissionKey: text("permission_key")
      .notNull()
      .references(() => permissions.key),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.roleId, table.permissionKey] })],
);

// Assignment with scope (database.md §7, FR-RBAC-2): company-level or
// project-level. project_id has no FK yet — the projects table doesn't
// exist until the Projects module (roadmap Phase 1B) lands.
export const userRoles = pgTable(
  "user_roles",
  {
    ...tenantColumns(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id),
    scopeType: text("scope_type").notNull(),
    projectId: uuid("project_id"),
  },
  (table) => [
    check("ck_user_roles_scope_type", sql`${table.scopeType} in ('company', 'project')`),
    uniqueIndex("ux_user_roles").on(
      table.tenantId,
      table.userId,
      table.roleId,
      sql`coalesce(${table.projectId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
    ),
  ],
);

// The grant table behind client/sub/supplier scoping (database.md §7, FR-RBAC-3).
export const externalShares = pgTable(
  "external_shares",
  {
    ...tenantColumns(),
    principalUserId: uuid("principal_user_id")
      .notNull()
      .references(() => users.id),
    audience: text("audience").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    access: text("access").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
  },
  (table) => [
    check(
      "ck_external_shares_audience",
      sql`${table.audience} in ('client', 'subcontractor', 'supplier')`,
    ),
    check("ck_external_shares_access", sql`${table.access} in ('view', 'approve', 'comment')`),
    index("ix_shares_tenant_principal").on(table.tenantId, table.principalUserId),
    index("ix_shares_entity").on(table.tenantId, table.entityType, table.entityId),
  ],
);
