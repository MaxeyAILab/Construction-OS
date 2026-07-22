import { describe, expect, it } from "vitest";
import { runCpm, topologicalOrder } from "../src/modules/scheduling/domain/cpm";
import { CycleDetectedError } from "../src/modules/scheduling/domain/errors";

describe("CPM engine", () => {
  it("computes a linear FS chain with a single critical path", () => {
    const activities = [
      { id: "A", durationDays: 5 },
      { id: "B", durationDays: 3 },
      { id: "C", durationDays: 2 },
    ];
    const deps = [
      { predecessorId: "A", successorId: "B", type: "FS" as const, lagDays: 0 },
      { predecessorId: "B", successorId: "C", type: "FS" as const, lagDays: 0 },
    ];
    const result = runCpm(activities, deps);

    expect(result.get("A")).toMatchObject({ earlyStart: 0, earlyFinish: 5, totalFloatDays: 0, isCritical: true });
    expect(result.get("B")).toMatchObject({ earlyStart: 5, earlyFinish: 8, totalFloatDays: 0, isCritical: true });
    expect(result.get("C")).toMatchObject({ earlyStart: 8, earlyFinish: 10, totalFloatDays: 0, isCritical: true });
  });

  it("gives the shorter of two parallel paths positive float, longer path stays critical", () => {
    // A -> B -> D (5+10=15) and A -> C -> D (5+2=7), converging on D.
    const activities = [
      { id: "A", durationDays: 5 },
      { id: "B", durationDays: 10 },
      { id: "C", durationDays: 2 },
      { id: "D", durationDays: 1 },
    ];
    const deps = [
      { predecessorId: "A", successorId: "B", type: "FS" as const, lagDays: 0 },
      { predecessorId: "A", successorId: "C", type: "FS" as const, lagDays: 0 },
      { predecessorId: "B", successorId: "D", type: "FS" as const, lagDays: 0 },
      { predecessorId: "C", successorId: "D", type: "FS" as const, lagDays: 0 },
    ];
    const result = runCpm(activities, deps);

    expect(result.get("B")!.isCritical).toBe(true);
    expect(result.get("C")!.isCritical).toBe(false);
    expect(result.get("C")!.totalFloatDays).toBe(8); // 15 - 7
    expect(result.get("D")!.earlyStart).toBe(15);
    expect(result.get("D")!.isCritical).toBe(true);
  });

  it("honors lag and all four dependency types (SS/FF/SF) alongside FS", () => {
    // A(5) -SS+2-> B(4): B can start 2 days after A starts -> ES(B)=2, EF(B)=6
    // B -FF+1-> C(3): C must finish >= EF(B)+1=7 -> ES(C)=4, EF(C)=7
    // C -SF-1-> D(2): D must finish >= ES(C)-1=3, but D also has no other
    //   constraint so ES(D)=0 unless SF pushes it - SF constraint on finish:
    //   EF(D) >= ES(C) + lag => EF(D) >= 4 + (-1) = 3 => ES(D) >= 1.
    const activities = [
      { id: "A", durationDays: 5 },
      { id: "B", durationDays: 4 },
      { id: "C", durationDays: 3 },
      { id: "D", durationDays: 2 },
    ];
    const deps = [
      { predecessorId: "A", successorId: "B", type: "SS" as const, lagDays: 2 },
      { predecessorId: "B", successorId: "C", type: "FF" as const, lagDays: 1 },
      { predecessorId: "C", successorId: "D", type: "SF" as const, lagDays: -1 },
    ];
    const result = runCpm(activities, deps);

    expect(result.get("A")).toMatchObject({ earlyStart: 0, earlyFinish: 5 });
    expect(result.get("B")).toMatchObject({ earlyStart: 2, earlyFinish: 6 });
    expect(result.get("C")).toMatchObject({ earlyStart: 4, earlyFinish: 7 });
    expect(result.get("D")).toMatchObject({ earlyStart: 1, earlyFinish: 3 });
  });

  it("treats milestones (zero duration) as instantaneous points", () => {
    const activities = [
      { id: "A", durationDays: 4 },
      { id: "M", durationDays: 0 },
    ];
    const deps = [{ predecessorId: "A", successorId: "M", type: "FS" as const, lagDays: 0 }];
    const result = runCpm(activities, deps);
    expect(result.get("M")).toMatchObject({ earlyStart: 4, earlyFinish: 4, isCritical: true });
  });

  it("detects a cycle and throws CycleDetectedError instead of an infinite loop", () => {
    const activities = [
      { id: "A", durationDays: 1 },
      { id: "B", durationDays: 1 },
      { id: "C", durationDays: 1 },
    ];
    const deps = [
      { predecessorId: "A", successorId: "B", type: "FS" as const, lagDays: 0 },
      { predecessorId: "B", successorId: "C", type: "FS" as const, lagDays: 0 },
      { predecessorId: "C", successorId: "A", type: "FS" as const, lagDays: 0 },
    ];
    expect(() => topologicalOrder(["A", "B", "C"], deps)).toThrow(CycleDetectedError);
    expect(() => runCpm(activities, deps)).toThrow(CycleDetectedError);
  });

  it("handles activities with no dependencies at all (isolated nodes)", () => {
    const activities = [
      { id: "A", durationDays: 5 },
      { id: "B", durationDays: 2 },
    ];
    const result = runCpm(activities, []);
    expect(result.get("A")).toMatchObject({ earlyStart: 0, earlyFinish: 5, isCritical: true });
    expect(result.get("B")).toMatchObject({ earlyStart: 0, earlyFinish: 2, isCritical: false, totalFloatDays: 3 });
  });
});
