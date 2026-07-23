import { Inject, Injectable } from "@nestjs/common";
import type {
  CreateEquipmentInspectionInput,
  CreateMaintenanceScheduleInput,
  CreateMaintenanceWorkOrderInput,
  UpdateMaintenanceWorkOrderInput,
} from "@constructionos/schemas";
import { and, eq, gte, sum } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import {
  equipmentInspections,
  equipmentUsageLogs,
  maintenanceSchedules,
  maintenanceWorkOrders,
} from "../../../infrastructure/db/schema";
import { OutboxService } from "../../events";
import { MaintenanceScheduleNotFoundError, MaintenanceWorkOrderNotFoundError } from "../domain/errors";
import { EquipmentService } from "./equipment.service";

export type MaintenanceDueStatus = "ok" | "due_soon" | "overdue";

// database.md §13 / FR-EQ-3: "due-state projection feeds reminders."
// Computed on read from last_service_*/recurrence_value — same "no
// reconciliation job, plain read is always exact" reasoning as
// budget_lines' live-margin view. `days` schedules compare against the
// calendar; `hours` schedules sum equipment_usage_logs.hours logged since
// last_service_date (there's no running hour-meter column — usage logs
// are the only source of truth for accumulated hours).
const DUE_SOON_FRACTION = 0.1;

