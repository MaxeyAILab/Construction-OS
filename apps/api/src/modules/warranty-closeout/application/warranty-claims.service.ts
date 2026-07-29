import { Inject, Injectable } from "@nestjs/common";
import type { CreateWarrantyClaimInput, UpdateWarrantyClaimInput, WarrantyClaimStatus } from "@constructionos/schemas";
import { and, asc, eq, isNull } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import { warrantyClaims } from "../../../infrastructure/db/schema";
import { OutboxService } from "../../events";
import { ExternalSharesService, PermissionResolverService } from "../../rbac";
import {
  IllegalWarrantyClaimTransitionError,
  WarrantyClaimCreateDeniedError,
  WarrantyClaimNotFoundError,
  WarrantyClaimReadDeniedError,
  WarrantyExpiredError,
} from "../domain/errors";
import { WarrantiesService } from "./warranties.service";

const ALLOWED_TRANSITIONS: Record<WarrantyClaimStatus, WarrantyClaimStatus[]> = {
  submitted: ["acknowledged", "rejected"],
  acknowledged: ["in_progress", "rejected"],
  in_progress: ["resolved", "rejected"],
  resolved: [],
  rejected: [],
};

// FR-CLOSE-5. Dual-path authorization — internal permission or a
// client-portal share on the warranty's *project* (not a per-warranty
// share: requiring a PM to grant one per warranty would be unworkable
// friction for something this routine) — same
// authorizeRead/authorizeCreate shape as PortalMessagesService.
@Injectable()
export class WarrantyClaimsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly outbox: OutboxService,
    private readonly permissions: PermissionResolverService,
    private readonly externalShares: ExternalSharesService,
    private readonly warranties: WarrantiesService,
  ) {}

  async list(tenantId: string, actorId: string, warrantyId: string) {
    return withTenant(this.db, tenantId, async (tx) => {
      const warranty = await this.warranties.requireForClaim(tx, warrantyId);
      await this.authorizeRead(tenantId, actorId, warranty.projectId);

      return tx.query.warrantyClaims.findMany({
        where: and(eq(warrantyClaims.warrantyId, warrantyId), isNull(warrantyClaims.deletedAt)),
        orderBy: [asc(warrantyClaims.createdAt)],
      });
    });
  }

  async create(tenantId: string, actorId: string, warrantyId: string, input: CreateWarrantyClaimInput) {
    return withTenant(this.db, tenantId, async (tx) => {
      const warranty = await this.warranties.requireForClaim(tx, warrantyId);
      await this.authorizeCreate(tenantId, actorId, warranty.projectId);
      if (warranty.dueState === "expired") throw new WarrantyExpiredError();

      const [created] = await tx
        .insert(warrantyClaims)
        .values({ tenantId, warrantyId, description: input.description, createdBy: actorId })
        .returning();

      await this.outbox.append(tx, {
        tenantId,
        eventType: "warranty_claim.created.v1",
        dedupeKey: `warranty_claim.created.v1:${created!.id}`,
        actorId,
        payload: { companyId: tenantId, warrantyId, warrantyClaimId: created!.id },
      });

      return created!;
    });
  }

  // Internal-only lifecycle transitions (api.md §18) — no share fallback,
  // gated on closeout.claim.update at the controller.
  async update(tenantId: string, actorId: string, id: string, input: UpdateWarrantyClaimInput) {
    return withTenant(this.db, tenantId, async (tx) => {
      const existing = await this.requireClaim(tx, id);

      const allowed = ALLOWED_TRANSITIONS[existing.status as WarrantyClaimStatus];
      if (!allowed.includes(input.status)) {
        throw new IllegalWarrantyClaimTransitionError(existing.status, input.status);
      }

      const [updated] = await tx
        .update(warrantyClaims)
        .set({
          status: input.status,
          resolutionNotes: input.resolutionNotes,
          updatedBy: actorId,
          ...((input.status === "resolved" || input.status === "rejected") ? { resolvedAt: new Date() } : {}),
        })
        .where(eq(warrantyClaims.id, id))
        .returning();

      await this.outbox.append(tx, {
        tenantId,
        eventType: "warranty_claim.updated.v1",
        dedupeKey: `warranty_claim.updated.v1:${id}:${Date.now()}`,
        actorId,
        payload: { companyId: tenantId, warrantyId: existing.warrantyId, warrantyClaimId: id, status: input.status },
      });

      return updated!;
    });
  }

  private async requireClaim(tx: Database, id: string) {
    const row = await tx.query.warrantyClaims.findFirst({ where: and(eq(warrantyClaims.id, id), isNull(warrantyClaims.deletedAt)) });
    if (!row) throw new WarrantyClaimNotFoundError();
    return row;
  }

  private async authorizeRead(tenantId: string, actorId: string, projectId: string): Promise<void> {
    const hasPermission = await this.permissions.has(tenantId, actorId, "closeout.claim.read");
    if (hasPermission) return;
    const hasShare = await this.externalShares.hasAccess(tenantId, actorId, "project", projectId, "view");
    if (!hasShare) throw new WarrantyClaimReadDeniedError();
  }

  private async authorizeCreate(tenantId: string, actorId: string, projectId: string): Promise<void> {
    const hasPermission = await this.permissions.has(tenantId, actorId, "closeout.claim.create");
    if (hasPermission) return;
    const hasShare = await this.externalShares.hasAccess(tenantId, actorId, "project", projectId, "comment");
    if (!hasShare) throw new WarrantyClaimCreateDeniedError();
  }
}
