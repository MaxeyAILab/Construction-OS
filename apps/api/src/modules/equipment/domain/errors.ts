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

export class EquipmentNotFoundError extends DomainError {
  readonly code = "not_found";
  readonly status = 404;
  constructor() {
    super("equipment not found");
  }
}

export class DuplicateAssetNoError extends DomainError {
  readonly code = "conflict";
  readonly status = 409;
  constructor() {
    super("equipment with this asset number already exists");
  }
}

export class EquipmentAssignmentNotFoundError extends DomainError {
  readonly code = "not_found";
  readonly status = 404;
  constructor() {
    super("equipment assignment not found");
  }
}

// api.md §11: "409 overlap on double-book (DB exclusion)" — thrown when
// the DB's EXCLUDE USING gist constraint (ck_equipment_assignments_no_overlap)
// rejects the insert (FR-EQ-1).
export class EquipmentAssignmentOverlapError extends DomainError {
  readonly code = "overlap";
  readonly status = 409;
  constructor() {
    super("this equipment is already assigned during the requested window");
  }
}

export class EquipmentAssignmentAlreadyEndedError extends DomainError {
  readonly code = "illegal_transition";
  readonly status = 422;
  constructor() {
    super("this assignment has already ended");
  }
}

export class MaintenanceScheduleNotFoundError extends DomainError {
  readonly code = "not_found";
  readonly status = 404;
  constructor() {
    super("maintenance schedule not found");
  }
}

export class MaintenanceWorkOrderNotFoundError extends DomainError {
  readonly code = "not_found";
  readonly status = 404;
  constructor() {
    super("maintenance work order not found");
  }
}
