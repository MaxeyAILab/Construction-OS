import { Inject, Injectable, Logger } from "@nestjs/common";
import type { ReportKind } from "@constructionos/schemas";
import { eq } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import { reportDefinitions, reportRuns } from "../../../infrastructure/db/schema";
import { DocumentsService, DocumentVersionsService } from "../../documents";
import { OutboxService } from "../../events";
import { FileUploadService } from "../../files";
import { type ReportPdfRow, renderReportPdf } from "../domain/report-pdf";
import { DashboardsService } from "./dashboards.service";
import type { ReportJobData } from "./reports.queue";

interface ReportContent {
  projectId: string | null;
  title: string;
  rows: ReportPdfRow[];
}

// The actual work behind ReportWorker's BullMQ consumer, same split as
// PaymentApplicationPdfRunnerService/PaymentApplicationPdfWorker.
@Injectable()
export class ReportRunnerService {
  private readonly logger = new Logger(ReportRunnerService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly dashboards: DashboardsService,
    private readonly fileUpload: FileUploadService,
    private readonly documentsService: DocumentsService,
    private readonly documentVersionsService: DocumentVersionsService,
    private readonly outbox: OutboxService,
  ) {}

  async run(data: ReportJobData): Promise<void> {
    const { tenantId, actorId, reportDefinitionId, reportRunId } = data;
    const startedAt = Date.now();

    await withTenant(this.db, tenantId, (tx) =>
      tx.update(reportRuns).set({ status: "running" }).where(eq(reportRuns.id, reportRunId)),
    );

    try {
      const definition = await withTenant(this.db, tenantId, (tx) =>
        tx.query.reportDefinitions.findFirst({ where: eq(reportDefinitions.id, reportDefinitionId) }),
      );
      if (!definition) throw new Error(`report definition ${reportDefinitionId} not found`);

      const { title, rows, projectId } = await this.buildContent(tenantId, definition);

      const buffer = await renderReportPdf({ title, generatedAt: new Date().toISOString(), rows });

      const { fileId } = await this.fileUpload.storeGeneratedFile(tenantId, actorId, {
        filename: `${slugify(definition.name)}-${reportRunId}.pdf`,
        contentType: "application/pdf",
        buffer,
      });

      // Company-scoped runs have no project to file a Documents entry
      // under (documents.project_id is NOT NULL) — see report_runs'
      // schema comment. Only project-scoped runs additionally get filed.
      let documentId: string | null = null;
      let documentVersionId: string | null = null;
      if (projectId) {
        const document = await this.documentsService.create(tenantId, actorId, projectId, {
          name: definition.name,
          category: "report",
        });
        const version = await this.documentVersionsService.createVersionFromGeneratedFile(tenantId, actorId, document.id, fileId);
        documentId = document.id;
        documentVersionId = version.id;
      }

      await withTenant(this.db, tenantId, async (tx) => {
        await tx
          .update(reportRuns)
          .set({
            status: "completed",
            fileId,
            documentId,
            documentVersionId,
            durationMs: Date.now() - startedAt,
            updatedBy: actorId,
          })
          .where(eq(reportRuns.id, reportRunId));

        await this.outbox.append(tx, {
          tenantId,
          eventType: "report_run.completed.v1",
          dedupeKey: `report_run.completed.v1:${reportRunId}`,
          actorId,
          payload: { companyId: tenantId, reportDefinitionId, reportRunId },
        });
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`report run ${reportRunId} failed: ${message}`);
      await withTenant(this.db, tenantId, (tx) =>
        tx
          .update(reportRuns)
          .set({ status: "failed", error: message, durationMs: Date.now() - startedAt, updatedBy: actorId })
          .where(eq(reportRuns.id, reportRunId)),
      );
      throw err;
    }
  }

  // Both kinds are backed entirely by DashboardsService's existing
  // aggregates — "numeric truth from SQL, not tokens", same precedent as
  // every AI-Gateway-adjacent report/summary tool this session, except
  // there's no AI call at all here: a report is a literal, deterministic
  // snapshot of what the dashboard already shows.
  private async buildContent(
    tenantId: string,
    definition: typeof reportDefinitions.$inferSelect,
  ): Promise<ReportContent> {
    if ((definition.kind as ReportKind) === "project_summary") {
      const params = definition.params as { projectId: string };
      const summary = await this.dashboards.getProject(tenantId, params.projectId);
      return {
        projectId: params.projectId,
        title: `Project Summary — ${summary.name}`,
        rows: [
          { label: "Project", value: `${summary.name} (${summary.code})` },
          { label: "Status", value: summary.status },
          // No "Health" row: projects.health is an unimplemented stub
          // (all-null fields, projects.service.ts's own STUB_HEALTH) —
          // same "flag it, don't invent a value for it" treatment as
          // that column's existing precedent elsewhere.
          { label: "Revised Budget", value: summary.profitability?.revisedTotalAmount ?? "—" },
          { label: "Actual Cost", value: summary.profitability?.actualTotalAmount ?? "—" },
          { label: "Forecast at Completion", value: summary.profitability?.forecastAtCompletionAmount ?? "—" },
          { label: "Margin %", value: summary.profitability?.marginPct ?? "—" },
          { label: "Critical Activities", value: String(summary.risk.criticalActivityCount) },
          { label: "Overdue Tasks", value: String(summary.risk.overdueTaskCount) },
          { label: "Open RFIs", value: String(summary.risk.openRfiCount) },
        ],
      };
    }

    const summary = await this.dashboards.getCompany(tenantId);
    return {
      projectId: null,
      title: "Company Portfolio Summary",
      rows: [
        { label: "Total Projects", value: String(summary.projectCount) },
        { label: "Active Projects", value: String(summary.activeProjectCount) },
        { label: "Total Revised Amount", value: summary.profitability.totalRevisedAmount },
        { label: "Total Actual Amount", value: summary.profitability.totalActualAmount },
        { label: "Total Forecast at Completion", value: summary.profitability.totalForecastAtCompletionAmount },
        { label: "Total Margin", value: summary.profitability.totalMarginAmount ?? "—" },
        { label: "Critical Activities", value: String(summary.risk.criticalActivityCount) },
        { label: "Overdue Tasks", value: String(summary.risk.overdueTaskCount) },
        { label: "Open RFIs", value: String(summary.risk.openRfiCount) },
      ],
    };
  }
}

function slugify(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "report";
}
