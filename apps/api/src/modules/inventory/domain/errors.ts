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

export class CostCodeNotOnProjectError extends DomainError {
  readonly code = "not_found";
  readonly status = 404;
  constructor() {
    super("cost code does not belong to this project");
  }
}

export class InventoryItemNotFoundError extends DomainError {
  readonly code = "not_found";
  readonly status = 404;
  constructor() {
    super("inventory item not found");
  }
}

export class DuplicateSkuError extends DomainError {
  readonly code = "conflict";
  readonly status = 409;
  constructor() {
    super("an inventory item with this SKU already exists");
  }
}

export class InventoryLocationNotFoundError extends DomainError {
  readonly code = "not_found";
  readonly status = 404;
  constructor() {
    super("inventory location not found");
  }
}

// api.md §11: "validated against stock" — issue/transfer_out/return
// can't draw more than what's on hand at the source location.
export class InsufficientStockError extends DomainError {
  readonly code = "validation_error";
  readonly status = 422;
  constructor() {
    super("insufficient stock on hand at the source location");
  }
}