@Injectable()
export class MaintenanceService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly outbox: OutboxService,
    private readonly equipmentService: EquipmentService,
  ) {}

  async listSchedules(tenantId: string, equipmentId: string) {
    return withTenant(this.db, tenantId, async (tx) => {
      const schedules = await tx.query.maintenanceSchedules.findMany({
        where: eq(maintenanceSchedules.equipmentId, equipmentId),
        orderBy: (t, { desc }) => [desc(t.createdAt)],
      });

      return Promise.all(schedules.map((schedule) => this.withDueState(tx, schedule)));
    });
  }

  async createSchedule(tenantId: string, actorId: string, equipmentId: string, input: CreateMaintenanceScheduleInput) {
    return withTenant(this.db, tenantId, async (tx) => {
      await this.equipmentService.requireEquipment(tx, equipmentId);

      const [created] = await tx
        .insert(maintenanceSchedules)
        .values({
          tenantId,
          equipmentId,
          name: input.name,
          recurrenceType: input.recurrenceType,
          recurrenceValue: input.recurrenceValue,
          lastServiceDate: input.lastServiceDate,
          lastServiceHours: input.lastServiceHours,
          createdBy: actorId,
        })
        .returning();

      await this.outbox.append(tx, {
        tenantId,
        eventType: "maintenance_schedule.created.v1",
        dedupeKey: `maintenance_schedule.created.v1:${created!.id}`,
        actorId,
        payload: { companyId: tenantId, equipmentId, maintenanceScheduleId: created!.id },
      });

      return created!;
    });
  }

  async listWorkOrders(tenantId: string, equipmentId: string) {
    return withTenant(this.db, tenantId, (tx) =>
      tx.query.maintenanceWorkOrders.findMany({
        where: eq(maintenanceWorkOrders.equipmentId, equipmentId),
        orderBy: (t, { desc }) => [desc(t.createdAt)],
      }),
    );
  }

  async createWorkOrder(tenantId: string, actorId: string, equipmentId: string, input: CreateMaintenanceWorkOrderInput) {
    return withTenant(this.db, tenantId, async (tx) => {
      await this.equipmentService.requireEquipment(tx, equipmentId);
      if (input.maintenanceScheduleId) {
        await this.requireSchedule(tx, equipmentId, input.maintenanceScheduleId);
      }

      const [created] = await tx
        .insert(maintenanceWorkOrders)
        .values({
          tenantId,
          equipmentId,
          maintenanceScheduleId: input.maintenanceScheduleId,
          description: input.description,
          costAllocation: input.costAllocation,
          projectId: input.projectId,
          costCodeId: input.costCodeId,
          createdBy: actorId,
        })
        .returning();

      await this.outbox.append(tx, {
        tenantId,
        eventType: "maintenance_work_order.created.v1",
        dedupeKey: `maintenance_work_order.created.v1:${created!.id}`,
        actorId,
        payload: { companyId: tenantId, equipmentId, maintenanceWorkOrderId: created!.id },
      });

      return created!;
    });
  }

  // FR-EQ-3: completing a work order rolls its linked schedule forward —
  // no separate lifecycle action (unlike PO/change-order approvals), a
  // simple status field transition is all the spec calls for here.
  async updateWorkOrder(
    tenantId: string,
    actorId: string,
    equipmentId: string,
    workOrderId: string,
    input: UpdateMaintenanceWorkOrderInput,
  ) {
    return withTenant(this.db, tenantId, async (tx) => {
      const existing = await this.requireWorkOrder(tx, equipmentId, workOrderId);
      const completingNow = input.status === "completed" && existing.status !== "completed";

      const [updated] = await tx
        .update(maintenanceWorkOrders)
        .set({
          ...input,
          completedAt: completingNow ? new Date() : existing.completedAt,
          updatedBy: actorId,
        })
        .where(eq(maintenanceWorkOrders.id, workOrderId))
        .returning();

      if (completingNow && existing.maintenanceScheduleId) {
        const today = new Date().toISOString().slice(0, 10);
        const rows = await tx
          .select({ total: sum(equipmentUsageLogs.hours) })
          .from(equipmentUsageLogs)
          .where(eq(equipmentUsageLogs.equipmentId, equipmentId));

        await tx
          .update(maintenanceSchedules)
          .set({ lastServiceDate: today, lastServiceHours: rows[0]?.total ?? undefined, updatedBy: actorId })
          .where(eq(maintenanceSchedules.id, existing.maintenanceScheduleId));
      }

      await this.outbox.append(tx, {
        tenantId,
        eventType: "maintenance_work_order.updated.v1",
        dedupeKey: `maintenance_work_order.updated.v1:${workOrderId}:${Date.now()}`,
        actorId,
        payload: {
          companyId: tenantId,
          equipmentId,
          maintenanceWorkOrderId: workOrderId,
          changedFields: Object.keys(input),
        },
      });

      return updated!;
    });
  }

  async listInspections(tenantId: string, equipmentId: string) {
    return withTenant(this.db, tenantId, (tx) =>
      tx.query.equipmentInspections.findMany({
        where: eq(equipmentInspections.equipmentId, equipmentId),
        orderBy: (t, { desc }) => [desc(t.inspectionDate), desc(t.createdAt)],
      }),
    );
  }

  async createInspection(tenantId: string, actorId: string, equipmentId: string, input: CreateEquipmentInspectionInput) {
    return withTenant(this.db, tenantId, async (tx) => {
      await this.equipmentService.requireEquipment(tx, equipmentId);

      const [created] = await tx
        .insert(equipmentInspections)
        .values({
          tenantId,
          equipmentId,
          inspectorId: input.inspectorId,
          inspectionDate: input.inspectionDate,
          checklist: input.checklist,
          passed: input.passed,
          notes: input.notes,
          createdBy: actorId,
        })
        .returning();

      await this.outbox.append(tx, {
        tenantId,
        eventType: "equipment_inspection.created.v1",
        dedupeKey: `equipment_inspection.created.v1:${created!.id}`,
        actorId,
        payload: { companyId: tenantId, equipmentId, equipmentInspectionId: created!.id, passed: created!.passed },
      });

      return created!;
    });
  }

  private async requireSchedule(tx: Database, equipmentId: string, id: string) {
    const row = await tx.query.maintenanceSchedules.findFirst({
      where: and(eq(maintenanceSchedules.id, id), eq(maintenanceSchedules.equipmentId, equipmentId)),
    });
    if (!row) throw new MaintenanceScheduleNotFoundError();
    return row;
  }

  private async requireWorkOrder(tx: Database, equipmentId: string, id: string) {
    const row = await tx.query.maintenanceWorkOrders.findFirst({
      where: and(eq(maintenanceWorkOrders.id, id), eq(maintenanceWorkOrders.equipmentId, equipmentId)),
    });
    if (!row) throw new MaintenanceWorkOrderNotFoundError();
    return row;
  }

  private async withDueState(tx: Database, schedule: typeof maintenanceSchedules.$inferSelect) {
    if (schedule.recurrenceType === "days") {
      if (!schedule.lastServiceDate) {
        return { ...schedule, dueState: "overdue" as MaintenanceDueStatus, sinceValue: null };
      }
      const daysSince = Math.floor((Date.now() - new Date(schedule.lastServiceDate).getTime()) / 86_400_000);
      const remaining = schedule.recurrenceValue - daysSince;
      return { ...schedule, dueState: this.classify(remaining, schedule.recurrenceValue), sinceValue: daysSince };
    }

    if (!schedule.lastServiceDate) {
      return { ...schedule, dueState: "overdue" as MaintenanceDueStatus, sinceValue: null };
    }
    const rows = await tx
      .select({ total: sum(equipmentUsageLogs.hours) })
      .from(equipmentUsageLogs)
      .where(
        and(eq(equipmentUsageLogs.equipmentId, schedule.equipmentId), gte(equipmentUsageLogs.workDate, schedule.lastServiceDate)),
      );
    const hoursSince = Number(rows[0]?.total ?? 0);
    const remaining = schedule.recurrenceValue - hoursSince;
    return { ...schedule, dueState: this.classify(remaining, schedule.recurrenceValue), sinceValue: hoursSince };
  }

  private classify(remaining: number, recurrenceValue: number): MaintenanceDueStatus {
    if (remaining <= 0) return "overdue";
    if (remaining <= recurrenceValue * DUE_SOON_FRACTION) return "due_soon";
    return "ok";
  }
}
