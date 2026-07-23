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

export class PhotoNotFoundError extends DomainError {
  readonly code = "not_found";
  readonly status = 404;
  constructor() {
    super("photo not found");
  }
}
