import { Inject, Injectable } from "@nestjs/common";
import type { CreatePaymentApplicationInput, CreatePaymentApplicationLineInput, ListPaymentApplicationsQuery } from "@constructionos/schemas";
import { and, eq, isNull, sql } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import { costCodes, paymentApplicationLines, paymentApplications, projects } from "../../../infrastructure/db/schema";
import { OutboxService } from "../../events";
import {
  CostCodeNotOnProjectError,
  NoClientForProjectError,
  PaymentApplicationAlreadyApprovedError,
  PaymentApplicationNotDraftError,
  PaymentApplicationNotFoundError,
  PaymentApplicationNotSubmittedError,
  ProjectNotFoundError,
} from "../domain/errors";
import { InvoicesService } from "./invoices.service";
import { PaymentApplicationPdfQueue } from "./payment-application-pdf.queue";

// database.md §11 (FR-FIN-4): AIA-style progress billing. Lives in the
// Finance module (not Budgets) for the same reason InvoicesService does
// — it needs InvoicesService to bill the client on approval, and Budgets
// can't depend on anything that (transitively) depends back on it.
@Injectable()
export class PaymentApplicationsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly outbox: OutboxService,
    private readonly invoicesService: InvoicesService,
    private readonly pdfQueue: PaymentApplicationPdfQueue,
  ) {}

  async listForProject(tenantId: string, projectId: string, query: ListPaymentApplicationsQuery) {
    return withTenant(this.db, tenantId, (tx) => {
      const conditions = [eq(paymentApplications.projectId, projectId), isNull(paymentApplications.deletedAt)];
      if (query.status) conditions.push(eq(paymentApplications.status, query.status));
      return tx.query.paymentApplications.findMany({
        where: and(...conditions),
        orderBy: (t, { desc }) => [desc(t.periodNumber)],
      });
    });
  }

  async getById(tenantId: string, id: string) {
    return withTenant(this.db, tenantId, async (tx) => {
      const app = await this.requirePaymentApplication(tx, id);
      const lines = await tx.query.paymentApplicationLines.findMany({
        where: eq(paymentApplicationLines.paymentApplicationId, id),
      });
      return { ...app, lines };
    });
  }

  async create(tenantId: string, actorId: string, projectId: string, input: CreatePaymentApplicationInput) {
    return withTenant(this.db, tenantId, async (tx) => {
      const project = await tx.query.projects.findFirst({ where: eq(projects.id, projectId) });
      if (!project) throw new ProjectNotFoundError();

      for (const line of input.lines) {
        const costCode = await tx.query.costCodes.findFirst({
          where: and(eq(costCodes.id, line.costCodeId), eq(costCodes.projectId, projectId)),
        });
        if (!costCode) throw new CostCodeNotOnProjectError();
      }

      const [maxPeriodRow] = await tx
        .select({ maxPeriod: sql<number | null>`max(${paymentApplications.periodNumber})` })
        .from(paymentApplications)
        .where(eq(paymentApplications.projectId, projectId));
      const periodNumber = (maxPeriodRow!.maxPeriod ?? 0) + 1;

      const [app] = await tx
        .insert(paymentApplications)
        .values({ tenantId, projectId, periodNumber, periodEndDate: input.periodEndDate, createdBy: actorId })
        .returning();
      const created = app!;

      await tx.insert(paymentApplicationLines).values(
        input.lines.map((line) => ({
          tenantId,
          paymentApplicationId: created.id,
          costCodeId: line.costCodeId,
          scheduledValue: line.scheduledValue,
          previousCompleted: line.previousCompleted ?? "0.00",
          thisPeriod: line.thisPeriod,
          materialsStored: line.materialsStored ?? "0.00",
          retainagePct: line.retainagePct ?? "0.00",
          createdBy: actorId,
        })),
      );

      const withTotals = await this.recomputeTotals(tx, created.id, actorId);

      await this.outbox.append(tx, {
        tenantId,
        eventType: "payment_application.created.v1",
        dedupeKey: `payment_application.created.v1:${created.id}`,
        actorId,
        payload: { companyId: tenantId, projectId, paymentApplicationId: created.id, periodNumber },
      });

      const lines = await tx.query.paymentApplicationLines.findMany({
        where: eq(paymentApplicationLines.paymentApplicationId, created.id),
      });
      return { ...withTotals, lines };
    });
  }

  async addLine(tenantId: string, actorId: string, id: string, input: CreatePaymentApplicationLineInput) {
    return withTenant(this.db, tenantId, async (tx) => {
      const app = await this.requirePaymentApplication(tx, id);
      if (app.status !== "draft") throw new PaymentApplicationNotDraftError();

      const costCode = await tx.query.costCodes.findFirst({
        where: and(eq(costCodes.id, input.costCodeId), eq(costCodes.projectId, app.projectId)),
      });
      if (!costCode) throw new CostCodeNotOnProjectError();

      const [line] = await tx
        .insert(paymentApplicationLines)
        .values({
          tenantId,
          paymentApplicationId: id,
          costCodeId: input.costCodeId,
          scheduledValue: input.scheduledValue,
          previousCompleted: input.previousCompleted ?? "0.00",
          thisPeriod: input.thisPeriod,
          materialsStored: input.materialsStored ?? "0.00",
          retainagePct: input.retainagePct ?? "0.00",
          createdBy: actorId,
        })
        .returning();

      await this.recomputeTotals(tx, id, actorId);
      return line!;
    });
  }

  async submit(tenantId: string, actorId: string, id: string) {
    return withTenant(this.db, tenantId, async (tx) => {
      const app = await this.requirePaymentApplication(tx, id);
      if (app.status !== "draft") throw new PaymentApplicationNotDraftError();

      const [updated] = await tx
        .update(paymentApplications)
        .set({ status: "submitted", updatedBy: actorId })
        .where(eq(paymentApplications.id, id))
        .returning();
      return updated!;
    });
  }

  // FR-FIN-4: approval bills the client via a real receivable invoice —
  // one invoice line per cost code, amount = this_period + materials_
  // stored - retainage_amount (the net new amount due this period; prior
  // periods were already billed by earlier payment applications).
  // InvoicesService.create() runs its own transaction (Finance's own
  // service, so no cross-module two-phase-write concern), called after
  // this transaction commits.
  async approve(tenantId: string, actorId: string, id: string) {
    const { app, lines, project } = await withTenant(this.db, tenantId, async (tx) => {
      const app = await this.requirePaymentApplication(tx, id);
      if (app.status !== "submitted") throw new PaymentApplicationNotSubmittedError();

      const project = await tx.query.projects.findFirst({ where: eq(projects.id, app.projectId) });
      if (!project) throw new ProjectNotFoundError();
      if (!project.clientContactCompanyId) throw new NoClientForProjectError();

      const lines = await tx.query.paymentApplicationLines.findMany({
        where: eq(paymentApplicationLines.paymentApplicationId, id),
      });

      return { app, lines, project };
    });

    const invoice = await this.invoicesService.create(tenantId, actorId, {
      direction: "receivable",
      counterpartyType: "client",
      counterpartyId: project.clientContactCompanyId!,
      projectId: app.projectId,
      issueDate: app.periodEndDate,
      lines: lines.map((line) => ({
        costCodeId: line.costCodeId,
        description: `Pay App #${app.periodNumber}`,
        amount: (Number(line.thisPeriod) + Number(line.materialsStored) - Number(line.retainageAmount)).toFixed(2),
      })),
    });

    return withTenant(this.db, tenantId, async (tx) => {
      const [approved] = await tx
        .update(paymentApplications)
        .set({ status: "approved", invoiceId: invoice.id, updatedBy: actorId })
        .where(eq(paymentApplications.id, id))
        .returning();

      await this.outbox.append(tx, {
        tenantId,
        eventType: "payment_application.approved.v1",
        dedupeKey: `payment_application.approved.v1:${id}`,
        actorId,
        payload: {
          companyId: tenantId,
          projectId: app.projectId,
          paymentApplicationId: id,
          invoiceId: invoice.id,
          currentPaymentDue: approved!.currentPaymentDue,
        },
      });

      return approved!;
    });
  }

  // api.md §10: "POST {id}/generate-pdf -> 202" — enqueue-and-poll, same
  // shape as Imports/Exports' CSV export pipeline.
  async requestPdf(tenantId: string, actorId: string, id: string) {
    const app = await withTenant(this.db, tenantId, async (tx) => {
      await this.requirePaymentApplication(tx, id);
      const [updated] = await tx
        .update(paymentApplications)
        .set({ pdfStatus: "generating", updatedBy: actorId })
        .where(eq(paymentApplications.id, id))
        .returning();
      return updated!;
    });

    await this.pdfQueue.enqueue({ tenantId, actorId, paymentApplicationId: id });
    return app;
  }

  async void(tenantId: string, actorId: string, id: string) {
    return withTenant(this.db, tenantId, async (tx) => {
      const app = await this.requirePaymentApplication(tx, id);
      if (app.status === "approved") throw new PaymentApplicationAlreadyApprovedError();

      const [voided] = await tx
        .update(paymentApplications)
        .set({ status: "void", updatedBy: actorId })
        .where(eq(paymentApplications.id, id))
        .returning();

      await this.outbox.append(tx, {
        tenantId,
        eventType: "payment_application.voided.v1",
        dedupeKey: `payment_application.voided.v1:${id}`,
        actorId,
        payload: { companyId: tenantId, paymentApplicationId: id },
      });

      return voided!;
    });
  }

  async requirePaymentApplication(tx: Database, id: string) {
    const app = await tx.query.paymentApplications.findFirst({
      where: and(eq(paymentApplications.id, id), isNull(paymentApplications.deletedAt)),
    });
    if (!app) throw new PaymentApplicationNotFoundError();
    return app;
  }

  private async recomputeTotals(tx: Database, paymentApplicationId: string, actorId: string) {
    const lines = await tx.query.paymentApplicationLines.findMany({
      where: eq(paymentApplicationLines.paymentApplicationId, paymentApplicationId),
    });

    const totalScheduledValue = lines.reduce((sum, l) => sum + Number(l.scheduledValue), 0);
    const totalCompletedAndStored = lines.reduce((sum, l) => sum + Number(l.completedToDate), 0);
    const totalRetainage = lines.reduce((sum, l) => sum + Number(l.retainageAmount), 0);
    const currentPaymentDue = lines.reduce(
      (sum, l) => sum + Number(l.thisPeriod) + Number(l.materialsStored) - Number(l.retainageAmount),
      0,
    );

    const [updated] = await tx
      .update(paymentApplications)
      .set({
        totalScheduledValue: totalScheduledValue.toFixed(2),
        totalCompletedAndStored: totalCompletedAndStored.toFixed(2),
        totalRetainage: totalRetainage.toFixed(2),
        currentPaymentDue: currentPaymentDue.toFixed(2),
        updatedBy: actorId,
      })
      .where(eq(paymentApplications.id, paymentApplicationId))
      .returning();
    return updated!;
  }
}
