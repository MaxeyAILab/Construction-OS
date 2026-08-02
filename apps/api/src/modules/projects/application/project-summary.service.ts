import { Inject, Injectable } from "@nestjs/common";
import { count, eq } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import { costCodes, milestones, projectUsers, projects } from "../../../infrastructure/db/schema";
import { FinancialSummaryService } from "../../budgets";
import { RfisService } from "../../rfis";
import { SchedulesService } from "../../scheduling";
import { TasksService } from "../../tasks";
import { ProjectNotFoundError } from "../domain/errors";

// FR-PM-3: "command center summarizing all modules for that project:
// health, schedule variance, margin, open items — served from
// projections." margin comes from FinancialSummaryService (M9),
// scheduleVariance from SchedulesService.getVarianceSummary (M7, null
// until a baseline exists), openItems from Tasks/RFIs countOpen (M6/M3).
// Each is read via the owning module's public barrel surface, gated once
// on this endpoint's own projects.project.read permission — same
// "aggregate reads across modules without re-checking each one's granular
// permission" precedent as DashboardsService.getCompany.
@Injectable()
export class ProjectSummaryService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly financialSummary: FinancialSummaryService,
    private readonly schedules: SchedulesService,
    private readonly tasks: TasksService,
    private readonly rfis: RfisService,
  ) {}

  async get(tenantId: string, projectId: string) {
    const project = await withTenant(this.db, tenantId, (tx) =>
      tx.query.projects.findFirst({ where: eq(projects.id, projectId) }),
    );
    if (!project) throw new ProjectNotFoundError();

    const [[memberCount], [costCodeCount], [milestoneStats], margin, scheduleVariance, openTasks, openRfis] =
      await Promise.all([
        withTenant(this.db, tenantId, (tx) =>
          tx.select({ value: count() }).from(projectUsers).where(eq(projectUsers.projectId, projectId)),
        ),
        withTenant(this.db, tenantId, (tx) =>
          tx.select({ value: count() }).from(costCodes).where(eq(costCodes.projectId, projectId)),
        ),
        withTenant(this.db, tenantId, (tx) =>
          tx
            .select({
              total: count(),
              completed: count(milestones.completedAt),
            })
            .from(milestones)
            .where(eq(milestones.projectId, projectId)),
        ),
        this.financialSummary.get(tenantId, projectId),
        this.schedules.getVarianceSummary(tenantId, projectId),
        this.tasks.countOpen(tenantId, projectId),
        this.rfis.countOpen(tenantId, projectId),
      ]);

    return {
      projectId,
      status: project.status,
      health: project.health,
      team: { memberCount: memberCount?.value ?? 0 },
      costCodes: { count: costCodeCount?.value ?? 0 },
      milestones: {
        total: milestoneStats?.total ?? 0,
        completed: milestoneStats?.completed ?? 0,
      },
      scheduleVariance,
      margin: { amount: margin.marginAmount, pct: margin.marginPct },
      openItems: { tasks: openTasks, rfis: openRfis },
    };
  }
}
