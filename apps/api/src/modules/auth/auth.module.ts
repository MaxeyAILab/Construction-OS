import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { loadEnv } from "../../config/env";
import { createDatabase, DATABASE } from "../../infrastructure/db/client";
import { createRedisClient, REDIS_CLIENT } from "../../infrastructure/redis/client";
import { AccessTokenGuard } from "./api/access-token.guard";
import { AuthController } from "./api/auth.controller";
import { AuthService } from "./application/auth.service";
import { EncryptionService } from "./infrastructure/encryption.service";
import { MagicLinkService } from "./infrastructure/magic-link.service";
import { PasswordService } from "./infrastructure/password.service";
import { RefreshTokenService } from "./infrastructure/refresh-token.service";
import { SessionDenylistService } from "./infrastructure/session-denylist.service";
import { TokenService } from "./infrastructure/token.service";
import { TotpService } from "./infrastructure/totp.service";

const env = loadEnv();

@Module({
  imports: [JwtModule.register({ secret: env.JWT_ACCESS_SECRET })],
  controllers: [AuthController],
  providers: [
    { provide: DATABASE, useFactory: () => createDatabase(env) },
    { provide: REDIS_CLIENT, useFactory: () => createRedisClient(env) },
    { provide: EncryptionService, useFactory: () => new EncryptionService(env.MFA_ENCRYPTION_KEY) },
    { provide: MagicLinkService, useFactory: () => new MagicLinkService(env.MAGIC_LINK_SECRET) },
    PasswordService,
    TokenService,
    RefreshTokenService,
    TotpService,
    SessionDenylistService,
    AccessTokenGuard,
    AuthService,
  ],
  exports: [AuthService],
})
export class AuthModule {}
