import { Inject, Injectable } from "@nestjs/common";
import { and, count, eq, isNull, lt, notInArray } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import {
  projectionCompanyKpis,
  projectionProjectFinancials,
  projects,
  rfis,
  scheduleActivities,
  schedules,
  tasks,
} from "../../../infrastructure/db/schema";
import { ProjectNotFoundError } from "../domain/errors";

const OPEN_TASK_STATUSES = ["done", "cancelled"];
const CLOSED_RFI_STATUSES = ["closed", "void"];

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

// FR-EXEC-1/NFR-4 (M16). Reads the event-maintained projection tables
// (database.md §21) for the profitability rollup — O(1), not re-summing
// every budget line on every request — plus a handful of cheap indexed
// live counts for the "risk" KPI (schedule_activities.is_critical,
// tasks.due_date/status, rfis.status all already have the composite
// indexes those filters need). "pipeline"/"cash" stay null: no CRM (M1) or
// AP/AR-invoicing module exists this session to source them from — see
// dashboards.ts's schema comment.
@Injectable()
export class DashboardsService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async getCompany(tenantId: string) {
    return withTenant(this.db, tenantId, async (tx) => {
      const kpis = await tx.query.projectionCompanyKpis.findFirst({
        where: eq(projectionCompanyKpis.tenantId, tenantId),
      });

      const [criticalActivities] = await tx
        .select({ value: count() })
        .from(scheduleActivities)
        .innerJoin(schedules, eq(scheduleActivities.scheduleId, schedules.id))
        .where(
          and(
            eq(schedules.tenantId, tenantId),
            eq(schedules.kind, "master"),
            eq(scheduleActivities.isCritical, true),
            isNull(scheduleActivities.deletedAt),
          ),
        );

      const [overdueTasks] = await tx
        .select({ value: count() })
        .from(tasks)
        .where(
          and(
            eq(tasks.tenantId, tenantId),
            isNull(tasks.deletedAt),
            lt(tasks.dueDate, today()),
            notInArray(tasks.status, OPEN_TASK_STATUSES),
          ),
        );

      const [openRfis] = await tx
        .select({ value: count() })
        .from(rfis)
        .where(and(eq(rfis.tenantId, tenantId), isNull(rfis.deletedAt), notInArray(rfis.status, CLOSED_RFI_STATUSES)));

      return {
        tenantId,
        projectCount: kpis?.projectCount ?? 0,
        activeProjectCount: kpis?.activeProjectCount ?? 0,
        // Naive sum across every project's projection row — assumes a
        // single-currency portfolio (the common case: one tenant, one
        // country). A true multi-currency rollup needs FX conversion;
        // database.md has no exchange-rate table, so that's out of scope,
        // not silently wrong-by-omission — flagged here for whenever a
        // multi-currency tenant shows up.
        profitability: {
          totalRevisedAmount: kpis?.totalRevisedAmount ?? "0.00",
          totalActualAmount: kpis?.totalActualAmount ?? "0.00",
          totalForecastAtCompletionAmount: kpis?.totalForecastAtCompletionAmount ?? "0.00",
          totalMarginAmount: kpis?.totalMarginAmount ?? null,
        },
        risk: {
          criticalActivityCount: criticalActivities?.value ?? 0,
          overdueTaskCount: overdueTasks?.value ?? 0,
          openRfiCount: openRfis?.value ?? 0,
        },
        // Blocked — see dashboards.ts's schema comment.
        pipelineValueAmount: kpis?.pipelineValueAmount ?? null,
        cashPositionAmount: kpis?.cashPositionAmount ?? null,
        overdueArAmount: kpis?.overdueArAmount ?? null,
        safetyTrir: kpis?.safetyTrir ?? null,
        updatedAt: kpis?.updatedAt ?? null,
      };
    });
  }

  async getProject(tenantId: string, projectId: string) {
    return withTenant(this.db, tenantId, async (tx) => {
      const project = await tx.query.projects.findFirst({
        where: and(eq(projects.id, projectId), isNull(projects.deletedAt)),
      });
      if (!project) throw new ProjectNotFoundError();

      const financials = await tx.query.projectionProjectFinancials.findFirst({
        where: and(
          eq(projectionProjectFinancials.tenantId, tenantId),
          eq(projectionProjectFinancials.projectId, projectId),
        ),
      });

      const [criticalActivities] = await tx
        .select({ value: count() })
        .from(scheduleActivities)
        .innerJoin(schedules, eq(scheduleActivities.scheduleId, schedules.id))
        .where(
          and(
            eq(schedules.projectId, projectId),
            eq(schedules.kind, "master"),
            eq(scheduleActivities.isCritical, true),
            isNull(scheduleActivities.deletedAt),
          ),
        );

      const [overdueTasks] = await tx
        .select({ value: count() })
        .from(tasks)
        .where(
          and(
            eq(tasks.projectId, projectId),
            isNull(tasks.deletedAt),
            lt(tasks.dueDate, today()),
            notInArray(tasks.status, OPEN_TASK_STATUSES),
          ),
        );

      const [openRfis] = await tx
        .select({ value: count() })
        .from(rfis)
        .where(and(eq(rfis.projectId, projectId), isNull(rfis.deletedAt), notInArray(rfis.status, CLOSED_RFI_STATUSES)));

      return {
        projectId,
        name: project.name,
        code: project.code,
        status: project.status,
        health: project.health,
        // null until a budget exists for this project (FinancialSummaryService
        // has the same "no active budget yet" nullability).
        profitability: financials
          ? {
              currency: financials.currency,
              originalTotalAmount: financials.originalTotalAmount,
              revisedTotalAmount: financials.revisedTotalAmount,
              committedTotalAmount: financials.committedTotalAmount,
              actualTotalAmount: financials.actualTotalAmount,
              costToCompleteAmount: financials.costToCompleteAmount,
              forecastAtCompletionAmount: financials.forecastAtCompletionAmount,
              marginAmount: financials.marginAmount,
              marginPct: financials.marginPct,
            }
          : null,
        risk: {
          criticalActivityCount: criticalActivities?.value ?? 0,
          overdueTaskCount: overdueTasks?.value ?? 0,
          openRfiCount: openRfis?.value ?? 0,
        },
        updatedAt: financials?.updatedAt ?? null,
      };
    });
  }
}
