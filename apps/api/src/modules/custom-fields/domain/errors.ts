import { DomainError } from "../../../platform/domain-error";

export class CustomFieldDefinitionNotFoundError extends DomainError {
  readonly code = "not_found";
  readonly status = 404;
  constructor() {
    super("custom field definition not found");
  }
}

export class DuplicateFieldKeyError extends DomainError {
  readonly code = "conflict";
  readonly status = 409;
  constructor() {
    super("a custom field with this key already exists for this entity type");
  }
}

// api.md §19: field/entity types referenced by an automation must belong
// to the automation's own entity_type — a trigger on a task field can't
// silently fire off a project's automation.
export class FieldEntityTypeMismatchError extends DomainError {
  readonly code = "unprocessable_entity";
  readonly status = 422;
  constructor(readonly field: string) {
    super(`${field} does not belong to this automation's entity_type`);
  }
}

export class InvalidFieldValueError extends DomainError {
  readonly code = "validation_error";
  readonly status = 422;
  constructor(readonly reason: string) {
    super(`invalid custom field value: ${reason}`);
  }
}

export class CustomFieldAutomationNotFoundError extends DomainError {
  readonly code = "not_found";
  readonly status = 404;
  constructor() {
    super("custom field automation not found");
  }
}
