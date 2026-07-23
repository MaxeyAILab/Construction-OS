import { DomainError } from "../../../platform/domain-error";

export class ContactCompanyNotFoundError extends DomainError {
  readonly code = "not_found";
  readonly status = 404;
  constructor() {
    super("contact company not found");
  }
}

export class ContactNotFoundError extends DomainError {
  readonly code = "not_found";
  readonly status = 404;
  constructor() {
    super("contact not found");
  }
}

export class PipelineStageNotFoundError extends DomainError {
  readonly code = "not_found";
  readonly status = 404;
  constructor() {
    super("pipeline stage not found");
  }
}

export class OpportunityNotFoundError extends DomainError {
  readonly code = "not_found";
  readonly status = 404;
  constructor() {
    super("opportunity not found");
  }
}

// api.md §4: win/lose only apply to an open opportunity.
export class OpportunityNotOpenError extends DomainError {
  readonly code = "illegal_transition";
  readonly status = 422;
  constructor() {
    super("this opportunity is not open (already won or lost)");
  }
}
