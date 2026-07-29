import { Inject, Injectable } from "@nestjs/common";
import type {
  EquipmentInsight,
  EquipmentInsightRecommendation,
  EquipmentInsightsResponse,
  EquipmentOwnership,
  FaultPatternInsight,
  IdleAssetInsight,
  MaintenanceDueInsight,
  RentVsBuyInsight,
} from "@constructionos/schemas";
import { and, desc, eq, gte, inArray, isNull, sum } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import { equipment, equipmentUsageLogs } from "../../../infrastructure/db/schema";
import { EquipmentFaultAlertsService } from "./equipment-fault-alerts.service";
import { MaintenanceService } from "./maintenance.service";

// ai-spec.md §7.6 (Equipment AI, M11) / FR-EQ-4. api.md §11: "GET
// /equipment/ai/insights | Idle assets, predictive maintenance,
// rent-vs-buy." idle_asset/maintenance_due/rent_vs_buy are a pure
// deterministic feed with no AI Gateway call — see the schema doc comment
// (packages/schemas/src/equipment.ts) for the "recommendations list"
// precedent this follows (procurement's recommendations feed, inventory's
// reorder-suggestions). fault_pattern instead reads persisted
// equipment_fault_alerts rows (EquipmentFaultAlertsService) — the one
// insight kind an actual AI Gateway call produces.
//
// Thresholds below are documented assumptions (not specified anywhere in
// the docs) — same "sensible default, no provisioning required" precedent
// as ProcurementNeedsService's BUFFER_DAYS/DEFAULT_LEAD_TIME_DAYS.
const IDLE_THRESHOLD_DAYS = 7;
const UTILIZATION_WINDOW_DAYS = 30;
const STANDARD_WORKDAY_HOURS = 8;
const BUY_THRESHOLD_PCT = 60;
const RETURN_THRESHOLD_PCT = 15;

