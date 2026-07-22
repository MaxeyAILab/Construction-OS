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

export class CostItemNotFoundError extends DomainError {
  readonly code = "not_found";
  readonly status = 404;
  constructor() {
    super("cost item not found");
  }
}

export class DuplicateCostItemCodeError extends DomainError {
  readonly code = "duplicate_cost_item_code";
  readonly status = 409;
  constructor() {
    super("a cost item with this code already exists");
  }
}

export class AssemblyNotFoundError extends DomainError {
  readonly code = "not_found";
  readonly status = 404;
  constructor() {
    super("assembly not found");
  }
}

export class DuplicateAssemblyCodeError extends DomainError {
  readonly code = "duplicate_assembly_code";
  readonly status = 409;
  constructor() {
    super("an assembly with this code already exists");
  }
}

export class EstimateNotFoundError extends DomainError {
  readonly code = "not_found";
  readonly status = 404;
  constructor() {
    super("estimate not found");
  }
}

// ux_estimates_tenant_parent_version enforces this at the DB level too —
// this check exists to return a clean 409 instead of a raw constraint
// violation. FR-EST-4 versions must go through POST /estimates/{id}/versions,
// not a second POST /estimates for the same project.
export class EstimateAlreadyExistsForProjectError extends DomainError {
  readonly code = "duplicate_estimate";
  readonly status = 409;
  constructor() {
    super("this project already has an estimate — use the versions endpoint to create a new version");
  }
}

export class EstimateLineNotFoundError extends DomainError {
  readonly code = "not_found";
  readonly status = 404;
  constructor() {
    super("estimate line not found");
  }
}

// Duplicated from budgets/domain/errors.ts — same reasoning as
// ProjectNotFoundError above. api.md §5: "409 if active budget exists".
export class ActiveBudgetAlreadyExistsError extends DomainError {
  readonly code = "duplicate_budget";
  readonly status = 409;
  constructor() {
    super("this project already has an active budget");
  }
}
