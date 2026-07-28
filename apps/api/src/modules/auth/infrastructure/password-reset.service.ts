import { Injectable } from "@nestjs/common";
import jwt from "jsonwebtoken";

const PASSWORD_RESET_TTL_SECONDS = 15 * 60;
const PURPOSE = "password-reset";

export interface PasswordResetClaims {
  userId: string;
}

@Injectable()
export class PasswordResetService {
  constructor(private readonly secret: string) {}

  issue(claims: PasswordResetClaims): string {
    return jwt.sign({ ...claims, purpose: PURPOSE }, this.secret, {
      expiresIn: PASSWORD_RESET_TTL_SECONDS,
    });
  }

  consume(token: string): PasswordResetClaims {
    const decoded = jwt.verify(token, this.secret);
    if (typeof decoded === "string" || decoded["purpose"] !== PURPOSE) {
      throw new Error("invalid password reset token");
    }
    return { userId: decoded["userId"] };
  }
}
