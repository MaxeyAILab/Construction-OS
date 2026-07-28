import { sql } from "drizzle-orm";
import { boolean, check, index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { tenantColumns } from "./columns";
import { roles } from "./roles";

// api.md §2.1 "Enterprise SSO (SAML) + SCIM provisioning" (FR-PLAT-2,
// architecture.md §11). A tenant-configured IdP connection — SAML 2.0 only
// for this pass (OIDC is a flagged follow-up, see api.md §2.1). The SCIM
// bearer token lives on the same row (scim_token_hash) rather than a
// separate table: it's a 1:1 property of "this connection's directory
// sync," not an independent resource.
export const ssoConnections = pgTable(
  "sso_connections",
  {
    ...tenantColumns(),
    name: text("name").notNull(),
    protocol: text("protocol").notNull().default("saml"),
    idpEntityId: text("idp_entity_id").notNull(),
    idpSsoUrl: text("idp_sso_url").notNull(),
    // PEM x509 cert used to validate the IdP's assertion signature —
    // public key material, not a secret, so unlike idp/scim tokens it is
    // stored in the clear (same treatment as a webhook endpoint's URL).
    idpCertificate: text("idp_certificate").notNull(),
    // Role a JIT-provisioned (first-login) user is assigned — required at
    // creation because there is no other source for a brand-new SSO user's
    // "permission_set (narrow, explicit)" (ai-spec.md §15's phrasing for
    // the analogous agent-identity requirement).
    defaultRoleId: uuid("default_role_id")
      .notNull()
      .references(() => roles.id),
    // { email?: string; fullName?: string } — SAML attribute names to read
    // for those two fields; falls back to profile.email/profile.nameID and
    // profile.displayName when unset (AuthService.loginViaSso).
    attributeMapping: jsonb("attribute_mapping"),
    isActive: boolean("is_active").notNull().default(true),
    // SHA-256 of the current SCIM bearer token, same key-hash contract as
    // api_keys.key_hash (api.md §16.4) — direct hash-equality lookup, no
    // salt needed given the token's entropy. Null until first rotated.
    scimTokenHash: text("scim_token_hash"),
    scimTokenLastUsedAt: timestamp("scim_token_last_used_at", { withTimezone: true }),
  },
  (table) => [
    check("ck_sso_connections_protocol", sql`${table.protocol} in ('saml')`),
    index("ix_sso_connections_tenant").on(table.tenantId),
  ],
);
