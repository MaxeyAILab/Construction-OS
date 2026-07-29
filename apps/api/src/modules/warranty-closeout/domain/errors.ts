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

export class CloseoutChecklistItemNotFoundError extends DomainError {
  readonly code = "not_found";
  readonly status = 404;
  constructor() {
    super("closeout checklist item not found");
  }
}

// FR-CLOSE-2: the whole point of the gate.
export class ChecklistIncompleteError extends DomainError {
  readonly code = "checklist_incomplete";
  readonly status = 409;
  constructor() {
    super("one or more closeout checklist items are still pending");
  }
}

export class PunchListOpenError extends DomainError {
  readonly code = "punch_list_open";
  readonly status = 409;
  constructor() {
    super("one or more punch items on this project are still open");
  }
}

export class WarrantyNotFoundError extends DomainError {
  readonly code = "not_found";
  readonly status = 404;
  constructor() {
    super("warranty not found");
  }
}

export class WarrantyClaimNotFoundError extends DomainError {
  readonly code = "not_found";
  readonly status = 404;
  constructor() {
    super("warranty claim not found");
  }
}

// FR-CLOSE-5: "during a warranty's active period" — expired warranties
// don't accept new claims (a homeowner outside the coverage window has no
// contractual claim to route).
export class WarrantyExpiredError extends DomainError {
  readonly code = "warranty_expired";
  readonly status = 409;
  constructor() {
    super("this warranty has expired; claims can only be filed during its active period");
  }
}

export class WarrantyClaimReadDeniedError extends DomainError {
  readonly code = "permission_denied";
  readonly status = 403;
  constructor() {
    super("missing permission: closeout.claim.read (or a valid client-portal share on the project)");
  }
}

export class WarrantyClaimCreateDeniedError extends DomainError {
  readonly code = "permission_denied";
  readonly status = 403;
  constructor() {
    super("missing permission: closeout.claim.create (or a valid client-portal share on the project)");
  }
}

export class IllegalWarrantyClaimTransitionError extends DomainError {
  readonly code = "illegal_transition";
  readonly status = 422;
  constructor(from: string, to: string) {
    super(`cannot move a warranty claim from '${from}' to '${to}'`);
  }
}
