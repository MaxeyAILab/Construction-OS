import { DomainError } from "../../../platform/domain-error";

export class UnknownEventTypeError extends DomainError {
  readonly code = "unknown_event_type";
  readonly status = 422;
  constructor(readonly eventType: string) {
    super(`unknown event type: ${eventType}`);
  }
}

export class InvalidEventPayloadError extends DomainError {
  readonly code = "invalid_event_payload";
  readonly status = 422;
  constructor(
    readonly eventType: string,
    message: string,
  ) {
    super(`invalid payload for event ${eventType}: ${message}`);
  }
}
