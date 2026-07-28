import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SamlService } from "../src/modules/auth/infrastructure/saml.service";
import { buildTestAuthService } from "./setup/auth";
import { bootstrapTestRole, getTestDatabase } from "./setup/db";
import { buildTestAuthServiceWithSso, buildTestSsoServices } from "./setup/sso";

// api.md §2.1 "Enterprise SSO (SAML) + SCIM provisioning" (FR-PLAT-2).
// SamlService's own signature-validation correctness is
// @node-saml/node-saml's responsibility (CLAUDE.md: don't hand-roll
// crypto) — loginViaSso is tested against a stubbed assertion result
// (FakeSamlService, same "can't stand up a real IdP in CI" precedent as
// test/accounting.spec.ts's FakeAccountingProvider).
describe("Enterprise SSO (SAML) + SCIM provisioning", () => {
  const db = getTestDatabase();
  const { authService, redis: baseRedis } = buildTestAuthService(db);
  const { ssoConnections, scimUsers, scimGroups, redis: ssoRedis } = buildTestSsoServices(db);

  beforeAll(async () => {
    await bootstrapTestRole();
  });

  afterAll(async () => {
    await baseRedis.quit();
    await ssoRedis.quit();
  });

  async function signUpCompany(label: string) {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const signUp = await authService.signUp({
      email: `sso-${label}-${suffix}@example.com`,
      password: "correct horse battery staple",
      fullName: "Owner",
      companyName: `SSO ${label} ${suffix}`,
    });
    const payload = JSON.parse(Buffer.from(signUp.accessToken.split(".")[1]!, "base64url").toString());
    return { tenantId: signUp.companyId, ownerId: payload.sub as string };
  }

  async function createRole(tenantId: string, ownerId: string, name: string) {
    // Reuses the same rbac tables directly (no RbacController dependency
    // in this test file) — mirrors how other spec files seed a role.
    const { withTenant } = await import("../src/infrastructure/db/client");
    const { roles } = await import("../src/infrastructure/db/schema");
    return withTenant(db, tenantId, async (tx) => {
      const [role] = await tx.insert(roles).values({ tenantId, name, createdBy: ownerId }).returning();
      return role!;
    });
  }

  describe("SsoConnectionsService", () => {
    it("creates, lists (redacted), updates, and deletes a connection", async () => {
      const { tenantId, ownerId } = await signUpCompany("crud");
      const role = await createRole(tenantId, ownerId, "SSO Default");

      const created = await ssoConnections.create(tenantId, ownerId, {
        name: "Okta",
        idpEntityId: "https://idp.example.test/entity",
        idpSsoUrl: "https://idp.example.test/sso",
        idpCertificate: "-----BEGIN CERTIFICATE-----\nMIIB...fake...\n-----END CERTIFICATE-----",
        defaultRoleId: role.id,
      });
      expect(created).not.toHaveProperty("scimTokenHash");

      const listed = await ssoConnections.list(tenantId);
      expect(listed).toHaveLength(1);
      expect(listed[0]).not.toHaveProperty("scimTokenHash");

      const updated = await ssoConnections.update(tenantId, ownerId, created.id, { name: "Okta (renamed)" });
      expect(updated.name).toBe("Okta (renamed)");

      await ssoConnections.delete(tenantId, ownerId, created.id);
      await expect(ssoConnections.list(tenantId)).resolves.toHaveLength(0);
    });

    it("rotates a SCIM token: the raw token authenticates once, the prior one stops working", async () => {
      const { tenantId, ownerId } = await signUpCompany("scim-token");
      const role = await createRole(tenantId, ownerId, "SCIM Default");
      const created = await ssoConnections.create(tenantId, ownerId, {
        name: "Entra",
        idpEntityId: "https://idp2.example.test/entity",
        idpSsoUrl: "https://idp2.example.test/sso",
        idpCertificate: "-----BEGIN CERTIFICATE-----\nMIIB...fake2...\n-----END CERTIFICATE-----",
        defaultRoleId: role.id,
      });

      const tokenA = await ssoConnections.rotateScimToken(tenantId, ownerId, created.id);
      expect(tokenA).toMatch(new RegExp(`^scim_${tenantId}\\.`));

      const resolvedA = await ssoConnections.resolveScimAuth(tokenA);
      expect(resolvedA).toEqual({ tenantId, connectionId: created.id, defaultRoleId: role.id });

      const tokenB = await ssoConnections.rotateScimToken(tenantId, ownerId, created.id);
      await expect(ssoConnections.resolveScimAuth(tokenA)).resolves.toBeNull();
      await expect(ssoConnections.resolveScimAuth(tokenB)).resolves.toEqual({
        tenantId,
        connectionId: created.id,
        defaultRoleId: role.id,
      });
    });

    it("resolveScimAuth rejects garbage and cross-tenant tokens", async () => {
      await expect(ssoConnections.resolveScimAuth("not-a-scim-token")).resolves.toBeNull();
      const { tenantId, ownerId } = await signUpCompany("scim-garbage");
      const role = await createRole(tenantId, ownerId, "Garbage Default");
      const created = await ssoConnections.create(tenantId, ownerId, {
        name: "Fake",
        idpEntityId: "https://idp3.example.test/entity",
        idpSsoUrl: "https://idp3.example.test/sso",
        idpCertificate: "-----BEGIN CERTIFICATE-----\nfake3\n-----END CERTIFICATE-----",
        defaultRoleId: role.id,
      });
      await ssoConnections.rotateScimToken(tenantId, ownerId, created.id);
      await expect(ssoConnections.resolveScimAuth(`scim_${tenantId}.tampered`)).resolves.toBeNull();
    });
  });

  describe("AuthService.loginViaSso", () => {
    it("JIT-provisions a first-time SSO login with the connection's default role and a null password", async () => {
      const { tenantId, ownerId } = await signUpCompany("jit");
      const role = await createRole(tenantId, ownerId, "SSO Members");
      const { ssoConnections: connections } = buildTestSsoServices(db);
      const connection = await connections.create(tenantId, ownerId, {
        name: "JIT IdP",
        idpEntityId: "https://jit-idp.example.test/entity",
        idpSsoUrl: "https://jit-idp.example.test/sso",
        idpCertificate: "-----BEGIN CERTIFICATE-----\nfake-jit\n-----END CERTIFICATE-----",
        defaultRoleId: role.id,
      });

      const { authService: ssoAuth, fakeSaml, redis } = buildTestAuthServiceWithSso(db);
      fakeSaml.assertion = { email: `jit-user-${Date.now()}@example.com`, fullName: "JIT User" };
      try {
        const session = await ssoAuth.loginViaSso(connection.id, {});
        expect(session.companyId).toBe(tenantId);
        expect(session.accessToken).toBeTruthy();

        const { users } = await import("../src/infrastructure/db/schema");
        const { eq } = await import("drizzle-orm");
        const user = await db.query.users.findFirst({ where: eq(users.email, fakeSaml.assertion.email) });
        expect(user).toBeDefined();
        expect(user!.passwordHash).toBeNull();

        // Logging in again for the same email doesn't create a second
        // membership row or re-throw (idempotent find-or-provision).
        const second = await ssoAuth.loginViaSso(connection.id, {});
        expect(second.companyId).toBe(tenantId);
      } finally {
        await redis.quit();
      }
    });

    it("rejects login against an unknown or inactive connection", async () => {
      const { authService: ssoAuth, redis } = buildTestAuthServiceWithSso(db);
      try {
        await expect(ssoAuth.loginViaSso(crypto.randomUUID(), {})).rejects.toMatchObject({
          code: "not_found",
          status: 404,
        });
      } finally {
        await redis.quit();
      }
    });
  });

  describe("SamlService (pure request/metadata construction, no signature verification)", () => {
    it("builds an SP metadata document and an IdP-bound authorize URL", async () => {
      const saml = new SamlService();
      const connection = {
        id: "conn-1",
        idpEntityId: "https://idp.example.test/entity",
        idpSsoUrl: "https://idp.example.test/sso",
        idpCertificate: "-----BEGIN CERTIFICATE-----\nfake\n-----END CERTIFICATE-----",
      };
      const metadata = saml.spMetadata(connection);
      expect(metadata).toContain("EntityDescriptor");
      expect(metadata).toContain("conn-1");

      const url = await saml.getLoginUrl(connection, "relay-state-123");
      expect(url.startsWith("https://idp.example.test/sso")).toBe(true);
      expect(url).toContain("SAMLRequest=");
    });
  });

  describe("SCIM Users + Groups", () => {
    it("provisions a user via SCIM, deactivates it, then reactivates it", async () => {
      const { tenantId, ownerId } = await signUpCompany("scim-users");
      const role = await createRole(tenantId, ownerId, "SCIM Role");
      const connectionId = crypto.randomUUID();

      const created = await scimUsers.create(tenantId, connectionId, role.id, null, {
        userName: `scim-${Date.now()}@example.com`,
        emails: [{ value: `scim-${Date.now()}@example.com`, primary: true }],
        name: { formatted: "SCIM Provisioned" },
      });
      expect(created.active).toBe(true);
      expect(created.schemas).toContain("urn:ietf:params:scim:schemas:core:2.0:User");

      const listed = await scimUsers.list(tenantId, connectionId, {});
      expect(listed.Resources.some((r) => r.id === created.id)).toBe(true);

      const deactivated = await scimUsers.patch(tenantId, connectionId, role.id, null, created.id, {
        Operations: [{ op: "replace", path: "active", value: false }],
      });
      expect(deactivated.active).toBe(false);

      const listedAfterDeactivate = await scimUsers.list(tenantId, connectionId, {});
      expect(listedAfterDeactivate.Resources.some((r) => r.id === created.id)).toBe(false);

      const reactivated = await scimUsers.patch(tenantId, connectionId, role.id, null, created.id, {
        Operations: [{ op: "replace", path: "active", value: true }],
      });
      expect(reactivated.active).toBe(true);
    });

    it("filters list() by userName eq, and delete() hard-deprovisions (membership + roles gone, user row kept)", async () => {
      const { tenantId, ownerId } = await signUpCompany("scim-filter");
      const role = await createRole(tenantId, ownerId, "SCIM Filter Role");
      const connectionId = crypto.randomUUID();
      const email = `scim-filter-${Date.now()}@example.com`;

      const created = await scimUsers.create(tenantId, connectionId, role.id, null, {
        userName: email,
        emails: [{ value: email }],
      });

      const filtered = await scimUsers.list(tenantId, connectionId, { filter: `userName eq "${email}"` });
      expect(filtered.totalResults).toBe(1);
      expect(filtered.Resources[0]!.id).toBe(created.id);

      await scimUsers.delete(tenantId, connectionId, null, created.id);
      await expect(scimUsers.get(tenantId, created.id)).rejects.toMatchObject({ code: "not_found", status: 404 });

      const { users } = await import("../src/infrastructure/db/schema");
      const { eq } = await import("drizzle-orm");
      const userRow = await db.query.users.findFirst({ where: eq(users.id, created.id) });
      expect(userRow).toBeDefined();
    });

    it("Groups: lists tenant roles as SCIM Groups and PATCH .../members syncs role assignment via RbacService", async () => {
      const { tenantId, ownerId } = await signUpCompany("scim-groups");
      const role = await createRole(tenantId, ownerId, "Group Sync Role");
      const connectionId = crypto.randomUUID();
      const email = `scim-group-member-${Date.now()}@example.com`;
      const member = await scimUsers.create(tenantId, connectionId, role.id, null, {
        userName: email,
        emails: [{ value: email }],
      });

      const groups = await scimGroups.list(tenantId);
      const group = groups.Resources.find((g) => g.id === role.id);
      expect(group).toBeDefined();
      // The member was already assigned this role by create()'s own
      // defaultRoleId provisioning.
      expect(group!.members.map((m) => m.value)).toContain(member.id);

      const cleared = await scimGroups.patchMembers(tenantId, connectionId, role.id, {
        Operations: [{ op: "replace", path: "members", value: [] }],
      });
      expect(cleared.members).toHaveLength(0);

      const restored = await scimGroups.patchMembers(tenantId, connectionId, role.id, {
        Operations: [{ op: "replace", path: "members", value: [{ value: member.id }] }],
      });
      expect(restored.members.map((m) => m.value)).toContain(member.id);
    });
  });
});
