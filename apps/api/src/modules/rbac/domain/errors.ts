import { DomainError } from "../../../platform/domain-error";

export class PermissionDeniedError extends DomainError {
  readonly code = "permission_denied";
  readonly status = 403;
  constructor(readonly permission: string) {
    super(`missing permission: ${permission}`);
  }
}

export class RoleNotFoundError extends DomainError {
  readonly code = "not_found";
  readonly status = 404;
  constructor() {
    super("role not found");
  }
}

export class UnknownPermissionError extends DomainError {
  readonly code = "unknown_permission";
  readonly status = 422;
  constructor(readonly permission: string) {
    super(`unknown permission key: ${permission}`);
  }
}

export class DuplicateRoleNameError extends DomainError {
  readonly code = "conflict";
  readonly status = 409;
  constructor() {
    super("a role with this name already exists");
  }
}

export class UserNotFoundError extends DomainError {
  readonly code = "not_found";
  readonly status = 404;
  constructor() {
    super("user not found");
  }
}

export class AlreadyAMemberError extends DomainError {
  readonly code = "conflict";
  readonly status = 409;
  constructor() {
    super("user is already a member of this company");
  }
}
