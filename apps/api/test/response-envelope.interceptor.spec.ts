import type { CallHandler } from "@nestjs/common";
import { firstValueFrom, of } from "rxjs";
import { describe, expect, it } from "vitest";
import { ResponseEnvelopeInterceptor } from "../src/platform/response-envelope.interceptor";

// api.md §1.2: every success response is wrapped as { data: ... }, unless
// the handler already built the list envelope itself ({ data, meta }).
// Regression coverage for a real bug the Imports/Exports smoke test caught:
// a plain domain row with its own `error` field (export_jobs.error, a
// job's failure message) was being mistaken for an already-built envelope
// and left unwrapped.
describe("ResponseEnvelopeInterceptor", () => {
  const interceptor = new ResponseEnvelopeInterceptor();

  function handlerReturning(body: unknown): CallHandler {
    return { handle: () => of(body) };
  }

  it("wraps a plain object in { data }", async () => {
    const result = await firstValueFrom(
      interceptor.intercept({} as never, handlerReturning({ id: "abc", status: "queued" })),
    );
    expect(result).toEqual({ data: { id: "abc", status: "queued" } });
  });

  it("wraps a domain row that happens to have its own `error` field, rather than mistaking it for an envelope", async () => {
    const row = { id: "job-1", entityType: "cost_codes", status: "failed", error: "boom" };
    const result = await firstValueFrom(interceptor.intercept({} as never, handlerReturning(row)));
    expect(result).toEqual({ data: row });
  });

  it("passes a hand-built { data, meta } list envelope through unchanged", async () => {
    const envelope = { data: [{ id: "1" }], meta: { cursor: null, hasMore: false } };
    const result = await firstValueFrom(interceptor.intercept({} as never, handlerReturning(envelope)));
    expect(result).toBe(envelope);
  });

  it("passes undefined (204) through unchanged", async () => {
    const result = await firstValueFrom(interceptor.intercept({} as never, handlerReturning(undefined)));
    expect(result).toBeUndefined();
  });
});
