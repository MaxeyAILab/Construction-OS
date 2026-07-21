import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
// Real (non-type-only) import required: NestJS constructor injection
// resolves JwtService via emitDecoratorMetadata, which needs the actual
// class reference at runtime.
import { JwtService } from "@nestjs/jwt";

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;

// architecture.md §11: "short-lived access JWT (≤ 15 min) carrying sub,
// tenant_id, roles, session_id".
export interface AccessTokenClaims {
  sub: string;
  tenantId: string;
  roles: string[];
  sessionId: string;
}

export interface AccessTokenPayload extends AccessTokenClaims {
  jti: string;
}

export interface IssuedAccessToken {
  token: string;
  jti: string;
  expiresAt: Date;
}

@Injectable()
export class TokenService {
  constructor(private readonly jwt: JwtService) {}

  async issueAccessToken(claims: AccessTokenClaims): Promise<IssuedAccessToken> {
    const jti = randomUUID();
    const token = await this.jwt.signAsync({ ...claims, jti } satisfies AccessTokenPayload, {
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    });
    return { token, jti, expiresAt: new Date(Date.now() + ACCESS_TOKEN_TTL_SECONDS * 1000) };
  }

  verifyAccessToken(token: string): Promise<AccessTokenPayload> {
    return this.jwt.verifyAsync<AccessTokenPayload>(token);
  }
}
