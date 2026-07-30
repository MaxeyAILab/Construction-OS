import { Inject, Injectable, Logger } from "@nestjs/common";
import { and, eq, isNull, sql } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import { agentIdentities } from "../../../infrastructure/db/schema";
// Real (non-type-only) import required: NestJS constructor injection
// resolves providers via emitDecoratorMetadata, which needs the actual
// class reference at runtime.
import { ExecutiveBriefingService } from "../../dashboards";
import { AgentIdentitiesService } from "./agent-identities.service";

type ActiveExecutiveBriefingAgentRow = Record<string, unknown> & {
  tenantId: string;
  agentId: string;
  agentUserId: string;
};

// api.md §15.6 "Executive Briefing Agent" (ai-spec.md §7.1: "weekly
// proactive briefing"). Reuses ExecutiveBriefingService.generate — the
// exact same call a human's on-demand `POST /dashboards/company/briefing`
// makes — under the agent's own identity. No draft->act ladder: a briefing
// is a read-derived snapshot with no external effect, same posture as
// §15.4/§15.5's non-consequential writes.
@Injectable()
export class ExecutiveBriefingAgentRunnerService {
  private readonly logger = new Logger(ExecutiveBriefingAgentRunnerService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly agentIdentities: AgentIdentitiesService,
    private readonly executiveBriefing: ExecutiveBriefingService,
  ) {}

  async runTick(): Promise<void> {
    // SECURITY DEFINER cross-tenant enumeration (migration 0135) — see its
    // own doc comment for why this is the one narrow exception to
    // withTenant()-scoped queries here.
    const rows = await this.db.execute<ActiveExecutiveBriefingAgentRow>(
      sql`select tenant_id as "tenantId", agent_id as "agentId", agent_user_id as "agentUserId"
          from get_active_executive_briefing_agents()`,
    );

    for (const agent of Array.from(rows)) {
      try {
        await this.runForAgent(agent.tenantId, agent.agentId, agent.agentUserId);
      } catch (err) {
        this.logger.error(
          `executive briefing agent ${agent.agentId} (tenant ${agent.tenantId}) tick failed: ${errorMessage(err)}`,
        );
      }
    }
  }

  private async runForAgent(tenantId: string, agentId: string, agentUserId: string): Promise<void> {
    // Kill-switch + budget gate — a paused or over-budget agent is
    // skipped for the week entirely, not retried mid-tick.
    await this.agentIdentities.assertCanAct(tenantId, agentUserId);

    // The human who declared this agent is the v1 notification recipient
    // (api.md §15.6's own documented scope cut, same as §15.2's unwired
    // escalation_contacts) — AgentIdentitiesService's own DTO doesn't
    // expose created_by, so this reads it directly off the row.
    const row = await withTenant(this.db, tenantId, (tx) =>
      tx.query.agentIdentities.findFirst({
        where: and(eq(agentIdentities.id, agentId), isNull(agentIdentities.deletedAt)),
        columns: { createdBy: true },
      }),
    );

    await this.executiveBriefing.generate(tenantId, agentUserId, row?.createdBy ?? null, "ai");
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
