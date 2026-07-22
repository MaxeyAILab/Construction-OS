import { DomainError } from "../../../platform/domain-error";

// Duplicated rather than imported from ../../projects/domain/errors —
// modules communicate only via their index.ts public surface, and
// ProjectsModule doesn't export its domain errors (same reasoning as
// budgets/domain/errors.ts's own ProjectNotFoundError).
export class ProjectNotFoundError extends DomainError {
  readonly code = "not_found";
  readonly status = 404;
  constructor() {
    super("project not found");
  }
}

export class TaskNotFoundError extends DomainError {
  readonly code = "not_found";
  readonly status = 404;
  constructor() {
    super("task not found");
  }
}

// api.md §1.7: "Updates send If-Match: <version> -> 409 version_conflict
// on mismatch" — duplicated from projects/domain/errors.ts, same reasoning
// as ProjectNotFoundError above.
export class VersionConflictError extends DomainError {
  readonly code = "version_conflict";
  readonly status = 409;
  constructor() {
    super("the resource was modified since it was last read (If-Match mismatch)");
  }
}
