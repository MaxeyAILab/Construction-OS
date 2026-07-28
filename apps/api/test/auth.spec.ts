import { eq } from "drizzle-orm";
import { authenticator } from "otplib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenant } from "../src/infrastructure/db/client";
import { companies, companyUsers, outbox, roles, userRoles } from "../src/infrastructure/db/schema";
import {
  AmbiguousCompanyError,
  InvalidCredentialsError,
  InvalidMfaCodeError,
  InvalidRefreshTokenError,
  MfaRequiredError,
} from "../src/modules/auth/domain/errors";
import { bootstrapTestRole, getTestDatabase } from "./setup/db";
import { buildTestAuthService } from "./setup/auth";

describe("auth flows", () => {
  const db = getTestDatabase();
  const { authService, redis, denylist, userPreferencesService, companySettingsService } =
    buildTestAuthService(db);

  async function outboxEventTypes(tenantId: string): Promise<string[]> {
    const rows = await withTenant(db, tenantId, (tx) =>
      tx.query.outbox.findMany({ where: eq(outbox.tenantId, tenantId) }),
    );
    return rows.map((r) => r.eventType);
  }

  beforeAll(async () => {
    await bootstrapTestRole();
  });

  afterAll(async () => {
    await redis.quit();
  });

  it("signs up, then logs in with the same credentials", async () => {
    const suffix = Date.now();
    const email = `owner-${suffix}@example.com`;
    const signUp = await authService.signUp({
      email,
      password: "correct horse battery staple",
      fullName: "Jane Owner",
      companyName: `Acme ${suffix}`,
    });
    expect(signUp.accessToken).toBeTruthy();
    expect(signUp.refreshToken).toContain(signUp.companyId);

    const login = await authService.login({ email, password: "correct horse battery staple" });
    expect(login.companyId).toBe(signUp.companyId);
  });

  it("rejects the wrong password", async () => {
    const suffix = Date.now();
    const email = `wrongpw-${suffix}@example.com`;
    await authService.signUp({
      email,
      password: "correct horse battery staple",
      fullName: "Wrong PW",
      companyName: `Bolt ${suffix}`,
    });

    await expect(authService.login({ email, password: "not the right password" })).rejects.toThrow(
      InvalidCredentialsError,
    );
  });

  it("requires an explicit companyId when a user belongs to more than one company", async () => {
    const suffix = Date.now();
    const email = `multi-${suffix}@example.com`;
    const first = await authService.signUp({
      email,
      password: "correct horse battery staple",
      fullName: "Multi Co",
      companyName: `First ${suffix}`,
    });

    const [secondCompany] = await db
      .insert(companies)
      .values({ name: `Second ${suffix}`, slug: `second-${suffix}` })
      .returning();
    await withTenant(db, secondCompany!.id, async (tx) => {
      const [role] = await tx
        .insert(roles)
        .values({ tenantId: secondCompany!.id, name: "Owner", isSystem: true })
        .returning();
      const userId = (await db.query.users.findFirst({ where: (u, { eq }) => eq(u.email, email) }))!
        .id;
      await tx.insert(companyUsers).values({ tenantId: secondCompany!.id, userId });
      await tx
        .insert(userRoles)
        .values({ tenantId: secondCompany!.id, userId, roleId: role!.id, scopeType: "company" });
    });

    await expect(
      authService.login({ email, password: "correct horse battery staple" }),
    ).rejects.toThrow(AmbiguousCompanyError);

    const login = await authService.login({
      email,
      password: "correct horse battery staple",
      companyId: first.companyId,
    });
    expect(login.companyId).toBe(first.companyId);
  });

  it("rotates the refresh token and invalidates the previous one", async () => {
    const suffix = Date.now();
    const email = `refresh-${suffix}@example.com`;
    const signUp = await authService.signUp({
      email,
      password: "correct horse battery staple",
      fullName: "Refresh Case",
      companyName: `Refreshco ${suffix}`,
    });

    const rotated = await authService.refresh(signUp.refreshToken);
    expect(rotated.refreshToken).not.toBe(signUp.refreshToken);

    await expect(authService.refresh(signUp.refreshToken)).rejects.toThrow(
      InvalidRefreshTokenError,
    );

    const rotatedAgain = await authService.refresh(rotated.refreshToken);
    expect(rotatedAgain.accessToken).toBeTruthy();
  });

  it("revokes the session on logout and denylists the access token", async () => {
    const suffix = Date.now();
    const email = `logout-${suffix}@example.com`;
    const signUp = await authService.signUp({
      email,
      password: "correct horse battery staple",
      fullName: "Logout Case",
      companyName: `Logoutco ${suffix}`,
    });

    const decoded = JSON.parse(
      Buffer.from(signUp.accessToken.split(".")[1]!, "base64url").toString(),
    );
    await authService.logout(
      signUp.companyId,
      decoded.sessionId,
      decoded.jti,
      new Date(Date.now() + 60_000),
    );

    expect(await denylist.isDenylisted(decoded.jti)).toBe(true);
    await expect(authService.refresh(signUp.refreshToken)).rejects.toThrow(
      InvalidRefreshTokenError,
    );
  });

  it("enforces MFA once enrolled", async () => {
    const suffix = Date.now();
    const email = `mfa-${suffix}@example.com`;
    const signUp = await authService.signUp({
      email,
      password: "correct horse battery staple",
      fullName: "MFA Case",
      companyName: `Mfaco ${suffix}`,
    });

    const decoded = JSON.parse(
      Buffer.from(signUp.accessToken.split(".")[1]!, "base64url").toString(),
    );
    const enrollment = await authService.startMfaEnrollment(decoded.sub);
    await authService.confirmMfaEnrollment(
      decoded.sub,
      enrollment.secret,
      authenticator.generate(enrollment.secret),
    );

    await expect(
      authService.login({ email, password: "correct horse battery staple" }),
    ).rejects.toThrow(MfaRequiredError);
    await expect(
      authService.login({ email, password: "correct horse battery staple", totpCode: "000000" }),
    ).rejects.toThrow(InvalidMfaCodeError);

    const login = await authService.login({
      email,
      password: "correct horse battery staple",
      totpCode: authenticator.generate(enrollment.secret),
    });
    expect(login.companyId).toBe(signUp.companyId);
  });

  it("issues a working session via magic link", async () => {
    const suffix = Date.now();
    const email = `magic-${suffix}@example.com`;
    const signUp = await authService.signUp({
      email,
      password: "correct horse battery staple",
      fullName: "Magic Case",
      companyName: `Magicco ${suffix}`,
    });

    const token = await authService.requestMagicLink(email, signUp.companyId);
    const consumed = await authService.consumeMagicLink(token);
    expect(consumed.companyId).toBe(signUp.companyId);
    expect(consumed.accessToken).toBeTruthy();
  });

  it("reads and updates a user's own locale preference (NFR-30 activation)", async () => {
    const suffix = Date.now();
    const email = `prefs-${suffix}@example.com`;
    const signUp = await authService.signUp({
      email,
      password: "correct horse battery staple",
      fullName: "Prefs Case",
      companyName: `Prefsco ${suffix}`,
    });
    const decoded = JSON.parse(
      Buffer.from(signUp.accessToken.split(".")[1]!, "base64url").toString(),
    );

    const initial = await userPreferencesService.get(decoded.sub);
    expect(initial.locale).toBe("en-US");

    const updated = await userPreferencesService.update(signUp.companyId, decoded.sub, {
      locale: "en-GB",
    });
    expect(updated.locale).toBe("en-GB");
    expect((await userPreferencesService.get(decoded.sub)).locale).toBe("en-GB");

    const eventTypes = await outboxEventTypes(signUp.companyId);
    expect(eventTypes).toContain("user.preferences_updated.v1");
  });

  it("a preferences PATCH with no fields is a no-op read, not an update", async () => {
    const suffix = Date.now();
    const email = `prefs-noop-${suffix}@example.com`;
    const signUp = await authService.signUp({
      email,
      password: "correct horse battery staple",
      fullName: "Prefs Noop",
      companyName: `Prefsnoop ${suffix}`,
    });
    const decoded = JSON.parse(
      Buffer.from(signUp.accessToken.split(".")[1]!, "base64url").toString(),
    );

    const result = await userPreferencesService.update(signUp.companyId, decoded.sub, {});
    expect(result.locale).toBe("en-US");

    const eventTypes = await outboxEventTypes(signUp.companyId);
    expect(eventTypes).not.toContain("user.preferences_updated.v1");
  });

  it("reads and updates company settings: locale, currency, unit system, branding, fiscal config (NFR-30 activation)", async () => {
    const suffix = Date.now();
    const email = `company-${suffix}@example.com`;
    const signUp = await authService.signUp({
      email,
      password: "correct horse battery staple",
      fullName: "Company Case",
      companyName: `Companyco ${suffix}`,
    });

    const initial = await companySettingsService.get(signUp.companyId);
    expect(initial.locale).toBe("en-US");
    expect(initial.currencyCode).toBe("USD");

    const decoded = JSON.parse(
      Buffer.from(signUp.accessToken.split(".")[1]!, "base64url").toString(),
    );
    const updated = await companySettingsService.update(signUp.companyId, decoded.sub, {
      locale: "en-GB",
      currencyCode: "GBP",
      settings: { unitSystem: "metric", fiscalYearStartMonth: 4 },
    });
    expect(updated.locale).toBe("en-GB");
    expect(updated.currencyCode).toBe("GBP");
    expect(updated.settings).toMatchObject({ unitSystem: "metric", fiscalYearStartMonth: 4 });

    // A second PATCH touching only branding must not clobber the
    // unitSystem/fiscalYearStartMonth set above (top-level settings keys
    // merge; only keys present in the body are replaced).
    const branded = await companySettingsService.update(signUp.companyId, decoded.sub, {
      settings: { branding: { primaryColor: "#336699" } },
    });
    expect(branded.settings).toMatchObject({
      unitSystem: "metric",
      fiscalYearStartMonth: 4,
      branding: { primaryColor: "#336699" },
    });

    const eventTypes = await outboxEventTypes(signUp.companyId);
    expect(eventTypes.filter((t) => t === "company.updated.v1")).toHaveLength(2);
  });

  // api.md §2: GET /auth/me — "Current principal: user, tenant, roles,
  // permissions". Verifies it reflects the real Owner role/permission grant
  // from signUp, not a stub.
  it("getMe returns the current principal's identity, tenant, roles, and resolved permissions", async () => {
    const suffix = Date.now();
    const email = `me-${suffix}@example.com`;
    const signUp = await authService.signUp({
      email,
      password: "correct horse battery staple",
      fullName: "Me Case",
      companyName: `Meco ${suffix}`,
    });
    const decoded = JSON.parse(
      Buffer.from(signUp.accessToken.split(".")[1]!, "base64url").toString(),
    );

    const me = await authService.getMe(signUp.companyId, decoded.sub, decoded.roles);
    expect(me.userId).toBe(decoded.sub);
    expect(me.email).toBe(email);
    expect(me.tenantId).toBe(signUp.companyId);
    expect(me.companyName).toBe(`Meco ${suffix}`);
    expect(me.roles).toEqual(["Owner"]);
    expect(me.permissions.length).toBeGreaterThan(0);
    expect(me.permissions).toContain("platform.role.manage");
  });
});
