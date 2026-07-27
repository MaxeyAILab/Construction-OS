import { Inject, Injectable } from "@nestjs/common";
import type { CreateBidInvitationInput } from "@constructionos/schemas";
import { and, eq } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import { bidInvitations } from "../../../infrastructure/db/schema";
import { OutboxService } from "../../events";
import { SubcontractorsService } from "../../subcontractors";
import { BidInvitationNotFoundError, DuplicateBidInvitationError } from "../domain/errors";
import { BidPackagesService } from "./bid-packages.service";

// database.md §10: "invitation (sub + due date + status)" (FR-EST-6).
@Injectable()
export class BidInvitationsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly outbox: OutboxService,
    private readonly bidPackages: BidPackagesService,
    private readonly subcontractors: SubcontractorsService,
  ) {}

  async listForPackage(tenantId: string, bidPackageId: string) {
    return withTenant(this.db, tenantId, (tx) =>
      tx.query.bidInvitations.findMany({
        where: eq(bidInvitations.bidPackageId, bidPackageId),
        orderBy: (t, { desc }) => [desc(t.createdAt)],
      }),
    );
  }

  // FR-SUB-2: eligibility gated at invitation time — an ineligible sub
  // (expired compliance doc) can't be invited to bid.
  async create(tenantId: string, actorId: string, bidPackageId: string, input: CreateBidInvitationInput) {
    await this.subcontractors.requireEligible(tenantId, input.subcontractorId);

    return withTenant(this.db, tenantId, async (tx) => {
      await this.bidPackages.requireBidPackage(tx, bidPackageId);
      await this.subcontractors.requireSubcontractor(tx, input.subcontractorId);

      const existing = await tx.query.bidInvitations.findFirst({
        where: and(eq(bidInvitations.bidPackageId, bidPackageId), eq(bidInvitations.subcontractorId, input.subcontractorId)),
      });
      if (existing) throw new DuplicateBidInvitationError();

      const [created] = await tx
        .insert(bidInvitations)
        .values({
          tenantId,
          bidPackageId,
          subcontractorId: input.subcontractorId,
          dueDate: input.dueDate,
          createdBy: actorId,
        })
        .returning();

      await this.outbox.append(tx, {
        tenantId,
        eventType: "bid_invitation.created.v1",
        dedupeKey: `bid_invitation.created.v1:${created!.id}`,
        actorId,
        payload: {
          companyId: tenantId,
          bidPackageId,
          bidInvitationId: created!.id,
          subcontractorId: input.subcontractorId,
        },
      });

      return created!;
    });
  }

  async requireInvitation(tx: Database, id: string) {
    const row = await tx.query.bidInvitations.findFirst({ where: eq(bidInvitations.id, id) });
    if (!row) throw new BidInvitationNotFoundError();
    return row;
  }
}
