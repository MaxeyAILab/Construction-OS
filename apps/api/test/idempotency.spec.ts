import type { CallHandler, ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { lastValueFrom, of } from "rxjs";
import { IdempotencyInterceptor } from "../src/platform/idempotency/idempotency.interceptor";
import { buildTestAuthService } from "./setup/auth";
import { bootstrapTestRole, getTestDatabase } from "./setup/db";

class TestController {
  handler(): void {}
}

function buildContext(opts: {
  tenantId: string;
  key: string | undefined;
  body: unknown;
}): { context: ExecutionContext; response: { statusCode?: number; status(code: number): void } } {
  const response = {
    statusCode: undefined as number | undefined,
    status(code: number) {
      this.statusCode = code;
    },
  };
  const request = {
    headers: opts.key ? { "idempotency-key": opts.key } : {},
    body: opts.body,
    method: "POST",
    auth: { tenantId: opts.tenantId, sub: "actor" },
  };
  const context = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
    getClass: () => TestController,
    getHandler: () => TestController.prototype.handler,
  } as unknown as ExecutionContext;
  return { context, response };
}

function handlerReturning(value: unknown): CallHandler {
  let calls = 0;
  return {
    handle: () => {
      calls++;
      return of(value);
    },
    get callCount() {
      return calls;
    },
  } as unknown as CallHandler & { callCount: number };
}

describe("IdempotencyInterceptor", () => {
  const db = getTestDatabase();
  const { authService, redis } = buildTestAuthService(db);
  const interceptor = new IdempotencyInterceptor(db, new Reflector());

  beforeAll(async () => {
    await bootstrapTestRole();
  });

  afterAll(async () => {
    await redis.quit();
  });

  async function signUpCompany(label: string) {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const result = await authService.signUp({
      email: `idem-${label}-${suffix}@example.com`,
      password: "correct horse battery staple",
      fullName: "Owner",
      companyName: `Idem ${label} ${suffix}`,
    });
    return result.companyId;
  }

  it("replays the cached response for a repeated key + identical body", async () => {
    const tenantId = await signUpCompany("replay");
    const key = "11111111-1111-1111-1111-111111111111";
    const body = { name: "Riverside" };

    const first = buildContext({ tenantId, key, body });
    const handler = handlerReturning({ id: "abc" }) as CallHandler & { callCount: number };
    const firstResult = await lastValueFrom(await interceptor.intercept(first.context, handler));
    expect(firstResult).toEqual({ id: "abc" });
    expect(handler.callCount).toBe(1);

    const second = buildContext({ tenantId, key, body });
    const secondHandler = handlerReturning({ id: "should-not-be-used" }) as CallHandler & {
      callCount: number;
    };
    const secondResult = await lastValueFrom(await interceptor.intercept(second.context, secondHandler));
    expect(secondResult).toEqual({ id: "abc" });
    expect(secondHandler.callCount).toBe(0);
  });

  it("rejects the same key reused with a different body", async () => {
    const tenantId = await signUpCompany("conflict");
    const key = "22222222-2222-2222-2222-222222222222";

    const first = buildContext({ tenantId, key, body: { name: "A" } });
    await lastValueFrom(
      await interceptor.intercept(first.context, handlerReturning({ id: "1" })),
    );

    const second = buildContext({ tenantId, key, body: { name: "B" } });
    await expect(
      interceptor.intercept(second.context, handlerReturning({ id: "2" })),
    ).rejects.toThrow(/already used/);
  });

  it("proceeds without dedupe when no Idempotency-Key header is sent", async () => {
    const tenantId = await signUpCompany("nokey");
    const ctx1 = buildContext({ tenantId, key: undefined, body: { name: "X" } });
    const ctx2 = buildContext({ tenantId, key: undefined, body: { name: "X" } });
    const handler1 = handlerReturning({ id: "first" }) as CallHandler & { callCount: number };
    const handler2 = handlerReturning({ id: "second" }) as CallHandler & { callCount: number };

    const r1 = await lastValueFrom(await interceptor.intercept(ctx1.context, handler1));
    const r2 = await lastValueFrom(await interceptor.intercept(ctx2.context, handler2));
    expect(r1).toEqual({ id: "first" });
    expect(r2).toEqual({ id: "second" });
    expect(handler1.callCount).toBe(1);
    expect(handler2.callCount).toBe(1);
  });
});
