import { Inject, Injectable } from "@nestjs/common";
import type { CreateManualCostTransactionInput } from "@constructionos/schemas";
import { and, eq } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import { budgetLines, budgets, costCodes, costTransactions } from "../../../infrastructure/db/schema";
import { OutboxService } from "../../events";
import { CostCodeNotOnProjectError } from "../domain/errors";

@Injectable()
export class CostTransactionsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly outbox: OutboxService,
  ) {}

  async list(tenantId: string, projectId: string) {
    return withTenant(this.db, tenantId, (tx) =>
      tx.query.costTransactions.findMany({
        where: eq(costTransactions.projectId, projectId),
        orderBy: (t, { desc }) => [desc(t.txnDate), desc(t.id)],
      }),
    );
  }

  // database.md §11: "actual_amount [is] maintained by ... use-cases in
  // the same transaction as the source rows ... no reconciliation job."
  // If the project has no active budget yet, or no line for this cost
  // code yet, the ledger entry still posts — actuals arriving ahead of
  // budget setup is a normal real-world sequence, not an error.
  async postManual(
    tenantId: string,
    actorId: string,
    projectId: string,
    input: CreateManualCostTransactionInput,
  ) {
    return withTenant(this.db, tenantId, (tx) =>
      this.post(tx, tenantId, actorId, projectId, {
        costCodeId: input.costCodeId,
        source: "manual",
        sourceId: null,
        txnDate: input.txnDate,
        amount: input.amount,
        qty: input.qty,
        uom: input.uom,
        memo: input.memo,
      }),
    );
  }

  // FR-FIELD-2: "Approval -> cost_transactions at labor rate." Called from
  // TimeEntriesService (budgets/index.ts's public surface — cross-module
  // reuse, same "broaden an existing module's public surface" precedent as
  // TasksService being reused by the sync mutation engine) in its own
  // transaction, not nested inside the caller's — same two-phase-write
  // looseness sync-mutations.service.ts already accepts between applying a
  // mutation and recording it.
  async postFromTimeEntry(
    tenantId: string,
    actorId: string,
    projectId: string,
    input: { costCodeId: string; timeEntryId: string; txnDate: string; amount: string; qty: string },
  ) {
    return withTenant(this.db, tenantId, (tx) =>
      this.post(tx, tenantId, actorId, projectId, {
        costCodeId: input.costCodeId,
        source: "time_entry",
        sourceId: input.timeEntryId,
        txnDate: input.txnDate,
        amount: input.amount,
        qty: input.qty,
        uom: "hr",
        memo: null,
      }),
    );
  }

  private async post(
    tx: Database,
    tenantId: string,
    actorId: string,
    projectId: string,
    input: {
      costCodeId: string;
      source: "manual" | "time_entry";
      sourceId: string | null;
      txnDate: string;
      amount: string;
      qty?: string | null | undefined;
      uom?: string | null | undefined;
      memo?: string | null | undefined;
    },
  ) {
    const costCode = await tx.query.costCodes.findFirst({
      where: and(eq(costCodes.id, input.costCodeId), eq(costCodes.projectId, projectId)),
    });
    if (!costCode) throw new CostCodeNotOnProjectError();

    const [txn] = await tx
      .insert(costTransactions)
      .values({
        tenantId,
        projectId,
        costCodeId: input.costCodeId,
        source: input.source,
        sourceId: input.sourceId,
        txnDate: input.txnDate,
        amount: input.amount,
        qty: input.qty,
        uom: input.uom,
        memo: input.memo,
        createdBy: actorId,
      })
      .returning();
    const created = txn!;

    const budget = await tx.query.budgets.findFirst({
      where: and(eq(budgets.projectId, projectId), eq(budgets.status, "active")),
    });
    if (budget) {
      const line = await tx.query.budgetLines.findFirst({
        where: and(eq(budgetLines.budgetId, budget.id), eq(budgetLines.costCodeId, input.costCodeId)),
      });
      if (line) {
        const newActual = (Number(line.actualAmount) + Number(input.amount)).toFixed(2);
        const revised = Number(line.originalAmount) + Number(line.approvedChangesAmount);
        const newForecastToComplete = (revised - Number(newActual)).toFixed(2);
        await tx
          .update(budgetLines)
          .set({
            actualAmount: newActual,
            forecastToCompleteAmount: newForecastToComplete,
            forecastAtCompletionAmount: (Number(newActual) + Number(newForecastToComplete)).toFixed(2),
            updatedBy: actorId,
          })
          .where(eq(budgetLines.id, line.id));
      }
    }

    await this.outbox.append(tx, {
      tenantId,
      eventType: "cost_transaction.posted.v1",
      dedupeKey: `cost_transaction.posted.v1:${created.id}`,
      actorId,
      payload: {
        companyId: tenantId,
        projectId,
        costCodeId: input.costCodeId,
        costTransactionId: created.id,
        source: input.source,
        amount: input.amount,
      },
    });

    return created;
  }
}
