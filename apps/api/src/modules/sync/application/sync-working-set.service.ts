import { Inject, Injectable } from "@nestjs/common";
import { eq, inArray } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import { projectUsers, projects } from "../../../infrastructure/db/schema";
import { DocumentsService, DocumentVersionsService, DrawingSetsService } from "../../documents";

// api.md §16.2: "GET /sync/working-set — Server-computed manifest
// (projects, drawing set, lookback window)." Each assigned project now
// carries its own published drawing set (roadmap.md's "Field tasks/punch +
// drawing viewer offline" row, FR-DOC-5) — a field worker on multiple
// projects gets each project's own pinned set, not one ambiguous top-level
// field. "lookback window" is still deferred (no consuming feature needs
// it yet), same "STUB_HEALTH" precedent as everywhere else this session a
// cross-module field isn't computable.
@Injectable()
export class SyncWorkingSetService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly documents: DocumentsService,
    private readonly documentVersions: DocumentVersionsService,
    private readonly drawingSets: DrawingSetsService,
  ) {}

  async getWorkingSet(tenantId: string, actorId: string) {
    const assignedProjects = await withTenant(this.db, tenantId, async (tx) => {
      const memberships = await tx.query.projectUsers.findMany({ where: eq(projectUsers.userId, actorId) });
      const projectIds = memberships.map((m) => m.projectId);
      return projectIds.length ? tx.query.projects.findMany({ where: inArray(projects.id, projectIds) }) : [];
    });

    const projectSummaries = await Promise.all(
      assignedProjects.map(async (p) => ({
        id: p.id,
        name: p.name,
        code: p.code,
        status: p.status,
        drawingSet: await this.getFieldDrawingSet(tenantId, actorId, p.id),
      })),
    );

    return { projects: projectSummaries, lookbackDays: null };
  }

  private async getFieldDrawingSet(tenantId: string, actorId: string, projectId: string) {
    try {
      await this.documents.authorizeRead(tenantId, actorId, projectId);
    } catch {
      // No docs access for this project — the working set just omits the
      // drawing set rather than failing the whole manifest.
      return null;
    }

    const published = await this.drawingSets.getPublished(tenantId, projectId);
    if (!published) return null;

    const sheets = await Promise.all(
      published.sheets.map(async (sheet) => ({
        documentVersionId: sheet.documentVersionId,
        sortOrder: sheet.sortOrder,
        downloadUrl: await this.documentVersions.getDownloadUrl(tenantId, actorId, sheet.documentVersionId),
      })),
    );

    return { id: published.id, name: published.name, sheets };
  }
}
