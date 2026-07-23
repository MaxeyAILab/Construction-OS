import { Inject, Injectable } from "@nestjs/common";
import type { OutboxEnvelope } from "@constructionos/schemas";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import { auditLog } from "../../../infrastructure/db/schema";
import { mapToAuditEntry } from "../domain/audit-action-map";

@Injectable()
export class AuditWriterService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async handleEnvelope(envelope: OutboxEnvelope): Promise<void> {
    const entry = mapToAuditEntry(envelope.eventType, envelope.payload);
    if (!entry) return; // no audit mapping for this event type — not an error

    await withTenant(this.db, envelope.tenantId, (tx) =>
      tx.insert(auditLog).values({
        tenantId: envelope.tenantId,
        occurredAt: new Date(envelope.occurredAt),
        actorId: envelope.actorId,
        actorType: envelope.actorType,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        ...(entry.aiRunId && { aiRunId: entry.aiRunId }),
        // No real before/after diffing yet (database.md §6 supports it,
        // nothing computes it) — the event payload is recorded as `after`
        // so the row is still useful, not left empty pending that work.
        after: envelope.payload,
      }),
    );
  }
}
