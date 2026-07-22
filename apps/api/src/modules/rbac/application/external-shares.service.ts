import { Inject, Injectable } from "@nestjs/common";
import type { CreateExternalShareInput, ExternalShareAccess, ListExternalSharesQuery } from "@constructionos/schemas";
import { and, eq, isNull, type SQL } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import { companyUsers, externalShares } from "../../../infrastructure/db/schema";
import { OutboxService } from "../../events";
import { UserNotFoundError } from "../domain/errors";

// database.md §7/§17 (FR-RBAC-3): "the grant table behind client/sub/
// supplier scoping... All external queries join through this table —
// external users have no direct row visibility otherwise." This service is
// the one place that join happens; other modules consume it via DI
// (exported from rbac/index.ts) rather than querying external_shares
// directly, same as every other cross-module service-injection precedent
// this session (e.g. Documents -> Files' FileUploadService).
@Injectable()
export class ExternalSharesService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly outbox: OutboxService,
  ) {}

  async create(tenantId: string, actorId: string, input: CreateExternalShareInput) {
    return withTenant(this.db, tenantId, async (tx) => {
      const membership = await tx.query.companyUsers.findFirst({
        where: and(eq(companyUsers.tenantId, tenantId), eq(companyUsers.userId, input.principalUserId)),
      });
      if (!membership) throw new UserNotFoundError();

      const [share] = await tx
        .insert(externalShares)
        .values({
          tenantId,
          principalUserId: input.principalUserId,
          audience: input.audience,
          entityType: input.entityType,
          entityId: input.entityId,
          access: input.access,
          expiresAt: input.expiresAt ? new Date(input.expiresAt) : undefined,
          createdBy: actorId,
        })
        .returning();
      const created = share!;

      await this.outbox.append(tx, {
        tenantId,
        eventType: "external_share.created.v1",
        dedupeKey: `external_share.created.v1:${created.id}`,
        actorId,
        payload: {
          companyId: tenantId,
          shareId: created.id,
          principalUserId: input.principalUserId,
          audience: input.audience,
          entityType: input.entityType,
          entityId: input.entityId,
          access: input.access,
        },
      });

      return created;
    });
  }

  async list(tenantId: string, query: ListExternalSharesQuery) {
    return withTenant(this.db, tenantId, (tx) => {
      const conditions: SQL[] = [isNull(externalShares.deletedAt)];
      if (query.principalUserId) conditions.push(eq(externalShares.principalUserId, query.principalUserId));
      if (query.entityType) conditions.push(eq(externalShares.entityType, query.entityType));
      if (query.entityId) conditions.push(eq(externalShares.entityId, query.entityId));
      return tx.query.externalShares.findMany({ where: and(...conditions) });
    });
  }

  // The record-level check architecture.md §11/12 assigns to "the
  // application layer... share scope" — consuming modules call this
  // instead of querying external_shares themselves. Read-only, so it's
  // fine to run in its own withTenant() connection even when the caller
  // (e.g. ChangeOrderLifecycleService.approve()) is mid-transaction —
  // same non-atomic cross-module reuse precedent as Documents -> Files.
  async hasAccess(
    tenantId: string,
    principalUserId: string,
    entityType: string,
    entityId: string,
    access: ExternalShareAccess,
  ): Promise<boolean> {
    return withTenant(this.db, tenantId, async (tx) => {
      const share = await tx.query.externalShares.findFirst({
        where: and(
          eq(externalShares.principalUserId, principalUserId),
          eq(externalShares.entityType, entityType),
          eq(externalShares.entityId, entityId),
          eq(externalShares.access, access),
          isNull(externalShares.deletedAt),
        ),
      });
      if (!share) return false;
      if (share.expiresAt && share.expiresAt.getTime() < Date.now()) return false;
      return true;
    });
  }
}
