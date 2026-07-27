import { Inject, Injectable } from "@nestjs/common";
import type { DraftFromNeedsResponse, ProcurementNeed, ProcurementNeedRiskLevel } from "@constructionos/schemas";
import { and, desc, eq, isNull, notInArray } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import { costCodes, purchaseOrderLines, purchaseOrders, suppliers } from "../../../infrastructure/db/schema";
import { AiGatewayService } from "../../ai";
import { BudgetService } from "../../budgets";
import { SchedulesService } from "../../scheduling";
import { PurchaseOrdersService } from "./purchase-orders.service";

const MODEL = "claude-sonnet-5";
const MAX_TOKENS = 300;

// ai-spec.md §7.4: "buy-timing recommendations (schedule need date − lead
// time − buffer)." Neither the buffer nor a no-history lead-time default
// is specified anywhere in the docs — documented assumptions, same
// "sensible default, no provisioning required" precedent as AI Gateway's
// DEFAULT_MONTHLY_LIMIT_USD.
const BUFFER_DAYS = 5;
const DEFAULT_LEAD_TIME_DAYS = 14;

const CLOSED_PO_STATUSES = ["cancelled", "closed"];

const RATIONALE_SYSTEM_PROMPT =
  "You are a construction procurement analyst. Given a list of cost codes with upcoming, unordered material needs (need date, urgency, remaining budget), write a concise 2-3 sentence rationale for why these purchase orders are being drafted now. Reason only from the data given.";

