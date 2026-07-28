import { DomainError } from "./domain-error";

// spec.md §10.2 (Segregation of duties): "Financial approvals, change-order
// approvals, and permission changes support maker/checker workflows for
// enterprise tenants." architecture.md §12: "Maker/checker approval chains
// (enterprise) modeled as workflow rules on top of permissions, not new
// permission types" — hence a plain 409 domain error at the use-case layer,
// not a new RBAC primitive.
export class MakerCheckerViolationError extends DomainError {
  readonly code = "maker_checker_violation";
  readonly status = 409;
  constructor() {
    super("segregation of duties is enabled for this company: the record's creator cannot also approve it");
  }
}

// `enabled` is the tenant's companies.settings.enforceMakerChecker toggle;
// `makerId` is the record's createdBy. A null maker (no creator recorded,
// e.g. a system-created row) can't violate the rule — nothing to compare
// the approver against.
export function assertMakerChecker(enabled: boolean, actorId: string, makerId: string | null): void {
  if (enabled && makerId !== null && actorId === makerId) {
    throw new MakerCheckerViolationError();
  }
}
