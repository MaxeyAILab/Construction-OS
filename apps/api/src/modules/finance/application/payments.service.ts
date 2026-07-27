import { Inject, Injectable } from "@nestjs/common";
import type { CreatePaymentInput } from "@constructionos/schemas";
import { eq } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import { invoices, payments } from "../../../infrastructure/db/schema";
import { OutboxService } from "../../events";
import { InvoiceNotApprovedError, PaymentExceedsBalanceError } from "../domain/errors";
import { InvoicesService } from "./invoices.service";

// database.md §11: "payments: applied amounts vs invoices (partial
// payments supported)." paid_amount is a maintained aggregate on
// invoices (same pattern as budget_lines.committed_amount) — flips
// status to 'paid' once the balance is fully covered.
@Injectable()
export class PaymentsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly outbox: OutboxService,
    private readonly invoicesService: InvoicesService,
  ) {}

  async create(tenantId: string, actorId: string, invoiceId: string, input: CreatePaymentInput) {
    return withTenant(this.db, tenantId, async (tx) => {
      const invoice = await this.invoicesService.requireInvoice(tx, invoiceId);
      if (invoice.status !== "approved") throw new InvoiceNotApprovedError();

      const newPaidAmount = Number(invoice.paidAmount) + Number(input.amount);
      if (newPaidAmount > Number(invoice.totalAmount)) throw new PaymentExceedsBalanceError();

      const [payment] = await tx
        .insert(payments)
        .values({
          tenantId,
          invoiceId,
          amount: input.amount,
          paidAt: input.paidAt,
          method: input.method,
          externalRef: input.externalRef,
          createdBy: actorId,
        })
        .returning();
      const created = payment!;

      const fullyPaid = newPaidAmount >= Number(invoice.totalAmount);
      await tx
        .update(invoices)
        .set({
          paidAmount: newPaidAmount.toFixed(2),
          status: fullyPaid ? "paid" : invoice.status,
          updatedBy: actorId,
        })
        .where(eq(invoices.id, invoiceId));

      await this.outbox.append(tx, {
        tenantId,
        eventType: "payment.created.v1",
        dedupeKey: `payment.created.v1:${created.id}`,
        actorId,
        payload: { companyId: tenantId, invoiceId, paymentId: created.id, amount: input.amount },
      });

      if (fullyPaid) {
        await this.outbox.append(tx, {
          tenantId,
          eventType: "invoice.paid.v1",
          dedupeKey: `invoice.paid.v1:${invoiceId}`,
          actorId,
          payload: { companyId: tenantId, invoiceId, paidAmount: newPaidAmount.toFixed(2) },
        });
      }

      return created;
    });
  }

  async listForInvoice(tenantId: string, invoiceId: string) {
    return withTenant(this.db, tenantId, (tx) => tx.query.payments.findMany({ where: eq(payments.invoiceId, invoiceId) }));
  }
}
