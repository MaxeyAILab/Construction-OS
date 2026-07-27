import { DomainError } from "../../../platform/domain-error";

// Duplicated rather than imported from ../../projects/domain/errors —
// modules communicate only via their index.ts public surface, and
// ProjectsModule doesn't export its domain errors (same reasoning as
// rfis/domain/errors.ts's own ProjectNotFoundError).
export class ProjectNotFoundError extends DomainError {
  readonly code = "not_found";
  readonly status = 404;
  constructor() {
    super("project not found");
  }
}

export class SubmittalNotFoundError extends DomainError {
  readonly code = "not_found";
  readonly status = 404;
  constructor() {
    super("submittal not found");
  }
}

// api.md §8: "Review workflow" — same 422 illegal_transition convention as
// RFIs' IllegalRfiTransitionError.
export class IllegalSubmittalTransitionError extends DomainError {
  readonly code = "illegal_transition";
  readonly status = 422;
  constructor(from: string, to: string) {
    super(`cannot transition a submittal from '${from}' to '${to}'`);
  }
}

export class DocumentNotOnProjectError extends DomainError {
  readonly code = "not_found";
  readonly status = 404;
  constructor() {
    super("document does not belong to this project");
  }
}
