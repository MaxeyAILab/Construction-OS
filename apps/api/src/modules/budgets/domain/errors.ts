import { DomainError } from "../../../platform/domain-error";

// Duplicated rather than imported from ../../projects/domain/errors —
// modules communicate only via their index.ts public surface, and
// ProjectsModule doesn't export its domain errors (same reasoning as
// projects/domain/errors.ts's own UserNotInCompanyError).
export class ProjectNotFoundError extends DomainError {
  readonly code = "not_found";
  readonly status = 404;
  constructor() {
    super("project not found");
  }
}

export class BudgetNotFoundError extends DomainError {
  readonly code = "not_found";
  readonly status = 404;
  constructor() {
    super("budget not found");
  }
}

export class ActiveBudgetAlreadyExistsError extends DomainError {
  readonly code = "duplicate_budget";
  readonly status = 409;
  constructor() {
    super("this project already has an active budget");
  }
}

export class BudgetLineNotFoundError extends DomainError {
  readonly code = "not_found";
  readonly status = 404;
  constructor() {
    super("budget line not found");
  }
}

export class DuplicateBudgetLineError extends DomainError {
  readonly code = "duplicate_budget_line";
  readonly status = 409;
  constructor() {
    super("this cost code already has a budget line on this budget");
  }
}

// api.md §10: "Original amounts editable only pre-lock".
export class BudgetLockedError extends DomainError {
  readonly code = "budget_locked";
  readonly status = 409;
  constructor() {
    super("this budget is locked — original amounts can no longer be edited");
  }
}

export class CostCodeNotOnProjectError extends DomainError {
  readonly code = "not_found";
  readonly status = 404;
  constructor() {
    super("cost code does not belong to this project");
  }
}
