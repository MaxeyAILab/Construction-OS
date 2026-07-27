import type { Database } from "../../src/infrastructure/db/client";
import { createQueueConnection } from "../../src/infrastructure/queue/connection";
import { createRedisClient } from "../../src/infrastructure/redis/client";
import type { DashboardsService } from "../../src/modules/dashboards/application/dashboards.service";
import { ReportRunnerService } from "../../src/modules/dashboards/application/report-runner.service";
import { ReportsQueue } from "../../src/modules/dashboards/application/reports.queue";
import { ReportsService } from "../../src/modules/dashboards/application/reports.service";
import { DocumentVersionsService } from "../../src/modules/documents/application/document-versions.service";
import { DocumentsService } from "../../src/modules/documents/application/documents.service";
import { OutboxService } from "../../src/modules/events/application/outbox.service";
import type { FileUploadService } from "../../src/modules/files/application/file-upload.service";
import { ExternalSharesService } from "../../src/modules/rbac/application/external-shares.service";
import { PermissionResolverService } from "../../src/modules/rbac/application/permission-resolver.service";
import { PermissionCacheService } from "../../src/modules/rbac/infrastructure/permission-cache.service";

export function buildTestReportsServices(db: Database, dashboardsService: DashboardsService, fileUploadService: FileUploadService) {
  const outbox = new OutboxService();
  const queueConnection = createQueueConnection({ REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:6379" });
  const queue = new ReportsQueue(queueConnection);
  const reportsService = new ReportsService(db, outbox, queue, fileUploadService);

  const cacheRedis = createRedisClient({ REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:6379" });
  const cache = new PermissionCacheService(cacheRedis);
  const permissions = new PermissionResolverService(db, cache);
  const externalShares = new ExternalSharesService(db, outbox);
  const documentsService = new DocumentsService(db, outbox, permissions, externalShares);
  const documentVersionsService = new DocumentVersionsService(db, outbox, fileUploadService, documentsService);

  const reportRunnerService = new ReportRunnerService(
    db,
    dashboardsService,
    fileUploadService,
    documentsService,
    documentVersionsService,
    outbox,
  );

  return { reportsService, reportRunnerService, queueConnection, cacheRedis };
}
