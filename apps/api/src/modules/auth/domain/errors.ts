import { DomainError } from "../../../platform/domain-error";

export class InvalidCredentialsError extends DomainError {
  readonly code = "invalid_credentials";
  readonly status = 401;
  constructor() {
    super("invalid email or password");
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

export class ApiKeyNotFoundError extends DomainError {
  readonly code = "not_found";
  readonly status = 404;
  constructor() {
    super("API key not found");
  }
}

export class UnknownApiKeyScopeError extends DomainError {
  readonly code = "unknown_permission";
  readonly status = 422;
  constructor(readonly scope: string) {
    super(`unknown permission key: ${scope}`);
  }
}

export class InvalidMfaChallengeError extends DomainError {
  readonly code = "invalid_mfa_challenge";
  readonly status = 401;
  constructor() {
    super("invalid or expired MFA challenge token");
  }
}

export class InvalidPasswordResetTokenError extends DomainError {
  readonly code = "invalid_password_reset_token";
  readonly status = 401;
  constructor() {
    super("invalid or expired password reset token");
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

// Roadmap Phase 2 "Second locale + metric units (NFR-30 activation)":
// GET/PATCH /admin/company (api.md §15). tenantId always comes from the
// caller's own access token, so this only fires if the company row was
// deleted out from under an active session — a defensive guard, not a
// reachable path in normal use.
export class CompanyNotFoundError extends DomainError {
  readonly code = "not_found";
  readonly status = 404;
  constructor() {
    super("company not found");
  }
}

export class SsoConnectionNotFoundError extends DomainError {
  readonly code = "not_found";
  readonly status = 404;
  constructor() {
    super("SSO connection not found");
  }
}

export class InvalidSamlAssertionError extends DomainError {
  readonly code = "invalid_saml_assertion";
  readonly status = 401;
  constructor() {
    super("SAML assertion failed validation");
  }
}

export class ScimAuthenticationError extends DomainError {
  readonly code = "invalid_credentials";
  readonly status = 401;
  constructor() {
    super("invalid or revoked SCIM token");
  }
}

export class ScimUserNotFoundError extends DomainError {
  readonly code = "not_found";
  readonly status = 404;
  constructor() {
    super("SCIM user not found");
  }
}

export class ScimGroupNotFoundError extends DomainError {
  readonly code = "not_found";
  readonly status = 404;
  constructor() {
    super("SCIM group not found");
  }
}
