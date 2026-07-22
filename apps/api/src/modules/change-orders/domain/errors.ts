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

export class CostCodeNotOnProjectError extends DomainError {
  readonly code = "not_found";
  readonly status = 404;
  constructor() {
    super("cost code does not belong to this project");
  }
}

export class ChangeOrderNotFoundError extends DomainError {
  readonly code = "not_found";
  readonly status = 404;
  constructor() {
    super("change order not found");
  }
}

export class ChangeOrderLineNotFoundError extends DomainError {
  readonly code = "not_found";
  readonly status = 404;
  constructor() {
    super("change order line not found");
  }
}

// api.md §9: header/line edits and void are only valid pre-submission.
export class ChangeOrderNotDraftError extends DomainError {
  readonly code = "illegal_transition";
  readonly status = 422;
  constructor() {
    super("this change order is no longer a draft");
  }
}

// Approve/reject only apply to a submitted (pending_client) change order.
export class ChangeOrderNotPendingClientError extends DomainError {
  readonly code = "illegal_transition";
  readonly status = 422;
  constructor() {
    super("this change order has not been submitted to the client");
  }
}

// FR-FIN-2 propagation requires an existing active budget on the project —
// same structural dependency as Estimating's convert-to-budget.
export class NoActiveBudgetForProjectError extends DomainError {
  readonly code = "not_found";
  readonly status = 404;
  constructor() {
    super("this project has no active budget to apply the change order impact to");
  }
}
