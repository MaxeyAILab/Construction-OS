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

export class ClientSelectionNotFoundError extends DomainError {
  readonly code = "not_found";
  readonly status = 404;
  constructor() {
    super("client selection not found");
  }
}

// Same "draft-only edits" precedent as Change Orders.
export class ClientSelectionNotPendingError extends DomainError {
  readonly code = "illegal_transition";
  readonly status = 422;
  constructor() {
    super("this selection has already been decided");
  }
}

export class ClientSelectionOptionNotFoundError extends DomainError {
  readonly code = "not_found";
  readonly status = 404;
  constructor(label: string) {
    super(`"${label}" is not one of this selection's options`);
  }
}

// M13 Client Portal v1 (FR-CLIENT-1): thrown when the caller has neither
// the internal client.selection.read permission nor a project-level
// "view" share.
export class ClientSelectionReadDeniedError extends DomainError {
  readonly code = "permission_denied";
  readonly status = 403;
  constructor() {
    super("missing permission: client.selection.read (or a valid client-portal share)");
  }
}

// M13 Client Portal v1 (FR-CLIENT-2): thrown when the caller has neither
// the internal client.selection.manage permission nor a valid
// entity_type='client_selection' share (audience='client', access='approve').
export class ClientSelectionDecisionDeniedError extends DomainError {
  readonly code = "permission_denied";
  readonly status = 403;
  constructor() {
    super("missing permission: client.selection.manage (or a valid client-portal share)");
  }
}

// M13 Client Portal v1 (FR-CLIENT-3): thrown when the caller has neither
// the internal client.message.read/create permission nor a project-level
// "view"/"comment" share.
export class PortalMessageReadDeniedError extends DomainError {
  readonly code = "permission_denied";
  readonly status = 403;
  constructor() {
    super("missing permission: client.message.read (or a valid client-portal share)");
  }
}

export class PortalMessageCreateDeniedError extends DomainError {
  readonly code = "permission_denied";
  readonly status = 403;
  constructor() {
    super("missing permission: client.message.create (or a valid client-portal share)");
  }
}
