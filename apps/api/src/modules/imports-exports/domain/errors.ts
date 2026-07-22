import { DomainError } from "../../../platform/domain-error";

export class ProjectNotFoundError extends DomainError {
  readonly code = "not_found";
  readonly status = 404;
  constructor() {
    super("project not found");
  }
}

export class ExportJobNotFoundError extends DomainError {
  readonly code = "not_found";
  readonly status = 404;
  constructor() {
    super("export job not found");
  }
}

export class ImportJobNotFoundError extends DomainError {
  readonly code = "not_found";
  readonly status = 404;
  constructor() {
    super("import job not found");
  }
}

// api.md §14: "upload -> map -> validate -> commit" is a strict pipeline —
// each step requires the previous one's output.
export class ImportJobNotMappedError extends DomainError {
  readonly code = "illegal_transition";
  readonly status = 422;
  constructor() {
    super("this import must be mapped (POST /imports/{id}/map) before it can be validated");
  }
}

export class ImportJobNotValidatedError extends DomainError {
  readonly code = "illegal_transition";
  readonly status = 422;
  constructor() {
    super("this import must pass validation (POST /imports/{id}/validate) before it can be committed");
  }
}

export class ImportJobAlreadyCommittedError extends DomainError {
  readonly code = "illegal_transition";
  readonly status = 422;
  constructor() {
    super("this import has already been committed");
  }
}

export class InvalidFieldMappingError extends DomainError {
  readonly code = "invalid_field_mapping";
  readonly status = 422;
  constructor(message: string) {
    super(message);
  }
}
