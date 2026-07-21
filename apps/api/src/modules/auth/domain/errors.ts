export class InvalidCredentialsError extends Error {
  constructor() {
    super("invalid email or password");
  }
}

export class MfaRequiredError extends Error {
  constructor() {
    super("totp code required");
  }
}

export class InvalidMfaCodeError extends Error {
  constructor() {
    super("invalid totp code");
  }
}

export class AmbiguousCompanyError extends Error {
  constructor() {
    super("user belongs to multiple companies; companyId is required");
  }
}

export class NoCompanyMembershipError extends Error {
  constructor() {
    super("user has no company membership");
  }
}

export class NotAMemberError extends Error {
  constructor() {
    super("user is not a member of this company");
  }
}

export class InvalidRefreshTokenError extends Error {
  constructor() {
    super("invalid or expired refresh token");
  }
}

export class EmailAlreadyRegisteredError extends Error {
  constructor() {
    super("a user with this email already exists");
  }
}
