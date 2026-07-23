import { DomainError } from "../../../platform/domain-error";

export class ConversationNotFoundError extends DomainError {
  readonly code = "not_found";
  readonly status = 404;
  constructor() {
    super("conversation not found");
  }
}
