import { Inject, Injectable, Logger } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { DATABASE, type Database } from "../../../infrastructure/db/client";
import { ComplianceAlertsService } from "../../compliance-alerts";
// Real (non-type-only) imports required: NestJS constructor injection
// resolves providers via emitDecoratorMetadata, which needs the actual
// class reference at runtime.
import { CertificationsService } from "../../safety";
import { AgentIdentitiesService } from "./agent-identities.service";

type ActiveComplianceAgentRow = Record<string, unknown> & {
  tenantId: string;
  agentId: string;
  agentUserId: string;
};

// api.md §15.4 "Compliance Agent" (ai-spec.md §15: "chase expiring
// certs/insurance with sub-portal messages"). Reuses CertificationsService's
// existing due-state computation unchanged — this agent adds no new
// expiry logic, only the daily scan + append-only alert feed. The
// "sub-portal messages" half of the spec has no channel to send through
// yet (api.md §15.4's explicit scope cut) — this pass ends at a
// queryable, attributed alert a human chases from.
@Injectable()
export class ComplianceAgentRunnerService {
  private readonly logger = new Logger(ComplianceAgentRunnerService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly agentIdentities: AgentIdentitiesService,
    private readonly certifications: CertificationsService,
    private readonly complianceAlerts: ComplianceAlertsService,
  ) {}

  async runTick(): Promise<void> {
    // SECURITY DEFINER cross-tenant enumeration (migration 0125) — see its
    // own doc comment for why this is the one narrow exception to
    // withTenant()-scoped queries here.
    const rows = await this.db.execute<ActiveComplianceAgentRow>(
      sql`select tenant_id as "tenantId", agent_id as "agentId", agent_user_id as "agentUserId"
          from get_active_compliance_agents()`,
    );

    for (const agent of Array.from(rows)) {
      try {
        await this.runForAgent(agent.tenantId, agent.agentUserId);
      } catch (err) {
        this.logger.error(
          `compliance agent ${agent.agentId} (tenant ${agent.tenantId}) tick failed: ${errorMessage(err)}`,
        );
      }
    }
  }

  private async runForAgent(tenantId: string, agentUserId: string): Promise<void> {
    // Kill-switch + budget gate — a paused or over-budget agent is
    // skipped for the day entirely, not retried mid-tick.
    await this.agentIdentities.assertCanAct(tenantId, agentUserId);

    const expiring = await this.certifications.list(tenantId, { expiringOnly: true, limit: 100 });

    for (const cert of expiring.data) {
      // Only subcontractor-held certifications are this agent's concern
      // ("sub compliance" per roadmap.md's dependency) — a user-held
      // certification (e.g. a crew member's OSHA card) is Safety's own
      // concern, not chased here. dueState is 'valid' | 'expiring_soon' |
      // 'expired' here since expiringOnly already filtered to the window.
      if (!cert.holderSubcontractorId) continue;
      if (cert.dueState !== "expiring_soon" && cert.dueState !== "expired") continue;
      if (!cert.expiresAt) continue;

      try {
        await this.complianceAlerts.raiseIfNew(
          tenantId,
          agentUserId,
          {
            certificationId: cert.id,
            subcontractorId: cert.holderSubcontractorId,
            dueState: cert.dueState,
            expiresAt: cert.expiresAt,
          },
          "ai",
        );
      } catch (err) {
        this.logger.error(
          `compliance agent alert failed for certification ${cert.id} (tenant ${tenantId}): ${errorMessage(err)}`,
        );
      }
    }
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
