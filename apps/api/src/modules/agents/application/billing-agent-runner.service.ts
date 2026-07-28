import { Inject, Injectable, Logger } from "@nestjs/common";
import { and, eq, isNull, sql } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import { projects } from "../../../infrastructure/db/schema";
import { BudgetService } from "../../budgets";
import { PaymentApplicationsService } from "../../finance";
// Real (non-type-only) imports required: NestJS constructor injection
// resolves providers via emitDecoratorMetadata, which needs the actual
// class reference at runtime.
import { SchedulesService } from "../../scheduling";
import { AgentIdentitiesService } from "./agent-identities.service";

type ActiveBillingAgentRow = Record<string, unknown> & {
  tenantId: string;
  agentId: string;
  agentUserId: string;
};

// api.md §15.3 "Billing Agent" (ai-spec.md §15: "assemble monthly pay-app
// from progress data -> route for approval"). Composes existing
// use-cases (BudgetService.getByProject, SchedulesService.
// getActiveSchedule, PaymentApplicationsService.create/submit) under the
// agent's own userId — same "same rails as humans, no AI side door" law
// as ProcurementAgentRunnerService. Driven by BillingAgentWorker's
// monthly BullMQ repeatable job.
@Injectable()
export class BillingAgentRunnerService {
  private readonly logger = new Logger(BillingAgentRunnerService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly agentIdentities: AgentIdentitiesService,
    private readonly budgetService: BudgetService,
    private readonly schedulesService: SchedulesService,
    private readonly paymentApplications: PaymentApplicationsService,
  ) {}

  async runTick(): Promise<void> {
    // SECURITY DEFINER cross-tenant enumeration (migration 0122) — see its
    // own doc comment for why this is the one narrow exception to
    // withTenant()-scoped queries here.
    const rows = await this.db.execute<ActiveBillingAgentRow>(
      sql`select tenant_id as "tenantId", agent_id as "agentId", agent_user_id as "agentUserId"
          from get_active_billing_agents()`,
    );

    for (const agent of Array.from(rows)) {
      try {
        await this.runForAgent(agent.tenantId, agent.agentUserId);
      } catch (err) {
        this.logger.error(`billing agent ${agent.agentId} (tenant ${agent.tenantId}) tick failed: ${errorMessage(err)}`);
      }
    }
  }

  private async runForAgent(tenantId: string, agentUserId: string): Promise<void> {
    // Kill-switch + budget gate — a paused or over-budget agent is
    // skipped for the month entirely, not retried mid-tick.
    await this.agentIdentities.assertCanAct(tenantId, agentUserId);

    // Agent roles are always company-scoped, same reasoning as
    // ProcurementAgentRunnerService — no separate "watched projects" config.
    const activeProjects = await withTenant(this.db, tenantId, (tx) =>
      tx
        .select({ id: projects.id })
        .from(projects)
        .where(and(eq(projects.tenantId, tenantId), eq(projects.status, "active"), isNull(projects.deletedAt))),
    );

    for (const { id: projectId } of activeProjects) {
      try {
        await this.assembleAndRoute(tenantId, agentUserId, projectId);
      } catch (err) {
        this.logger.error(
          `billing agent assemble/route failed for project ${projectId} (tenant ${tenantId}): ${errorMessage(err)}`,
        );
      }
    }
  }

  // api.md §15.3: percent-complete-by-cost-code rollup (unweighted mean of
  // schedule_activities.percent_complete across a cost code's linked
  // activities) feeds this_period = %complete x scheduled_value -
  // previous_completed. A cost code with no linked activities produces no
  // line — left for a human to bill manually, not guessed at.
  private async assembleAndRoute(tenantId: string, agentUserId: string, projectId: string): Promise<void> {
    const [budget, { activities }, previousCompletedByCostCode] = await Promise.all([
      this.budgetService.getByProject(tenantId, projectId),
      this.schedulesService.getActiveSchedule(tenantId, agentUserId, projectId),
      this.latestPreviousCompletedByCostCode(tenantId, projectId),
    ]);

    const percentsByCostCode = new Map<string, number[]>();
    for (const activity of activities) {
      if (!activity.costCodeId) continue;
      const percents = percentsByCostCode.get(activity.costCodeId) ?? [];
      percents.push(Number(activity.percentComplete));
      percentsByCostCode.set(activity.costCodeId, percents);
    }

    const lines: { costCodeId: string; scheduledValue: string; previousCompleted: string; thisPeriod: string }[] = [];
    for (const line of budget.lines) {
      const percents = percentsByCostCode.get(line.costCodeId);
      if (!percents || percents.length === 0) continue;

      const percentComplete = percents.reduce((sum, p) => sum + p, 0) / percents.length;
      const scheduledValue = Number(line.revisedAmount);
      const previousCompleted = Number(previousCompletedByCostCode.get(line.costCodeId) ?? "0.00");
      const thisPeriod = Math.max(0, (percentComplete / 100) * scheduledValue - previousCompleted);
      if (thisPeriod <= 0) continue;

      lines.push({
        costCodeId: line.costCodeId,
        scheduledValue: scheduledValue.toFixed(2),
        previousCompleted: previousCompleted.toFixed(2),
        thisPeriod: thisPeriod.toFixed(2),
      });
    }

    // No cost code produced forward progress this period — skip rather
    // than create an empty pay app, same "unresolvable need" precedent as
    // ProcurementAgentRunnerService.
    if (lines.length === 0) return;

    const periodEndDate = new Date().toISOString().slice(0, 10);
    const created = await this.paymentApplications.create(tenantId, agentUserId, projectId, { periodEndDate, lines }, "ai");
    // "Route" = submit into the human approval queue — approving (which
    // bills the client) stays a human-executed act, same meaning as
    // §15.2's "route" for Procurement.
    await this.paymentApplications.submit(tenantId, agentUserId, created.id);
  }

  // The most recent non-void payment application is the billing sequence's
  // last word on what's already been invoiced per cost code — a void one
  // never actually billed the client, so it doesn't carry forward.
  private async latestPreviousCompletedByCostCode(tenantId: string, projectId: string): Promise<Map<string, string>> {
    const existing = await this.paymentApplications.listForProject(tenantId, projectId, { limit: 100 });
    const latest = existing.find((app) => app.status !== "void");
    if (!latest) return new Map();

    const { lines } = await this.paymentApplications.getById(tenantId, latest.id);
    return new Map(lines.map((line) => [line.costCodeId, line.completedToDate ?? "0.00"]));
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
