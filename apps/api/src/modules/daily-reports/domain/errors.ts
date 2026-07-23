import { DomainError } from "../../../platform/domain-error";

// Duplicated rather than imported from ../../projects/domain/errors —
// modules communicate only via their index.ts public surface (same
// reasoning as tasks/domain/errors.ts's own ProjectNotFoundError).
export class ProjectNotFoundError extends DomainError {
  readonly code = "not_found";
  readonly status = 404;
  constructor() {
    super("project not found");
  }
}

export class CostCodeNotOnProjectError extends DomainError {
  readonly code = "not_found";
  readonly status = 404;
  constructor() {
    super("cost code not found on this project");
  }
}

export class DailyReportNotFoundError extends DomainError {
  readonly code = "not_found";
  readonly status = 404;
  constructor() {
    super("daily report not found");
  }
}

export class DailyReportNotDraftError extends DomainError {
  readonly code = "illegal_transition";
  readonly status = 422;
  constructor() {
    super("this daily report has already been submitted");
  }
}

export class VersionConflictError extends DomainError {
  readonly code = "version_conflict";
  readonly status = 409;
  constructor() {
    super("the resource was modified since it was last read (If-Match mismatch)");
  }
}

export class TimeEntryNotFoundError extends DomainError {
  readonly code = "not_found";
  readonly status = 404;
  constructor() {
    super("time entry not found");
  }
}

export class TimeEntryAlreadyApprovedError extends DomainError {
  readonly code = "illegal_transition";
  readonly status = 422;
  constructor() {
    super("this time entry has already been approved");
  }
}
