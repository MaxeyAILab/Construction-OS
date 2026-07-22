import { describe, expect, it } from "vitest";
import { activityDatesFromOffsets, addDaysToIsoDate } from "../src/modules/scheduling/domain/dates";

describe("scheduling date-offset arithmetic", () => {
  it("adds days across a month boundary", () => {
    expect(addDaysToIsoDate("2026-07-30", 5)).toBe("2026-08-04");
  });

  it("adds zero days as a no-op", () => {
    expect(addDaysToIsoDate("2026-01-15", 0)).toBe("2026-01-15");
  });

  it("computes start/end for a normal-duration activity as an inclusive last day", () => {
    // duration 5 starting at offset 0 -> earlyFinish=5 -> ends on day 4 (5th day)
    expect(activityDatesFromOffsets("2026-07-01", 0, 5)).toEqual({
      startDate: "2026-07-01",
      endDate: "2026-07-05",
    });
  });

  it("collapses start/end to the same day for a zero-duration milestone", () => {
    expect(activityDatesFromOffsets("2026-07-01", 4, 4)).toEqual({
      startDate: "2026-07-05",
      endDate: "2026-07-05",
    });
  });
});
