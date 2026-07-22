import { Inject, Injectable } from "@nestjs/common";
import { count, eq } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import { costCodes, milestones, projectUsers, projects } from "../../../infrastructure/db/schema";
import { ProjectNotFoundError } from "../domain/errors";

// FR-PM-3: "command center summarizing all modules for that project:
// health, schedule variance, margin, open items — served from
// projections." Schedule (M7), Finance (M9), and Tasks/RFIs (M6/M3) don't
// exist yet, so scheduleVariance/margin/openItems are structurally present
// but null — real values arrive once those modules land and start
// maintaining this projection. Team/cost-code/milestone counts are real
// today since Projects owns that data directly.
@Injectable()
export class ProjectSummaryService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async get(tenantId: string, projectId: string) {
    return withTenant(this.db, tenantId, async (tx) => {
      const project = await tx.query.projects.findFirst({ where: eq(projects.id, projectId) });
      if (!project) throw new ProjectNotFoundError();

      const [[memberCount], [costCodeCount], [milestoneStats]] = await Promise.all([
        tx.select({ value: count() }).from(projectUsers).where(eq(projectUsers.projectId, projectId)),
        tx.select({ value: count() }).from(costCodes).where(eq(costCodes.projectId, projectId)),
        tx
          .select({
            total: count(),
            completed: count(milestones.completedAt),
          })
          .from(milestones)
          .where(eq(milestones.projectId, projectId)),
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
        // Not built yet — see class doc comment.
        scheduleVariance: null,
        margin: null,
        openItems: null,
      };
    });
  }
}
