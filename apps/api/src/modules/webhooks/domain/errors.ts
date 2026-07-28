import { DomainError } from "../../../platform/domain-error";

export class WebhookEndpointNotFoundError extends DomainError {
  readonly code = "not_found";
  readonly status = 404;
  constructor() {
    super("webhook endpoint not found");
  }
}
