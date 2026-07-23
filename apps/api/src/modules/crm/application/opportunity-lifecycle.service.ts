import { Inject, Injectable } from "@nestjs/common";
import type { LoseOpportunityInput, WinOpportunityInput } from "@constructionos/schemas";
import { and, eq, isNull } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import { opportunities } from "../../../infrastructure/db/schema";
import { OutboxService } from "../../events";
import { ProjectsService } from "../../projects";
import { OpportunityNotFoundError, OpportunityNotOpenError } from "../domain/errors";

// FR-CRM-4 / api.md §4: "Atomic: marks won, creates project (+links
// estimate) — zero re-entry." ProjectsService.create() opens its own
// withTenant() transaction internally and has no way to participate in a
// caller's transaction without a much more invasive cross-module
// signature change — so this is a two-phase write (create the project,
// then link it back), not one atomic DB transaction. Same bounded
// "two-phase-write looseness" this codebase already accepts elsewhere
// (CostTransactionsService.postFromTimeEntry's own documented precedent):
// if the second phase fails, the project exists but isn't linked back to
// the opportunity — a real, documented risk, not hidden. True atomicity
// would require either ProjectsService accepting an external transaction
// handle (invasive, touches every existing caller) or CRM inserting
// directly into the projects table (violates "modules communicate only
// via public surface" — the harder rule to break).
@Injectable()
export class OpportunityLifecycleService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly outbox: OutboxService,
    private readonly projectsService: ProjectsService,
  ) {}

  async win(tenantId: string, actorId: string, opportunityId: string, input: WinOpportunityInput) {
    const opportunity = await withTenant(this.db, tenantId, (tx) => this.requireOpenOpportunity(tx, opportunityId));

    const project = await this.projectsService.create(tenantId, actorId, {
      name: opportunity.name,
      code: input.project.code,
      clientContactCompanyId: opportunity.contactCompanyId ?? undefined,
      startDate: input.project.startDate,
      targetEndDate: input.project.targetEndDate,
      contractValueAmount: opportunity.expectedValueAmount,
      currency: opportunity.currency,
      templateId: input.project.templateId,
    });

    return withTenant(this.db, tenantId, async (tx) => {
      // Re-verify: something could have changed the opportunity's status
      // between the read above and now (the project-creation call ran
      // outside any transaction this method holds).
      await this.requireOpenOpportunity(tx, opportunityId);

      const [updatedOpportunity] = await tx
        .update(opportunities)
        .set({ status: "won", wonProjectId: project.id, updatedBy: actorId })
        .where(eq(opportunities.id, opportunityId))
        .returning();

      await this.outbox.append(tx, {
        tenantId,
        eventType: "opportunity.won.v1",
        dedupeKey: `opportunity.won.v1:${opportunityId}`,
        actorId,
        payload: { companyId: tenantId, opportunityId, wonProjectId: project.id },
      });

      return { opportunity: updatedOpportunity!, project };
    });
  }

  async lose(tenantId: string, actorId: string, opportunityId: string, input: LoseOpportunityInput) {
    return withTenant(this.db, tenantId, async (tx) => {
      await this.requireOpenOpportunity(tx, opportunityId);

      const [updated] = await tx
        .update(opportunities)
        .set({ status: "lost", lostReason: input.lostReason, updatedBy: actorId })
        .where(eq(opportunities.id, opportunityId))
        .returning();

      await this.outbox.append(tx, {
        tenantId,
        eventType: "opportunity.lost.v1",
        dedupeKey: `opportunity.lost.v1:${opportunityId}`,
        actorId,
        payload: { companyId: tenantId, opportunityId, lostReason: input.lostReason },
      });

      return updated!;
    });
  }

  private async requireOpenOpportunity(tx: Database, id: string) {
    const row = await tx.query.opportunities.findFirst({ where: and(eq(opportunities.id, id), isNull(opportunities.deletedAt)) });
    if (!row) throw new OpportunityNotFoundError();
    if (row.status !== "open") throw new OpportunityNotOpenError();
    return row;
  }
}
