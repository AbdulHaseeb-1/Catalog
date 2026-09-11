import { ERROR_CODES } from "@verifybridge/shared";
import type { ErrorCode } from "@verifybridge/shared";

export class DomainError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = new.target.name;
    this.code = code;
  }
}

export class VerificationSessionNotFoundError extends DomainError {
  constructor() {
    super(ERROR_CODES.SESSION_NOT_FOUND, "Verification session not found.");
  }
}

export class VerificationSessionExpiredError extends DomainError {
  constructor() {
    super(ERROR_CODES.SESSION_EXPIRED, "This verification session has expired.");
  }
}

export class VerificationSessionConsumedError extends DomainError {
  constructor() {
    super(ERROR_CODES.SESSION_CONSUMED, "This verification session has already been used.");
  }
}

export class InvalidVerificationTokenError extends DomainError {
  constructor() {
    super(ERROR_CODES.INVALID_TOKEN, "Invalid or missing verification token.");
  }
}

export class OriginMismatchError extends DomainError {
  constructor() {
    super(ERROR_CODES.ORIGIN_MISMATCH, "The requesting origin does not match this session.");
  }
}

export class InvalidStateTransitionError extends DomainError {
  constructor(from: string, to: string) {
    super(ERROR_CODES.INVALID_STATE_TRANSITION, `Cannot transition session from ${from} to ${to}.`);
  }
}

export class ProviderVerificationError extends DomainError {
  constructor(message = "The verification provider returned an error.") {
    super(ERROR_CODES.PROVIDER_ERROR, message);
  }
}

export class RateLimitedError extends DomainError {
  constructor() {
    super(ERROR_CODES.RATE_LIMITED, "Too many requests. Please try again shortly.");
  }
}

export class ValidationFailedError extends DomainError {
  constructor(message: string) {
    super(ERROR_CODES.VALIDATION_ERROR, message);
  }
}
