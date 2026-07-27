import { Inject, Injectable } from "@nestjs/common";
import type { CreateReportDefinitionInput, ListReportDefinitionsQuery, UpdateReportDefinitionInput } from "@constructionos/schemas";
import { and, desc, eq, isNull, lt, or, type SQL } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import { reportDefinitions, reportRuns } from "../../../infrastructure/db/schema";
import { OutboxService } from "../../events";
import { FileUploadService } from "../../files";
import { ReportDefinitionNotFoundError, ReportRunNotFoundError } from "../domain/errors";
import { ReportsQueue } from "./reports.queue";

interface Cursor {
  createdAt: string;
  id: string;
}

function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify(c)).toString("base64url");
}

function decodeCursor(raw: string): Cursor {
  return JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Cursor;
}

// api.md §14 (M16 Reports & Dashboards, FR-EXEC-2): "GET/POST/PATCH
// /reports/definitions | POST .../run | GET /reports/runs/{id}." Formerly
// flagged out of scope in DashboardsController's own doc comment ("a
// scheduled-report/PDF-XLSX-artifact job pipeline is substantial new
// infrastructure") — this is that deferred row, built now under Phase 3's
// "Portfolio analytics & custom report builder."
@Injectable()
export class ReportsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly outbox: OutboxService,
    private readonly queue: ReportsQueue,
    private readonly fileUpload: FileUploadService,
  ) {}

  async list(tenantId: string, query: ListReportDefinitionsQuery) {
    return withTenant(this.db, tenantId, async (tx) => {
      const conditions: SQL[] = [isNull(reportDefinitions.deletedAt)];
      if (query.cursor) {
        const c = decodeCursor(query.cursor);
        conditions.push(
          or(
            lt(reportDefinitions.createdAt, new Date(c.createdAt)),
            and(eq(reportDefinitions.createdAt, new Date(c.createdAt)), lt(reportDefinitions.id, c.id))!,
          )!,
        );
      }

      const rows = await tx.query.reportDefinitions.findMany({
        where: and(...conditions),
        orderBy: [desc(reportDefinitions.createdAt), desc(reportDefinitions.id)],
        limit: query.limit + 1,
      });

      const hasMore = rows.length > query.limit;
      const page = rows.slice(0, query.limit);
      const last = page.at(-1);
      const nextCursor = hasMore && last ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id }) : null;

      return { data: page, meta: { cursor: nextCursor, hasMore } };
    });
  }

  async create(tenantId: string, actorId: string, input: CreateReportDefinitionInput) {
    return withTenant(this.db, tenantId, async (tx) => {
      const [row] = await tx
        .insert(reportDefinitions)
        .values({
          tenantId,
          name: input.name,
          kind: input.kind,
          params: input.kind === "project_summary" ? input.params : null,
          schedule: input.schedule,
          recipients: input.recipients,
          createdBy: actorId,
        })
        .returning();
      const created = row!;

      await this.outbox.append(tx, {
        tenantId,
        eventType: "report_definition.created.v1",
        dedupeKey: `report_definition.created.v1:${created.id}`,
        actorId,
        payload: { companyId: tenantId, reportDefinitionId: created.id, kind: created.kind },
      });

      return created;
    });
  }

  async getDefinition(tenantId: string, id: string) {
    return withTenant(this.db, tenantId, (tx) => this.requireDefinition(tx, id));
  }

  async update(tenantId: string, actorId: string, id: string, input: UpdateReportDefinitionInput) {
    return withTenant(this.db, tenantId, async (tx) => {
      await this.requireDefinition(tx, id);

      const [updated] = await tx
        .update(reportDefinitions)
        .set({ ...input, updatedBy: actorId })
        .where(eq(reportDefinitions.id, id))
        .returning();

      await this.outbox.append(tx, {
        tenantId,
        eventType: "report_definition.updated.v1",
        dedupeKey: `report_definition.updated.v1:${id}:${Date.now()}`,
        actorId,
        payload: { companyId: tenantId, reportDefinitionId: id, changedFields: Object.keys(input) },
      });

      return updated!;
    });
  }

  // api.md §14: "POST /reports/definitions/{id}/run -> 202 -> job ->
  // artifact." Enqueues and returns immediately — ReportRunnerService (run
  // by ReportWorker) does the actual rendering, same split as
  // ExportsService/PaymentApplicationsService's PDF pipeline.
  async requestRun(tenantId: string, actorId: string, reportDefinitionId: string) {
    await this.getDefinition(tenantId, reportDefinitionId);

    const run = await withTenant(this.db, tenantId, async (tx) => {
      const [row] = await tx
        .insert(reportRuns)
        .values({ tenantId, reportDefinitionId, status: "queued", createdBy: actorId })
        .returning();
      return row!;
    });

    await this.queue.enqueue({ tenantId, actorId, reportDefinitionId, reportRunId: run.id });
    return run;
  }

  // api.md §14: "GET /reports/runs/{id} | Status + signed download" — one
  // endpoint returns both, unlike Exports' separate status/download-url
  // endpoints (api.md's own wording differs between the two rows).
  async getRun(tenantId: string, id: string) {
    const run = await withTenant(this.db, tenantId, async (tx) => {
      const row = await tx.query.reportRuns.findFirst({ where: eq(reportRuns.id, id) });
      if (!row) throw new ReportRunNotFoundError();
      return row;
    });

    const downloadUrl = run.status === "completed" && run.fileId ? await this.fileUpload.getDownloadUrl(tenantId, run.fileId) : null;
    return { ...run, downloadUrl };
  }

  private async requireDefinition(tx: Database, id: string) {
    const row = await tx.query.reportDefinitions.findFirst({
      where: and(eq(reportDefinitions.id, id), isNull(reportDefinitions.deletedAt)),
    });
    if (!row) throw new ReportDefinitionNotFoundError();
    return row;
  }
}
