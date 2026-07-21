import { DomainError } from "../../../platform/domain-error";

export class InvalidCredentialsError extends DomainError {
  readonly code = "invalid_credentials";
  readonly status = 401;
  constructor() {
    super("invalid email or password");
  }
}

// api.md §2 documents a two-step MFA challenge (login returns mfa_required
// + a step-up token, then POST /auth/mfa/verify completes it) — not yet
// implemented; this is a temporary single-call approximation (flagged
// follow-up) so it's mapped as an auth failure, not a distinct flow state.
export class MfaRequiredError extends DomainError {
  readonly code = "mfa_required";
  readonly status = 401;
  constructor() {
    super("totp code required");
  }
}

export class InvalidMfaCodeError extends DomainError {
  readonly code = "invalid_mfa_code";
  readonly status = 401;
  constructor() {
    super("invalid totp code");
  }
}

export class AmbiguousCompanyError extends DomainError {
  readonly code = "ambiguous_company";
  readonly status = 409;
  constructor() {
    super("user belongs to multiple companies; companyId is required");
  }
}

export class NoCompanyMembershipError extends DomainError {
  readonly code = "no_company_membership";
  readonly status = 403;
  constructor() {
    super("user has no company membership");
  }
}

export class NotAMemberError extends DomainError {
  readonly code = "not_a_member";
  readonly status = 403;
  constructor() {
    super("user is not a member of this company");
  }
}

export class InvalidRefreshTokenError extends DomainError {
  readonly code = "invalid_refresh_token";
  readonly status = 401;
  constructor() {
    super("invalid or expired refresh token");
  }
}

export class EmailAlreadyRegisteredError extends DomainError {
  readonly code = "email_already_registered";
  readonly status = 409;
  constructor() {
    super("a user with this email already exists");
  }
}
