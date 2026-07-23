// ai-spec.md §2 (NFR-27 cost metering). Per-million-token USD pricing —
// must be kept in sync with the provider's published price sheet by hand
// (providers don't expose a pricing API to fetch this from). An unknown
// model falls back to DEFAULT_PRICING rather than throwing, so metering
// degrades to "approximate" instead of failing the whole call outright.
export interface ModelPricing {
  inputPerMillionUsd: number;
  outputPerMillionUsd: number;
}

const MODEL_PRICING: Record<string, ModelPricing> = {
  "claude-opus-4-8": { inputPerMillionUsd: 15, outputPerMillionUsd: 75 },
  "claude-sonnet-5": { inputPerMillionUsd: 3, outputPerMillionUsd: 15 },
  "claude-haiku-4-5-20251001": { inputPerMillionUsd: 0.8, outputPerMillionUsd: 4 },
};

const DEFAULT_PRICING: ModelPricing = { inputPerMillionUsd: 3, outputPerMillionUsd: 15 };

// ai-spec.md §2's soft-limit "degrade ... smaller models" — the model
// AiGatewayService substitutes in once a tenant crosses its soft budget
// threshold, before the hard limit blocks calls outright.
export const DEGRADED_MODEL = "claude-haiku-4-5-20251001";

export function pricingFor(model: string): ModelPricing {
  return MODEL_PRICING[model] ?? DEFAULT_PRICING;
}

// database.md §19: ai_runs.cost_usd is NUMERIC(10,6) — a fixed-point
// string, never a float, same "money is exact" rule as everywhere else.
export function computeCostUsd(model: string, inputTokens: number, outputTokens: number): string {
  const pricing = pricingFor(model);
  const cost =
    (inputTokens / 1_000_000) * pricing.inputPerMillionUsd + (outputTokens / 1_000_000) * pricing.outputPerMillionUsd;
  return cost.toFixed(6);
}
