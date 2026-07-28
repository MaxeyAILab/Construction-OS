import { Inject, Injectable } from "@nestjs/common";
import type { CreateApiKeyInput } from "@constructionos/schemas";
import { and, eq, isNull } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import { apiKeys, permissions } from "../../../infrastructure/db/schema";
import { OutboxService } from "../../events";
import { generateApiKey, hashApiKey, parseApiKeyTenantId } from "../domain/api-key-generator";
import { ApiKeyNotFoundError, UnknownApiKeyScopeError } from "../domain/errors";

export interface ResolvedApiKeyAuth {
  tenantId: string;
  userId: string;
  scopes: string[];
}

// api.md §16.4 "Public API: API keys" (NFR-23). Raw key material
// (key_hash) is never selected back out — list()/create()'s return value
// both omit it, same "write-only over the API" precedent as
// WebhooksService's secret handling.
function omitHash<T extends { keyHash: string }>(key: T): Omit<T, "keyHash"> {
  const { keyHash: _keyHash, ...safe } = key;
  return safe;
}

@Injectable()
export class ApiKeysService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly outbox: OutboxService,
  ) {}

  async list(tenantId: string) {
    const rows = await withTenant(this.db, tenantId, (tx) =>
      tx.query.apiKeys.findMany({
        where: and(eq(apiKeys.tenantId, tenantId), isNull(apiKeys.deletedAt)),
      }),
    );
    return rows.map(omitHash);
  }

  // Scopes reuse the existing module.resource.action permission catalog
  // (architecture.md §12 "not new permission types") — validated against
  // the DB-seeded catalog, same pattern as RbacService.grantPermissionToRole's
  // UnknownPermissionError.
  async create(tenantId: string, actorId: string, input: CreateApiKeyInput) {
    for (const scope of input.scopes) {
      const found = await this.db.query.permissions.findFirst({ where: eq(permissions.key, scope) });
      if (!found) throw new UnknownApiKeyScopeError(scope);
    }

    const { raw, hash } = generateApiKey(tenantId);

    return withTenant(this.db, tenantId, async (tx) => {
      const [created] = await tx
        .insert(apiKeys)
        .values({ tenantId, name: input.name, keyHash: hash, scopes: input.scopes, createdBy: actorId })
        .returning();

      await this.outbox.append(tx, {
        tenantId,
        eventType: "api_key.created.v1",
        dedupeKey: `api_key.created.v1:${created!.id}`,
        actorId,
        payload: { companyId: tenantId, apiKeyId: created!.id, name: created!.name },
      });

      // The raw key is shown exactly once — this response is the only
      // place it ever appears; key_hash is a one-way SHA-256 digest with no
      // recovery path (api.md §16.4).
      return { ...omitHash(created!), key: raw };
    });
  }

  async revoke(tenantId: string, actorId: string, id: string) {
    return withTenant(this.db, tenantId, async (tx) => {
      const existing = await tx.query.apiKeys.findFirst({
        where: and(eq(apiKeys.tenantId, tenantId), eq(apiKeys.id, id), isNull(apiKeys.deletedAt)),
      });
      if (!existing) throw new ApiKeyNotFoundError();

      await tx
        .update(apiKeys)
        .set({ revokedAt: new Date(), deletedAt: new Date(), updatedBy: actorId })
        .where(eq(apiKeys.id, id));

      await this.outbox.append(tx, {
        tenantId,
        eventType: "api_key.revoked.v1",
        dedupeKey: `api_key.revoked.v1:${id}`,
        actorId,
        payload: { companyId: tenantId, apiKeyId: id },
      });
    });
  }

  // Authenticates a raw `X-Api-Key` header value (called from
  // AccessTokenGuard, before any tenant context exists). The tenant id is
  // parsed out of the key's visible prefix first — database.md §2's
  // FORCE ROW LEVEL SECURITY on api_keys has no bypass path, so this is the
  // only way to run the actual hash lookup inside that tenant's own
  // withTenant(...) scope rather than a cross-tenant admin query.
  async resolveForAuth(rawKey: string): Promise<ResolvedApiKeyAuth | null> {
    const tenantId = parseApiKeyTenantId(rawKey);
    if (!tenantId) return null;

    const hash = hashApiKey(rawKey);
    return withTenant(this.db, tenantId, async (tx) => {
      const found = await tx.query.apiKeys.findFirst({
        where: and(
          eq(apiKeys.tenantId, tenantId),
          eq(apiKeys.keyHash, hash),
          isNull(apiKeys.deletedAt),
          isNull(apiKeys.revokedAt),
        ),
      });
      if (!found || !found.createdBy) return null;

      await tx.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, found.id));

      return { tenantId, userId: found.createdBy, scopes: found.scopes };
    });
  }
}
