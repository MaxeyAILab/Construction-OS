import { Injectable } from "@nestjs/common";
import jwt from "jsonwebtoken";

const MAGIC_LINK_TTL_SECONDS = 15 * 60;
const PURPOSE = "magic-link";

export interface MagicLinkClaims {
  email: string;
  companyId: string;
}

// Deliberately a *separate* secret from access tokens (JWT_ACCESS_SECRET):
// this token grants login, so a leaked magic-link secret shouldn't also let
// someone forge API access tokens, and vice versa.
@Injectable()
export class MagicLinkService {
  constructor(private readonly secret: string) {}

  issue(claims: MagicLinkClaims): string {
    return jwt.sign({ ...claims, purpose: PURPOSE }, this.secret, {
      expiresIn: MAGIC_LINK_TTL_SECONDS,
    });
  }

  consume(token: string): MagicLinkClaims {
    const decoded = jwt.verify(token, this.secret);
    if (typeof decoded === "string" || decoded["purpose"] !== PURPOSE) {
      throw new Error("invalid magic link token");
    }
    return { email: decoded["email"], companyId: decoded["companyId"] };
  }
}
