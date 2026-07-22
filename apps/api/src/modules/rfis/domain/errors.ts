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

export class RfiNotFoundError extends DomainError {
  readonly code = "not_found";
  readonly status = 404;
  constructor() {
    super("RFI not found");
  }
}

// api.md §8: "status machine enforced" — same 422 illegal_transition
// convention as Projects' PATCH {status} (api.md line 122).
export class IllegalRfiTransitionError extends DomainError {
  readonly code = "illegal_transition";
  readonly status = 422;
  constructor(from: string, to: string) {
    super(`cannot transition an RFI from '${from}' to '${to}'`);
  }
}

export class RfiAnswerRequiredError extends DomainError {
  readonly code = "answer_required";
  readonly status = 422;
  constructor() {
    super("an RFI cannot be marked answered without an answer");
  }
}
