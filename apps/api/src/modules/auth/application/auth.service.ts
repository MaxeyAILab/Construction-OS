import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { loginSchema, signUpSchema } from "@constructionos/schemas";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { z } from "zod";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import {
  companies,
  companyUsers,
  permissions,
  rolePermissions,
  roles,
  sessions,
  userRoles,
  users,
} from "../../../infrastructure/db/schema";
import {
  AmbiguousCompanyError,
  EmailAlreadyRegisteredError,
  InvalidCredentialsError,
  InvalidMfaCodeError,
  InvalidRefreshTokenError,
  MfaRequiredError,
  NoCompanyMembershipError,
  NotAMemberError,
} from "../domain/errors";
// Real (non-type-only) imports required: NestJS constructor injection
// resolves providers via emitDecoratorMetadata, which needs the actual
// class reference at runtime, not just its type.
import { EncryptionService } from "../infrastructure/encryption.service";
import { MagicLinkService } from "../infrastructure/magic-link.service";
import { PasswordService } from "../infrastructure/password.service";
import { RefreshTokenService } from "../infrastructure/refresh-token.service";
import { SessionDenylistService } from "../infrastructure/session-denylist.service";
import { TokenService } from "../infrastructure/token.service";
import { TotpService } from "../infrastructure/totp.service";

export interface DeviceContext {
  deviceId?: string | undefined;
  deviceName?: string | undefined;
  ipAddress?: string | undefined;
  userAgent?: string | undefined;
}

