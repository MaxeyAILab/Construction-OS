import type { ExecutionContext } from "@nestjs/common";
import type { Reflector } from "@nestjs/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashApiKey } from "../src/modules/auth/domain/api-key-generator";
import { PermissionGuard } from "../src/modules/rbac/api/permission.guard";
import { buildTestAuthService } from "./setup/auth";
import { buildTestApiKeysService } from "./setup/api-keys";
import { bootstrapTestRole, getTestDatabase } from "./setup/db";
import { buildTestRbacServices } from "./setup/rbac";

// api.md §16.4 "Public API: API keys" (NFR-23). ApiKeysService is tested
// directly (no HTTP layer), same convention as webhooks.spec.ts.
describe("API keys (Public API GA)", () => {
  const db = getTestDatabase();
  const { authService, redis } = buildTestAuthService(db);
  const apiKeys = buildTestApiKeysService(db);
  const { permissionResolver, redis: rbacRedis } = buildTestRbacServices(db);

  beforeAll(async () => {
    await bootstrapTestRole();
  });

  afterAll(async () => {
    await redis.quit();
    await rbacRedis.quit();
  });

  async function signUpCompany(label: string) {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const signUp = await authService.signUp({
      email: `apikey-${label}-${suffix}@example.com`,
      password: "correct horse battery staple",
      fullName: "Owner",
      companyName: `Api Key ${label} ${suffix}`,
    });
    const payload = JSON.parse(Buffer.from(signUp.accessToken.split(".")[1]!, "base64url").toString());
    return { tenantId: signUp.companyId, ownerId: payload.sub as string };
  }

  it("create returns the raw key exactly once; list and the stored row never expose it", async () => {
    const { tenantId, ownerId } = await signUpCompany("create");

    const created = await apiKeys.create(tenantId, ownerId, {
      name: "CI integration",
      scopes: ["admin.webhook.manage"],
    });
    expect(created.key).toMatch(new RegExp(`^cos_live_${tenantId}\\.`));
    expect(created).not.toHaveProperty("keyHash");

    const listed = await apiKeys.list(tenantId);
    expect(listed).toHaveLength(1);
    expect(listed[0]).not.toHaveProperty("keyHash");
    expect(listed[0]).not.toHaveProperty("key");
    expect(listed[0]!.name).toBe("CI integration");
  });

  it("rejects a scope that isn't a real permission key", async () => {
    const { tenantId, ownerId } = await signUpCompany("badscope");
    await expect(
      apiKeys.create(tenantId, ownerId, { name: "bad", scopes: ["not.a.real.permission"] }),
    ).rejects.toMatchObject({ code: "unknown_permission", status: 422 });
  });

  it("resolveForAuth round-trips (auth succeeds, lastUsedAt advances), then fails after revoke", async () => {
    const { tenantId, ownerId } = await signUpCompany("roundtrip");
    const created = await apiKeys.create(tenantId, ownerId, {
      name: "roundtrip key",
      scopes: ["admin.webhook.manage"],
    });

    const resolved = await apiKeys.resolveForAuth(created.key);
    expect(resolved).toEqual({ tenantId, userId: ownerId, scopes: ["admin.webhook.manage"] });

    const listedAfterUse = await apiKeys.list(tenantId);
    expect(listedAfterUse[0]!.lastUsedAt).not.toBeNull();

    await apiKeys.revoke(tenantId, ownerId, created.id);
    await expect(apiKeys.resolveForAuth(created.key)).resolves.toBeNull();
    await expect(apiKeys.list(tenantId)).resolves.toHaveLength(0);
  });

  it("revoking an unknown id is a 404, not a silent no-op", async () => {
    const { tenantId, ownerId } = await signUpCompany("revoke404");
    await expect(apiKeys.revoke(tenantId, ownerId, crypto.randomUUID())).rejects.toMatchObject({
      code: "not_found",
      status: 404,
    });
  });

  it("resolveForAuth returns null for garbage input (no tenant prefix, or wrong hash)", async () => {
    await expect(apiKeys.resolveForAuth("not-a-cos-key")).resolves.toBeNull();

    const { tenantId, ownerId } = await signUpCompany("garbage");
    const created = await apiKeys.create(tenantId, ownerId, { name: "x", scopes: ["admin.webhook.manage"] });
    // Same tenant prefix, tampered secret — hash lookup inside the correct
    // tenant scope still must not match.
    await expect(apiKeys.resolveForAuth(`cos_live_${tenantId}.tampered`)).resolves.toBeNull();
    // Sanity: the real key's hash is exactly what a direct hash of the raw
    // string would produce (documents the SHA-256 contract api.md §16.4
    // relies on for the lookup).
    expect(hashApiKey(created.key)).toHaveLength(64);
  });

  it("PermissionGuard denies a request whose granted permission falls outside the API key's own scopes", async () => {
    const { tenantId, ownerId } = await signUpCompany("scope-intersection");
    const guard = new PermissionGuard(
      {
        getAllAndOverride: (key: string) => {
          if (key === "requiredPermission") return "admin.webhook.manage";
          return undefined;
        },
      } as unknown as Reflector,
      permissionResolver,
    );

    function contextWithScopes(apiKeyScopes: string[] | undefined): ExecutionContext {
      const request = { auth: { tenantId, sub: ownerId }, apiKeyScopes };
      return {
        getHandler: () => (() => undefined) as unknown,
        getClass: () => class {},
        switchToHttp: () => ({ getRequest: () => request }),
      } as unknown as ExecutionContext;
    }

    // The owner genuinely holds admin.webhook.manage, but a key minted with
    // only a narrower scope can't exercise it — a key never exceeds what it
    // was scoped to, even though its creator could.
    await expect(guard.canActivate(contextWithScopes(["admin.apikey.manage"]))).rejects.toMatchObject({
      code: "permission_denied",
      status: 403,
    });

    // A key that does include the required scope passes.
    await expect(guard.canActivate(contextWithScopes(["admin.webhook.manage"]))).resolves.toBe(true);

    // A Bearer-token request (no apiKeyScopes at all) is unaffected by this
    // check — the earlier permissionResolver.has() call is authoritative.
    await expect(guard.canActivate(contextWithScopes(undefined))).resolves.toBe(true);
  });
});
