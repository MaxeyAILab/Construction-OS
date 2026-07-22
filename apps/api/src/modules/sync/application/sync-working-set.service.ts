import { Inject, Injectable } from "@nestjs/common";
import { eq, inArray } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import { projectUsers, projects } from "../../../infrastructure/db/schema";

// api.md §16.2: "GET /sync/working-set — Server-computed manifest
// (projects, drawing set, lookback window)." v1 returns assigned projects
// only — "current drawing set" and "lookback window" need the later,
// separate roadmap rows (photo pipeline, daily reports) this row's own
// dependency ordering defers to; returning a well-shaped manifest with
// just the real part now, same "STUB_HEALTH" precedent as everywhere else
// this session a cross-module field isn't computable yet.
@Injectable()
export class SyncWorkingSetService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async getWorkingSet(tenantId: string, userId: string) {
    return withTenant(this.db, tenantId, async (tx) => {
      const memberships = await tx.query.projectUsers.findMany({ where: eq(projectUsers.userId, userId) });
      const projectIds = memberships.map((m) => m.projectId);

      const assignedProjects = projectIds.length
        ? await tx.query.projects.findMany({ where: inArray(projects.id, projectIds) })
        : [];

      return {
        projects: assignedProjects.map((p) => ({ id: p.id, name: p.name, code: p.code, status: p.status })),
        drawingSet: null,
        lookbackDays: null,
      };
    });
  }
}