@Injectable()
export class EquipmentInsightsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly maintenanceService: MaintenanceService,
    private readonly faultAlerts: EquipmentFaultAlertsService,
  ) {}

  async listInsights(tenantId: string): Promise<EquipmentInsightsResponse> {
    const [maintenanceDue, idleAssets, rentVsBuy, faultPatterns] = await Promise.all([
      this.maintenanceDueInsights(tenantId),
      this.idleAssetInsights(tenantId),
      this.rentVsBuyInsights(tenantId),
      this.faultPatternInsights(tenantId),
    ]);

    const insights: EquipmentInsight[] = [...maintenanceDue, ...idleAssets, ...rentVsBuy, ...faultPatterns];
    return { insights };
  }

  private async faultPatternInsights(tenantId: string): Promise<FaultPatternInsight[]> {
    const latestByEquipment = await this.faultAlerts.listLatestByEquipment(tenantId);
    return Array.from(latestByEquipment.values()).map((alert) => ({
      kind: "fault_pattern" as const,
      equipmentId: alert.equipmentId,
      assetNo: alert.assetNo,
      name: alert.name,
      description: alert.description,
      failedInspectionCount: alert.failedInspectionCount,
      windowDays: alert.windowDays,
    }));
  }

  // FR-EQ-3's due-state projection (MaintenanceService.listAllDueStates)
  // reused as-is, filtered to what's actionable — same "usage-hours vs
  // service intervals" signal ai-spec §7.6 calls "predictive maintenance",
  // without inventing a separate computation.
  private async maintenanceDueInsights(tenantId: string): Promise<MaintenanceDueInsight[]> {
    const rows = await this.maintenanceService.listAllDueStates(tenantId);
    return rows
      .filter((row) => row.dueState === "due_soon" || row.dueState === "overdue")
      .map((row) => ({
        kind: "maintenance_due" as const,
        equipmentId: row.equipmentId,
        assetNo: row.equipmentAssetNo,
        name: row.equipmentName,
        maintenanceScheduleId: row.id,
        scheduleName: row.name,
        dueState: row.dueState as "due_soon" | "overdue",
        recurrenceType: row.recurrenceType as "hours" | "days",
        remaining: row.sinceValue === null ? 0 : row.recurrenceValue - row.sinceValue,
      }));
  }

  // status === 'available' is the reliable "not currently assigned" signal
  // (EquipmentAssignmentsService.create/end are the only writers of
  // equipment.status). idleDays is measured from the most recent usage log
  // (or, if the asset has never logged hours, from when it was registered).
  private async idleAssetInsights(tenantId: string): Promise<IdleAssetInsight[]> {
    return withTenant(this.db, tenantId, async (tx) => {
      const available = await tx.query.equipment.findMany({
        where: and(eq(equipment.status, "available"), isNull(equipment.deletedAt)),
      });
      if (available.length === 0) return [];

      const availableIds = available.map((item) => item.id);
      const usageRows = await tx
        .select({
          equipmentId: equipmentUsageLogs.equipmentId,
          workDate: equipmentUsageLogs.workDate,
          projectId: equipmentUsageLogs.projectId,
        })
        .from(equipmentUsageLogs)
        .where(inArray(equipmentUsageLogs.equipmentId, availableIds))
        .orderBy(desc(equipmentUsageLogs.workDate));

      // First row per equipment (in desc order) is its most recent usage.
      const lastUsageByEquipment = new Map<string, { workDate: string; projectId: string | null }>();
      for (const row of usageRows) {
        if (!lastUsageByEquipment.has(row.equipmentId)) {
          lastUsageByEquipment.set(row.equipmentId, { workDate: row.workDate, projectId: row.projectId });
        }
      }

      const now = Date.now();
      const insights: IdleAssetInsight[] = [];
      for (const item of available) {
        const lastUsage = lastUsageByEquipment.get(item.id);
        const sinceDate = lastUsage ? new Date(`${lastUsage.workDate}T00:00:00Z`) : item.createdAt;
        const idleDays = Math.floor((now - sinceDate.getTime()) / 86_400_000);
        if (idleDays < IDLE_THRESHOLD_DAYS) continue;

        insights.push({
          kind: "idle_asset",
          equipmentId: item.id,
          assetNo: item.assetNo,
          name: item.name,
          ownership: item.ownership as EquipmentOwnership,
          idleDays,
          lastProjectId: lastUsage?.projectId ?? null,
          suggestedAction: item.ownership === "owned" ? "reassign" : "return",
        });
      }
      return insights;
    });
  }

  // Owned equipment has no rent/lease payment to weigh against buying, so
  // this analysis only applies to rented/leased assets (ai-spec §7.6:
  // "rent-vs-buy analysis from utilization history").
  private async rentVsBuyInsights(tenantId: string): Promise<RentVsBuyInsight[]> {
    return withTenant(this.db, tenantId, async (tx) => {
      const rentedOrLeased = await tx.query.equipment.findMany({
        where: and(inArray(equipment.ownership, ["rented", "leased"]), isNull(equipment.deletedAt)),
      });
      if (rentedOrLeased.length === 0) return [];

      const ids = rentedOrLeased.map((item) => item.id);
      const windowStart = new Date(Date.now() - UTILIZATION_WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);
      const hoursRows = await tx
        .select({ equipmentId: equipmentUsageLogs.equipmentId, totalHours: sum(equipmentUsageLogs.hours) })
        .from(equipmentUsageLogs)
        .where(and(inArray(equipmentUsageLogs.equipmentId, ids), gte(equipmentUsageLogs.workDate, windowStart)))
        .groupBy(equipmentUsageLogs.equipmentId);
      const hoursByEquipment = new Map(hoursRows.map((row) => [row.equipmentId, Number(row.totalHours ?? 0)]));

      const capacityHours = UTILIZATION_WINDOW_DAYS * STANDARD_WORKDAY_HOURS;
      return rentedOrLeased.map((item) => {
        const hoursUsed = hoursByEquipment.get(item.id) ?? 0;
        const utilizationPct = Math.round((hoursUsed / capacityHours) * 1000) / 10;
        return {
          kind: "rent_vs_buy" as const,
          equipmentId: item.id,
          assetNo: item.assetNo,
          name: item.name,
          ownership: item.ownership as "rented" | "leased",
          utilizationPct,
          windowDays: UTILIZATION_WINDOW_DAYS,
          recommendation: recommendationFor(utilizationPct),
        };
      });
    });
  }
}

function recommendationFor(utilizationPct: number): EquipmentInsightRecommendation {
  if (utilizationPct >= BUY_THRESHOLD_PCT) return "consider_buying";
  if (utilizationPct <= RETURN_THRESHOLD_PCT) return "consider_returning";
  return "monitor";
}
