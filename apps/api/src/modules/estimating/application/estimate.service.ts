import { Inject, Injectable } from "@nestjs/common";
import type { CreateEstimateInput, ListEstimatesQuery, UpdateEstimateInput } from "@constructionos/schemas";
import { and, desc, eq, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import { estimateLines, estimates, projects } from "../../../infrastructure/db/schema";
import { OutboxService } from "../../events";
import { EstimateAlreadyExistsForProjectError, EstimateNotFoundError, ProjectNotFoundError } from "../domain/errors";

interface Cursor {
  createdAt: string;
  id: string;
}

function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify(c)).toString("base64url");
}

function decodeCursor(raw: string): Cursor {
  return JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Cursor;
}

@Injectable()
export class EstimateService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly outbox: OutboxService,
  ) {}

  // api.md §5: "Filter: opportunity_id, project_id, status". opportunity_id
  // isn't filterable yet — every estimate today has project_id set (CRM/M1
  // doesn't exist), so it's out of scope until opportunities are reachable.
  async list(tenantId: string, query: ListEstimatesQuery) {
    return withTenant(this.db, tenantId, async (tx) => {
      const conditions: SQL[] = [eq(estimates.tenantId, tenantId)];
      if (query.projectId) conditions.push(eq(estimates.projectId, query.projectId));
      if (query.status) conditions.push(eq(estimates.status, query.status));
      if (query.cursor) {
        const c = decodeCursor(query.cursor);
        conditions.push(
          or(lt(estimates.createdAt, new Date(c.createdAt)), and(eq(estimates.createdAt, new Date(c.createdAt)), lt(estimates.id, c.id))!)!,
        );
      }

      const rows = await tx.query.estimates.findMany({
        where: and(...conditions),
        orderBy: [desc(estimates.createdAt), desc(estimates.id)],
        limit: query.limit + 1,
      });

      const hasMore = rows.length > query.limit;
      const page = rows.slice(0, query.limit);
      const last = page.at(-1);
      const nextCursor =
        hasMore && last ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id }) : null;

      return { data: page, meta: { cursor: nextCursor, hasMore } };
    });
  }

  async getById(tenantId: string, estimateId: string) {
    return withTenant(this.db, tenantId, async (tx) => {
      const estimate = await tx.query.estimates.findFirst({ where: eq(estimates.id, estimateId) });
      if (!estimate) throw new EstimateNotFoundError();

      const lines = await tx.query.estimateLines.findMany({
        where: and(eq(estimateLines.estimateId, estimateId), isNull(estimateLines.deletedAt)),
        orderBy: (t, { asc }) => [asc(t.sortOrder)],
      });
      return { ...estimate, lines };
    });
  }

  async create(tenantId: string, actorId: string, input: CreateEstimateInput) {
    return withTenant(this.db, tenantId, async (tx) => {
      const project = await tx.query.projects.findFirst({ where: eq(projects.id, input.projectId) });
      if (!project) throw new ProjectNotFoundError();

      const existing = await tx.query.estimates.findFirst({ where: eq(estimates.projectId, input.projectId) });
      if (existing) throw new EstimateAlreadyExistsForProjectError();

      const [estimate] = await tx
        .insert(estimates)
        .values({
          tenantId,
          projectId: input.projectId,
          version: 1,
          markupPct: input.markupPct,
          overheadPct: input.overheadPct,
          contingencyPct: input.contingencyPct,
          taxPct: input.taxPct,
          currency: input.currency,
          validUntil: input.validUntil,
          createdBy: actorId,
        })
        .returning();
      const created = estimate!;

      await this.outbox.append(tx, {
        tenantId,
        eventType: "estimate.created.v1",
        dedupeKey: `estimate.created.v1:${created.id}`,
        actorId,
        payload: { companyId: tenantId, projectId: input.projectId, estimateId: created.id, version: 1 },
      });

      return created;
    });
  }

  // FR-EST-4: "new versions are new rows" — copies the header (percentages,
  // currency, valid_until) and every line from the source version, then
  // marks the source superseded (unless it's already won/lost, which are
  // terminal states a new version shouldn't silently overwrite).
  async createVersion(tenantId: string, actorId: string, estimateId: string) {
    return withTenant(this.db, tenantId, async (tx) => {
      const source = await tx.query.estimates.findFirst({ where: eq(estimates.id, estimateId) });
      if (!source) throw new EstimateNotFoundError();

      const [maxVersionRow] = await tx
        .select({ maxVersion: sql<number>`max(${estimates.version})` })
        .from(estimates)
        .where(eq(estimates.projectId, source.projectId!));
      const maxVersion = maxVersionRow!.maxVersion;

      const sourceLines = await tx.query.estimateLines.findMany({
        where: and(eq(estimateLines.estimateId, estimateId), isNull(estimateLines.deletedAt)),
      });

      const [next] = await tx
        .insert(estimates)
        .values({
          tenantId,
          projectId: source.projectId,
          opportunityId: source.opportunityId,
          version: maxVersion + 1,
          markupPct: source.markupPct,
          overheadPct: source.overheadPct,
          contingencyPct: source.contingencyPct,
          taxPct: source.taxPct,
          subtotalAmount: source.subtotalAmount,
          currency: source.currency,
          validUntil: source.validUntil,
          createdBy: actorId,
        })
        .returning();
      const created = next!;

      if (sourceLines.length > 0) {
        await tx.insert(estimateLines).values(
          sourceLines.map((line) => ({
            tenantId,
            estimateId: created.id,
            costCodeRef: line.costCodeRef,
            description: line.description,
            qty: line.qty,
            uom: line.uom,
            unitCostAmount: line.unitCostAmount,
            unitPriceAmount: line.unitPriceAmount,
            assemblyId: line.assemblyId,
            sortOrder: line.sortOrder,
            source: line.source,
            aiRunId: line.aiRunId,
            createdBy: actorId,
          })),
        );
      }

      await this.recomputeTotals(tx, created.id);

      if (source.status !== "won" && source.status !== "lost") {
        await tx.update(estimates).set({ status: "superseded", updatedBy: actorId }).where(eq(estimates.id, source.id));
      }

      await this.outbox.append(tx, {
        tenantId,
        eventType: "estimate.created.v1",
        dedupeKey: `estimate.created.v1:${created.id}`,
        actorId,
        payload: { companyId: tenantId, projectId: source.projectId!, estimateId: created.id, version: created.version },
      });

      return created;
    });
  }

  async update(tenantId: string, actorId: string, estimateId: string, input: UpdateEstimateInput) {
    return withTenant(this.db, tenantId, async (tx) => {
      const estimate = await tx.query.estimates.findFirst({ where: eq(estimates.id, estimateId) });
      if (!estimate) throw new EstimateNotFoundError();

      const [updated] = await tx
        .update(estimates)
        .set({ ...input, updatedBy: actorId })
        .where(eq(estimates.id, estimateId))
        .returning();

      await this.recomputeTotals(tx, estimateId);

      await this.outbox.append(tx, {
        tenantId,
        eventType: "estimate.updated.v1",
        dedupeKey: `estimate.updated.v1:${estimateId}:${updated!.updatedSeq}`,
        actorId,
        payload: {
          companyId: tenantId,
          projectId: estimate.projectId!,
          estimateId,
          changedFields: Object.keys(input),
        },
      });

      return tx.query.estimates.findFirst({ where: eq(estimates.id, estimateId) });
    });
  }

  // database.md §10: "totals ... recomputed from lines on every mutation in
  // the same transaction." subtotal is the cost-basis sum of lines; total
  // applies overhead -> contingency -> markup (profit) -> tax as a
  // sequential cascade on top of that subtotal (each step rounded to 2dp,
  // matching the NUMERIC(14,2) column it represents). Per-line
  // unit_price_amount overrides are informational only and are not summed
  // in here — see estimate_lines' schema comment.
  async recomputeTotals(tx: Database, estimateId: string): Promise<void> {
    const [subtotalRow] = await tx
      .select({ subtotal: sql<string>`coalesce(sum(${estimateLines.totalCostAmount}), 0)` })
      .from(estimateLines)
      .where(and(eq(estimateLines.estimateId, estimateId), isNull(estimateLines.deletedAt)));
    const subtotal = subtotalRow!.subtotal;

    const estimate = await tx.query.estimates.findFirst({ where: eq(estimates.id, estimateId) });
    if (!estimate) throw new EstimateNotFoundError();

    let running = Number(subtotal);
    for (const pct of [estimate.overheadPct, estimate.contingencyPct, estimate.markupPct, estimate.taxPct]) {
      running = Math.round(running * (1 + Number(pct) / 100) * 100) / 100;
    }

    await tx
      .update(estimates)
      .set({ subtotalAmount: Number(subtotal).toFixed(2), totalAmount: running.toFixed(2) })
      .where(eq(estimates.id, estimateId));
  }
}
