import { Inject, Injectable } from "@nestjs/common";
import type { LeveledBid } from "@constructionos/schemas";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import { bidInvitations, bids, subcontractors } from "../../../infrastructure/db/schema";
import { AiGatewayService, type AiToolSpec } from "../../ai";
import { OutboxService } from "../../events";
import { NoBidsToLevelError } from "../domain/errors";
import { BidPackagesService } from "./bid-packages.service";

const MODEL = "claude-sonnet-5";
const MAX_TOKENS = 1536;
const TOOL_NAME = "emit_bid_completeness_scores";

// Weights are a documented assumption, not spec.md-mandated: a lowball
// bid missing scope is a worse outcome than a slightly-pricier complete
// one, so completeness (the thing price alone can't reveal) outweighs raw
// price-competitiveness. Revisit if FR-EST-6 ever specifies its own split.
const COMPLETENESS_WEIGHT = 0.6;
const PRICE_WEIGHT = 0.4;

const bidScoreSchema = z.object({
  bidId: z.string().uuid(),
  completenessScore: z.number().min(0).max(100),
  gapsSummary: z.string().min(1),
});
const emitScoresInputSchema = z.object({
  scores: z.array(bidScoreSchema),
});

const SYSTEM_PROMPT =
  "You are a construction estimator's assistant leveling subcontractor bids for a single bid package. You are given the package's scope of work and a list of submitted bids, each with an amount and its stated inclusions/exclusions. For each bid, assign a completenessScore from 0-100 reflecting how fully its inclusions cover the stated scope (100 = clearly covers the full scope with no concerning exclusions; lower scores for bids that exclude items a reasonable reading of the scope would expect, or that give too little detail to tell). Never adjust or restate the bid amount — pricing is handled separately. Write a one-sentence gapsSummary naming the most significant gap or, if there is none, confirming the bid reads as complete. You must return a score for every bid given, addressed by its bidId.";

// api.md §5 `POST /bid-packages/{id}/level` (FR-EST-6; ai-spec.md §7.3
// "bid-leveling matrix from sub bids"). See leveledBidSchema's doc comment
// in packages/schemas for the score composition: a deterministic
// price-competitiveness rule blended with this AI-assessed scope-
// completeness read. Bid amounts themselves are never touched — this
// only ever writes bids.leveled_score, same "AI never restates money"
// boundary as EstimatorAiService's cost lookup.
@Injectable()
export class BidLevelingService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly aiGateway: AiGatewayService,
    private readonly bidPackages: BidPackagesService,
    private readonly outbox: OutboxService,
  ) {}

  async level(tenantId: string, actorId: string, bidPackageId: string): Promise<{ bids: LeveledBid[]; aiRunId: string }> {
    const bidPackage = await this.bidPackages.getById(tenantId, bidPackageId);

    const rows = await withTenant(this.db, tenantId, (tx) =>
      tx
        .select({ bid: bids, subcontractorId: subcontractors.id, subcontractorName: subcontractors.name })
        .from(bids)
        .innerJoin(bidInvitations, eq(bids.bidInvitationId, bidInvitations.id))
        .innerJoin(subcontractors, eq(bidInvitations.subcontractorId, subcontractors.id))
        .where(eq(bidInvitations.bidPackageId, bidPackageId)),
    );
    if (rows.length === 0) throw new NoBidsToLevelError();

    const lowestAmount = Math.min(...rows.map((r) => Number(r.bid.amount)));

    const toolSpec: AiToolSpec = {
      name: TOOL_NAME,
      description: "Report a completeness score and one-sentence gap summary for each submitted bid.",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- zod-to-json-schema's ZodSchema type is a distinct nominal type from this codebase's "zod" import; see estimator-ai.service.ts's identical bridge comment.
      inputSchema: zodToJsonSchema(emitScoresInputSchema as any, { target: "jsonSchema7", $refStrategy: "none" }) as Record<
        string,
        unknown
      >,
    };

    const userPrompt = [
      `Bid package scope: ${bidPackage.scope ?? "(no scope text provided)"}`,
      "",
      "Submitted bids:",
      ...rows.map((r) => {
        const incExc = (r.bid.inclusionsExclusions ?? {}) as { inclusions?: string[]; exclusions?: string[] };
        return [
          `- bidId: ${r.bid.id}`,
          `  subcontractor: ${r.subcontractorName}`,
          `  amount: ${r.bid.amount}`,
          `  inclusions: ${incExc.inclusions?.join("; ") || "(none stated)"}`,
          `  exclusions: ${incExc.exclusions?.join("; ") || "(none stated)"}`,
        ].join("\n");
      }),
    ].join("\n");

    const result = await this.aiGateway.run(tenantId, actorId, {
      purpose: "estimating.ai_level_bids",
      model: MODEL,
      systemPrompt: SYSTEM_PROMPT,
      userPrompt,
      tools: [toolSpec],
      forceToolName: TOOL_NAME,
      maxTokens: MAX_TOKENS,
    });

    const call = result.toolCalls[0];
    if (!call) throw new Error(`Bid leveling: model did not call ${TOOL_NAME} for bid package ${bidPackageId}`);
    const scoresByBidId = new Map(emitScoresInputSchema.parse(call.input).scores.map((s) => [s.bidId, s]));

    const leveled = await withTenant(this.db, tenantId, async (tx) => {
      const out: LeveledBid[] = [];
      for (const row of rows) {
        const amount = Number(row.bid.amount);
        const priceScore = Math.min(100, (lowestAmount / amount) * 100);
        const score = scoresByBidId.get(row.bid.id);
        const completenessScore = score?.completenessScore ?? 0;
        const leveledScore = (COMPLETENESS_WEIGHT * completenessScore + PRICE_WEIGHT * priceScore).toFixed(2);

        await tx.update(bids).set({ leveledScore, updatedBy: actorId }).where(eq(bids.id, row.bid.id));

        out.push({
          bidId: row.bid.id,
          subcontractorId: row.subcontractorId,
          subcontractorName: row.subcontractorName,
          amount: row.bid.amount,
          priceScore: Math.round(priceScore * 100) / 100,
          completenessScore,
          leveledScore,
          gapsSummary: score?.gapsSummary ?? null,
        });
      }

      await this.outbox.append(tx, {
        tenantId,
        eventType: "bid_package.leveled.v1",
        dedupeKey: `bid_package.leveled.v1:${bidPackageId}:${result.aiRunId}`,
        actorId,
        payload: { companyId: tenantId, projectId: bidPackage.projectId, bidPackageId, bidCount: rows.length, aiRunId: result.aiRunId },
      });

      return out;
    });

    return { bids: leveled, aiRunId: result.aiRunId };
  }
}
