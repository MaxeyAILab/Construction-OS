import { Injectable } from "@nestjs/common";
import type { OutboxEnvelope } from "@constructionos/schemas";
import { RagIndexingService } from "./rag-indexing.service";

// Maps each indexed entity type's create/update event to a re-index call
// and its delete event to a tombstone removal. One more row per newly
// indexed entity type — same registry-growth pattern as
// DashboardProjectionsWriterService's event-type sets.
const REINDEX_EVENTS: Record<string, { entityType: string; idField: string }> = {
  "task.created.v1": { entityType: "task", idField: "taskId" },
  "task.updated.v1": { entityType: "task", idField: "taskId" },
  "rfi.created.v1": { entityType: "rfi", idField: "rfiId" },
  "rfi.updated.v1": { entityType: "rfi", idField: "rfiId" },
  "daily_report.created.v1": { entityType: "daily_report", idField: "dailyReportId" },
  "daily_report.updated.v1": { entityType: "daily_report", idField: "dailyReportId" },
  "daily_report.submitted.v1": { entityType: "daily_report", idField: "dailyReportId" },
};

const REMOVE_EVENTS: Record<string, { entityType: string; idField: string }> = {
  "task.deleted.v1": { entityType: "task", idField: "taskId" },
};

@Injectable()
export class RagIndexingWriterService {
  constructor(private readonly indexing: RagIndexingService) {}

  async handleEnvelope(envelope: OutboxEnvelope): Promise<void> {
    const payload = envelope.payload as Record<string, unknown>;

    const reindex = REINDEX_EVENTS[envelope.eventType];
    if (reindex) {
      const entityId = payload[reindex.idField] as string;
      await this.indexing.indexEntity(envelope.tenantId, reindex.entityType, entityId);
      return;
    }

    const remove = REMOVE_EVENTS[envelope.eventType];
    if (remove) {
      const entityId = payload[remove.idField] as string;
      await this.indexing.removeEntity(envelope.tenantId, remove.entityType, entityId);
    }
  }
}
