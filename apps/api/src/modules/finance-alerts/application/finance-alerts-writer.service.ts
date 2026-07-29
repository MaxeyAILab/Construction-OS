import { Injectable } from "@nestjs/common";
import type { BudgetLineUpdatedV1, InvoiceCreatedV1, OutboxEnvelope } from "@constructionos/schemas";
import { InvoiceAnomalyService } from "./invoice-anomaly.service";
import { MarginErosionService } from "./margin-erosion.service";

// budget_line.updated.v1 fires for both a direct budget-line edit AND the
// actual/forecast maintenance a posted cost transaction or approved change
// order triggers — the single event that covers every margin-affecting
// mutation this codebase produces (financial-summary.service.ts's own
// comment documents this). invoice.created.v1 drives the other producer
// (InvoiceAnomalyService, ai-spec.md §7.10) — one writer/consumer for both
// event types this module cares about, same "each module owns its own
// consumer, branches on eventType" shape as every other writer this
// session with more than one trigger.
@Injectable()
export class FinanceAlertsWriterService {
  constructor(
    private readonly marginErosion: MarginErosionService,
    private readonly invoiceAnomaly: InvoiceAnomalyService,
  ) {}

  async handleEnvelope(envelope: OutboxEnvelope): Promise<void> {
    if (envelope.eventType === "budget_line.updated.v1") {
      const payload = envelope.payload as BudgetLineUpdatedV1;
      await this.marginErosion.checkProject(envelope.tenantId, payload.projectId);
      return;
    }
    if (envelope.eventType === "invoice.created.v1") {
      const payload = envelope.payload as InvoiceCreatedV1;
      await this.invoiceAnomaly.checkForDuplicate(envelope.tenantId, payload.invoiceId);
    }
  }
}
