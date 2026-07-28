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
  // FR-PLAT-8: field-level encryption for accounting_connections' OAuth
  // tokens (EncryptionService) — deliberately a separate key from
  // MFA_ENCRYPTION_KEY, same "one leaked secret shouldn't unlock a second,
  // unrelated class of data" reasoning as MAGIC_LINK_SECRET being separate
  // from JWT_ACCESS_SECRET.
  ACCOUNTING_ENCRYPTION_KEY: z
    .string()
    .base64()
    .refine((v) => Buffer.from(v, "base64").length === 32, "must decode to 32 bytes"),
  // Signs the OAuth `state` param round-tripped through Intuit's redirect
  // (AccountingOAuthStateService) — same "separate secret, same shape as
  // MagicLinkService" precedent as MAGIC_LINK_SECRET.
  ACCOUNTING_OAUTH_STATE_SECRET: z.string().min(32),
  // Intuit app credentials. Optional (not required) since no Intuit app is
  // registered yet anywhere this app currently boots — same "unconfigured
  // is fine at startup, only fails when actually invoked" reasoning as
  // ANTHROPIC_API_KEY/S3_* above. Getting these costs nothing (Intuit's
  // developer program and sandbox are free); they're just not provisioned
  // in this environment.
  QUICKBOOKS_CLIENT_ID: z.string().optional(),
  QUICKBOOKS_CLIENT_SECRET: z.string().optional(),
  QUICKBOOKS_REDIRECT_URI: z.string().url().optional(),
  QUICKBOOKS_ENVIRONMENT: z.enum(["sandbox", "production"]).default("sandbox"),
  // roadmap.md "Sage & Xero connectors" (dependency: this accounting
  // framework, now built). Same "optional, dialed lazily, no fee to
  // register a developer app" reasoning as QUICKBOOKS_*. Neither Sage nor
  // Xero splits sandbox/production APIs the way Intuit does — one app
  // works against whichever organization the user connects.
  SAGE_CLIENT_ID: z.string().optional(),
  SAGE_CLIENT_SECRET: z.string().optional(),
  SAGE_REDIRECT_URI: z.string().url().optional(),
  XERO_CLIENT_ID: z.string().optional(),
  XERO_CLIENT_SECRET: z.string().optional(),
  XERO_REDIRECT_URI: z.string().url().optional(),
  // api.md §16.3: field-level encryption for webhook_endpoints.secret (the
  // HMAC signing key shared with the tenant's receiving system) — same
  // "deliberately separate key per data class" reasoning as
  // ACCOUNTING_ENCRYPTION_KEY/MFA_ENCRYPTION_KEY.
  WEBHOOK_ENCRYPTION_KEY: z
    .string()
    .base64()
    .refine((v) => Buffer.from(v, "base64").length === 32, "must decode to 32 bytes"),
  // api.md §2.1: this API's own externally-reachable origin, needed to
  // construct SAML SP entity IDs / ACS URLs / metadata (SamlService) —
  // unlike the provider credentials above, there's no "unconfigured is
  // fine" state for this one since every SSO connection needs it, so it's
  // defaulted to local dev rather than optional.
  API_BASE_URL: z.string().url().default("http://localhost:3001"),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    throw new Error(`Invalid environment configuration:\n${parsed.error.toString()}`);
  }
  return parsed.data;
}
