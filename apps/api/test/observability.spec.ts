import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import {
  attachAuthContext,
  beginRequestContext,
  getRequestContext,
  hashUserId,
  requestContextStorage,
} from "../src/infrastructure/observability/request-context";
import { createLogger } from "../src/infrastructure/observability/logger";
import { meter, tracer } from "../src/infrastructure/observability/metrics";
import { recordConsumed, recordDeadLettered } from "../src/infrastructure/observability/consumer-metrics";

describe("request-context", () => {
  it("hashUserId is deterministic and never returns the raw id", () => {
    const userId = "019f8827-d2cf-7571-a0ef-f37cdf282f73";
    const hash = hashUserId(userId);
    expect(hash).toBe(hashUserId(userId));
    expect(hash).not.toContain(userId);
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it("propagates trace/tenant/user through an async chain once begun", async () => {
    await requestContextStorage.run({}, async () => {
      beginRequestContext();
      await Promise.resolve();
      attachAuthContext("tenant-1", "user-1");
      await Promise.resolve();
      const ctx = getRequestContext();
      expect(ctx?.tenantId).toBe("tenant-1");
      expect(ctx?.userIdHash).toBe(hashUserId("user-1"));
    });
  });

  it("returns undefined outside of any established context", () => {
    expect(getRequestContext()).toBeUndefined();
  });
});

describe("logger", () => {
  function captureLogs() {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk, _enc, cb) {
        lines.push(chunk.toString());
        cb();
      },
    });
    return { lines, stream };
  }

  it("redacts sensitive fields", () => {
    const { lines, stream } = captureLogs();
    const logger = createLogger("info", stream);
    logger.info({ password: "hunter2", nested: { token: "abc.def.ghi" } }, "login attempt");
    const entry = JSON.parse(lines[0]!);
    expect(entry.password).toBe("[redacted]");
    expect(entry.nested.token).toBe("[redacted]");
  });

  it("does not redact unrelated fields", () => {
    const { lines, stream } = captureLogs();
    const logger = createLogger("info", stream);
    logger.info({ email: "user@example.com" }, "signed up");
    const entry = JSON.parse(lines[0]!);
    expect(entry.email).toBe("user@example.com");
  });

  it("mixin adds trace/tenant/user correlation only inside an active request context", () => {
    const { lines, stream } = captureLogs();
    const logger = createLogger("info", stream);

    logger.info("no context");
    const outsideContext = JSON.parse(lines[0]!);
    expect(outsideContext.traceId).toBeUndefined();

    requestContextStorage.run({ traceId: "trace-1", tenantId: "tenant-1" }, () => {
      logger.info("inside context");
    });
    const insideContext = JSON.parse(lines[1]!);
    expect(insideContext.traceId).toBe("trace-1");
    expect(insideContext.tenantId).toBe("tenant-1");
  });
});

describe("metrics", () => {
  it("meter/tracer are usable without a started SDK (NODE_ENV=test)", () => {
    expect(() => meter.createCounter("test_counter").add(1)).not.toThrow();
    expect(() => meter.createHistogram("test_histogram").record(10)).not.toThrow();
    const span = tracer.startSpan("test-span");
    expect(() => span.end()).not.toThrow();
  });

  it("consumer-metrics helpers don't throw", () => {
    expect(() => recordConsumed("test-consumer", "events.test.v1", "ack")).not.toThrow();
    expect(() => recordDeadLettered("test-consumer", "events.test.v1")).not.toThrow();
  });
});
