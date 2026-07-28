import { DomainError } from "../../../platform/domain-error";

export class AccountingConnectionNotFoundError extends DomainError {
  readonly code = "not_found";
  readonly status = 404;
  constructor() {
    super("accounting connection not found");
  }
}

export class AccountingConnectionNotConnectedError extends DomainError {
  readonly code = "not_connected";
  readonly status = 409;
  constructor() {
    super("accounting connection is not in a connected state");
  }
}

export class AccountingSyncRunNotFoundError extends DomainError {
  readonly code = "not_found";
  readonly status = 404;
  constructor() {
    super("accounting sync run not found");
  }
}

export class AccountingSyncConflictNotFoundError extends DomainError {
  readonly code = "not_found";
  readonly status = 404;
  constructor() {
    super("accounting sync conflict not found");
  }
}

export class AccountingSyncConflictAlreadyResolvedError extends DomainError {
  readonly code = "already_resolved";
  readonly status = 409;
  constructor() {
    super("accounting sync conflict has already been resolved");
  }
}
