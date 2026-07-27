import { DomainError } from "../../../platform/domain-error";

// Duplicated rather than imported from ../../budgets/domain/errors —
// modules communicate only via their index.ts public surface, and
// BudgetsModule doesn't export its domain errors (same reasoning as
// budgets/domain/errors.ts's own duplication of ProjectNotFoundError from
// Projects).
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

export class InvoiceNotFoundError extends DomainError {
  readonly code = "not_found";
  readonly status = 404;
  constructor() {
    super("invoice not found");
  }
}

export class InvoiceNotDraftError extends DomainError {
  readonly code = "illegal_transition";
  readonly status = 422;
  constructor() {
    super("only a draft invoice can be edited, approved, or voided");
  }
}

// FR-VEND-2: the 2-/3-way match check has to block something to have any
// teeth — same "gate an action on a real check" precedent as
// SubcontractorIneligibleError. A mismatched invoice must be corrected
// (edit lines) or voided before it can be approved.
export class InvoiceMismatchedError extends DomainError {
  readonly code = "mismatched";
  readonly status = 422;
  constructor() {
    super("this invoice has one or more lines that don't match their purchase order (FR-VEND-2)");
  }
}

export class InvoiceNotApprovedError extends DomainError {
  readonly code = "illegal_transition";
  readonly status = 422;
  constructor() {
    super("payments can only be applied to an approved invoice");
  }
}

export class PaymentExceedsBalanceError extends DomainError {
  readonly code = "payment_exceeds_balance";
  readonly status = 422;
  constructor() {
    super("this payment would exceed the invoice's outstanding balance");
  }
}

export class PaymentApplicationNotFoundError extends DomainError {
  readonly code = "not_found";
  readonly status = 404;
  constructor() {
    super("payment application not found");
  }
}

export class PaymentApplicationNotDraftError extends DomainError {
  readonly code = "illegal_transition";
  readonly status = 422;
  constructor() {
    super("only a draft payment application can be edited or submitted");
  }
}

export class PaymentApplicationNotSubmittedError extends DomainError {
  readonly code = "illegal_transition";
  readonly status = 422;
  constructor() {
    super("only a submitted payment application can be approved");
  }
}

export class PaymentApplicationAlreadyApprovedError extends DomainError {
  readonly code = "illegal_transition";
  readonly status = 422;
  constructor() {
    super("an approved payment application cannot be voided");
  }
}

// FR-FIN-4: approval bills the project's client — there's no counterparty
// to bill if the project was never linked to one (projects.
// client_contact_company_id is nullable, per database.md §9).
export class NoClientForProjectError extends DomainError {
  readonly code = "no_client_for_project";
  readonly status = 422;
  constructor() {
    super("this project has no client contact company — set one before approving a payment application");
  }
}
