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

export class ReportDefinitionNotFoundError extends DomainError {
  readonly code = "not_found";
  readonly status = 404;
  constructor() {
    super("report definition not found");
  }
}

export class ReportRunNotFoundError extends DomainError {
  readonly code = "not_found";
  readonly status = 404;
  constructor() {
    super("report run not found");
  }
}

// What-if simulation (FR-EXEC-4, roadmap.md "bid loss, crew moves, delay
// cascades") — WhatIfSimulationService's own input-validation errors,
// distinct from the CRM/Scheduling domain errors (OpportunityNotFoundError,
// ScheduleNotFoundError, etc.) that already propagate unchanged from the
// injected OpportunitiesService/DelayImpactService calls.
export class OpportunityNotOpenError extends DomainError {
  readonly code = "conflict";
  readonly status = 409;
  constructor() {
    super("opportunity is not open — only an open opportunity can be simulated as a loss");
  }
}

export class WhatIfResourceAssignmentNotFoundError extends DomainError {
  readonly code = "not_found";
  readonly status = 404;
  constructor() {
    super("one or more resource assignments were not found");
  }
}

export class WhatIfScheduleMismatchError extends DomainError {
  readonly code = "unprocessable_entity";
  readonly status = 422;
  constructor() {
    super("all resource assignments must belong to the given schedule");
  }
}
