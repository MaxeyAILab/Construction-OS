import { Inject, Injectable } from "@nestjs/common";
import type { CreateSsoConnectionInput, UpdateSsoConnectionInput } from "@constructionos/schemas";
import { and, eq, isNull, sql } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import { ssoConnections } from "../../../infrastructure/db/schema";
import { OutboxService } from "../../events";
import { SsoConnectionNotFoundError } from "../domain/errors";
import { generateScimToken, hashScimToken, parseScimTokenTenantId } from "../domain/scim-token-generator";

export interface ScimAuthContext {
  tenantId: string;
  connectionId: string;
  defaultRoleId: string;
}

export type SsoConnectionForLogin = Record<string, unknown> & {
  id: string;
  tenantId: string;
  idpEntityId: string;
  idpSsoUrl: string;
  idpCertificate: string;
  defaultRoleId: string;
  attributeMapping: unknown;
};

// api.md §2.1 "Enterprise SSO (SAML) + SCIM provisioning" — admin.sso.
// manage-gated connection CRUD, same shape as WebhooksService's endpoint
// CRUD (§16.3): a secret-bearing config row, write-only over the API for
// its secret half (here, the SCIM token; idp_certificate is public key
// material and returned as-is).
@Injectable()
export class SsoConnectionsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly outbox: OutboxService,
  ) {}

  async list(tenantId: string) {
    return withTenant(this.db, tenantId, (tx) =>
      tx.query.ssoConnections.findMany({
        where: and(eq(ssoConnections.tenantId, tenantId), isNull(ssoConnections.deletedAt)),
        columns: { scimTokenHash: false },
      }),
    );
  }

  async create(tenantId: string, actorId: string, input: CreateSsoConnectionInput) {
    return withTenant(this.db, tenantId, async (tx) => {
      const [created] = await tx
        .insert(ssoConnections)
        .values({
          tenantId,
          name: input.name,
          idpEntityId: input.idpEntityId,
          idpSsoUrl: input.idpSsoUrl,
          idpCertificate: input.idpCertificate,
          defaultRoleId: input.defaultRoleId,
          attributeMapping: input.attributeMapping,
          createdBy: actorId,
        })
        .returning();

      await this.outbox.append(tx, {
        tenantId,
        eventType: "sso_connection.created.v1",
        dedupeKey: `sso_connection.created.v1:${created!.id}`,
        actorId,
        payload: { companyId: tenantId, ssoConnectionId: created!.id, name: created!.name },
      });

      const { scimTokenHash: _scimTokenHash, ...safe } = created!;
      return safe;
    });
  }

  async update(tenantId: string, actorId: string, id: string, input: UpdateSsoConnectionInput) {
    return withTenant(this.db, tenantId, async (tx) => {
      await this.requireConnection(tx, tenantId, id);

      const [updated] = await tx
        .update(ssoConnections)
        .set({
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.idpEntityId !== undefined ? { idpEntityId: input.idpEntityId } : {}),
          ...(input.idpSsoUrl !== undefined ? { idpSsoUrl: input.idpSsoUrl } : {}),
          ...(input.idpCertificate !== undefined ? { idpCertificate: input.idpCertificate } : {}),
          ...(input.defaultRoleId !== undefined ? { defaultRoleId: input.defaultRoleId } : {}),
          ...(input.attributeMapping !== undefined ? { attributeMapping: input.attributeMapping } : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
          updatedBy: actorId,
        })
        .where(eq(ssoConnections.id, id))
        .returning();

      const { scimTokenHash: _scimTokenHash, ...safe } = updated!;
      return safe;
    });
  }

  async delete(tenantId: string, actorId: string, id: string) {
    return withTenant(this.db, tenantId, async (tx) => {
      await this.requireConnection(tx, tenantId, id);

      await tx
        .update(ssoConnections)
        .set({ deletedAt: new Date(), updatedBy: actorId })
        .where(eq(ssoConnections.id, id));

      await this.outbox.append(tx, {
        tenantId,
        eventType: "sso_connection.deleted.v1",
        dedupeKey: `sso_connection.deleted.v1:${id}`,
        actorId,
        payload: { companyId: tenantId, ssoConnectionId: id },
      });
    });
  }

  // api.md §2.1: "one active token per connection... rotating replaces
  // it" — the raw token is returned exactly once, same posture as API-key
  // creation (§16.4).
  async rotateScimToken(tenantId: string, actorId: string, id: string): Promise<string> {
    return withTenant(this.db, tenantId, async (tx) => {
      await this.requireConnection(tx, tenantId, id);
      const { raw, hash } = generateScimToken(tenantId);
      await tx
        .update(ssoConnections)
        .set({ scimTokenHash: hash, updatedBy: actorId })
        .where(eq(ssoConnections.id, id));
      return raw;
    });
  }

  // Bootstrap lookup — the SAML metadata/login endpoints only ever learn a
  // bare connection id from the URL pasted into the tenant's IdP config,
  // with no tenant context yet to satisfy sso_connections' FORCE ROW LEVEL
  // SECURITY. get_sso_connection_for_login (migration 0116) is a narrow
  // SECURITY DEFINER function scoped to exactly this query shape — same
  // precedent as AuthService.resolveSoleCompanyId's
  // get_user_company_memberships.
  async getForLogin(connectionId: string): Promise<SsoConnectionForLogin | undefined> {
    const rows = await this.db.execute<SsoConnectionForLogin>(
      sql`select id, tenant_id as "tenantId", idp_entity_id as "idpEntityId",
          idp_sso_url as "idpSsoUrl", idp_certificate as "idpCertificate",
          default_role_id as "defaultRoleId", attribute_mapping as "attributeMapping"
          from get_sso_connection_for_login(${connectionId})`,
    );
    return Array.from(rows)[0];
  }

  // Authenticates an incoming SCIM `Authorization: Bearer <token>` header —
  // same RLS-bypass-avoidance shape as ApiKeysService.resolveForAuth
  // (api.md §16.4): the tenant id is parsed out of the token's own visible
  // prefix so the hash lookup runs inside that tenant's own RLS scope.
  async resolveScimAuth(rawToken: string): Promise<ScimAuthContext | null> {
    const tenantId = parseScimTokenTenantId(rawToken);
    if (!tenantId) return null;

    const hash = hashScimToken(rawToken);
    return withTenant(this.db, tenantId, async (tx) => {
      const found = await tx.query.ssoConnections.findFirst({
        where: and(
          eq(ssoConnections.tenantId, tenantId),
          eq(ssoConnections.scimTokenHash, hash),
          eq(ssoConnections.isActive, true),
          isNull(ssoConnections.deletedAt),
        ),
      });
      if (!found) return null;

      await tx
        .update(ssoConnections)
        .set({ scimTokenLastUsedAt: new Date() })
        .where(eq(ssoConnections.id, found.id));

      return { tenantId, connectionId: found.id, defaultRoleId: found.defaultRoleId };
    });
  }

  private async requireConnection(tx: Database, tenantId: string, id: string) {
    const connection = await tx.query.ssoConnections.findFirst({
      where: and(eq(ssoConnections.tenantId, tenantId), eq(ssoConnections.id, id), isNull(ssoConnections.deletedAt)),
    });
    if (!connection) throw new SsoConnectionNotFoundError();
    return connection;
  }
}
