import { createHash, randomBytes } from "node:crypto";

const BASE62_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

function toBase62(buffer: Buffer): string {
  let value = BigInt(`0x${buffer.toString("hex")}`);
  if (value === 0n) return "0";
  let out = "";
  const base = BigInt(BASE62_ALPHABET.length);
  while (value > 0n) {
    out = BASE62_ALPHABET[Number(value % base)] + out;
    value /= base;
  }
  return out;
}

// api.md §16.4: "raw key is cos_live_<tenant_id>.<32 random bytes,
// base62>". The tenant id has to be recoverable from the key itself
// (before any DB query) because api_keys has FORCE ROW LEVEL SECURITY
// with no bypass path (database.md §2) — authenticating a key means
// running its lookup inside that tenant's own withTenant(...) scope like
// every other query in this system, not a cross-tenant admin bypass.
// 32 random bytes (256 bits) of secret is why key_hash can safely be a
// fast, deterministic SHA-256 rather than a slow salted hash — a request
// only carries the raw key, never an email-equivalent lookup key, so
// authenticating it needs a direct key_hash = ... query once the tenant
// scope is set.
export function generateApiKey(tenantId: string): { raw: string; hash: string } {
  const raw = `cos_live_${tenantId}.${toBase62(randomBytes(32))}`;
  return { raw, hash: hashApiKey(raw) };
}

export function hashApiKey(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

// Returns null for anything that isn't shaped like one of our keys —
// callers treat that as "not an API key" (e.g. AccessTokenGuard falling
// through to its normal missing-credentials error) rather than a lookup
// failure.
export function parseApiKeyTenantId(raw: string): string | null {
  const match = /^cos_live_([0-9a-f-]{36})\./.exec(raw);
  return match ? match[1]! : null;
}
