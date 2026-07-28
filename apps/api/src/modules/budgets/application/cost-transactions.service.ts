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

  // FR-PLAT-8: read-only lookup for AccountingSyncService's conflict
  // resolution — it needs the original transaction's projectId/costCodeId
  // to post a "keep_remote" adjustment on the same project/cost code, and
  // a plain read is the appropriate cross-module surface for that (same
  // "own connection" precedent as PurchaseOrdersService.getLineById()).
  async getById(tenantId: string, id: string) {
    return withTenant(this.db, tenantId, (tx) => tx.query.costTransactions.findFirst({ where: eq(costTransactions.id, id) }));
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

  // FR-INV-2: "record ... consumption and value them into job costs."
  // Called from StockService (inventory/index.ts's public surface —
  // cross-module reuse, same "broaden an existing module's public
  // surface" precedent as postFromTimeEntry) in its own transaction, not
  // nested inside the caller's — same two-phase-write looseness.
  async postFromInventoryIssue(
    tenantId: string,
    actorId: string,
    projectId: string,
    input: { costCodeId: string; stockMovementId: string; txnDate: string; amount: string; qty: string; uom: string },
  ) {
    return withTenant(this.db, tenantId, (tx) =>
      this.post(tx, tenantId, actorId, projectId, {
        costCodeId: input.costCodeId,
        source: "inventory_issue",
        sourceId: input.stockMovementId,
        txnDate: input.txnDate,
        amount: input.amount,
        qty: input.qty,
        uom: input.uom,
        memo: null,
      }),
    );
  }

  // FR-EQ-2: "allocate equipment cost to job costing." Called from
  // UsageLogsService (equipment/index.ts's public surface — cross-module
  // reuse, same "broaden an existing module's public surface" precedent as
  // postFromTimeEntry/postFromInventoryIssue) in its own transaction, not
  // nested inside the caller's — same two-phase-write looseness.
  async postFromEquipmentUsage(
    tenantId: string,
    actorId: string,
    projectId: string,
    input: { costCodeId: string; equipmentUsageLogId: string; txnDate: string; amount: string; qty?: string; uom?: string },
  ) {
    return withTenant(this.db, tenantId, (tx) =>
      this.post(tx, tenantId, actorId, projectId, {
        costCodeId: input.costCodeId,
        source: "equipment_usage",
        sourceId: input.equipmentUsageLogId,
        txnDate: input.txnDate,
        amount: input.amount,
        qty: input.qty,
        uom: input.uom,
        memo: null,
      }),
    );
  }

  // FR-VEND-2/FR-SUB-3: "process supplier/sub invoices into ... actual
  // costs." Called from InvoicesService.approve() (Finance module,
  // index.ts's public surface — cross-module reuse, same "broaden an
  // existing module's public surface" precedent as postFromTimeEntry/
  // postFromInventoryIssue/postFromEquipmentUsage) in its own
  // transaction, not nested inside the caller's — same two-phase-write
  // looseness.
  async postFromInvoiceLine(
    tenantId: string,
    actorId: string,
    projectId: string,
    input: {
      costCodeId: string;
      source: "supplier_invoice" | "sub_invoice";
      invoiceLineId: string;
      txnDate: string;
      amount: string;
      qty?: string | null;
      uom?: string | null;
    },
  ) {
    return withTenant(this.db, tenantId, (tx) =>
      this.post(tx, tenantId, actorId, projectId, {
        costCodeId: input.costCodeId,
        source: input.source,
        sourceId: input.invoiceLineId,
        txnDate: input.txnDate,
        amount: input.amount,
        qty: input.qty,
        uom: input.uom,
        memo: null,
      }),
    );
  }

  // FR-PLAT-8: pull-side reconciliation. Called from
  // AccountingSyncRunnerService (accounting/index.ts's public surface —
  // cross-module reuse, same "broaden an existing module's public surface"
  // precedent as postFromTimeEntry/postFromInventoryIssue/
  // postFromEquipmentUsage/postFromInvoiceLine) when a QuickBooks-side edit
  // to a previously-pushed cost_transaction is accepted (conflict resolved
  // "keep_remote") — posts the delta as a new ledger row rather than
  // mutating the original, same "append-only ledger" discipline as every
  // other cost_transactions writer. amount is the signed delta
  // (remote - local), not the remote total.
  async postFromAccountingSync(
    tenantId: string,
    actorId: string,
    projectId: string,
    input: { costCodeId: string; externalId: string; txnDate: string; amount: string; memo?: string | null },
  ) {
    return withTenant(this.db, tenantId, (tx) =>
      this.post(tx, tenantId, actorId, projectId, {
        costCodeId: input.costCodeId,
        source: "accounting_sync",
        // sourceId is a uuid FK-shaped column with no local row to point
        // at here — the QuickBooks-side id (an arbitrary string, not a
        // uuid) belongs in externalRef instead (database.md §11:
        // "external_ref (accounting id)"), same column invoices/payments
        // use for the same purpose.
        sourceId: null,
        externalRef: input.externalId,
        txnDate: input.txnDate,
        amount: input.amount,
        qty: null,
        uom: null,
        memo: input.memo ?? "QuickBooks reconciliation adjustment",
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
      source:
        | "manual"
        | "time_entry"
        | "inventory_issue"
        | "equipment_usage"
        | "supplier_invoice"
        | "sub_invoice"
        | "accounting_sync";
      sourceId: string | null;
      externalRef?: string | null | undefined;
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
        externalRef: input.externalRef,
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
