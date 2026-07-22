import { Inject, Injectable } from "@nestjs/common";
import type { ActivityDependencyType } from "@constructionos/schemas";
import { and, eq, isNull } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import { scheduleActivities } from "../../../infrastructure/db/schema";
import { OutboxService } from "../../events";
import { activityDatesFromOffsets } from "../domain/dates";
import { runCpm } from "../domain/cpm";
import { ScheduleRecalcQueue } from "./recalculate.queue";
import { SchedulesService } from "./schedules.service";

// database.md §14: "CPM recalculation runs in a worker for schedules > 500
// activities (job queue), synchronously below that" — matches api.md §6's
// "CPM run — sync <500 activities, else 202 job" and this row's own success
// metric ("500-activity schedule interactive < 100 ms").
const SYNC_ACTIVITY_THRESHOLD = 500;

@Injectable()
export class RecalculateService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly outbox: OutboxService,
    private readonly schedules: SchedulesService,
    private readonly queue: ScheduleRecalcQueue,
  ) {}

  // Entry point for the controller: decides sync vs. queued based on the
  // schedule's current activity count, then either runs recalculateSync
  // inline or hands off to ScheduleRecalcWorker via the queue.
  async recalculate(
    tenantId: string,
    actorId: string,
    scheduleId: string,
  ): Promise<{ async: true; jobId: string } | ({ async: false } & Awaited<ReturnType<RecalculateService["recalculateSync"]>>)> {
    const activityCount = await withTenant(this.db, tenantId, async (tx) => {
      await this.schedules.requireSchedule(tx, scheduleId);
      const rows = await tx.query.scheduleActivities.findMany({
        where: and(eq(scheduleActivities.scheduleId, scheduleId), isNull(scheduleActivities.deletedAt)),
        columns: { id: true },
      });
      return rows.length;
    });

    if (activityCount >= SYNC_ACTIVITY_THRESHOLD) {
      const jobId = await this.queue.enqueue({ tenantId, actorId, scheduleId });
      return { async: true, jobId };
    }

    const result = await this.recalculateSync(tenantId, actorId, scheduleId);
    return { async: false, ...result };
  }

  // The actual CPM run + write-back, always synchronous — called directly
  // for the <500 case, or by ScheduleRecalcWorker (the BullMQ consumer) for
  // the >=500 case. One transaction: forward/backward pass, write every
  // activity's computed start/end/is_critical/total_float_days, bump
  // schedule_version, emit schedule.recalculated.v1.
  async recalculateSync(tenantId: string, actorId: string, scheduleId: string) {
    return withTenant(this.db, tenantId, async (tx) => {
      const schedule = await this.schedules.requireSchedule(tx, scheduleId);

      const activityRows = await tx.query.scheduleActivities.findMany({
        where: and(eq(scheduleActivities.scheduleId, scheduleId), isNull(scheduleActivities.deletedAt)),
      });
      const dependencyRows = await this.schedules.loadDependencies(tx, scheduleId);

      const cpmResults = runCpm(
        activityRows.map((a) => ({ id: a.id, durationDays: a.durationDays })),
        dependencyRows.map((d) => ({
          predecessorId: d.predecessorId,
          successorId: d.successorId,
          type: d.type as ActivityDependencyType,
          lagDays: d.lagDays,
        })),
      );

      let criticalActivityCount = 0;
      const updatedActivities: (typeof scheduleActivities.$inferSelect)[] = [];
      for (const activity of activityRows) {
        const result = cpmResults.get(activity.id)!;
        const { startDate, endDate } = activityDatesFromOffsets(schedule.dataDate, result.earlyStart, result.earlyFinish);
        if (result.isCritical) criticalActivityCount += 1;

        const [updated] = await tx
          .update(scheduleActivities)
          .set({
            startDate,
            endDate,
            isCritical: result.isCritical,
            totalFloatDays: result.totalFloatDays,
            updatedBy: actorId,
          })
          .where(eq(scheduleActivities.id, activity.id))
          .returning();
        updatedActivities.push(updated!);
      }

      const updatedSchedule = await this.schedules.bumpVersion(tx, scheduleId);

      await this.outbox.append(tx, {
        tenantId,
        eventType: "schedule.recalculated.v1",
        dedupeKey: `schedule.recalculated.v1:${scheduleId}:${updatedSchedule.scheduleVersion}`,
        actorId,
        payload: {
          companyId: tenantId,
          projectId: schedule.projectId,
          scheduleId,
          scheduleVersion: updatedSchedule.scheduleVersion,
          activityCount: activityRows.length,
          criticalActivityCount,
        },
      });

      return { schedule: updatedSchedule, activities: updatedActivities };
    });
  }
}
