import { Inject, Injectable } from "@nestjs/common";
import type { ActivityDependencyType, ReplaceActivityDependenciesInput } from "@constructionos/schemas";
import { and, eq, isNull } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import { activityDependencies, scheduleActivities } from "../../../infrastructure/db/schema";
import { topologicalOrder } from "../domain/cpm";
import { ScheduleActivityNotFoundError } from "../domain/errors";
import { OutboxService } from "../../events";
import { SchedulesService } from "./schedules.service";

@Injectable()
export class DependenciesService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly outbox: OutboxService,
    private readonly schedules: SchedulesService,
  ) {}

  // api.md §6: "PUT /activities/{id}/dependencies — Replace dep set; 422
  // cycle_detected." The activity in the path is always the successor;
  // `input.dependencies` is the full replacement set of predecessor edges
  // into it. Cycle detection runs over the *whole schedule's* graph (not
  // just this activity's edges) since a new edge here could complete a
  // cycle anywhere — database.md §14: "cycle detection at application
  // layer before commit."
  async replace(tenantId: string, actorId: string, activityId: string, input: ReplaceActivityDependenciesInput) {
    return withTenant(this.db, tenantId, async (tx) => {
      const successor = await this.requireActivity(tx, activityId);
      const schedule = await this.schedules.requireSchedule(tx, successor.scheduleId);

      for (const dep of input.dependencies) {
        const predecessor = await this.requireActivity(tx, dep.predecessorId);
        if (predecessor.scheduleId !== successor.scheduleId) {
          throw new ScheduleActivityNotFoundError();
        }
      }

      await tx.delete(activityDependencies).where(eq(activityDependencies.successorId, activityId));

      for (const dep of input.dependencies) {
        await tx.insert(activityDependencies).values({
          tenantId,
          predecessorId: dep.predecessorId,
          successorId: activityId,
          type: dep.type,
          lagDays: dep.lagDays,
          createdBy: actorId,
        });
      }

      const activityIds = (
        await tx.query.scheduleActivities.findMany({
          where: and(eq(scheduleActivities.scheduleId, successor.scheduleId), isNull(scheduleActivities.deletedAt)),
          columns: { id: true },
        })
      ).map((a) => a.id);
      const allDependencies = await this.schedules.loadDependencies(tx, successor.scheduleId);
      // Throws CycleDetectedError (422) if the new edge set is cyclic —
      // the whole transaction (delete + inserts above) rolls back with it.
      topologicalOrder(
        activityIds,
        allDependencies.map((d) => ({
          predecessorId: d.predecessorId,
          successorId: d.successorId,
          type: d.type as ActivityDependencyType,
          lagDays: d.lagDays,
        })),
      );

      const updatedSchedule = await this.schedules.bumpVersion(tx, schedule.id);

      await this.outbox.append(tx, {
        tenantId,
        eventType: "activity_dependency.replaced.v1",
        dedupeKey: `activity_dependency.replaced.v1:${activityId}:${updatedSchedule.scheduleVersion}`,
        actorId,
        payload: {
          companyId: tenantId,
          projectId: schedule.projectId,
          scheduleId: schedule.id,
          activityId,
          predecessorIds: input.dependencies.map((d) => d.predecessorId),
        },
      });

      return allDependencies.filter((dep) => dep.successorId === activityId);
    });
  }

  private async requireActivity(tx: Database, activityId: string) {
    const activity = await tx.query.scheduleActivities.findFirst({
      where: and(eq(scheduleActivities.id, activityId), isNull(scheduleActivities.deletedAt)),
    });
    if (!activity) throw new ScheduleActivityNotFoundError();
    return activity;
  }
}
