import { randomBytes } from "node:crypto";
import { JwtService } from "@nestjs/jwt";
import type { Database } from "../../src/infrastructure/db/client";
import { createRedisClient, type RedisClient } from "../../src/infrastructure/redis/client";
import { AuthService } from "../../src/modules/auth/application/auth.service";
import { CompanySettingsService } from "../../src/modules/auth/application/company-settings.service";
import { UserPreferencesService } from "../../src/modules/auth/application/user-preferences.service";
import { EncryptionService } from "../../src/modules/auth/infrastructure/encryption.service";
import { MagicLinkService } from "../../src/modules/auth/infrastructure/magic-link.service";
import { MfaChallengeService } from "../../src/modules/auth/infrastructure/mfa-challenge.service";
import { PasswordResetService } from "../../src/modules/auth/infrastructure/password-reset.service";
import { PasswordService } from "../../src/modules/auth/infrastructure/password.service";
import { RefreshTokenService } from "../../src/modules/auth/infrastructure/refresh-token.service";
import { SamlService } from "../../src/modules/auth/infrastructure/saml.service";
import { SessionDenylistService } from "../../src/modules/auth/infrastructure/session-denylist.service";
import { TokenService } from "../../src/modules/auth/infrastructure/token.service";
import { TotpService } from "../../src/modules/auth/infrastructure/totp.service";
import { OutboxService } from "../../src/modules/events/application/outbox.service";
import { PermissionResolverService } from "../../src/modules/rbac/application/permission-resolver.service";
import { PermissionCacheService } from "../../src/modules/rbac/infrastructure/permission-cache.service";

// Wires AuthService with its real dependencies (no HTTP layer) so tests can
// exercise the actual login/refresh/RLS/Redis interplay directly, the same
// way tenant-isolation.spec.ts does for the schema layer.
export function buildTestAuthService(db: Database): {
  authService: AuthService;
  redis: RedisClient;
  denylist: SessionDenylistService;
  userPreferencesService: UserPreferencesService;
  companySettingsService: CompanySettingsService;
} {
  const jwt = new JwtService({ secret: "test-jwt-access-secret-0123456789012345" });
  const redis = createRedisClient({ REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:6379" });
  const denylist = new SessionDenylistService(redis);
  const outbox = new OutboxService();

  const authService = new AuthService(
    db,
    new PasswordService(),
    new TokenService(jwt),
    new RefreshTokenService(),
    new TotpService(),
    new EncryptionService(randomBytes(32).toString("base64")),
    new MagicLinkService("test-magic-link-secret-01234567890123"),
    new PasswordResetService("test-password-reset-secret-0123456789012"),
    denylist,
    outbox,
    new SamlService(),
    new PermissionResolverService(db, new PermissionCacheService(redis)),
    new MfaChallengeService("test-mfa-challenge-secret-0123456789012"),
  );

  return {
    authService,
    redis,
    denylist,
    userPreferencesService: new UserPreferencesService(db, outbox),
    companySettingsService: new CompanySettingsService(db, outbox),
  };
}
