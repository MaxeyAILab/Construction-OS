import { describe, expect, it } from "vitest";
import { HealthController } from "../src/platform/health/health.controller.js";

describe("HealthController", () => {
  it("reports ok status", () => {
    const controller = new HealthController();
    const result = controller.check();
    expect(result.status).toBe("ok");
    expect(new Date(result.timestamp).toString()).not.toBe("Invalid Date");
  });
});
