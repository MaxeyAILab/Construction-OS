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

export class SafetyFormTemplateNotFoundError extends DomainError {
  readonly code = "not_found";
  readonly status = 404;
  constructor() {
    super("safety form template not found");
  }
}

export class SafetyFormNotFoundError extends DomainError {
  readonly code = "not_found";
  readonly status = 404;
  constructor() {
    super("safety form not found");
  }
}

export class IncidentNotFoundError extends DomainError {
  readonly code = "not_found";
  readonly status = 404;
  constructor() {
    super("incident not found");
  }
}

// FR-SAFE-3: an incident routes to at most one corrective-action task.
export class IncidentAlreadyRoutedError extends DomainError {
  readonly code = "illegal_transition";
  readonly status = 422;
  constructor() {
    super("this incident already has a corrective action assigned");
  }
}

export class CertificationNotFoundError extends DomainError {
  readonly code = "not_found";
  readonly status = 404;
  constructor() {
    super("certification not found");
  }
}
