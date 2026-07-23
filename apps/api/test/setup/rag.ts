import { createHash } from "node:crypto";
import type Redis from "ioredis";
import type { Database } from "../../src/infrastructure/db/client";
import { createRedisClient } from "../../src/infrastructure/redis/client";
import { DailyReportsService } from "../../src/modules/daily-reports/application/daily-reports.service";
import { OutboxService } from "../../src/modules/events/application/outbox.service";
import { PhotosService } from "../../src/modules/photos/application/photos.service";
import { RagIndexingService } from "../../src/modules/rag/application/rag-indexing.service";
import { RagSearchService } from "../../src/modules/rag/application/rag-search.service";
import { EMBEDDING_DIMENSIONS, type EmbeddingProvider } from "../../src/modules/rag/domain/embedding-provider";
import { RfisService } from "../../src/modules/rfis/application/rfis.service";
import { PermissionResolverService } from "../../src/modules/rbac/application/permission-resolver.service";
import { PermissionCacheService } from "../../src/modules/rbac/infrastructure/permission-cache.service";
import { TasksService } from "../../src/modules/tasks/application/tasks.service";
import { buildTestFileServices } from "./files";

// Real, deterministic feature-hashing embedder (bag-of-words -> fixed-dim
// vector, L2-normalized) — no network call, but textually meaningful:
// two texts sharing words score higher cosine similarity than unrelated
// ones, so hybrid-retrieval ranking tests exercise real behavior rather
// than a coin flip. Mirrors FakeStorageService/FakeAiProvider's "real
// double, not a network client" role elsewhere in this test suite.
export class FakeEmbeddingProvider implements EmbeddingProvider {
  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => embedOne(text));
  }
}

function embedOne(text: string): number[] {
  const vector = new Array(EMBEDDING_DIMENSIONS).fill(0) as number[];
  const words = text.toLowerCase().split(/\W+/).filter(Boolean);
  for (const word of words) {
    const hash = createHash("sha256").update(word).digest();
    const index = hash.readUInt32BE(0) % EMBEDDING_DIMENSIONS;
    vector[index] = vector[index]! + 1;
  }
  const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0)) || 1;
  return vector.map((v) => v / norm);
}

export function buildTestRagServices(db: Database): {
  ragIndexingService: RagIndexingService;
  ragSearchService: RagSearchService;
  tasksService: TasksService;
  rfisService: RfisService;
  dailyReportsService: DailyReportsService;
  photosService: PhotosService;
  cacheRedis: Redis;
} {
  const outbox = new OutboxService();
  const tasksService = new TasksService(db, outbox);
  const rfisService = new RfisService(db, outbox);
  const dailyReportsService = new DailyReportsService(db, outbox);
  const { fileUploadService } = buildTestFileServices(db);
  const photosService = new PhotosService(db, outbox, fileUploadService);

  const embeddingProvider = new FakeEmbeddingProvider();
  const cacheRedis = createRedisClient({ REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:6379" });
  const cache = new PermissionCacheService(cacheRedis);
  const permissions = new PermissionResolverService(db, cache);

  return {
    ragIndexingService: new RagIndexingService(db, embeddingProvider, tasksService, rfisService, dailyReportsService, photosService),
    ragSearchService: new RagSearchService(db, embeddingProvider, permissions),
    tasksService,
    rfisService,
    dailyReportsService,
    photosService,
    cacheRedis,
  };
}
