import { Injectable } from "@nestjs/common";
import jwt from "jsonwebtoken";

const MFA_CHALLENGE_TTL_SECONDS = 5 * 60;
const PURPOSE = "mfa-challenge";

export interface MfaChallengeClaims {
  userId: string;
  companyId: string;
}

@Injectable()
export class MfaChallengeService {
  constructor(private readonly secret: string) {}

  issue(claims: MfaChallengeClaims): string {
    return jwt.sign({ ...claims, purpose: PURPOSE }, this.secret, {
      expiresIn: MFA_CHALLENGE_TTL_SECONDS,
    });
  }

  consume(token: string): MfaChallengeClaims {
    const decoded = jwt.verify(token, this.secret);
    if (typeof decoded === "string" || decoded["purpose"] !== PURPOSE) {
      throw new Error("invalid mfa challenge token");
    }
    return { userId: decoded["userId"], companyId: decoded["companyId"] };
  }
}
