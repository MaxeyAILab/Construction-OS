import { Inject, Injectable, Logger } from "@nestjs/common";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import { projects } from "../../../infrastructure/db/schema";
// Real (non-type-only) import required: NestJS constructor injection
// resolves providers via emitDecoratorMetadata, which needs the actual
// class reference at runtime.
import { CloseoutPackagesService } from "../../warranty-closeout";
import { AgentIdentitiesService } from "./agent-identities.service";

type ActiveCloseoutAgentRow = Record<string, unknown> & {
  tenantId: string;
  agentId: string;
  agentUserId: string;
};

// api.md §15.5 "Closeout Agent" (ai-spec.md §15: "assemble O&M/warranty
// package"). Unlike §15.2/§15.3, there is no draft->act ladder here —
// assembling a package has no external effect (api.md §18's own
// delivery-to-client scope cut), so this agent runs at 'act' from day
// one, same posture as §15.4's alert-raising. It calls the exact same
// CloseoutPackagesService.assemble() a human's `:assemble` button calls,
// under its own identity — no separate "AI draft" endpoint exists.
@Injectable()
export class CloseoutAgentRunnerService {
  private readonly logger = new Logger(CloseoutAgentRunnerService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly agentIdentities: AgentIdentitiesService,
    private readonly packages: CloseoutPackagesService,
  ) {}

  async runTick(): Promise<void> {
    // SECURITY DEFINER cross-tenant enumeration (migration 0129) — see its
    // own doc comment for why this is the one narrow exception to
    // withTenant()-scoped queries here.
    const rows = await this.db.execute<ActiveCloseoutAgentRow>(
      sql`select tenant_id as "tenantId", agent_id as "agentId", agent_user_id as "agentUserId"
          from get_active_closeout_agents()`,
    );

    for (const agent of Array.from(rows)) {
      try {
        await this.runForAgent(agent.tenantId, agent.agentUserId);
      } catch (err) {
        this.logger.error(`closeout agent ${agent.agentId} (tenant ${agent.tenantId}) tick failed: ${errorMessage(err)}`);
      }
    }
  }

  private async runForAgent(tenantId: string, agentUserId: string): Promise<void> {
    // Kill-switch + budget gate — a paused or over-budget agent is
    // skipped for the day entirely, not retried mid-tick.
    await this.agentIdentities.assertCanAct(tenantId, agentUserId);

    // Only post-construction projects are ever closeout-ready — an
    // 'active'/'planning' project is never a candidate, so scoping here
    // avoids re-checking every project in the tenant daily.
    const candidateProjects = await withTenant(this.db, tenantId, (tx) =>
      tx
        .select({ id: projects.id })
        .from(projects)
        .where(
          and(eq(projects.tenantId, tenantId), inArray(projects.status, ["closed", "warranty"]), isNull(projects.deletedAt)),
        ),
    );

    for (const { id: projectId } of candidateProjects) {
      try {
        // This agent only ever catches the *first* moment a project
        // becomes ready — a later re-assembly is a deliberate human
        // action via :assemble, not something the agent repeats.
        const { history } = await this.packages.getStatus(tenantId, projectId);
        if (history.length > 0) continue;

        // "Not ready yet" is the expected steady state for most projects
        // on most days — checked via isReady() rather than catching
        // assemble()'s own thrown errors, so this runner never has to
        // distinguish domain-error types across the module boundary.
        if (!(await this.packages.isReady(tenantId, projectId))) continue;

        await this.packages.assemble(tenantId, agentUserId, projectId, "ai");
      } catch (err) {
        this.logger.error(`closeout agent assembly failed for project ${projectId} (tenant ${tenantId}): ${errorMessage(err)}`);
      }
    }
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