export interface IssuedSession {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

type CompanyMembership = Record<string, unknown> & {
  companyId: string;
  companyName: string;
  companySlug: string;
};

@Injectable()
export class AuthService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly password: PasswordService,
    private readonly tokens: TokenService,
    private readonly refreshTokens: RefreshTokenService,
    private readonly totp: TotpService,
    private readonly encryption: EncryptionService,
    private readonly magicLink: MagicLinkService,
    private readonly denylist: SessionDenylistService,
  ) {}

  async signUp(
    input: z.infer<typeof signUpSchema>,
    device: DeviceContext = {},
  ): Promise<IssuedSession & { companyId: string }> {
    const existing = await this.db.query.users.findFirst({ where: eq(users.email, input.email) });
    if (existing) throw new EmailAlreadyRegisteredError();

    const passwordHash = await this.password.hash(input.password);
    const [user] = await this.db
      .insert(users)
      .values({ email: input.email, passwordHash, fullName: input.fullName })
      .returning();
    const [company] = await this.db
      .insert(companies)
      .values({ name: input.companyName, slug: this.slugify(input.companyName) })
      .returning();

    // Owner gets every permission in the catalog — it's the only role that
    // exists at signup, and nobody could otherwise call any RBAC-gated
    // endpoint (including the ones that create further roles).
    const catalog = await this.db.select({ key: permissions.key }).from(permissions);

    const session = await withTenant(this.db, company!.id, async (tx) => {
      const [ownerRole] = await tx
        .insert(roles)
        .values({ tenantId: company!.id, name: "Owner", isSystem: true })
        .returning();
      await tx.insert(companyUsers).values({ tenantId: company!.id, userId: user!.id });
      await tx.insert(userRoles).values({
        tenantId: company!.id,
        userId: user!.id,
        roleId: ownerRole!.id,
        scopeType: "company",
      });
      if (catalog.length > 0) {
        await tx
          .insert(rolePermissions)
          .values(
            catalog.map((p) => ({
              tenantId: company!.id,
              roleId: ownerRole!.id,
              permissionKey: p.key,
            })),
          );
      }

      return this.issueSession(tx, user!.id, company!.id, ["Owner"], device);
    });

    return { ...session, companyId: company!.id };
  }

  async login(
    input: z.infer<typeof loginSchema>,
    device: DeviceContext = {},
  ): Promise<IssuedSession & { companyId: string }> {
    const user = await this.db.query.users.findFirst({ where: eq(users.email, input.email) });
    if (!user?.passwordHash || !(await this.password.verify(user.passwordHash, input.password))) {
      throw new InvalidCredentialsError();
    }

    if (user.mfaSecretEnc) {
      if (!input.totpCode) throw new MfaRequiredError();
      const secret = this.encryption.decrypt(user.mfaSecretEnc);
      if (!this.totp.verify(input.totpCode, secret)) throw new InvalidMfaCodeError();
    }

    const companyId = input.companyId ?? (await this.resolveSoleCompanyId(user.id));

    return withTenant(this.db, companyId, async (tx) => {
      const roleNames = await this.membershipRoleNames(tx, companyId, user.id);
      const session = await this.issueSession(tx, user.id, companyId, roleNames, device);
      return { ...session, companyId };
    });
  }

  async refresh(refreshToken: string, device: DeviceContext = {}): Promise<IssuedSession> {
    const tenantId = this.refreshTokens.parseTenantId(refreshToken);
    if (!tenantId) throw new InvalidRefreshTokenError();

    return withTenant(this.db, tenantId, async (tx) => {
      const hash = this.refreshTokens.hashToken(refreshToken);
      const existing = await tx.query.sessions.findFirst({
        where: and(eq(sessions.refreshTokenHash, hash), isNull(sessions.revokedAt)),
      });
      if (!existing || existing.expiresAt < new Date()) {
        throw new InvalidRefreshTokenError();
      }

      const issued = this.refreshTokens.issue(tenantId);
      await tx
        .update(sessions)
        .set({
          refreshTokenHash: issued.hash,
          expiresAt: issued.expiresAt,
          deviceId: device.deviceId ?? existing.deviceId,
          deviceName: device.deviceName ?? existing.deviceName,
          ipAddress: device.ipAddress ?? existing.ipAddress,
          userAgent: device.userAgent ?? existing.userAgent,
        })
        .where(eq(sessions.id, existing.id));

      const roleNames = await this.membershipRoleNames(tx, tenantId, existing.userId);
      const access = await this.tokens.issueAccessToken({
        sub: existing.userId,
        tenantId,
        roles: roleNames,
        sessionId: existing.id,
      });

      return { accessToken: access.token, refreshToken: issued.token, expiresAt: access.expiresAt };
    });
  }

  async logout(
    tenantId: string,
    sessionId: string,
    accessTokenJti: string,
    accessTokenExpiresAt: Date,
  ): Promise<void> {
    await withTenant(this.db, tenantId, (tx) =>
      tx.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, sessionId)),
    );
    const remainingSeconds = Math.ceil((accessTokenExpiresAt.getTime() - Date.now()) / 1000);
    await this.denylist.denylist(accessTokenJti, remainingSeconds);
  }

  async startMfaEnrollment(userId: string): Promise<{ secret: string; keyUri: string }> {
    const user = await this.db.query.users.findFirst({ where: eq(users.id, userId) });
    if (!user) throw new InvalidCredentialsError();
    const secret = this.totp.generateSecret();
    return { secret, keyUri: this.totp.keyUri(user.email, secret) };
  }

  async confirmMfaEnrollment(userId: string, secret: string, totpCode: string): Promise<void> {
    if (!this.totp.verify(totpCode, secret)) throw new InvalidMfaCodeError();
    await this.db
      .update(users)
      .set({ mfaSecretEnc: this.encryption.encrypt(secret) })
      .where(eq(users.id, userId));
  }

  async requestMagicLink(email: string, companyId: string): Promise<string> {
    const user = await this.db.query.users.findFirst({ where: eq(users.email, email) });
    if (!user) throw new NotAMemberError();
    await withTenant(this.db, companyId, async (tx) => {
      const membership = await tx.query.companyUsers.findFirst({
        where: and(eq(companyUsers.tenantId, companyId), eq(companyUsers.userId, user.id)),
      });
      if (!membership) throw new NotAMemberError();
    });
    // Real delivery (email) is the Notification Service, a separate roadmap
    // row not yet built — callers get the token directly for now.
    return this.magicLink.issue({ email, companyId });
  }

  async consumeMagicLink(
    token: string,
    device: DeviceContext = {},
  ): Promise<IssuedSession & { companyId: string }> {
    const { email, companyId } = this.magicLink.consume(token);
    const user = await this.db.query.users.findFirst({ where: eq(users.email, email) });
    if (!user) throw new NotAMemberError();

    return withTenant(this.db, companyId, async (tx) => {
      const roleNames = await this.membershipRoleNames(tx, companyId, user.id);
      const session = await this.issueSession(tx, user.id, companyId, roleNames, device);
      return { ...session, companyId };
    });
  }

  private async issueSession(
    tx: Database,
    userId: string,
    tenantId: string,
    roleNames: string[],
    device: DeviceContext,
  ): Promise<IssuedSession> {
    const issued = this.refreshTokens.issue(tenantId);
    const [session] = await tx
      .insert(sessions)
      .values({
        tenantId,
        userId,
        refreshTokenHash: issued.hash,
        expiresAt: issued.expiresAt,
        deviceId: device.deviceId,
        deviceName: device.deviceName,
        ipAddress: device.ipAddress,
        userAgent: device.userAgent,
      })
      .returning();

    const access = await this.tokens.issueAccessToken({
      sub: userId,
      tenantId,
      roles: roleNames,
      sessionId: session!.id,
    });

    return { accessToken: access.token, refreshToken: issued.token, expiresAt: access.expiresAt };
  }

  private async membershipRoleNames(
    tx: Database,
    tenantId: string,
    userId: string,
  ): Promise<string[]> {
    const membership = await tx.query.companyUsers.findFirst({
      where: and(eq(companyUsers.tenantId, tenantId), eq(companyUsers.userId, userId)),
    });
    if (!membership) throw new NotAMemberError();

    const rows = await tx
      .select({ name: roles.name })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(
        and(
          eq(userRoles.tenantId, tenantId),
          eq(userRoles.userId, userId),
          eq(userRoles.scopeType, "company"),
        ),
      );
    return rows.map((r) => r.name);
  }

  // SECURITY DEFINER function (0003_user_company_lookup.sql) — the one
  // deliberate, narrow exception to "always query through withTenant": a
  // user's own list of memberships is inherently cross-tenant, and RLS
  // can't be satisfied without already knowing the tenant to look in.
  private async resolveSoleCompanyId(userId: string): Promise<string> {
    const rows = await this.db.execute<CompanyMembership>(
      sql`select company_id as "companyId", company_name as "companyName", company_slug as "companySlug"
          from get_user_company_memberships(${userId})`,
    );
    const memberships = Array.from(rows);
    if (memberships.length === 0) throw new NoCompanyMembershipError();
    if (memberships.length > 1) throw new AmbiguousCompanyError();
    return memberships[0]!.companyId;
  }

  private slugify(name: string): string {
    const base = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");
    return `${base}-${randomUUID().slice(0, 8)}`;
  }
}
