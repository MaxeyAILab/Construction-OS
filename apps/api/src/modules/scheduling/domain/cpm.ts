import type { ActivityDependencyType } from "@constructionos/schemas";
import { CycleDetectedError } from "./errors";

// database.md §14: "cycle detection at application layer before commit" +
// "CPM recalculation ... results written back in one transaction." Pure
// functions only — no DB/framework imports — so the forward/backward pass
// math is unit-testable in isolation from Postgres.

export interface CpmActivityInput {
  id: string;
  durationDays: number;
}

export interface CpmDependencyInput {
  predecessorId: string;
  successorId: string;
  type: ActivityDependencyType;
  lagDays: number;
}

export interface CpmActivityResult {
  id: string;
  earlyStart: number;
  earlyFinish: number;
  lateStart: number;
  lateFinish: number;
  totalFloatDays: number;
  isCritical: boolean;
}

// Kahn's algorithm: a topological order exists iff the graph is acyclic —
// so this single pass both orders the activities for the forward/backward
// pass below and detects cycles (database.md's "cycle detection at
// application layer before commit").
export function topologicalOrder(activityIds: string[], dependencies: CpmDependencyInput[]): string[] {
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();
  for (const id of activityIds) {
    inDegree.set(id, 0);
    adjacency.set(id, []);
  }
  for (const dep of dependencies) {
    adjacency.get(dep.predecessorId)?.push(dep.successorId);
    inDegree.set(dep.successorId, (inDegree.get(dep.successorId) ?? 0) + 1);
  }

  const queue: string[] = [];
  for (const [id, degree] of inDegree) {
    if (degree === 0) queue.push(id);
  }

  const order: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    order.push(id);
    for (const nextId of adjacency.get(id) ?? []) {
      const remaining = inDegree.get(nextId)! - 1;
      inDegree.set(nextId, remaining);
      if (remaining === 0) queue.push(nextId);
    }
  }

  if (order.length !== activityIds.length) {
    const resolved = new Set(order);
    const cycle = activityIds.filter((id) => !resolved.has(id));
    throw new CycleDetectedError(cycle);
  }

  return order;
}

// Standard CPM forward/backward pass over FS/SS/FF/SF dependency types with
// lag, expressed in whole-day offsets from the schedule's data_date. v1
// treats every day as a working day (no working-calendar exclusions —
// flagged follow-up, see schedules.ts's schema comment); converting offsets
// to real calendar dates is the caller's job (RecalculateService).
export function runCpm(
  activities: CpmActivityInput[],
  dependencies: CpmDependencyInput[],
): Map<string, CpmActivityResult> {
  const activityIds = activities.map((a) => a.id);
  const durationById = new Map(activities.map((a) => [a.id, a.durationDays]));
  const order = topologicalOrder(activityIds, dependencies);

  const predecessorsOf = new Map<string, CpmDependencyInput[]>();
  const successorsOf = new Map<string, CpmDependencyInput[]>();
  for (const id of activityIds) {
    predecessorsOf.set(id, []);
    successorsOf.set(id, []);
  }
  for (const dep of dependencies) {
    predecessorsOf.get(dep.successorId)?.push(dep);
    successorsOf.get(dep.predecessorId)?.push(dep);
  }

  const earlyStart = new Map<string, number>();
  const earlyFinish = new Map<string, number>();

  for (const id of order) {
    const duration = durationById.get(id)!;
    let start = 0;
    for (const dep of predecessorsOf.get(id)!) {
      const predStart = earlyStart.get(dep.predecessorId)!;
      const predFinish = earlyFinish.get(dep.predecessorId)!;
      const constraint = {
        FS: predFinish + dep.lagDays,
        SS: predStart + dep.lagDays,
        FF: predFinish + dep.lagDays - duration,
        SF: predStart + dep.lagDays - duration,
      }[dep.type];
      start = Math.max(start, constraint);
    }
    earlyStart.set(id, start);
    earlyFinish.set(id, start + duration);
  }

  const projectEnd = activityIds.reduce((max, id) => Math.max(max, earlyFinish.get(id)!), 0);

  const lateStart = new Map<string, number>();
  const lateFinish = new Map<string, number>();

  for (let i = order.length - 1; i >= 0; i--) {
    const id = order[i]!;
    const duration = durationById.get(id)!;
    const succs = successorsOf.get(id)!;
    let finish = projectEnd;
    if (succs.length > 0) {
      finish = Math.min(
        ...succs.map((dep) => {
          const succStart = lateStart.get(dep.successorId)!;
          const succFinish = lateFinish.get(dep.successorId)!;
          return {
            FS: succStart - dep.lagDays,
            SS: succStart - dep.lagDays + duration,
            FF: succFinish - dep.lagDays,
            SF: succFinish - dep.lagDays + duration,
          }[dep.type];
        }),
      );
    }
    lateFinish.set(id, finish);
    lateStart.set(id, finish - duration);
  }

  const results = new Map<string, CpmActivityResult>();
  for (const id of activityIds) {
    const es = earlyStart.get(id)!;
    const ef = earlyFinish.get(id)!;
    const ls = lateStart.get(id)!;
    const lf = lateFinish.get(id)!;
    const totalFloatDays = ls - es;
    results.set(id, { id, earlyStart: es, earlyFinish: ef, lateStart: ls, lateFinish: lf, totalFloatDays, isCritical: totalFloatDays <= 0 });
  }
  return results;
}
