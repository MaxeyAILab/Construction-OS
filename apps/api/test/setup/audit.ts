import type { Database } from "../../src/infrastructure/db/client";
import { AuditQueryService } from "../../src/modules/audit/application/audit-query.service";
import { AuditWriterService } from "../../src/modules/audit/application/audit-writer.service";

export function buildTestAuditServices(db: Database): {
  auditQueryService: AuditQueryService;
  auditWriterService: AuditWriterService;
} {
  return {
    auditQueryService: new AuditQueryService(db),
    auditWriterService: new AuditWriterService(db),
  };
}
