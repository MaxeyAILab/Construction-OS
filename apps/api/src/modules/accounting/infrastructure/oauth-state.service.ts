import { Injectable } from "@nestjs/common";
import jwt from "jsonwebtoken";

const STATE_TTL_SECONDS = 10 * 60;
const PURPOSE = "accounting-oauth-state";

export interface AccountingOAuthStateClaims {
  tenantId: string;
  actorId: string;
  provider: string;
}

// Round-tripped through Intuit's OAuth redirect as the `state` query param —
// same self-contained signed-token pattern as MagicLinkService, deliberately
// a separate secret (ACCOUNTING_OAUTH_STATE_SECRET) from both
// JWT_ACCESS_SECRET and MAGIC_LINK_SECRET. There's no user session on the
// callback request (it's a browser redirect from Intuit, not an
// authenticated API call), so this token is what carries tenant/actor
// identity and CSRF protection across the round trip.
@Injectable()
export class AccountingOAuthStateService {
  constructor(private readonly secret: string) {}

  issue(claims: AccountingOAuthStateClaims): string {
    return jwt.sign({ ...claims, purpose: PURPOSE }, this.secret, { expiresIn: STATE_TTL_SECONDS });
  }

  consume(state: string): AccountingOAuthStateClaims {
    const decoded = jwt.verify(state, this.secret);
    if (typeof decoded === "string" || decoded["purpose"] !== PURPOSE) {
      throw new Error("invalid accounting oauth state");
    }
    return { tenantId: decoded["tenantId"], actorId: decoded["actorId"], provider: decoded["provider"] };
  }
}
