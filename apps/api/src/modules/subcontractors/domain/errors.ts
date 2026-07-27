import { DomainError } from "../../../platform/domain-error";

// Duplicated rather than imported from ../../projects/domain/errors —
// modules communicate only via their index.ts public surface, same
// reasoning as every other module's own copy this session.
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

export class SubcontractorNotFoundError extends DomainError {
  readonly code = "not_found";
  readonly status = 404;
  constructor() {
    super("subcontractor not found");
  }
}

// FR-SUB-2: "eligibility gating" — a subcontractor with an expired
// compliance document (insurance, license) can't be engaged.
export class SubcontractorIneligibleError extends DomainError {
  readonly code = "ineligible";
  readonly status = 422;
  constructor() {
    super("this subcontractor has an expired compliance document on file");
  }
}

export class SubcontractNotFoundError extends DomainError {
  readonly code = "not_found";
  readonly status = 404;
  constructor() {
    super("subcontract not found");
  }
}

export class SubcontractIllegalTransitionError extends DomainError {
  readonly code = "illegal_transition";
  readonly status = 422;
  constructor(expectedStatus: string) {
    super(`this subcontract must be '${expectedStatus}' for this action`);
  }
}

// Gap-fill (see SubcontractsService.void's doc comment) — an approved
// subcontract has already created commitments; voiding it would need a
// reversal use-case this row doesn't build, so it's blocked outright.
export class SubcontractAlreadyApprovedError extends DomainError {
  readonly code = "illegal_transition";
  readonly status = 422;
  constructor() {
    super("an approved subcontract cannot be voided");
  }
}

export class NoActiveBudgetForProjectError extends DomainError {
  readonly code = "not_found";
  readonly status = 404;
  constructor() {
    super("project has no active budget");
  }
}
