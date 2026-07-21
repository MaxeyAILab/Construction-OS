import { createHash, randomBytes } from "node:crypto";
import { Injectable } from "@nestjs/common";

const REFRESH_TOKEN_BYTES = 32;
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface IssuedRefreshToken {
  token: string;
  hash: string;
  expiresAt: Date;
}

// Refresh tokens are opaque (DB-checked on every use, not self-contained
// JWTs) so revocation is immediate and rotation is a plain row update —
// architecture.md §11 "rotating refresh tokens ... device binding + revocation".
//
// Format is `${tenantId}.${secret}`: sessions carry Row-Level Security
// (database.md §2), so looking one up by hash alone would need tenant
// context we don't have yet at refresh time. Embedding the tenant id lets
// the caller open the right tenant context before querying — tenant_id
// isn't secret (it's already a JWT claim), only the random part is.
@Injectable()
export class RefreshTokenService {
  issue(tenantId: string): IssuedRefreshToken {
    const secret = randomBytes(REFRESH_TOKEN_BYTES).toString("base64url");
    const token = `${tenantId}.${secret}`;
    return {
      token,
      hash: this.hashToken(token),
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
    };
  }

  hashToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }

  parseTenantId(token: string): string | undefined {
    const [tenantId] = token.split(".", 1);
    return tenantId;
  }
}
