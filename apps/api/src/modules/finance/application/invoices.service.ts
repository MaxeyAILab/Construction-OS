import { Inject, Injectable } from "@nestjs/common";
import type { CreateInvoiceInput, CreateInvoiceLineInput, ListInvoicesQuery } from "@constructionos/schemas";
import { and, desc, eq, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import { costCodes, invoiceLines, invoices, payments, projects } from "../../../infrastructure/db/schema";
import { CostTransactionsService } from "../../budgets";
import { ContactCompaniesService } from "../../crm";
import { OutboxService } from "../../events";
import { PurchaseOrdersService, SuppliersService } from "../../procurement";
import { SubcontractorsService } from "../../subcontractors";
import {
  CostCodeNotOnProjectError,
  InvoiceMismatchedError,
  InvoiceNotDraftError,
  InvoiceNotFoundError,
  ProjectNotFoundError,
} from "../domain/errors";

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

type MatchStatus = "unmatched" | "two_way_matched" | "three_way_matched" | "mismatched";

// database.md §11 (api.md §10; FR-VEND-2, FR-SUB-3). Unified AP/AR
// invoices — a separate module from Budgets (not folded into it) purely
// to avoid a NestJS module cycle: Procurement already transitively
// depends on Budgets (via Inventory, for job-costing postings), so
// Budgets can't import Procurement back without a 3-hop cycle. Finance
// sits strictly above Budgets/Procurement/Subcontractors/Crm instead —
// same "api.md section groupings don't force one NestJS module"
// precedent as Change Orders being its own module despite sharing api.md
// §10 with Budgets. Counterparty existence is validated against
// whichever module owns that counterparty type (cross-module service
// reuse via each module's public index.ts surface). 2-/3-way matching is
// computed against PurchaseOrdersService.getLineById() — a read-only,
// non-atomic cross-module call, same "own connection" precedent as
// ExternalSharesService.hasAccess().
@Injectable()
export class InvoicesService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly outbox: OutboxService,
    private readonly purchaseOrders: PurchaseOrdersService,
    private readonly suppliers: SuppliersService,
    private readonly subcontractors: SubcontractorsService,
    private readonly contactCompanies: ContactCompaniesService,
    private readonly costTransactions: CostTransactionsService,
  ) {}

  async list(tenantId: string, query: ListInvoicesQuery) {
    return withTenant(this.db, tenantId, async (tx) => {
      const conditions: SQL[] = [isNull(invoices.deletedAt)];
      if (query.direction) conditions.push(eq(invoices.direction, query.direction));
      if (query.projectId) conditions.push(eq(invoices.projectId, query.projectId));
      if (query.status) conditions.push(eq(invoices.status, query.status));
      if (query.cursor) {
        const c = decodeCursor(query.cursor);
        conditions.push(
          or(
            lt(invoices.createdAt, new Date(c.createdAt)),
            and(eq(invoices.createdAt, new Date(c.createdAt)), lt(invoices.id, c.id))!,
          )!,
        );
      }

      const rows = await tx.query.invoices.findMany({
        where: and(...conditions),
        orderBy: [desc(invoices.createdAt), desc(invoices.id)],
        limit: query.limit + 1,
      });

      const hasMore = rows.length > query.limit;
      const page = rows.slice(0, query.limit);
      const last = page.at(-1);
      const nextCursor = hasMore && last ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id }) : null;

      return { data: page, meta: { cursor: nextCursor, hasMore } };
    });
  }

  async getById(tenantId: string, id: string) {
    return withTenant(this.db, tenantId, async (tx) => {
      const invoice = await this.requireInvoice(tx, id);
      const lines = await tx.query.invoiceLines.findMany({ where: eq(invoiceLines.invoiceId, id) });
      const paymentRows = await tx.query.payments.findMany({ where: eq(payments.invoiceId, id) });
      return { ...invoice, lines, payments: paymentRows };
    });
  }

  async create(tenantId: string, actorId: string, input: CreateInvoiceInput) {
    await this.validateCounterparty(tenantId, input.counterpartyType, input.counterpartyId);

    const matchedLines = await Promise.all(input.lines.map((line) => this.matchLine(tenantId, line)));

    return withTenant(this.db, tenantId, async (tx) => {
      if (input.projectId) {
        const project = await tx.query.projects.findFirst({ where: eq(projects.id, input.projectId) });
        if (!project) throw new ProjectNotFoundError();
      }
      for (const line of input.lines) {
        if (line.costCodeId && input.projectId) {
          const costCode = await tx.query.costCodes.findFirst({
            where: and(eq(costCodes.id, line.costCodeId), eq(costCodes.projectId, input.projectId)),
          });
          if (!costCode) throw new CostCodeNotOnProjectError();
        }
      }

      const [maxNumberRow] = await tx
        .select({ maxNumber: sql<number | null>`max(${invoices.number})` })
        .from(invoices)
        .where(and(eq(invoices.tenantId, tenantId), eq(invoices.direction, input.direction)));
      const number = (maxNumberRow!.maxNumber ?? 0) + 1;

      const subtotal = input.lines.reduce((sum, line) => sum + Number(line.amount), 0);
      const tax = Number(input.taxAmount ?? "0");

      const [invoice] = await tx
        .insert(invoices)
        .values({
          tenantId,
          direction: input.direction,
          counterpartyType: input.counterpartyType,
          counterpartyId: input.counterpartyId,
          projectId: input.projectId,
          number,
          issueDate: input.issueDate,
          dueDate: input.dueDate,
          subtotalAmount: subtotal.toFixed(2),
          taxAmount: tax.toFixed(2),
          totalAmount: (subtotal + tax).toFixed(2),
          externalRef: input.externalRef,
          matchStatus: this.aggregateMatchStatus(matchedLines.map((l) => l.matchStatus)),
          createdBy: actorId,
        })
        .returning();
      const created = invoice!;

      await tx.insert(invoiceLines).values(
        input.lines.map((line, i) => ({
          tenantId,
          invoiceId: created.id,
          purchaseOrderLineId: line.purchaseOrderLineId,
          costCodeId: line.costCodeId,
          description: line.description,
          qty: line.qty,
          unitPriceAmount: line.unitPriceAmount,
          amount: line.amount,
          matchStatus: matchedLines[i]!.matchStatus,
          createdBy: actorId,
        })),
      );
      const insertedLines = await tx.query.invoiceLines.findMany({ where: eq(invoiceLines.invoiceId, created.id) });

      await this.outbox.append(tx, {
        tenantId,
        eventType: "invoice.created.v1",
        dedupeKey: `invoice.created.v1:${created.id}`,
        actorId,
        payload: {
          companyId: tenantId,
          projectId: created.projectId,
          invoiceId: created.id,
          direction: created.direction as "payable" | "receivable",
          counterpartyType: created.counterpartyType as "client" | "supplier" | "subcontractor",
        },
      });

      return { ...created, lines: insertedLines };
    });
  }

  async addLine(tenantId: string, actorId: string, id: string, input: CreateInvoiceLineInput) {
    const matched = await this.matchLine(tenantId, input);

    return withTenant(this.db, tenantId, async (tx) => {
      const invoice = await this.requireInvoice(tx, id);
      if (invoice.status !== "draft") throw new InvoiceNotDraftError();
      if (input.costCodeId && invoice.projectId) {
        const costCode = await tx.query.costCodes.findFirst({
          where: and(eq(costCodes.id, input.costCodeId), eq(costCodes.projectId, invoice.projectId)),
        });
        if (!costCode) throw new CostCodeNotOnProjectError();
      }

      const [line] = await tx
        .insert(invoiceLines)
        .values({
          tenantId,
          invoiceId: id,
          purchaseOrderLineId: input.purchaseOrderLineId,
          costCodeId: input.costCodeId,
          description: input.description,
          qty: input.qty,
          unitPriceAmount: input.unitPriceAmount,
          amount: input.amount,
          matchStatus: matched.matchStatus,
          createdBy: actorId,
        })
        .returning();

      await this.recomputeTotals(tx, id, actorId);
      return line!;
    });
  }

  // FR-VEND-2: recomputes match state at approval time (receipts may have
  // arrived since the invoice was created) and blocks approval on a
  // mismatch — the check has no teeth otherwise. On success, posts one
  // cost_transaction per line that carries a cost code (job costing,
  // FR-VEND-2/FR-SUB-3) *after* this transaction commits — Finance and
  // Budgets are separate modules, so this is the same two-phase-write
  // looseness every other cross-module cost posting in this session uses.
  async approve(tenantId: string, actorId: string, id: string) {
    const lines = await withTenant(this.db, tenantId, (tx) =>
      tx.query.invoiceLines.findMany({ where: eq(invoiceLines.invoiceId, id) }),
    );
    const rematched = await Promise.all(
      lines.map(async (line) => {
        if (!line.purchaseOrderLineId) return { id: line.id, matchStatus: line.matchStatus as MatchStatus | null };
        const matched = await this.matchLine(tenantId, {
          purchaseOrderLineId: line.purchaseOrderLineId,
          qty: line.qty ?? undefined,
          unitPriceAmount: line.unitPriceAmount ?? undefined,
        });
        return { id: line.id, matchStatus: matched.matchStatus };
      }),
    );
    const overallMatchStatus = this.aggregateMatchStatus(rematched.map((r) => r.matchStatus));
    if (overallMatchStatus === "mismatched") throw new InvoiceMismatchedError();

    const approved = await withTenant(this.db, tenantId, async (tx) => {
      const invoice = await this.requireInvoice(tx, id);
      if (invoice.status !== "draft") throw new InvoiceNotDraftError();

      for (const r of rematched) {
        await tx.update(invoiceLines).set({ matchStatus: r.matchStatus, updatedBy: actorId }).where(eq(invoiceLines.id, r.id));
      }

      const [updated] = await tx
        .update(invoices)
        .set({ status: "approved", matchStatus: overallMatchStatus, updatedBy: actorId })
        .where(eq(invoices.id, id))
        .returning();

      await this.outbox.append(tx, {
        tenantId,
        eventType: "invoice.approved.v1",
        dedupeKey: `invoice.approved.v1:${id}`,
        actorId,
        payload: {
          companyId: tenantId,
          projectId: updated!.projectId,
          invoiceId: id,
          totalAmount: updated!.totalAmount,
          matchStatus: updated!.matchStatus,
        },
      });

      return updated!;
    });

    if (approved.projectId) {
      const source = approved.counterpartyType === "subcontractor" ? "sub_invoice" : "supplier_invoice";
      for (const line of lines) {
        if (!line.costCodeId) continue;
        await this.costTransactions.postFromInvoiceLine(tenantId, actorId, approved.projectId, {
          costCodeId: line.costCodeId,
          source,
          invoiceLineId: line.id,
          txnDate: approved.issueDate,
          amount: line.amount,
          qty: line.qty,
          uom: null,
        });
      }
    }

    return approved;
  }

  async void(tenantId: string, actorId: string, id: string) {
    return withTenant(this.db, tenantId, async (tx) => {
      const invoice = await this.requireInvoice(tx, id);
      if (invoice.status !== "draft") throw new InvoiceNotDraftError();

      const [voided] = await tx
        .update(invoices)
        .set({ status: "void", updatedBy: actorId })
        .where(eq(invoices.id, id))
        .returning();

      await this.outbox.append(tx, {
        tenantId,
        eventType: "invoice.voided.v1",
        dedupeKey: `invoice.voided.v1:${id}`,
        actorId,
        payload: { companyId: tenantId, invoiceId: id },
      });

      return voided!;
    });
  }

  async requireInvoice(tx: Database, id: string) {
    const invoice = await tx.query.invoices.findFirst({ where: and(eq(invoices.id, id), isNull(invoices.deletedAt)) });
    if (!invoice) throw new InvoiceNotFoundError();
    return invoice;
  }

  private async validateCounterparty(tenantId: string, counterpartyType: string, counterpartyId: string): Promise<void> {
    if (counterpartyType === "supplier") {
      await this.suppliers.getById(tenantId, counterpartyId);
    } else if (counterpartyType === "subcontractor") {
      await this.subcontractors.getById(tenantId, counterpartyId);
    } else {
      await this.contactCompanies.getById(tenantId, counterpartyId);
    }
  }

  // FR-VEND-2: 2-way match = the invoice line doesn't exceed the PO
  // line's ordered qty/unit cost; 3-way adds "doesn't exceed what's
  // actually been received" (purchase_order_lines.qty_received, maintained
  // by DeliveriesService). No PO line reference -> no match state (null).
  private async matchLine(
    tenantId: string,
    line: Pick<CreateInvoiceLineInput, "purchaseOrderLineId" | "qty" | "unitPriceAmount">,
  ): Promise<{ matchStatus: MatchStatus | null }> {
    if (!line.purchaseOrderLineId) return { matchStatus: null };
    const poLine = await this.purchaseOrders.getLineById(tenantId, line.purchaseOrderLineId);

    const qty = line.qty !== undefined ? Number(line.qty) : null;
    const priceOk =
      (qty === null || qty <= Number(poLine.qtyOrdered)) &&
      (line.unitPriceAmount === undefined || Number(line.unitPriceAmount) <= Number(poLine.unitCostAmount));
    if (!priceOk) return { matchStatus: "mismatched" };

    const receivedOk = qty !== null && qty <= Number(poLine.qtyReceived);
    return { matchStatus: receivedOk ? "three_way_matched" : "two_way_matched" };
  }

  private aggregateMatchStatus(lineStatuses: Array<MatchStatus | null>): MatchStatus | null {
    const relevant = lineStatuses.filter((s): s is MatchStatus => s !== null);
    if (relevant.length === 0) return null;
    if (relevant.some((s) => s === "mismatched")) return "mismatched";
    if (relevant.every((s) => s === "three_way_matched")) return "three_way_matched";
    return "two_way_matched";
  }

  private async recomputeTotals(tx: Database, invoiceId: string, actorId: string) {
    const lines = await tx.query.invoiceLines.findMany({ where: eq(invoiceLines.invoiceId, invoiceId) });
    const subtotal = lines.reduce((sum, l) => sum + Number(l.amount), 0);
    const invoice = await this.requireInvoice(tx, invoiceId);
    const tax = Number(invoice.taxAmount);
    const overallMatchStatus = this.aggregateMatchStatus(lines.map((l) => l.matchStatus as MatchStatus | null));

    await tx
      .update(invoices)
      .set({
        subtotalAmount: subtotal.toFixed(2),
        totalAmount: (subtotal + tax).toFixed(2),
        matchStatus: overallMatchStatus,
        updatedBy: actorId,
      })
      .where(eq(invoices.id, invoiceId));
  }
}
