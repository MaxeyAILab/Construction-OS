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

// api.md §2.1: "mirrors §16.4's API-key design exactly" — same tenant-
// id-in-prefix + SHA-256 rationale as api-key-generator.ts (RLS on
// sso_connections has no bypass path either), just a different visible
// prefix (`scim_` vs `cos_live_`) so the two token families are never
// confusable in logs or IdP config screens.
export function generateScimToken(tenantId: string): { raw: string; hash: string } {
  const raw = `scim_${tenantId}.${toBase62(randomBytes(32))}`;
  return { raw, hash: hashScimToken(raw) };
}

export function hashScimToken(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

export function parseScimTokenTenantId(raw: string): string | null {
  const match = /^scim_([0-9a-f-]{36})\./.exec(raw);
  return match ? match[1]! : null;
}
