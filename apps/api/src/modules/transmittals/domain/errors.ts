import { DomainError } from "../../../platform/domain-error";

export class ProjectNotFoundError extends DomainError {
  readonly code = "not_found";
  readonly status = 404;
  constructor() {
    super("project not found");
  }
}

export class DocumentVersionNotFoundError extends DomainError {
  readonly code = "not_found";
  readonly status = 404;
  constructor() {
    super("document version not found");
  }
}

export class TransmittalNotFoundError extends DomainError {
  readonly code = "not_found";
  readonly status = 404;
  constructor() {
    super("transmittal not found");
  }
}

export class TransmittalNotDraftError extends DomainError {
  readonly code = "illegal_transition";
  readonly status = 409;
  constructor() {
    super("only a draft transmittal can be sent");
  }
}

export class NotATransmittalRecipientError extends DomainError {
  readonly code = "permission_denied";
  readonly status = 403;
  constructor() {
    super("you are not a recipient of this transmittal");
  }
}

export class ApprovalMatrixNotFoundError extends DomainError {
  readonly code = "not_found";
  readonly status = 404;
  constructor() {
    super("approval matrix not found");
  }
}

// api.md §20: the matrix's own entity_type must match what the caller is
// starting a chain against — same shape as Custom Fields' cross-entity
// automation guard.
export class ApprovalEntityTypeMismatchError extends DomainError {
  readonly code = "unprocessable_entity";
  readonly status = 422;
  constructor() {
    super("this approval matrix's entity_type does not match");
  }
}

export class ApprovalAlreadyInProgressError extends DomainError {
  readonly code = "conflict";
  readonly status = 409;
  constructor() {
    super("an approval chain is already in progress for this entity");
  }
}

export class ApprovalInstanceNotFoundError extends DomainError {
  readonly code = "not_found";
  readonly status = 404;
  constructor() {
    super("approval instance not found");
  }
}

export class ApprovalInstanceNotInProgressError extends DomainError {
  readonly code = "illegal_transition";
  readonly status = 409;
  constructor() {
    super("this approval chain has already been decided");
  }
}

// FR-DOC-9's core guard-rail: only the current step's named approver may
// decide, regardless of what permissions the caller otherwise holds.
export class NotCurrentApproverError extends DomainError {
  readonly code = "permission_denied";
  readonly status = 403;
  constructor() {
    super("you are not the current step's named approver");
  }
}
