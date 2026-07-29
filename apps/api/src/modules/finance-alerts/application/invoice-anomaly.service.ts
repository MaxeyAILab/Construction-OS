import { Inject, Injectable } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import { financeAlerts } from "../../../infrastructure/db/schema";
import { OutboxService } from "../../events";
import { InvoicesService } from "../../finance";

const KIND = "invoice_duplicate";

// Same "sensible default, no provisioning required" precedent as every
// other documented-assumption threshold this session (e.g.
// EquipmentInsightsService's IDLE_THRESHOLD_DAYS) — two invoices from the
// same counterparty for the exact same amount within a week of each other
// is the classic "was this already entered?" duplicate signal.
const AMOUNT_MATCH_WINDOW_DAYS = 7;

function daysBetween(a: string, b: string): number {
  return Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 86_400_000;
}

// ai-spec.md §7.10 (Financial AI) / FR-FIN-6: "invoice anomaly detection
// (duplicate, price-drift vs PO, unusual patterns)". Price-drift vs PO is
// already a hard gate at approval time (InvoicesService's 2-/3-way match
// throws InvoiceMismatchedError) — this closes the other flagged half,
// duplicate detection, as a passive alert rather than a block: an
// unintentionally-double-entered invoice is a real finding worth
// surfacing, but unlike a PO price mismatch it's not something the system
// can be certain enough about to refuse outright. Rule-only, no AI
// enrichment — same "nothing to explain beyond the match itself"
// precedent as compliance_alerts.
@Injectable()
export class InvoiceAnomalyService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly invoicesService: InvoicesService,
    private readonly outbox: OutboxService,
  ) {}

  async checkForDuplicate(tenantId: string, invoiceId: string): Promise<void> {
    const alreadyAlerted = await withTenant(this.db, tenantId, (tx) =>
      tx.query.financeAlerts.findFirst({
        where: and(eq(financeAlerts.kind, KIND), eq(financeAlerts.invoiceId, invoiceId)),
      }),
    );
    if (alreadyAlerted) return;

    const invoice = await this.invoicesService.getById(tenantId, invoiceId);
    const candidates = await this.invoicesService.listByCounterparty(
      tenantId,
      invoice.counterpartyId,
      invoice.direction as "payable" | "receivable",
      invoiceId,
    );

    const externalRefMatch =
      invoice.externalRef && candidates.find((c) => c.externalRef === invoice.externalRef);
    const amountAndDateMatch = candidates.find(
      (c) => c.totalAmount === invoice.totalAmount && daysBetween(c.issueDate, invoice.issueDate) <= AMOUNT_MATCH_WINDOW_DAYS,
    );

    const match = externalRefMatch || amountAndDateMatch;
    if (!match) return;

    const matchReason = externalRefMatch ? "external_ref" : "amount_and_date";
    const severity = externalRefMatch ? "critical" : "warning";

    await withTenant(this.db, tenantId, async (tx) => {
      const [alert] = await tx
        .insert(financeAlerts)
        .values({
          tenantId,
          projectId: invoice.projectId,
          kind: KIND,
          severity,
          invoiceId,
          duplicateOfInvoiceId: match.id,
          matchReason,
        })
        .returning();

      await this.outbox.append(tx, {
        tenantId,
        eventType: "finance_alert.created.v1",
        dedupeKey: `finance_alert.created.v1:${alert!.id}`,
        actorId: null,
        actorType: "system",
        payload: {
          companyId: tenantId,
          projectId: invoice.projectId,
          financeAlertId: alert!.id,
          kind: KIND,
          severity,
          aiRunId: null,
        },
      });
    });
  }
}
