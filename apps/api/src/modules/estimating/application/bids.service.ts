import { Inject, Injectable } from "@nestjs/common";
import type { CreateBidInput } from "@constructionos/schemas";
import { eq } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import { bidInvitations, bids } from "../../../infrastructure/db/schema";
import { OutboxService } from "../../events";
import { BidAlreadySubmittedError } from "../domain/errors";
import { BidInvitationsService } from "./bid-invitations.service";

// database.md §10: "bid (amount, inclusions/exclusions jsonb,
// leveled_score)" (FR-EST-6). AI bid-leveling (api.md §5's
// "POST /bid-packages/{id}/level") stays unbuilt — Estimator AI is its
// own later roadmap row, same "AI gets its own row" convention as
// Equipment/Safety AI.
@Injectable()
export class BidsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly outbox: OutboxService,
    private readonly bidInvitations: BidInvitationsService,
  ) {}

  async listForPackage(tenantId: string, bidPackageId: string) {
    return withTenant(this.db, tenantId, (tx) =>
      tx
        .select({ bid: bids })
        .from(bids)
        .innerJoin(bidInvitations, eq(bids.bidInvitationId, bidInvitations.id))
        .where(eq(bidInvitations.bidPackageId, bidPackageId))
        .then((rows) => rows.map((r) => r.bid)),
    );
  }

  async submit(tenantId: string, actorId: string, bidInvitationId: string, input: CreateBidInput) {
    return withTenant(this.db, tenantId, async (tx) => {
      const invitation = await this.bidInvitations.requireInvitation(tx, bidInvitationId);
      const existing = await tx.query.bids.findFirst({ where: eq(bids.bidInvitationId, bidInvitationId) });
      if (existing) throw new BidAlreadySubmittedError();

      const [created] = await tx
        .insert(bids)
        .values({
          tenantId,
          bidInvitationId,
          amount: input.amount,
          inclusionsExclusions: input.inclusionsExclusions,
          submittedAt: new Date(),
          createdBy: actorId,
        })
        .returning();

      await tx.update(bidInvitations).set({ status: "submitted", updatedBy: actorId }).where(eq(bidInvitations.id, invitation.id));

      await this.outbox.append(tx, {
        tenantId,
        eventType: "bid.submitted.v1",
        dedupeKey: `bid.submitted.v1:${created!.id}`,
        actorId,
        payload: { companyId: tenantId, bidInvitationId, bidId: created!.id, amount: created!.amount },
      });

      return created!;
    });
  }
}
