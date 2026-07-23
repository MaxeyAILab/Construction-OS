import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "staging", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3001),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  NATS_URL: z.string().url(),
  JWT_ACCESS_SECRET: z.string().min(32),
  MAGIC_LINK_SECRET: z.string().min(32),
  MFA_ENCRYPTION_KEY: z
    .string()
    .base64()
    .refine((v) => Buffer.from(v, "base64").length === 32, "must decode to 32 bytes"),
  // architecture.md §13: S3-compatible object store (real AWS, R2, or a
  // local MinIO). Defaulted (not required) since no bucket is provisioned
  // yet anywhere this app currently boots — the files module's StorageService
  // only actually dials the endpoint when invoked, never at startup, so an
  // unconfigured/placeholder value here doesn't break `pnpm dev`/`pnpm test`.
  S3_BUCKET: z.string().default("constructionos-dev"),
  S3_REGION: z.string().default("auto"),
  S3_ENDPOINT: z.string().url().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  // MinIO/R2 require path-style bucket addressing; real AWS S3 doesn't.
  S3_FORCE_PATH_STYLE: z.coerce.boolean().default(true),
  // ClamAV clamd daemon (architecture.md §13's virus-scan step) — same
  // "defaulted, dialed lazily" reasoning as the S3 vars above.
  CLAMAV_HOST: z.string().default("localhost"),
  CLAMAV_PORT: z.coerce.number().int().positive().default(3310),
  // architecture.md §7 / ai-spec.md §2: AI Gateway provider credential.
  // Optional (not required) since no account is provisioned yet anywhere
  // this app currently boots — same "unconfigured is fine at startup,
  // only fails when actually invoked" reasoning as the S3 vars above.
  ANTHROPIC_API_KEY: z.string().optional(),
  // ai-spec.md §4: the embedding provider for RAG (M17). Same "optional,
  // dialed lazily" reasoning as ANTHROPIC_API_KEY.
  VOYAGE_API_KEY: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    throw new Error(`Invalid environment configuration:\n${parsed.error.toString()}`);
  }
  return parsed.data;
}
