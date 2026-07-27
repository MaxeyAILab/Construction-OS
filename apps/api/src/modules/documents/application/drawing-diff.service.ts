import { Inject, Injectable } from "@nestjs/common";
import type { DrawingSetDiffInput, DrawingSetDiffResult, DrawingSetDiffSheet } from "@constructionos/schemas";
import { eq } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import { documents, documentVersions } from "../../../infrastructure/db/schema";
import { AiGatewayService } from "../../ai";
import { NoPriorDrawingSetError } from "../domain/errors";
import { DrawingSetsService } from "./drawing-sets.service";

const MODEL = "claude-sonnet-5";
const MAX_TOKENS = 300;

const SYSTEM_PROMPT =
  "You are a construction document controller. Given a list of drawing sheets added, removed, and revised between two issued drawing sets, write a concise 2-3 sentence summary of what changed. Call out any structurally significant sheets if the sheet names suggest it (e.g. structural, MEP). Reason only from the sheet names given — never invent scope you cannot see.";

interface ResolvedSheet {
  documentId: string;
  name: string;
  documentVersionId: string;
  versionNo: number;
}

// ai-spec.md §7.7 (Document AI, M3) / FR-DOC-6. api.md §8: "POST
// /drawing-sets/{id}/ai/diff -> changed-region report." A sheet's
// identity across sets is its underlying documents.id (stable across
// revisions), never document_version_id (which changes release to
// release by design) — that's exactly what "revised" detects. This is a
// structural (added/removed/revised sheet) diff, not pixel-level visual
// region detection: this codebase has no drawing OCR/vision-diffing
// infrastructure, same documented-gap treatment as RAG's cross-encoder
// rerank deferral.
//
// The other Document AI capabilities ai-spec §7.7 lists (classification &
// auto-filing, metadata extraction, spec/contract Q&A, submittal-vs-spec
// conformance) either already exist elsewhere (documents.category is
// caller-set at upload, not AI-classified) or have no dedicated api.md
// endpoint of their own except /documents/ai/ask — and that one needs a
// document text-extraction/RAG-indexing pipeline this codebase doesn't
// have yet (RAG's ENTITY_PERMISSIONS only indexes task/rfi/daily_report/
// photo, never a document's actual file content). Flagged follow-up, not
// silently built as a shallow metadata-only search.
//
// Safety AI (FR-SAFE-4, ai-spec §7.9) has no api.md endpoint at all in
// this table, unlike every other AI row this session (Estimator/
// Procurement/Scheduling AI each had at least one concretely documented
// route) — nothing to build against without inventing an API surface,
// so it's not attempted this pass either.
@Injectable()
export class DrawingDiffService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly drawingSets: DrawingSetsService,
    private readonly aiGateway: AiGatewayService,
  ) {}

  async diff(tenantId: string, actorId: string, drawingSetId: string, input: DrawingSetDiffInput): Promise<DrawingSetDiffResult> {
    const target = await this.drawingSets.getById(tenantId, drawingSetId);

    let priorId = input.compareToDrawingSetId;
    if (!priorId) {
      const all = await this.drawingSets.list(tenantId, target.projectId);
      const priors = all
        .filter((s) => s.id !== target.id && s.createdAt < target.createdAt)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      priorId = priors[0]?.id;
    }
    if (!priorId) throw new NoPriorDrawingSetError();

    const prior = await this.drawingSets.getById(tenantId, priorId);
    if (prior.projectId !== target.projectId) throw new NoPriorDrawingSetError();

    const [targetSheets, priorSheets] = await Promise.all([
      this.resolveSheets(tenantId, target.sheets.map((s) => s.documentVersionId)),
      this.resolveSheets(tenantId, prior.sheets.map((s) => s.documentVersionId)),
    ]);

    const priorByDoc = new Map(priorSheets.map((s) => [s.documentId, s]));
    const targetByDoc = new Map(targetSheets.map((s) => [s.documentId, s]));

    const added = targetSheets.filter((s) => !priorByDoc.has(s.documentId));
    const removed = priorSheets.filter((s) => !targetByDoc.has(s.documentId));
    const revised: DrawingSetDiffSheet[] = [];
    let unchangedCount = 0;
    for (const sheet of targetSheets) {
      const priorSheet = priorByDoc.get(sheet.documentId);
      if (!priorSheet) continue;
      if (priorSheet.documentVersionId !== sheet.documentVersionId) {
        revised.push({ ...sheet, priorVersionNo: priorSheet.versionNo });
      } else {
        unchangedCount += 1;
      }
    }

    const { summary, aiRunId } = await this.summarize(tenantId, actorId, added, removed, revised);

    return {
      drawingSetId: target.id,
      comparedToDrawingSetId: prior.id,
      added,
      removed,
      revised,
      unchangedCount,
      summary,
      aiRunId,
    };
  }

  private async resolveSheets(tenantId: string, documentVersionIds: string[]): Promise<ResolvedSheet[]> {
    return withTenant(this.db, tenantId, async (tx) => {
      const resolved: ResolvedSheet[] = [];
      for (const documentVersionId of documentVersionIds) {
        const version = await tx.query.documentVersions.findFirst({ where: eq(documentVersions.id, documentVersionId) });
        if (!version) continue;
        const document = await tx.query.documents.findFirst({ where: eq(documents.id, version.documentId) });
        if (!document) continue;
        resolved.push({ documentId: document.id, name: document.name, documentVersionId: version.id, versionNo: version.versionNo });
      }
      return resolved;
    });
  }

  private async summarize(
    tenantId: string,
    actorId: string,
    added: DrawingSetDiffSheet[],
    removed: DrawingSetDiffSheet[],
    revised: DrawingSetDiffSheet[],
  ): Promise<{ summary: string | null; aiRunId: string | null }> {
    if (added.length === 0 && removed.length === 0 && revised.length === 0) {
      return { summary: "No sheets were added, removed, or revised between these two sets.", aiRunId: null };
    }

    try {
      const facts = [
        added.length > 0 ? `Added:\n${added.map((s) => `- ${s.name}`).join("\n")}` : null,
        removed.length > 0 ? `Removed:\n${removed.map((s) => `- ${s.name}`).join("\n")}` : null,
        revised.length > 0
          ? `Revised:\n${revised.map((s) => `- ${s.name} (v${s.priorVersionNo} -> v${s.versionNo})`).join("\n")}`
          : null,
      ]
        .filter((f): f is string => f !== null)
        .join("\n\n");

      const result = await this.aiGateway.run(tenantId, actorId, {
        purpose: "documents.ai_drawing_diff",
        model: MODEL,
        systemPrompt: SYSTEM_PROMPT,
        userPrompt: facts,
        maxTokens: MAX_TOKENS,
      });

      return { summary: result.content?.trim() ?? null, aiRunId: result.aiRunId };
    } catch {
      // The structural diff above is exact and already returned — a
      // failed/unconfigured model call only loses the narrative summary,
      // same tolerance as every other best-effort AI enrichment this
      // session (MarginErosionService, ProcurementNeedsService).
      return { summary: null, aiRunId: null };
    }
  }
}
