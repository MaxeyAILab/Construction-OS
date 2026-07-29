import { Inject, Injectable, Logger } from "@nestjs/common";
import { and, desc, eq, gte } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import { equipment, equipmentFaultAlerts, equipmentInspections } from "../../../infrastructure/db/schema";
import { AiGatewayService } from "../../ai";
import { OutboxService } from "../../events";

const MODEL = "claude-sonnet-5";
const MAX_TOKENS = 200;

// Documented assumptions (not specified anywhere in the docs) — same
// "sensible default, no provisioning required" precedent as
// EquipmentInsightsService's own IDLE_THRESHOLD_DAYS/UTILIZATION_WINDOW_DAYS.
const WINDOW_DAYS = 180;
const MIN_FAILED_INSPECTIONS = 2;
const NO_PATTERN_MARKER = "NONE";

const SYSTEM_PROMPT =
  `You are a construction equipment maintenance analyst. You will be given a chronological list of dated notes from an asset's FAILED inspections. Decide whether they describe a genuine recurring or worsening fault (e.g. the same component failing repeatedly) rather than a coincidence of unrelated one-off issues. If there is a real recurring pattern, respond with one concise sentence naming the affected component/system and the pattern. If the notes do not show a real recurring pattern, respond with exactly "${NO_PATTERN_MARKER}". Reason only from the notes given — never invent a cause they don't support.`;

// ai-spec.md §7.6 (Equipment AI, M11) / FR-EQ-4 "fault patterns" — the one
// predictive-maintenance capability equipment-insights.service.ts's doc
// comment flagged as deferred. Triggered by
// EquipmentFaultAlertsWriterService off equipment_inspection.created.v1
// (passed=false) — same "rule pre-filters, AI judges" split as every
// other AI-enrichment feature, except here the AI's judgment (is this
// really a recurring fault?) *is* the fact being detected, not narration
// on top of one, so there is no fallback alert when the call fails or
// returns "no pattern" — see the schema file's doc comment.
@Injectable()
export class EquipmentFaultAlertsService {
  private readonly logger = new Logger(EquipmentFaultAlertsService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly aiGateway: AiGatewayService,
    private readonly outbox: OutboxService,
  ) {}

  async checkEquipment(tenantId: string, equipmentId: string): Promise<void> {
    const windowStart = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);

    const failedInspections = await withTenant(this.db, tenantId, (tx) =>
      tx.query.equipmentInspections.findMany({
        where: and(
          eq(equipmentInspections.equipmentId, equipmentId),
          eq(equipmentInspections.passed, false),
          gte(equipmentInspections.inspectionDate, windowStart),
        ),
        orderBy: [desc(equipmentInspections.inspectionDate)],
      }),
    );
    if (failedInspections.length < MIN_FAILED_INSPECTIONS) return;

    const latest = failedInspections[0]!;
    const alreadyAlerted = await withTenant(this.db, tenantId, (tx) =>
      tx.query.equipmentFaultAlerts.findFirst({
        where: and(eq(equipmentFaultAlerts.equipmentId, equipmentId), eq(equipmentFaultAlerts.latestInspectionId, latest.id)),
      }),
    );
    if (alreadyAlerted) return;

    let description: string;
    let aiRunId: string;
    try {
      const notes = [...failedInspections]
        .reverse()
        .map((row) => `${row.inspectionDate}: ${row.notes?.trim() || "(no notes recorded)"}`)
        .join("\n");

      const result = await this.aiGateway.run(tenantId, null, {
        purpose: "equipment.fault_pattern_detection",
        model: MODEL,
        systemPrompt: SYSTEM_PROMPT,
        userPrompt: `Failed inspection notes for this asset, oldest first:\n${notes}`,
        maxTokens: MAX_TOKENS,
      });

      const content = result.content?.trim();
      if (!content || content.toUpperCase() === NO_PATTERN_MARKER) return;
      description = content;
      aiRunId = result.aiRunId;
    } catch (err) {
      this.logger.warn(`fault-pattern check failed for equipment ${equipmentId} (tenant ${tenantId}), no alert raised: ${err}`);
      return;
    }

    await withTenant(this.db, tenantId, async (tx) => {
      const [created] = await tx
        .insert(equipmentFaultAlerts)
        .values({
          tenantId,
          equipmentId,
          failedInspectionCount: failedInspections.length,
          windowDays: WINDOW_DAYS,
          description,
          aiRunId,
          latestInspectionId: latest.id,
        })
        .returning();

      await this.outbox.append(tx, {
        tenantId,
        eventType: "equipment_fault_alert.raised.v1",
        dedupeKey: `equipment_fault_alert.raised.v1:${created!.id}`,
        actorId: null,
        actorType: "system",
        payload: {
          companyId: tenantId,
          equipmentId,
          equipmentFaultAlertId: created!.id,
          failedInspectionCount: failedInspections.length,
          aiRunId,
        },
      });
    });
  }

  // Read side for EquipmentInsightsService — the most recent alert per
  // equipment (an append-only log can carry several over time as new
  // failures extend the same or a new pattern; only the latest is a
  // "current" insight).
  async listLatestByEquipment(tenantId: string): Promise<Map<string, EquipmentFaultAlertWithAsset>> {
    return withTenant(this.db, tenantId, async (tx) => {
      const rows = await tx
        .select({ alert: equipmentFaultAlerts, assetNo: equipment.assetNo, name: equipment.name })
        .from(equipmentFaultAlerts)
        .innerJoin(equipment, eq(equipment.id, equipmentFaultAlerts.equipmentId))
        .orderBy(desc(equipmentFaultAlerts.createdAt));

      const latestByEquipment = new Map<string, EquipmentFaultAlertWithAsset>();
      for (const row of rows) {
        if (!latestByEquipment.has(row.alert.equipmentId)) {
          latestByEquipment.set(row.alert.equipmentId, { ...row.alert, assetNo: row.assetNo, name: row.name });
        }
      }
      return latestByEquipment;
    });
  }
}

export type EquipmentFaultAlertWithAsset = typeof equipmentFaultAlerts.$inferSelect & { assetNo: string; name: string };
