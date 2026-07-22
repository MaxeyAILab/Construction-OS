import { Inject, Injectable } from "@nestjs/common";
import type {
  BatchUpdateScheduleActivitiesInput,
  CreateScheduleActivityInput,
  UpdateScheduleActivityInput,
} from "@constructionos/schemas";
import { and, eq, isNull } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import { scheduleActivities } from "../../../infrastructure/db/schema";
import { OutboxService } from "../../events";
import { ScheduleActivityNotFoundError, VersionConflictError } from "../domain/errors";
import { SchedulesService } from "./schedules.service";

@Injectable()
export class ActivitiesService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly outbox: OutboxService,
    private readonly schedules: SchedulesService,
  ) {}

  async create(tenantId: string, actorId: string, scheduleId: string, input: CreateScheduleActivityInput) {
    return withTenant(this.db, tenantId, async (tx) => {
      const schedule = await this.schedules.requireSchedule(tx, scheduleId);

      const [created] = await tx
        .insert(scheduleActivities)
        .values({
          tenantId,
          scheduleId,
          wbsPath: input.wbsPath,
          name: input.name,
          durationDays: input.durationDays,
          isMilestone: input.isMilestone,
          crew: input.crew,
          costCodeId: input.costCodeId,
          actualStartDate: input.actualStartDate,
          actualEndDate: input.actualEndDate,
          percentComplete: input.percentComplete?.toFixed(2),
          createdBy: actorId,
        })
        .returning();
      const activity = created!;

      await this.schedules.bumpVersion(tx, scheduleId);

      await this.outbox.append(tx, {
        tenantId,
        eventType: "schedule_activity.created.v1",
        dedupeKey: `schedule_activity.created.v1:${activity.id}`,
        actorId,
        payload: { companyId: tenantId, projectId: schedule.projectId, scheduleId, activityId: activity.id },
      });

      return activity;
    });
  }

  async getById(tenantId: string, activityId: string) {
    return withTenant(this.db, tenantId, (tx) => this.requireActivity(tx, activityId));
  }

  async list(tenantId: string, scheduleId: string) {
    return withTenant(this.db, tenantId, (tx) =>
      tx.query.scheduleActivities.findMany({
        where: and(eq(scheduleActivities.scheduleId, scheduleId), isNull(scheduleActivities.deletedAt)),
      }),
    );
  }

  async update(
    tenantId: string,
    actorId: string,
    activityId: string,
    input: UpdateScheduleActivityInput,
    ifMatchVersion?: number,
  ) {
    return withTenant(this.db, tenantId, async (tx) => {
      const current = await this.requireActivity(tx, activityId);
      const schedule = await this.schedules.requireSchedule(tx, current.scheduleId);
      const updated = await this.applyUpdate(tx, actorId, activityId, current, input, ifMatchVersion);

      await this.schedules.bumpVersion(tx, schedule.id);

      const changedFields = Object.keys(input).filter((key) => (input as Record<string, unknown>)[key] !== undefined);
      if (changedFields.length > 0) {
        await this.outbox.append(tx, {
          tenantId,
          eventType: "schedule_activity.updated.v1",
          dedupeKey: `schedule_activity.updated.v1:${activityId}:${updated.updatedSeq}`,
          actorId,
          payload: { companyId: tenantId, projectId: schedule.projectId, scheduleId: schedule.id, activityId, changedFields },
        });
      }

      return updated;
    });
  }

  // api.md §6: "PATCH /activities:batch for drag-multiselect" — all-or-
  // nothing within one transaction (a multi-activity drag is one logical
  // edit; a version conflict on any one activity rolls back the rest,
  // same reasoning as Change Orders' multi-line create).
  async batchUpdate(tenantId: string, actorId: string, scheduleId: string, input: BatchUpdateScheduleActivitiesInput) {
    return withTenant(this.db, tenantId, async (tx) => {
      const schedule = await this.schedules.requireSchedule(tx, scheduleId);
      const updated: (typeof scheduleActivities.$inferSelect)[] = [];

      for (const { id, ifMatchVersion, ...fields } of input.activities) {
        const current = await this.requireActivity(tx, id);
        if (current.scheduleId !== scheduleId) throw new ScheduleActivityNotFoundError();

        const row = await this.applyUpdate(tx, actorId, id, current, fields, ifMatchVersion);
        updated.push(row);

        const changedFields = Object.keys(fields).filter((key) => (fields as Record<string, unknown>)[key] !== undefined);
        if (changedFields.length > 0) {
          await this.outbox.append(tx, {
            tenantId,
            eventType: "schedule_activity.updated.v1",
            dedupeKey: `schedule_activity.updated.v1:${id}:${row.updatedSeq}`,
            actorId,
            payload: { companyId: tenantId, projectId: schedule.projectId, scheduleId, activityId: id, changedFields },
          });
        }
      }

      await this.schedules.bumpVersion(tx, scheduleId);
      return updated;
    });
  }

  async remove(tenantId: string, actorId: string, activityId: string): Promise<void> {
    await withTenant(this.db, tenantId, async (tx) => {
      const current = await this.requireActivity(tx, activityId);
      const schedule = await this.schedules.requireSchedule(tx, current.scheduleId);

      await tx
        .update(scheduleActivities)
        .set({ deletedAt: new Date(), updatedBy: actorId })
        .where(eq(scheduleActivities.id, activityId));

      await this.schedules.bumpVersion(tx, schedule.id);

      await this.outbox.append(tx, {
        tenantId,
        eventType: "schedule_activity.deleted.v1",
        dedupeKey: `schedule_activity.deleted.v1:${activityId}`,
        actorId,
        payload: { companyId: tenantId, projectId: schedule.projectId, scheduleId: schedule.id, activityId },
      });
    });
  }

  private async applyUpdate(
    tx: Database,
    actorId: string,
    activityId: string,
    current: typeof scheduleActivities.$inferSelect,
    input: UpdateScheduleActivityInput,
    ifMatchVersion?: number,
  ) {
    if (ifMatchVersion !== undefined && current.updatedSeq !== ifMatchVersion) {
      throw new VersionConflictError();
    }

    const [updated] = await tx
      .update(scheduleActivities)
      .set({
        ...input,
        percentComplete: input.percentComplete === undefined ? undefined : input.percentComplete?.toFixed(2),
        updatedBy: actorId,
      })
      .where(and(eq(scheduleActivities.id, activityId), eq(scheduleActivities.updatedSeq, current.updatedSeq)))
      .returning();

    if (!updated) throw new VersionConflictError();
    return updated;
  }

  private async requireActivity(tx: Database, activityId: string) {
    const activity = await tx.query.scheduleActivities.findFirst({
      where: and(eq(scheduleActivities.id, activityId), isNull(scheduleActivities.deletedAt)),
    });
    if (!activity) throw new ScheduleActivityNotFoundError();
    return activity;
  }
}
