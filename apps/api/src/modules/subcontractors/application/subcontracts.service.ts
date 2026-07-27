import { Inject, Injectable } from "@nestjs/common";
import type { CreateSubcontractInput, CreateSubcontractLineInput, ListSubcontractsQuery } from "@constructionos/schemas";
import { and, desc, eq, isNull, lt, or, type SQL } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import {
  budgetLines,
  budgets,
  commitments,
  costCodes,
  projects,
  subcontractLines,
  subcontracts,
} from "../../../infrastructure/db/schema";
import { OutboxService } from "../../events";
import {
  CostCodeNotOnProjectError,
  NoActiveBudgetForProjectError,
  ProjectNotFoundError,
  SubcontractAlreadyApprovedError,
  SubcontractIllegalTransitionError,
  SubcontractNotFoundError,
} from "../domain/errors";
import { SubcontractorsService } from "./subcontractors.service";

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

// database.md §17 (M14): "Contract per project/sub ... approval creates
// commitments (mirror of PO flow, FR-SUB-3)."
@Injectable()
export class SubcontractsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly outbox: OutboxService,
    private readonly subcontractors: SubcontractorsService,
  ) {}

  async listForProject(tenantId: string, projectId: string, query: ListSubcontractsQuery) {
    return withTenant(this.db, tenantId, async (tx) => {
      const conditions: SQL[] = [eq(subcontracts.projectId, projectId), isNull(subcontracts.deletedAt)];
      if (query.subcontractorId) conditions.push(eq(subcontracts.subcontractorId, query.subcontractorId));
      if (query.status) conditions.push(eq(subcontracts.status, query.status));
      if (query.cursor) {
        const c = decodeCursor(query.cursor);
        conditions.push(
          or(
            lt(subcontracts.createdAt, new Date(c.createdAt)),
            and(eq(subcontracts.createdAt, new Date(c.createdAt)), lt(subcontracts.id, c.id))!,
          )!,
        );
      }

      const rows = await tx.query.subcontracts.findMany({
        where: and(...conditions),
        orderBy: [desc(subcontracts.createdAt), desc(subcontracts.id)],
        limit: query.limit + 1,
      });

      const hasMore = rows.length > query.limit;
      const page = rows.slice(0, query.limit);
      const last = page.at(-1);
      const nextCursor = hasMore && last ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id }) : null;

      return { data: page, meta: { cursor: nextCursor, hasMore } };
    });
  }

  async getById(tenantId: string, id: string) {
    return withTenant(this.db, tenantId, async (tx) => {
      const subcontract = await this.requireSubcontract(tx, id);
      const lines = await tx.query.subcontractLines.findMany({
        where: and(eq(subcontractLines.subcontractId, id), isNull(subcontractLines.deletedAt)),
      });
      return { ...subcontract, lines };
    });
  }

  // FR-SUB-2: eligibility gated at the point a subcontractor is actually
  // engaged on a contract (not merely invited to bid).
  async create(tenantId: string, actorId: string, projectId: string, input: CreateSubcontractInput) {
    await this.subcontractors.requireEligible(tenantId, input.subcontractorId);

    return withTenant(this.db, tenantId, async (tx) => {
      const project = await tx.query.projects.findFirst({ where: eq(projects.id, projectId) });
      if (!project) throw new ProjectNotFoundError();
      await this.subcontractors.requireSubcontractor(tx, input.subcontractorId);

      const [created] = await tx
        .insert(subcontracts)
        .values({
          tenantId,
          projectId,
          subcontractorId: input.subcontractorId,
          scope: input.scope,
          retainagePct: input.retainagePct,
          createdBy: actorId,
        })
        .returning();
      const subcontract = created!;

      await this.outbox.append(tx, {
        tenantId,
        eventType: "subcontract.created.v1",
        dedupeKey: `subcontract.created.v1:${subcontract.id}`,
        actorId,
        payload: { companyId: tenantId, projectId, subcontractId: subcontract.id, subcontractorId: input.subcontractorId },
      });

      return subcontract;
    });
  }

  async addLine(tenantId: string, actorId: string, subcontractId: string, input: CreateSubcontractLineInput) {
    return withTenant(this.db, tenantId, async (tx) => {
      const subcontract = await this.requireSubcontract(tx, subcontractId);
      const costCode = await tx.query.costCodes.findFirst({
        where: and(eq(costCodes.id, input.costCodeId), eq(costCodes.projectId, subcontract.projectId)),
      });
      if (!costCode) throw new CostCodeNotOnProjectError();

      const [created] = await tx
        .insert(subcontractLines)
        .values({
          tenantId,
          subcontractId,
          costCodeId: input.costCodeId,
          description: input.description,
          amount: input.amount,
          createdBy: actorId,
        })
        .returning();

      return created!;
    });
  }

  async submit(tenantId: string, actorId: string, id: string) {
    return this.transition(tenantId, actorId, id, "draft", "pending_approval");
  }

  // Gap-fill: 'void' is a documented status value (database.md §17) with
  // no dedicated api.md entry point of its own — same "the enum requires
  // it, so gap-fill it" precedent as ChangeOrderLifecycleService's
  // reject/void.
  async void(tenantId: string, actorId: string, id: string) {
    return withTenant(this.db, tenantId, async (tx) => {
      const subcontract = await this.requireSubcontract(tx, id);
      if (subcontract.status === "approved") throw new SubcontractAlreadyApprovedError();

      const [updated] = await tx
        .update(subcontracts)
        .set({ status: "void", updatedBy: actorId })
        .where(eq(subcontracts.id, id))
        .returning();
      return updated!;
    });
  }

  // FR-SUB-3: "approval creates commitments (mirror of PO flow)" — one
  // commitments row per cost code represented on the subcontract's lines
  // (grouped/summed, since commitments has a single cost_code_id per
  // row), writing directly to budgets/budget_lines via the shared schema
  // import rather than calling BudgetService — same cross-module-
  // atomicity justification as PurchaseOrderLifecycleService.approve().
  async approve(tenantId: string, actorId: string, id: string) {
    return withTenant(this.db, tenantId, async (tx) => {
      const subcontract = await this.requireSubcontract(tx, id);
      if (subcontract.status !== "pending_approval") throw new SubcontractIllegalTransitionError("pending_approval");

      const budget = await tx.query.budgets.findFirst({
        where: and(eq(budgets.projectId, subcontract.projectId), eq(budgets.status, "active")),
      });
      if (!budget) throw new NoActiveBudgetForProjectError();

      const lines = await tx.query.subcontractLines.findMany({
        where: and(eq(subcontractLines.subcontractId, id), isNull(subcontractLines.deletedAt)),
      });

      const totalsByCostCode = new Map<string, number>();
      for (const line of lines) {
        const current = totalsByCostCode.get(line.costCodeId) ?? 0;
        totalsByCostCode.set(line.costCodeId, current + Number(line.amount));
      }

      for (const [costCodeId, amount] of totalsByCostCode) {
        const amountStr = amount.toFixed(2);
        await tx.insert(commitments).values({
          tenantId,
          projectId: subcontract.projectId,
          costCodeId,
          kind: "subcontract",
          sourceId: subcontract.id,
          amount: amountStr,
          status: "active",
          createdBy: actorId,
        });

        const existingLine = await tx.query.budgetLines.findFirst({
          where: and(eq(budgetLines.budgetId, budget.id), eq(budgetLines.costCodeId, costCodeId)),
        });
        if (existingLine) {
          const newCommitted = (Number(existingLine.committedAmount) + amount).toFixed(2);
          await tx
            .update(budgetLines)
            .set({ committedAmount: newCommitted, updatedBy: actorId })
            .where(eq(budgetLines.id, existingLine.id));
        }
      }

      const [updated] = await tx
        .update(subcontracts)
        .set({ status: "approved", updatedBy: actorId })
        .where(eq(subcontracts.id, id))
        .returning();

      await this.outbox.append(tx, {
        tenantId,
        eventType: "subcontract.approved.v1",
        dedupeKey: `subcontract.approved.v1:${id}`,
        actorId,
        payload: { companyId: tenantId, projectId: subcontract.projectId, subcontractId: id },
      });

      return updated!;
    });
  }

  private async transition(tenantId: string, actorId: string, id: string, from: string, to: string) {
    return withTenant(this.db, tenantId, async (tx) => {
      const subcontract = await this.requireSubcontract(tx, id);
      if (subcontract.status !== from) throw new SubcontractIllegalTransitionError(from);

      const [updated] = await tx
        .update(subcontracts)
        .set({ status: to, updatedBy: actorId })
        .where(eq(subcontracts.id, id))
        .returning();
      return updated!;
    });
  }

  private async requireSubcontract(tx: Database, id: string) {
    const row = await tx.query.subcontracts.findFirst({
      where: and(eq(subcontracts.id, id), isNull(subcontracts.deletedAt)),
    });
    if (!row) throw new SubcontractNotFoundError();
    return row;
  }
}
