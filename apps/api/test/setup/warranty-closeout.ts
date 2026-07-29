import type { Database } from "../../src/infrastructure/db/client";
import { OutboxService } from "../../src/modules/events/application/outbox.service";
import type { FileUploadService } from "../../src/modules/files/application/file-upload.service";
import { ExternalSharesService } from "../../src/modules/rbac/application/external-shares.service";
import { PermissionResolverService } from "../../src/modules/rbac/application/permission-resolver.service";
import { PermissionCacheService } from "../../src/modules/rbac/infrastructure/permission-cache.service";
import { CloseoutChecklistService } from "../../src/modules/warranty-closeout/application/closeout-checklist.service";
import { CloseoutPackagesService } from "../../src/modules/warranty-closeout/application/closeout-packages.service";
import { WarrantiesService } from "../../src/modules/warranty-closeout/application/warranties.service";
import { WarrantyClaimsService } from "../../src/modules/warranty-closeout/application/warranty-claims.service";
import { createRedisClient, type RedisClient } from "../../src/infrastructure/redis/client";

export function buildTestWarrantyCloseoutServices(
  db: Database,
  fileUploadService: FileUploadService,
): {
  checklistService: CloseoutChecklistService;
  packagesService: CloseoutPackagesService;
  warrantiesService: WarrantiesService;
  claimsService: WarrantyClaimsService;
  cacheRedis: RedisClient;
} {
  const outbox = new OutboxService();
  const cacheRedis = createRedisClient({ REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:6379" });
  const permissions = new PermissionResolverService(db, new PermissionCacheService(cacheRedis));
  const externalShares = new ExternalSharesService(db, outbox);
  const warrantiesService = new WarrantiesService(db, outbox);

  return {
    checklistService: new CloseoutChecklistService(db, outbox),
    packagesService: new CloseoutPackagesService(db, outbox, fileUploadService, warrantiesService),
    warrantiesService,
    claimsService: new WarrantyClaimsService(db, outbox, permissions, externalShares, warrantiesService),
    cacheRedis,
  };
}
