import type { Database } from "../../src/infrastructure/db/client";
import { AiGatewayService } from "../../src/modules/ai/application/ai-gateway.service";
import type { AiCompletionRequest, AiCompletionResult, AiProvider } from "../../src/modules/ai/domain/ai-provider";
import { OutboxService } from "../../src/modules/events/application/outbox.service";
import { BidInvitationsService } from "../../src/modules/estimating/application/bid-invitations.service";
import { BidLevelingService } from "../../src/modules/estimating/application/bid-leveling.service";
import { BidPackagesService } from "../../src/modules/estimating/application/bid-packages.service";
import { BidsService } from "../../src/modules/estimating/application/bids.service";
import { CostBookService } from "../../src/modules/estimating/application/cost-book.service";
import { ConvertToBudgetService } from "../../src/modules/estimating/application/convert-to-budget.service";
import { EstimateLinesService } from "../../src/modules/estimating/application/estimate-lines.service";
import { EstimateService } from "../../src/modules/estimating/application/estimate.service";
import { EstimatorAiService } from "../../src/modules/estimating/application/estimator-ai.service";
import type { SubcontractorsService } from "../../src/modules/subcontractors/application/subcontractors.service";

interface DraftLine {
  costCodeRef?: string;
  description: string;
  qty: number;
  uom: string;
}

// Same "real double, not a network client" role as FakePhotoTaggingProvider
// (test/setup/photo-ai.ts) — only supports EstimatorAiService's one call
// shape (forced tool choice), returning whatever draft lines the test set
// rather than a fixed fixture, since different tests need to exercise the
// matched/unmatched/anomaly cost-lookup branches in priceDraft().
export class FakeEstimatorAiProvider implements AiProvider {
  private draftLines: DraftLine[] = [];

  setDraftLines(lines: DraftLine[]): void {
    this.draftLines = lines;
  }

  async complete(request: AiCompletionRequest): Promise<AiCompletionResult> {
    if (!request.forceToolName) throw new Error("FakeEstimatorAiProvider only supports forced-tool-choice calls");
    return {
      content: null,
      toolCalls: [{ id: "call-lines", name: request.forceToolName, input: { lines: this.draftLines } }],
      inputTokens: 200,
      outputTokens: 80,
    };
  }
}

interface BidScore {
  bidId: string;
  completenessScore: number;
  gapsSummary: string;
}

// Same "real double, not a network client" role as FakeEstimatorAiProvider
// above — only supports BidLevelingService's one call shape (forced tool
// choice), returning whatever per-bid scores the test set.
export class FakeBidLevelingProvider implements AiProvider {
  private scores: BidScore[] = [];

  setScores(scores: BidScore[]): void {
    this.scores = scores;
  }

  async complete(request: AiCompletionRequest): Promise<AiCompletionResult> {
    if (!request.forceToolName) throw new Error("FakeBidLevelingProvider only supports forced-tool-choice calls");
    return {
      content: null,
      toolCalls: [{ id: "call-level", name: request.forceToolName, input: { scores: this.scores } }],
      inputTokens: 200,
      outputTokens: 80,
    };
  }
}

export function buildTestEstimatingServices(db: Database, subcontractorsService: SubcontractorsService) {
  const outbox = new OutboxService();
  const estimateService = new EstimateService(db, outbox);
  const bidPackagesService = new BidPackagesService(db, outbox);
  const bidInvitationsService = new BidInvitationsService(db, outbox, bidPackagesService, subcontractorsService);
  const estimatorAiProvider = new FakeEstimatorAiProvider();
  const estimatorAiService = new EstimatorAiService(db, new AiGatewayService(db, estimatorAiProvider), estimateService);
  const bidLevelingProvider = new FakeBidLevelingProvider();
  const bidLevelingService = new BidLevelingService(db, new AiGatewayService(db, bidLevelingProvider), bidPackagesService, outbox);
  return {
    estimateService,
    estimateLinesService: new EstimateLinesService(db, outbox, estimateService),
    costBookService: new CostBookService(db, outbox),
    convertToBudgetService: new ConvertToBudgetService(db, outbox),
    bidPackagesService,
    bidInvitationsService,
    bidsService: new BidsService(db, outbox, bidInvitationsService),
    estimatorAiService,
    estimatorAiProvider,
    bidLevelingService,
    bidLevelingProvider,
  };
}
