import { Injectable } from "@nestjs/common";
import type { BudgetLineUpdatedV1, OutboxEnvelope } from "@constructionos/schemas";
import { MarginErosionService } from "./margin-erosion.service";

// budget_line.updated.v1 fires for both a direct budget-line edit AND the
// actual/forecast maintenance a posted cost transaction or approved change
// order triggers — the single event that covers every margin-affecting
// mutation this codebase produces (financial-summary.service.ts's own
// comment documents this).
@Injectable()
export class FinanceAlertsWriterService {
  constructor(private readonly marginErosion: MarginErosionService) {}

  async handleEnvelope(envelope: OutboxEnvelope): Promise<void> {
    if (envelope.eventType !== "budget_line.updated.v1") return;

    const payload = envelope.payload as BudgetLineUpdatedV1;
    await this.marginErosion.checkProject(envelope.tenantId, payload.projectId);
  }
}
