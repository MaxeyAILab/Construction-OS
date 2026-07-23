import { DomainError } from "../../../platform/domain-error";

export class ProjectNotFoundError extends DomainError {
  readonly code = "not_found";
  readonly status = 404;
  constructor() {
    super("project not found");
  }
}

// api.md §3: "code unique per tenant (409 duplicate_code)".
export class DuplicateProjectCodeError extends DomainError {
  readonly code = "duplicate_code";
  readonly status = 409;
  constructor(readonly projectCode: string) {
    super(`a project with code "${projectCode}" already exists`);
  }
}

// api.md §3: "status transitions via PATCH {status} validated against
// state machine (422 illegal_transition)".
export class IllegalStatusTransitionError extends DomainError {
  readonly code = "illegal_transition";
  readonly status = 422;
  constructor(
    readonly from: string,
    readonly to: string,
  ) {
    super(`cannot transition project status from "${from}" to "${to}"`);
  }
}

// api.md §1.7: "Updates send If-Match: <version> -> 409 version_conflict
// on mismatch (optimistic locking; pairs with offline sync)."
export class VersionConflictError extends DomainError {
  readonly code = "version_conflict";
  readonly status = 409;
  constructor() {
    super("the resource was modified since it was last read (If-Match mismatch)");
  }
}

// The CRM module (M1) now exists, but this direct-from-Projects path
// stays unsupported: the real FR-CRM-4 "atomic" conversion lives in
// OpportunitiesService.win() (POST /crm/opportunities/{id}/win), which
// depends on ProjectsService — ProjectsService reaching back into CRM to
// validate from_opportunity_id here would make that a circular module
// dependency. Not invented ahead of a real need for a second entry point.
export class OpportunityConversionNotSupportedError extends DomainError {
  readonly code = "not_supported";
  readonly status = 422;
  constructor() {
    super("from_opportunity_id is not supported on POST /projects — use POST /crm/opportunities/{id}/win instead");
  }
}

export class CostCodeNotFoundError extends DomainError {
  readonly code = "not_found";
  readonly status = 404;
  constructor() {
    super("cost code not found");
  }
}

export class DuplicateCostCodeError extends DomainError {
  readonly code = "duplicate_code";
  readonly status = 409;
  constructor(readonly costCode: string) {
    super(`a cost code with code "${costCode}" already exists on this project`);
  }
}

export class MilestoneNotFoundError extends DomainError {
  readonly code = "not_found";
  readonly status = 404;
  constructor() {
    super("milestone not found");
  }
}

export class NotAProjectMemberError extends DomainError {
  readonly code = "not_found";
  readonly status = 404;
  constructor() {
    super("user is not a member of this project");
  }
}

export class AlreadyAProjectMemberError extends DomainError {
  readonly code = "duplicate_member";
  readonly status = 409;
  constructor() {
    super("user is already a member of this project");
  }
}

export class UserNotInCompanyError extends DomainError {
  readonly code = "not_found";
  readonly status = 404;
  constructor() {
    super("user is not a member of this company");
  }
}

export class ProjectTemplateNotFoundError extends DomainError {
  readonly code = "not_found";
  readonly status = 404;
  constructor() {
    super("project template not found");
  }
}
