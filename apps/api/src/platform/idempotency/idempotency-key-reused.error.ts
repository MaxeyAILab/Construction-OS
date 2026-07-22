import { DomainError } from "../domain-error";

export class IdempotencyKeyReusedError extends DomainError {
  readonly code = "idempotency_key_reused";
  readonly status = 409;
  constructor() {
    super("this Idempotency-Key was already used with a different request body");
  }
}
