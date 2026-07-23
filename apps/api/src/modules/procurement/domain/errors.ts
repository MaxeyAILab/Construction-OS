import { DomainError } from "../../../platform/domain-error";

// Duplicated rather than imported from ../../projects/domain/errors —
// modules communicate only via their index.ts public surface, same
// reasoning as change-orders/domain/errors.ts's own copy.
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

export class SupplierNotFoundError extends DomainError {
  readonly code = "not_found";
  readonly status = 404;
  constructor() {
    super("supplier not found");
  }
}

export class PurchaseOrderNotFoundError extends DomainError {
  readonly code = "not_found";
  readonly status = 404;
  constructor() {
    super("purchase order not found");
  }
}

// api.md §11: header/line edits are only valid pre-submission.
export class PurchaseOrderNotDraftError extends DomainError {
  readonly code = "illegal_transition";
  readonly status = 422;
  constructor() {
    super("this purchase order is no longer a draft");
  }
}

export class PurchaseOrderNotPendingApprovalError extends DomainError {
  readonly code = "illegal_transition";
  readonly status = 422;
  constructor() {
    super("this purchase order is not pending approval");
  }
}

export class PurchaseOrderNotApprovedError extends DomainError {
  readonly code = "illegal_transition";
  readonly status = 422;
  constructor() {
    super("this purchase order has not been approved");
  }
}

// Generic transition guard for the gap-filled confirm/send/close moves —
// carries the expected prior status so the message stays accurate without
// a dedicated error class per transition.
export class PurchaseOrderIllegalTransitionError extends DomainError {
  readonly code = "illegal_transition";
  readonly status = 422;
  constructor(expectedStatus: string) {
    super(`this purchase order must be '${expectedStatus}' for this action`);
  }
}

// send/cancel are illegal once a PO has moved past receiving activity.
export class PurchaseOrderNotCancellableError extends DomainError {
  readonly code = "illegal_transition";
  readonly status = 422;
  constructor() {
    super("this purchase order can no longer be cancelled");
  }
}

// FR-PROC-3 needs an active budget to write the commitment into — same
// structural dependency as Change Orders' own copy of this error.
export class NoActiveBudgetForProjectError extends DomainError {
  readonly code = "not_found";
  readonly status = 404;
  constructor() {
    super("this project has no active budget to record the commitment against");
  }
}

export class RfqNotFoundError extends DomainError {
  readonly code = "not_found";
  readonly status = 404;
  constructor() {
    super("RFQ not found");
  }
}

export class RfqLineNotFoundError extends DomainError {
  readonly code = "not_found";
  readonly status = 404;
  constructor() {
    super("RFQ line not found");
  }
}

export class DeliveryLineExceedsOrderedQtyError extends DomainError {
  readonly code = "validation_error";
  readonly status = 422;
  constructor() {
    super("delivered quantity exceeds the remaining ordered quantity on this line");
  }
}
