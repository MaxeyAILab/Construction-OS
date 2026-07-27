import { Inject, Injectable, Logger } from "@nestjs/common";
import { eq, inArray } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import { costCodes, paymentApplicationLines, paymentApplications, projects } from "../../../infrastructure/db/schema";
import { DocumentsService, DocumentVersionsService } from "../../documents";
import { OutboxService } from "../../events";
import { FileUploadService } from "../../files";
import { renderPaymentApplicationPdf } from "../domain/pdf";
import type { PaymentApplicationPdfJobData } from "./payment-application-pdf.queue";

// The actual work behind PaymentApplicationPdfWorker's BullMQ consumer,
// same split as ExportRunnerService/ExportWorker.
@Injectable()
export class PaymentApplicationPdfRunnerService {
  private readonly logger = new Logger(PaymentApplicationPdfRunnerService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly fileUpload: FileUploadService,
    private readonly documentsService: DocumentsService,
    private readonly documentVersionsService: DocumentVersionsService,
    private readonly outbox: OutboxService,
  ) {}

  async run(data: PaymentApplicationPdfJobData): Promise<void> {
    const { tenantId, actorId, paymentApplicationId } = data;

    try {
      const { app, lines, project } = await withTenant(this.db, tenantId, async (tx) => {
        const app = await tx.query.paymentApplications.findFirst({ where: eq(paymentApplications.id, paymentApplicationId) });
        if (!app) throw new Error(`payment application ${paymentApplicationId} not found`);

        const lines = await tx.query.paymentApplicationLines.findMany({
          where: eq(paymentApplicationLines.paymentApplicationId, paymentApplicationId),
        });
        const costCodeRows = await tx.query.costCodes.findMany({
          where: inArray(costCodes.id, lines.map((l) => l.costCodeId)),
        });
        const codeById = new Map(costCodeRows.map((c) => [c.id, c]));

        const project = await tx.query.projects.findFirst({ where: eq(projects.id, app.projectId) });
        if (!project) throw new Error(`project ${app.projectId} not found`);

        return {
          app,
          project,
          lines: lines.map((line) => ({
            costCodeCode: codeById.get(line.costCodeId)?.code ?? "",
            costCodeName: codeById.get(line.costCodeId)?.name ?? "",
            scheduledValue: line.scheduledValue,
            previousCompleted: line.previousCompleted,
            thisPeriod: line.thisPeriod,
            materialsStored: line.materialsStored,
            completedToDate: line.completedToDate ?? "0.00",
            retainagePct: line.retainagePct,
            retainageAmount: line.retainageAmount ?? "0.00",
          })),
        };
      });

      const buffer = await renderPaymentApplicationPdf({
        projectName: project.name,
        projectCode: project.code,
        periodNumber: app.periodNumber,
        periodEndDate: app.periodEndDate,
        lines,
        totalScheduledValue: app.totalScheduledValue,
        totalCompletedAndStored: app.totalCompletedAndStored,
        totalRetainage: app.totalRetainage,
        currentPaymentDue: app.currentPaymentDue,
      });

      const { fileId } = await this.fileUpload.storeGeneratedFile(tenantId, actorId, {
        filename: `payment-application-${app.periodNumber}.pdf`,
        contentType: "application/pdf",
        buffer,
      });

      let documentId = app.documentId;
      if (!documentId) {
        const document = await this.documentsService.create(tenantId, actorId, app.projectId, {
          name: `Payment Application #${app.periodNumber}`,
          category: "report",
        });
        documentId = document.id;
      }

      const version = await this.documentVersionsService.createVersionFromGeneratedFile(tenantId, actorId, documentId, fileId);

      await withTenant(this.db, tenantId, async (tx) => {
        await tx
          .update(paymentApplications)
          .set({ pdfStatus: "ready", documentId, pdfDocumentVersionId: version.id, updatedBy: actorId })
          .where(eq(paymentApplications.id, paymentApplicationId));

        await this.outbox.append(tx, {
          tenantId,
          eventType: "payment_application.pdf_generated.v1",
          dedupeKey: `payment_application.pdf_generated.v1:${paymentApplicationId}:${version.id}`,
          actorId,
          payload: { companyId: tenantId, paymentApplicationId, documentVersionId: version.id },
        });
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`payment application pdf ${paymentApplicationId} failed: ${message}`);
      await withTenant(this.db, tenantId, (tx) =>
        tx.update(paymentApplications).set({ pdfStatus: "failed", updatedBy: actorId }).where(eq(paymentApplications.id, paymentApplicationId)),
      );
      throw err;
    }
  }
}
