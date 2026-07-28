import type Redis from "ioredis";
import { createQueueConnection } from "../../src/infrastructure/queue/connection";
import type { Database } from "../../src/infrastructure/db/client";
import { CompanySettingsService } from "../../src/modules/auth/application/company-settings.service";
import { DocumentsService } from "../../src/modules/documents/application/documents.service";
import { DocumentVersionsService } from "../../src/modules/documents/application/document-versions.service";
import { OutboxService } from "../../src/modules/events/application/outbox.service";
import type { FileUploadService } from "../../src/modules/files/application/file-upload.service";
import { PaymentApplicationPdfRunnerService } from "../../src/modules/finance/application/payment-application-pdf-runner.service";
import { PaymentApplicationPdfQueue } from "../../src/modules/finance/application/payment-application-pdf.queue";
import { PaymentApplicationsService } from "../../src/modules/finance/application/payment-applications.service";
import type { InvoicesService } from "../../src/modules/finance/application/invoices.service";
import { ExternalSharesService } from "../../src/modules/rbac/application/external-shares.service";
import { PermissionResolverService } from "../../src/modules/rbac/application/permission-resolver.service";
import { PermissionCacheService } from "../../src/modules/rbac/infrastructure/permission-cache.service";
import { createRedisClient } from "../../src/infrastructure/redis/client";

export function buildTestPaymentApplicationServices(
  db: Database,
  invoicesService: InvoicesService,
  fileUploadService: FileUploadService,
): {
  paymentApplicationsService: PaymentApplicationsService;
  pdfRunnerService: PaymentApplicationPdfRunnerService;
  documentsService: DocumentsService;
  companySettingsService: CompanySettingsService;
  queueConnection: Redis;
  cacheRedis: Redis;
} {
  const outbox = new OutboxService();
  const queueConnection = createQueueConnection({
    REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:6379",
  });
  const pdfQueue = new PaymentApplicationPdfQueue(queueConnection);
  const companySettingsService = new CompanySettingsService(db, outbox);
  const paymentApplicationsService = new PaymentApplicationsService(db, outbox, invoicesService, pdfQueue, companySettingsService);

  const cacheRedis = createRedisClient({ REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:6379" });
  const cache = new PermissionCacheService(cacheRedis);
  const permissions = new PermissionResolverService(db, cache);
  const externalShares = new ExternalSharesService(db, outbox);
  const documentsService = new DocumentsService(db, outbox, permissions, externalShares);
  const documentVersionsService = new DocumentVersionsService(db, outbox, fileUploadService, documentsService);
  const pdfRunnerService = new PaymentApplicationPdfRunnerService(
    db,
    fileUploadService,
    documentsService,
    documentVersionsService,
    outbox,
  );

  return { paymentApplicationsService, pdfRunnerService, documentsService, companySettingsService, queueConnection, cacheRedis };
}
