import { DomainError } from "../../../platform/domain-error";

// Duplicated rather than imported from ../../projects/domain/errors —
// modules communicate only via their index.ts public surface, same
// reasoning as every other module's own copy this session.
export class ProjectNotFoundError extends DomainError {
  readonly code = "not_found";
  readonly status = 404;
  constructor() {
    super("project not found");
  }
}

export class ScheduleNotFoundError extends DomainError {
  readonly code = "not_found";
  readonly status = 404;
  constructor() {
    super("schedule not found");
  }
}

export class ScheduleActivityNotFoundError extends DomainError {
  readonly code = "not_found";
  readonly status = 404;
  constructor() {
    super("schedule activity not found");
  }
}

export class VersionConflictError extends DomainError {
  readonly code = "version_conflict";
  readonly status = 409;
  constructor() {
    super("the resource was modified since it was last read (If-Match mismatch)");
  }
}

// api.md §6: "PUT /activities/{id}/dependencies ... 422 cycle_detected."
// Thrown by domain/cpm.ts's topologicalOrder (cycle detection doubles as
// the CPM engine's own prerequisite — a cyclic graph has no valid
// forward/backward pass) and caught at the same boundary for both the
// dependency-replace endpoint and the recalculate endpoint.
export class CycleDetectedError extends DomainError {
  readonly code = "cycle_detected";
  readonly status = 422;
  constructor(readonly cycle: string[]) {
    super(`dependency cycle detected among activities: ${cycle.join(", ")}`);
  }
}
