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

// A conflict can now be on any syncable entity (tasks, daily_reports,
// time_entries) — resolving it needs that entity's own update permission,
// not a single fixed one (sync.controller.ts's comment on this endpoint
// explains why it moved from a @RequirePermission() decorator to a
// per-conflict check here, same "second entity is one more row" pattern
// as the mutation engine's PERMISSIONS map).
export class ConflictResolutionPermissionDeniedError extends DomainError {
  readonly code = "forbidden";
  readonly status = 403;
  constructor() {
    super("you do not have permission to resolve this conflict");
  }
}
