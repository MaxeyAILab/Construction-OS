import { randomBytes } from "node:crypto";
import { JwtService } from "@nestjs/jwt";
import type { Database } from "../../src/infrastructure/db/client";
import { createRedisClient, type RedisClient } from "../../src/infrastructure/redis/client";
import { AuthService } from "../../src/modules/auth/application/auth.service";
import { ScimGroupsService } from "../../src/modules/auth/application/scim-groups.service";
import { ScimUsersService } from "../../src/modules/auth/application/scim-users.service";
import { SsoConnectionsService } from "../../src/modules/auth/application/sso-connections.service";
import { EncryptionService } from "../../src/modules/auth/infrastructure/encryption.service";
import { MagicLinkService } from "../../src/modules/auth/infrastructure/magic-link.service";
import { MfaChallengeService } from "../../src/modules/auth/infrastructure/mfa-challenge.service";
import { PasswordResetService } from "../../src/modules/auth/infrastructure/password-reset.service";
import { PasswordService } from "../../src/modules/auth/infrastructure/password.service";
import { RefreshTokenService } from "../../src/modules/auth/infrastructure/refresh-token.service";
import type { SamlAssertionResult } from "../../src/modules/auth/infrastructure/saml.service";
import { SamlService } from "../../src/modules/auth/infrastructure/saml.service";
import { SessionDenylistService } from "../../src/modules/auth/infrastructure/session-denylist.service";
import { TokenService } from "../../src/modules/auth/infrastructure/token.service";
import { TotpService } from "../../src/modules/auth/infrastructure/totp.service";
import { OutboxService } from "../../src/modules/events/application/outbox.service";
import { PermissionCacheService } from "../../src/modules/rbac/infrastructure/permission-cache.service";
import { PermissionResolverService } from "../../src/modules/rbac/application/permission-resolver.service";
import { RbacService } from "../../src/modules/rbac/application/rbac.service";

// Stands in for a real IdP's signature verification the same way
// FakeAccountingProvider stands in for a QuickBooks sandbox
// (test/setup/accounting.ts) — SamlService's own crypto-correctness is
// @node-saml/node-saml's responsibility (CLAUDE.md: don't hand-roll
// crypto), so AuthService's JIT-provisioning logic is tested against a
// stubbed assertion result instead of a hand-signed SAML response.
export class FakeSamlService extends SamlService {
  assertion: SamlAssertionResult = { email: "fake-idp-user@example.com", fullName: "Fake IdP User" };

  override async validateAssertion(): Promise<SamlAssertionResult> {
    return this.assertion;
  }
}

export function buildTestAuthServiceWithSso(db: Database): {
  authService: AuthService;
  fakeSaml: FakeSamlService;
  redis: RedisClient;
} {
  const jwt = new JwtService({ secret: "test-jwt-access-secret-0123456789012345" });
  const redis = createRedisClient({ REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:6379" });
  const denylist = new SessionDenylistService(redis);
  const outbox = new OutboxService();
  const fakeSaml = new FakeSamlService();

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
    fakeSaml,
    new PermissionResolverService(db, new PermissionCacheService(redis)),
    new MfaChallengeService("test-mfa-challenge-secret-0123456789012"),
  );

  return { authService, fakeSaml, redis };
}

export function buildTestSsoServices(db: Database): {
  ssoConnections: SsoConnectionsService;
  scimUsers: ScimUsersService;
  scimGroups: ScimGroupsService;
  redis: RedisClient;
} {
  const outbox = new OutboxService();
  const redis = createRedisClient({ REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:6379" });
  const rbac = new RbacService(db, new PermissionCacheService(redis), outbox);

  return {
    ssoConnections: new SsoConnectionsService(db, outbox),
    scimUsers: new ScimUsersService(db, outbox),
    scimGroups: new ScimGroupsService(db, rbac),
    redis,
  };
}
