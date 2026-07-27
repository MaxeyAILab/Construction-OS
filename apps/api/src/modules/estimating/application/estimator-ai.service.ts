import { Inject, Injectable } from "@nestjs/common";
import type { SuggestEstimateLinesInput, SuggestedEstimateLine } from "@constructionos/schemas";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import { costItemPriceHistory, costItems } from "../../../infrastructure/db/schema";
import { AiGatewayService, type AiToolSpec } from "../../ai";
import { EstimateService } from "./estimate.service";

const MODEL = "claude-sonnet-5";
const MAX_TOKENS = 1024;
const TOOL_NAME = "emit_estimate_line_drafts";

// A pricing.anomaly flag needs at least this many historical observations
// to mean anything — with fewer points, "deviates from the average" is
// just noise, not a signal.
const MIN_PRICE_HISTORY_FOR_ANOMALY = 3;
const ANOMALY_STDDEV_MULTIPLE = 2;

// The model's own output — what it can respect responsibly. It classifies
// and quantifies scope text; it never states a price. Unit costs only ever
// come from priceDraft()'s deterministic cost_items/cost_item_price_history
// lookup below, never from the model — "money is exact" (CLAUDE.md) and
// FR-EST-7's "historical-cost lookup" both require the number to trace back
// to a real observed cost, not a model guess.
const draftLineSchema = z.object({
  costCodeRef: z.string().min(1).optional(),
  description: z.string().min(1),
  qty: z.number().positive(),
  uom: z.string().min(1),
});
const emitDraftsInputSchema = z.object({
  lines: z.array(draftLineSchema).max(50),
});

const SYSTEM_PROMPT =
  "You are a construction estimator's assistant. Break the given scope-of-work text into discrete, billable line items a cost estimator would price separately. For each line, infer a quantity and unit of measure directly implied by the text (e.g. '2,400 SF of drywall' -> qty 2400, uom SF); if a quantity isn't stated, use your best professional estimate from typical construction ratios and say so in the description. If you can confidently classify a line against a standard CSI-style cost code already in use, include costCodeRef — otherwise omit it. Never state a unit cost or price; that is looked up separately from historical data. If the scope text describes nothing biddable, return an empty lines array.";

// ai-spec.md §7.3 (Estimator AI, M2) / FR-EST-7: "line-item suggestions,
// historical-cost lookup, and pricing-anomaly flags with confidence."
// Autonomy is draft-only — see suggestedEstimateLineSchema's doc comment
// in packages/schemas: nothing here ever inserts an estimate_lines row.
//
// Deliberately narrower than ai-spec §7.3's full capability list: bid-
// leveling already has its own endpoint (FR-EST-6, `/bid-packages/{id}
// /level`), and "win-price guidance from CRM history" isn't in FR-EST-7's
// spec.md wording (spec.md wins on conflicts, CLAUDE.md) — flagged as a
// follow-up, not silently built here.
@Injectable()
export class EstimatorAiService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly aiGateway: AiGatewayService,
    private readonly estimateService: EstimateService,
  ) {}

  async suggestLines(
    tenantId: string,
    actorId: string,
    estimateId: string,
    input: SuggestEstimateLinesInput,
  ): Promise<{ lines: SuggestedEstimateLine[]; aiRunId: string }> {
    await this.estimateService.getById(tenantId, estimateId); // throws EstimateNotFoundError if absent/foreign tenant

    const toolSpec: AiToolSpec = {
      name: TOOL_NAME,
      description: "Report the candidate estimate line items parsed from the scope text.",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- zod-to-json-schema's ZodSchema type is a distinct nominal type from this codebase's "zod" import; see photo-ai.service.ts's identical bridge comment.
      inputSchema: zodToJsonSchema(emitDraftsInputSchema as any, { target: "jsonSchema7", $refStrategy: "none" }) as Record<
        string,
        unknown
      >,
    };

    const result = await this.aiGateway.run(tenantId, actorId, {
      purpose: "estimate.ai_suggest_lines",
      model: MODEL,
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: input.scopeText,
      tools: [toolSpec],
      forceToolName: TOOL_NAME,
      maxTokens: MAX_TOKENS,
    });

    const call = result.toolCalls[0];
    if (!call) throw new Error(`Estimator AI: model did not call ${TOOL_NAME} for estimate ${estimateId}`);
    const drafts = emitDraftsInputSchema.parse(call.input).lines;

    const lines = await withTenant(this.db, tenantId, async (tx) => {
      const priced: SuggestedEstimateLine[] = [];
      for (const draft of drafts) {
        priced.push(await this.priceDraft(tx, draft));
      }
      return priced;
    });

    return { lines, aiRunId: result.aiRunId };
  }

  private async priceDraft(tx: Database, draft: z.infer<typeof draftLineSchema>): Promise<SuggestedEstimateLine> {
    const qty = draft.qty.toFixed(3);
    const costItem = draft.costCodeRef
      ? await tx.query.costItems.findFirst({ where: eq(costItems.code, draft.costCodeRef) })
      : undefined;

    if (!costItem) {
      return {
        costCodeRef: draft.costCodeRef ?? null,
        description: draft.description,
        qty,
        uom: draft.uom,
        unitCostAmount: null,
        confidence: 0.35,
        sources: [],
        pricingAnomaly: false,
      };
    }

    const history = await tx.query.costItemPriceHistory.findMany({
      where: eq(costItemPriceHistory.costItemId, costItem.id),
      orderBy: (t, { desc }) => [desc(t.observedAt)],
      limit: 24,
    });

    // recordPriceObservation() (CostBookService) is cost_items'
    // currentUnitCostAmount's only write path, and always inserts the same
    // value as a cost_item_price_history row in the same call — so
    // history[0] (newest first) is that same observation, not a prior,
    // independent data point. The anomaly baseline must exclude it, or a
    // single new spike would dilute its own signal by counting itself as
    // part of "normal."
    const priorHistory = history.slice(1);

    return {
      costCodeRef: costItem.code,
      description: draft.description,
      qty,
      uom: draft.uom,
      unitCostAmount: costItem.currentUnitCostAmount,
      confidence: history.length > 0 ? 0.85 : 0.6,
      sources: [`cost_item:${costItem.code}`],
      pricingAnomaly: isPricingAnomaly(
        Number(costItem.currentUnitCostAmount),
        priorHistory.map((h) => Number(h.unitCostAmount)),
      ),
    };
  }
}

// Deterministic rule, not a model judgment (same "the check is the
// authoritative rule, AI only enriches" split as MarginErosionService) —
// flags when the cost item's current price sits more than
// ANOMALY_STDDEV_MULTIPLE standard deviations from its own observed
// history, i.e. a real statistical outlier vs this tenant's own cost book.
function isPricingAnomaly(currentPrice: number, historicalPrices: number[]): boolean {
  if (historicalPrices.length < MIN_PRICE_HISTORY_FOR_ANOMALY) return false;

  const mean = historicalPrices.reduce((a, b) => a + b, 0) / historicalPrices.length;
  const variance = historicalPrices.reduce((a, b) => a + (b - mean) ** 2, 0) / historicalPrices.length;
  const stddev = Math.sqrt(variance);
  if (stddev === 0) return false;

  return Math.abs(currentPrice - mean) > ANOMALY_STDDEV_MULTIPLE * stddev;
}
