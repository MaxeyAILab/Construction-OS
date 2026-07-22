import type Redis from "ioredis";
import { createRedisClient } from "../../src/infrastructure/redis/client";
import type { Database } from "../../src/infrastructure/db/client";
import { DocumentVersionsService } from "../../src/modules/documents/application/document-versions.service";
import { DocumentsService } from "../../src/modules/documents/application/documents.service";
import { DrawingSetsService } from "../../src/modules/documents/application/drawing-sets.service";
import { FoldersService } from "../../src/modules/documents/application/folders.service";
import { OutboxService } from "../../src/modules/events/application/outbox.service";
import type { FileUploadService } from "../../src/modules/files/application/file-upload.service";
import { ExternalSharesService } from "../../src/modules/rbac/application/external-shares.service";
import { PermissionResolverService } from "../../src/modules/rbac/application/permission-resolver.service";
import { PermissionCacheService } from "../../src/modules/rbac/infrastructure/permission-cache.service";

export function buildTestDocumentServices(
  db: Database,
  fileUploadService: FileUploadService,
): {
  foldersService: FoldersService;
  documentsService: DocumentsService;
  versionsService: DocumentVersionsService;
  drawingSetsService: DrawingSetsService;
  cacheRedis: Redis;
} {
  const outbox = new OutboxService();
  const cacheRedis = createRedisClient({ REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:6379" });
  const cache = new PermissionCacheService(cacheRedis);
  const permissions = new PermissionResolverService(db, cache);
  const externalShares = new ExternalSharesService(db, outbox);
  const documentsService = new DocumentsService(db, outbox, permissions, externalShares);
  return {
    foldersService: new FoldersService(db, outbox),
    documentsService,
    versionsService: new DocumentVersionsService(db, outbox, fileUploadService, documentsService),
    drawingSetsService: new DrawingSetsService(db, outbox),
    cacheRedis,
  };
}
