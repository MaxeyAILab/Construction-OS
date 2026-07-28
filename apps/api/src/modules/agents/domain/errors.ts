import { DomainError } from "../../../platform/domain-error";

export class AgentIdentityNotFoundError extends DomainError {
  readonly code = "not_found";
  readonly status = 404;
  constructor() {
    super("agent identity not found");
  }
}

export class UnknownAgentToolError extends DomainError {
  readonly code = "unknown_tool";
  readonly status = 422;
  constructor(readonly tool: string) {
    super(`unknown tool: ${tool}`);
  }
}

// ai-spec.md §15: "human 'pause agent' kill-switch per tenant" — the
// enforcement-side counterpart to AgentIdentitiesService.pause().
export class AgentPausedError extends DomainError {
  readonly code = "agent_paused";
  readonly status = 403;
  constructor() {
    super("this agent identity is paused");
  }
}

// api.md §15.1: "budget_monthly_usd is compared against that agent's own
// ai_runs.cost_usd for the current month."
export class AgentBudgetExceededError extends DomainError {
  readonly code = "budget_exceeded";
  readonly status = 403;
  constructor() {
    super("this agent has exceeded its monthly budget");
  }
}
