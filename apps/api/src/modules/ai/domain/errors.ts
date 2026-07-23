import { DomainError } from "../../../platform/domain-error";

// ai-spec.md §2: "hard limit = assistant explains and offers a top-up."
// Thrown before any model invocation happens, so — unlike a provider
// failure — no ai_runs row is written for a blocked attempt (database.md
// §19 defines ai_runs as "every model invocation"; a budget block is a
// gateway-level rejection, not one).
export class AiBudgetExceededError extends DomainError {
  readonly code = "ai_budget_exceeded";
  readonly status = 429;
  constructor() {
    super("this tenant's monthly AI budget has been exceeded");
  }
}

export class AiRunNotFoundError extends DomainError {
  readonly code = "not_found";
  readonly status = 404;
  constructor() {
    super("ai run not found");
  }
}
