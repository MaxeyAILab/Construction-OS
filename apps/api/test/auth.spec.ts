import { eq } from "drizzle-orm";
import { authenticator } from "otplib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenant } from "../src/infrastructure/db/client";
import { companies, companyUsers, outbox, roles, userRoles } from "../src/infrastructure/db/schema";
import {
  AmbiguousCompanyError,
  InvalidCredentialsError,
  InvalidMfaChallengeError,
  InvalidMfaCodeError,
  InvalidParentCompanyError,
  InvalidPasswordResetTokenError,
  InvalidRefreshTokenError,
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

    const login = (await authService.login({ email, password: "correct horse battery staple" })) as {
      companyId: string;
    };
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

    const ambiguous = await authService
      .login({ email, password: "correct horse battery staple" })
      .then(
        () => null,
        (err: unknown) => err,
      );
    expect(ambiguous).toBeInstanceOf(AmbiguousCompanyError);
    const companiesInError = (ambiguous as AmbiguousCompanyError).details as {
      companies: { companyId: string; companyName: string; companySlug: string }[];
    };
    expect(companiesInError.companies.map((c) => c.companyId).sort()).toEqual(
      [first.companyId, secondCompany!.id].sort(),
    );

    const login = (await authService.login({
      email,
      password: "correct horse battery staple",
      companyId: first.companyId,
    })) as { companyId: string };
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

    // api.md §2: login() returns a step-up challenge instead of throwing.
    const challenge = await authService.login({ email, password: "correct horse battery staple" });
    expect(challenge).toMatchObject({ mfaRequired: true });
    const mfaToken = (challenge as { mfaRequired: true; mfaToken: string }).mfaToken;
    expect(mfaToken).toBeTruthy();

    await expect(
      authService.login({ email, password: "correct horse battery staple", totpCode: "000000" }),
    ).rejects.toThrow(InvalidMfaCodeError);
    await expect(authService.verifyMfaChallenge(mfaToken, "000000")).rejects.toThrow(
      InvalidMfaCodeError,
    );
    await expect(authService.verifyMfaChallenge("not-a-real-token", "000000")).rejects.toThrow(
      InvalidMfaChallengeError,
    );

    // The inline-totpCode shortcut still completes login in one call.
    const login = await authService.login({
      email,
      password: "correct horse battery staple",
      totpCode: authenticator.generate(enrollment.secret),
    });
    expect((login as { companyId: string }).companyId).toBe(signUp.companyId);

    // The two-step flow: consume the original challenge token.
    const verified = await authService.verifyMfaChallenge(
      mfaToken,
      authenticator.generate(enrollment.secret),
    );
    expect(verified.companyId).toBe(signUp.companyId);
    expect(verified.accessToken).toBeTruthy();
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

  // FR-PLAT-9 (api.md §15.7): PATCH /admin/company's parent_company_id +
  // GET /admin/company/children. `addMembership` mirrors the raw
  // company_users insert the ambiguous-company test above already uses to
  // give one user a second membership, without the role/permission
  // plumbing that test also sets up — assertValidParentLink only needs an
  // active company_users row, same as get_user_company_memberships itself.
  describe("multi-company / holding structures", () => {
    async function addMembership(userId: string, label: string) {
      const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const [company] = await db
        .insert(companies)
        .values({ name: `${label} ${suffix}`, slug: `${label}-${suffix}` })
        .returning();
      await withTenant(db, company!.id, (tx) => tx.insert(companyUsers).values({ tenantId: company!.id, userId }));
      return company!;
    }

    async function signUpOwner(label: string) {
      const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const signUp = await authService.signUp({
        email: `${label}-${suffix}@example.com`,
        password: "correct horse battery staple",
        fullName: "Owner",
        companyName: `${label} ${suffix}`,
      });
      const decoded = JSON.parse(Buffer.from(signUp.accessToken.split(".")[1]!, "base64url").toString());
      return { tenantId: signUp.companyId, ownerId: decoded.sub as string };
    }

    it("links a company under a holding parent the owner also belongs to, and lists it via children", async () => {
      const child = await signUpOwner("Child");
      const parent = await addMembership(child.ownerId, "Parent");

      const updated = await companySettingsService.update(child.tenantId, child.ownerId, {
        parentCompanyId: parent.id,
      });
      expect(updated.parentCompanyId).toBe(parent.id);

      const children = await companySettingsService.listChildren(parent.id);
      expect(children).toHaveLength(1);
      expect(children[0]).toMatchObject({ companyId: child.tenantId, companyName: updated.name, companySlug: updated.slug });

      const eventTypes = await outboxEventTypes(child.tenantId);
      expect(eventTypes).toContain("company.updated.v1");

      const cleared = await companySettingsService.update(child.tenantId, child.ownerId, { parentCompanyId: null });
      expect(cleared.parentCompanyId).toBeNull();
      expect(await companySettingsService.listChildren(parent.id)).toHaveLength(0);
    });

    it("rejects a company naming itself as its own parent", async () => {
      const { tenantId, ownerId } = await signUpOwner("SelfParent");
      await expect(
        companySettingsService.update(tenantId, ownerId, { parentCompanyId: tenantId }),
      ).rejects.toThrow(InvalidParentCompanyError);
    });

    it("rejects linking to a company the acting user doesn't belong to", async () => {
      const { tenantId, ownerId } = await signUpOwner("Outsider");
      const strangersCompany = await signUpOwner("Stranger");

      await expect(
        companySettingsService.update(tenantId, ownerId, { parentCompanyId: strangersCompany.tenantId }),
      ).rejects.toThrow(InvalidParentCompanyError);
    });

    it("rejects a link that would create a circular holding structure", async () => {
      const grandparent = await signUpOwner("Grandparent");
      const parent = await addMembership(grandparent.ownerId, "MiddleParent");

      // parent -> grandparent (a valid link: the owner belongs to both)
      await companySettingsService.update(parent.id, grandparent.ownerId, {
        parentCompanyId: grandparent.tenantId,
      });

      // Now grandparent -> parent would close the loop.
      await expect(
        companySettingsService.update(grandparent.tenantId, grandparent.ownerId, { parentCompanyId: parent.id }),
      ).rejects.toThrow(InvalidParentCompanyError);
    });
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
    expect(me.permissions).toContain("admin.role.manage");
  });

  // api.md §2: POST /auth/password/forgot -> /auth/password/reset. Same
  // stateless-JWT shape as MagicLinkService (not tracked as single-use
  // server-side, same precedent as consumeMagicLink above) — the token
  // itself just proves control of the original request within its TTL.
  it("resets a password via a tokenized link", async () => {
    const suffix = Date.now();
    const email = `forgot-${suffix}@example.com`;
    await authService.signUp({
      email,
      password: "correct horse battery staple",
      fullName: "Forgot Case",
      companyName: `Forgotco ${suffix}`,
    });

    const token = await authService.requestPasswordReset(email);
    expect(token).toBeTruthy();

    await authService.resetPassword(token!, "new correct horse battery");
    const login = (await authService.login({ email, password: "new correct horse battery" })) as {
      companyId: string;
    };
    expect(login.companyId).toBeTruthy();

    await expect(authService.login({ email, password: "correct horse battery staple" })).rejects.toThrow(
      InvalidCredentialsError,
    );
  });

  it("requestPasswordReset silently no-ops for an unknown email (no user enumeration)", async () => {
    await expect(
      authService.requestPasswordReset(`nobody-${Date.now()}@example.com`),
    ).resolves.toBeNull();
  });

  it("resetPassword rejects a garbage token", async () => {
    await expect(authService.resetPassword("not-a-real-token", "some new password")).rejects.toThrow(
      InvalidPasswordResetTokenError,
    );
  });
});
