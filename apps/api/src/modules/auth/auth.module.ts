import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { JwtModule } from "@nestjs/jwt";
import { loadEnv } from "../../config/env";
import { createDatabase, DATABASE } from "../../infrastructure/db/client";
import { createRedisClient, REDIS_CLIENT } from "../../infrastructure/redis/client";
// Deep import, not the "../../rbac" barrel — same cycle-avoidance
// precedent documented in scim-groups.service.ts.
import { PermissionCacheService } from "../rbac/infrastructure/permission-cache.service";
import { RbacService } from "../rbac/application/rbac.service";
import { EventsModule } from "../events";
import { AccessTokenGuard } from "./api/access-token.guard";
import { ApiKeysController } from "./api/api-keys.controller";
import { AuthController } from "./api/auth.controller";
import { CompanySettingsController } from "./api/company-settings.controller";
import { ScimGroupsController } from "./api/scim-groups.controller";
import { ScimAuthGuard } from "./api/scim-auth.guard";
import { ScimUsersController } from "./api/scim-users.controller";
import { SsoConnectionsController } from "./api/sso-connections.controller";
import { SsoLoginController } from "./api/sso-login.controller";
import { ApiKeysService } from "./application/api-keys.service";
import { AuthService } from "./application/auth.service";
import { CompanySettingsService } from "./application/company-settings.service";
import { ScimGroupsService } from "./application/scim-groups.service";
import { ScimUsersService } from "./application/scim-users.service";
import { SsoConnectionsService } from "./application/sso-connections.service";
import { UserPreferencesService } from "./application/user-preferences.service";
import { EncryptionService } from "./infrastructure/encryption.service";
import { MagicLinkService } from "./infrastructure/magic-link.service";
import { PasswordService } from "./infrastructure/password.service";
import { RefreshTokenService } from "./infrastructure/refresh-token.service";
import { SamlService } from "./infrastructure/saml.service";
import { SessionDenylistService } from "./infrastructure/session-denylist.service";
import { TokenService } from "./infrastructure/token.service";
import { TotpService } from "./infrastructure/totp.service";

const env = loadEnv();

@Module({
  imports: [JwtModule.register({ secret: env.JWT_ACCESS_SECRET }), EventsModule],
  controllers: [
    AuthController,
    CompanySettingsController,
    ApiKeysController,
    SsoConnectionsController,
    SsoLoginController,
    ScimUsersController,
    ScimGroupsController,
  ],
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
    { provide: APP_GUARD, useClass: AccessTokenGuard },
    AuthService,
    UserPreferencesService,
    CompanySettingsService,
    ApiKeysService,
    SamlService,
    SsoConnectionsService,
    ScimAuthGuard,
    PermissionCacheService,
    RbacService,
    ScimUsersService,
    ScimGroupsService,
  ],
  exports: [AuthService],
})
export class AuthModule {}