// ai-spec.md §7.4 (Procurement AI, M5) / FR-PROC-5/FR-PROC-6. The buy-
// timing computation itself is deterministic (schedule_activities.cost_code_id
// + start_date vs budget_lines' remaining balance vs this tenant's own PO
// history for that cost code) — no model call, same "the rule is the
// authoritative signal" split as MarginErosionService. The AI Gateway is
// only used in draftFromNeeds() for a best-effort natural-language
// rationale (FR-PROC-5: "...with reasoning"); a failed/degraded call never
// blocks drafting the POs themselves, since the money/dates are already
// fully determined without it.
//
// Deliberately narrower than ai-spec §7.4's full capability list: price
// benchmarking and delivery-risk alerts are flagged follow-ups, not built
// this pass (see SupplierScoringService for the related supplier-scoring
// deferral).
@Injectable()
export class ProcurementNeedsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly schedulesService: SchedulesService,
    private readonly budgetService: BudgetService,
    private readonly purchaseOrdersService: PurchaseOrdersService,
    private readonly aiGateway: AiGatewayService,
  ) {}

  // Reuses SchedulesService.getActiveSchedule()'s own schedule.read
  // authorization as an additional gate beyond the controller's
  // procurement.po.* check — same "compose, don't duplicate" precedent as
  // LookaheadService.
  async computeNeeds(tenantId: string, actorId: string, projectId: string): Promise<ProcurementNeed[]> {
    const { activities } = await this.schedulesService.getActiveSchedule(tenantId, actorId, projectId);

    const budgetLinesByCostCode = new Map<string, { revisedAmount: string; committedAmount: string }>();
    try {
      const budget = await this.budgetService.getByProject(tenantId, projectId);
      for (const line of budget.lines) {
        budgetLinesByCostCode.set(line.costCodeId, { revisedAmount: line.revisedAmount!, committedAmount: line.committedAmount });
      }
    } catch {
      return []; // no active budget yet — nothing to draft against (database.md §14: schedule_activities.cost_code_id NULL is common pre-budget)
    }

    // One need per cost code — the earliest activity start date "wins" as
    // the need-by date when several activities share a cost code.
    const byCostCode = new Map<string, { activityId: string; activityName: string; needByDate: string }>();
    for (const activity of activities) {
      if (!activity.costCodeId || !activity.startDate) continue;
      if (activity.actualStartDate) continue; // already underway — assume already sourced
      const existing = byCostCode.get(activity.costCodeId);
      if (!existing || activity.startDate < existing.needByDate) {
        byCostCode.set(activity.costCodeId, {
          activityId: activity.id,
          activityName: activity.name,
          needByDate: activity.startDate,
        });
      }
    }

    const today = new Date().toISOString().slice(0, 10);

    return withTenant(this.db, tenantId, async (tx) => {
      const needs: ProcurementNeed[] = [];

      for (const [costCodeId, info] of byCostCode) {
        const budgetLine = budgetLinesByCostCode.get(costCodeId);
        if (!budgetLine) continue; // no budget line for this cost code yet — nothing to buy against
        const remaining = Number(budgetLine.revisedAmount) - Number(budgetLine.committedAmount);
        if (remaining <= 0) continue;

        if (await this.hasOpenPurchaseOrder(tx, costCodeId)) continue;

        const costCode = await tx.query.costCodes.findFirst({ where: eq(costCodes.id, costCodeId) });
        if (!costCode) continue;

        const [historical] = await tx
          .select({
            supplierId: suppliers.id,
            supplierName: suppliers.name,
            defaultLeadTimeDays: suppliers.defaultLeadTimeDays,
          })
          .from(purchaseOrderLines)
          .innerJoin(purchaseOrders, eq(purchaseOrders.id, purchaseOrderLines.purchaseOrderId))
          .innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
          .where(and(eq(purchaseOrderLines.costCodeId, costCodeId), isNull(purchaseOrderLines.deletedAt)))
          .orderBy(desc(purchaseOrderLines.createdAt))
          .limit(1);

        const leadTimeDays = historical?.defaultLeadTimeDays ?? DEFAULT_LEAD_TIME_DAYS;
        const recommendedOrderByDate = addDays(info.needByDate, -(leadTimeDays + BUFFER_DAYS));
        const daysUntilMustOrder = diffDays(recommendedOrderByDate, today);

        needs.push({
          costCodeId,
          costCodeCode: costCode.code,
          scheduleActivityId: info.activityId,
          activityName: info.activityName,
          needByDate: info.needByDate,
          supplierId: historical?.supplierId ?? null,
          supplierName: historical?.supplierName ?? null,
          leadTimeDays,
          recommendedOrderByDate,
          daysUntilMustOrder,
          riskLevel: riskLevelFor(daysUntilMustOrder),
          remainingBudgetAmount: remaining.toFixed(2),
        });
      }

      return needs.sort((a, b) => a.daysUntilMustOrder - b.daysUntilMustOrder);
    });
  }

  // FR-PROC-6: "auto-draft POs from budget and schedule needs for user
  // approval." Reuses PurchaseOrdersService.create() (status defaults to
  // 'draft') rather than duplicating its validation/numbering/event-
  // emission — same "compose the existing use-case" precedent as every
  // other AI-drafting feature in this codebase never getting its own write
  // path. No per-line quantity signal exists between Scheduling and
  // Procurement (schedule_activities carries no qty/BOM), so each drafted
  // line is qty=1 LS at the cost code's full remaining budget — a
  // documented simplification, not a real takeoff.
  async draftFromNeeds(tenantId: string, actorId: string, projectId: string): Promise<DraftFromNeedsResponse> {
    const needs = await this.computeNeeds(tenantId, actorId, projectId);
    const draftable = needs.filter((n) => n.supplierId);
    const skipped = needs
      .filter((n) => !n.supplierId)
      .map((n) => ({ ...n, reason: "no historical supplier found for this cost code — needs manual sourcing" }));

    const { aiRunId, rationale } = await this.explainDrafting(tenantId, actorId, draftable);

    const draftedPurchaseOrderIds: string[] = [];
    for (const need of draftable) {
      const created = await this.purchaseOrdersService.create(
        tenantId,
        actorId,
        {
          projectId,
          supplierId: need.supplierId!,
          requiredByDate: need.needByDate,
          lines: [
            {
              description: `Auto-drafted from schedule need: ${need.activityName}`,
              costCodeId: need.costCodeId,
              qtyOrdered: "1.000",
              uom: "LS",
              unitCostAmount: Number(need.remainingBudgetAmount).toFixed(4),
            },
          ],
        },
        aiRunId,
      );
      draftedPurchaseOrderIds.push(created.id);
    }

    return { draftedPurchaseOrderIds, skipped, rationale, aiRunId };
  }

  private async explainDrafting(
    tenantId: string,
    actorId: string,
    draftable: ProcurementNeed[],
  ): Promise<{ aiRunId: string | null; rationale: string | null }> {
    if (draftable.length === 0) return { aiRunId: null, rationale: null };

    try {
      const summary = draftable
        .map(
          (n) =>
            `${n.costCodeCode}: needed by ${n.needByDate} (${n.riskLevel}), remaining budget $${n.remainingBudgetAmount}, lead time ${n.leadTimeDays}d`,
        )
        .join("\n");

      const result = await this.aiGateway.run(tenantId, actorId, {
        purpose: "procurement.ai_draft_pos_from_needs",
        model: MODEL,
        systemPrompt: RATIONALE_SYSTEM_PROMPT,
        userPrompt: summary,
        maxTokens: MAX_TOKENS,
      });

      return { aiRunId: result.aiRunId, rationale: result.content?.trim() ?? null };
    } catch {
      // A failed rationale call never blocks drafting the POs — the
      // money/dates are already fully determined without it (same
      // tolerance as MarginErosionService.explainErosion()).
      return { aiRunId: null, rationale: null };
    }
  }

  private async hasOpenPurchaseOrder(tx: Database, costCodeId: string): Promise<boolean> {
    const [row] = await tx
      .select({ id: purchaseOrderLines.id })
      .from(purchaseOrderLines)
      .innerJoin(purchaseOrders, eq(purchaseOrders.id, purchaseOrderLines.purchaseOrderId))
      .where(
        and(
          eq(purchaseOrderLines.costCodeId, costCodeId),
          isNull(purchaseOrderLines.deletedAt),
          notInArray(purchaseOrders.status, CLOSED_PO_STATUSES),
        ),
      )
      .limit(1);
    return !!row;
  }
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function diffDays(isoDateA: string, isoDateB: string): number {
  const a = new Date(`${isoDateA}T00:00:00Z`).getTime();
  const b = new Date(`${isoDateB}T00:00:00Z`).getTime();
  return Math.round((a - b) / 86_400_000);
}

function riskLevelFor(daysUntilMustOrder: number): ProcurementNeedRiskLevel {
  if (daysUntilMustOrder < 0) return "overdue";
  if (daysUntilMustOrder <= 7) return "urgent";
  if (daysUntilMustOrder <= 21) return "upcoming";
  return "planned";
}
