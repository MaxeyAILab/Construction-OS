import { DomainError } from "../../../platform/domain-error";

export class SyncConflictNotFoundError extends DomainError {
  readonly code = "not_found";
  readonly status = 404;
  constructor() {
    super("sync conflict not found");
  }
}

export class SyncConflictAlreadyResolvedError extends DomainError {
  readonly code = "illegal_transition";
  readonly status = 422;
  constructor() {
    super("this conflict has already been resolved");
  }
}

export class ManualResolutionRequiresChangesError extends DomainError {
  readonly code = "invalid_resolution";
  readonly status = 422;
  constructor() {
    super("resolution='manual' requires manualChanges");
  }
}
