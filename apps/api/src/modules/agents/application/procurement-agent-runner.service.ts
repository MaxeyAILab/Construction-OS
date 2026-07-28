import { Inject, Injectable, Logger } from "@nestjs/common";
import { and, eq, isNull, sql } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import { projects } from "../../../infrastructure/db/schema";
// Real (non-type-only) imports required: NestJS constructor injection
// resolves providers via emitDecoratorMetadata, which needs the actual
// class reference at runtime.
import { ProcurementNeedsService, PurchaseOrderLifecycleService } from "../../procurement";
import { AgentIdentitiesService } from "./agent-identities.service";

type ActiveProcurementAgentRow = Record<string, unknown> & {
  tenantId: string;
  agentId: string;
  agentUserId: string;
};

// api.md §15.2 "Procurement Agent" (ai-spec.md §15: "watch schedule/stock
// -> draft+route POs end-to-end"). The first concrete "planned agent"
// built on Agent Runtime GA's identity/budget/kill-switch scaffolding —
// everything here composes existing use-cases (ProcurementNeedsService.
// draftFromNeeds, PurchaseOrderLifecycleService.submit) under the agent's
// own userId, per ai-spec.md law #1 ("same rails as humans... no AI side
// door"). Driven by ProcurementAgentWorker's daily BullMQ repeatable job.
@Injectable()
export class ProcurementAgentRunnerService {
  private readonly logger = new Logger(ProcurementAgentRunnerService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly agentIdentities: AgentIdentitiesService,
    private readonly procurementNeeds: ProcurementNeedsService,
    private readonly lifecycle: PurchaseOrderLifecycleService,
  ) {}

  async runTick(): Promise<void> {
    // SECURITY DEFINER cross-tenant enumeration (migration 0121) — see its
    // own doc comment for why this is the one narrow exception to
    // withTenant()-scoped queries here.
    const rows = await this.db.execute<ActiveProcurementAgentRow>(
      sql`select tenant_id as "tenantId", agent_id as "agentId", agent_user_id as "agentUserId"
          from get_active_procurement_agents()`,
    );

    for (const agent of Array.from(rows)) {
      try {
        await this.runForAgent(agent.tenantId, agent.agentUserId);
      } catch (err) {
        this.logger.error(
          `procurement agent ${agent.agentId} (tenant ${agent.tenantId}) tick failed: ${errorMessage(err)}`,
        );
      }
    }
  }

  private async runForAgent(tenantId: string, agentUserId: string): Promise<void> {
    // Kill-switch + budget gate — a paused or over-budget agent is
    // skipped for the day entirely, not retried mid-tick.
    await this.agentIdentities.assertCanAct(tenantId, agentUserId);

    // Agent roles are always company-scoped (AgentIdentitiesService.create
    // only offers scopeType: "company"), so "watch schedule/stock" is
    // every active project in the tenant — no separate "watched projects"
    // config to resolve.
    const activeProjects = await withTenant(this.db, tenantId, (tx) =>
      tx
        .select({ id: projects.id })
        .from(projects)
        .where(and(eq(projects.tenantId, tenantId), eq(projects.status, "active"), isNull(projects.deletedAt))),
    );

    for (const { id: projectId } of activeProjects) {
      try {
        const result = await this.procurementNeeds.draftFromNeeds(tenantId, agentUserId, projectId, "ai");
        for (const purchaseOrderId of result.draftedPurchaseOrderIds) {
          // "Route" = submit into the human approval queue — sending to
          // the supplier stays a human-executed act (ai-spec.md §7.4).
          await this.lifecycle.submit(tenantId, agentUserId, purchaseOrderId, "ai");
        }
      } catch (err) {
        this.logger.error(
          `procurement agent draft/route failed for project ${projectId} (tenant ${tenantId}): ${errorMessage(err)}`,
        );
      }
    }
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
