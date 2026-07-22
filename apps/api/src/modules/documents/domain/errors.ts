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

export class FolderNotFoundError extends DomainError {
  readonly code = "not_found";
  readonly status = 404;
  constructor() {
    super("folder not found");
  }
}

export class DocumentNotFoundError extends DomainError {
  readonly code = "not_found";
  readonly status = 404;
  constructor() {
    super("document not found");
  }
}

export class DocumentVersionNotFoundError extends DomainError {
  readonly code = "not_found";
  readonly status = 404;
  constructor() {
    super("document version not found");
  }
}

export class DrawingSetNotFoundError extends DomainError {
  readonly code = "not_found";
  readonly status = 404;
  constructor() {
    super("drawing set not found");
  }
}

// A drawing set can only reference document_versions from documents
// belonging to the same project (a folder/document tree is project-scoped).
export class DocumentVersionNotOnProjectError extends DomainError {
  readonly code = "not_found";
  readonly status = 404;
  constructor() {
    super("document version does not belong to this project");
  }
}

// M13 Client Portal v1 (FR-CLIENT-1): thrown when the caller has neither
// the internal docs.document.read permission nor a project-level "view" share.
export class DocumentReadDeniedError extends DomainError {
  readonly code = "permission_denied";
  readonly status = 403;
  constructor() {
    super("missing permission: docs.document.read (or a valid client-portal share)");
  }
}
