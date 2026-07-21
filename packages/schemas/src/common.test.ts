import { describe, expect, it } from "vitest";
import { moneyAmountSchema, quantitySchema, uuidSchema } from "./common";

describe("moneyAmountSchema", () => {
  it("accepts exact 2-decimal strings", () => {
    expect(moneyAmountSchema.safeParse("1234.50").success).toBe(true);
    expect(moneyAmountSchema.safeParse("-42.00").success).toBe(true);
  });

  it("rejects numbers and imprecise strings", () => {
    expect(moneyAmountSchema.safeParse("1234.5").success).toBe(false);
    expect(moneyAmountSchema.safeParse("1234.567").success).toBe(false);
  });
});

describe("quantitySchema", () => {
  it("accepts exact 3-decimal strings", () => {
    expect(quantitySchema.safeParse("10.000").success).toBe(true);
  });
});

describe("uuidSchema", () => {
  it("rejects non-uuid strings", () => {
    expect(uuidSchema.safeParse("not-a-uuid").success).toBe(false);
  });
});
