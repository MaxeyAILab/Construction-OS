import { Inject, Injectable } from "@nestjs/common";
import type { CreateScheduleBaselineInput } from "@constructionos/schemas";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import { activityDependencies, projects, scheduleActivities, schedules } from "../../../infrastructure/db/schema";
import { OutboxService } from "../../events";
import { ProjectNotFoundError, ScheduleNotFoundError } from "../domain/errors";

@Injectable()
export class SchedulesService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly outbox: OutboxService,
  ) {}

  // api.md §6 has no dedicated "create schedule" endpoint — GET
  // /projects/{id}/schedule lazily get-or-creates the one master schedule
  // database.md §14 says every project has ("One active ... per project").
  async getActiveSchedule(tenantId: string, actorId: string, projectId: string) {
    return withTenant(this.db, tenantId, async (tx) => {
      const project = await tx.query.projects.findFirst({
        where: and(eq(projects.id, projectId), isNull(projects.deletedAt)),
      });
      if (!project) throw new ProjectNotFoundError();

      let schedule = await tx.query.schedules.findFirst({
        where: and(eq(schedules.projectId, projectId), eq(schedules.kind, "master"), isNull(schedules.deletedAt)),
      });

      if (!schedule) {
        const today = new Date().toISOString().slice(0, 10);
        const [created] = await tx
          .insert(schedules)
          .values({ tenantId, projectId, kind: "master", dataDate: today, createdBy: actorId })
          .returning();
        schedule = created!;

        await this.outbox.append(tx, {
          tenantId,
          eventType: "schedule.created.v1",
          dedupeKey: `schedule.created.v1:${schedule.id}`,
          actorId,
          payload: { companyId: tenantId, projectId, scheduleId: schedule.id },
        });
      }

      const [activities, dependencies] = await Promise.all([
        tx.query.scheduleActivities.findMany({
          where: and(eq(scheduleActivities.scheduleId, schedule.id), isNull(scheduleActivities.deletedAt)),
        }),
        this.loadDependencies(tx, schedule.id),
      ]);

      return { schedule, activities, dependencies };
    });
  }

  async getById(tenantId: string, scheduleId: string) {
    return withTenant(this.db, tenantId, (tx) => this.requireSchedule(tx, scheduleId));
  }

  // FR-SCH-2: snapshot the current master schedule (activities +
  // dependencies) into a frozen `kind='baseline'` copy. Each baseline
  // activity keeps `baselineSourceActivityId` pointing at the master
  // activity it came from, so planned-vs-baseline dates can be diffed
  // later without matching on name/wbs_path.
  async createBaseline(tenantId: string, actorId: string, projectId: string, input: CreateScheduleBaselineInput) {
    return withTenant(this.db, tenantId, async (tx) => {
      const project = await tx.query.projects.findFirst({
        where: and(eq(projects.id, projectId), isNull(projects.deletedAt)),
      });
      if (!project) throw new ProjectNotFoundError();

      const master = await tx.query.schedules.findFirst({
        where: and(eq(schedules.projectId, projectId), eq(schedules.kind, "master"), isNull(schedules.deletedAt)),
      });
      if (!master) throw new ScheduleNotFoundError();

      const masterActivities = await tx.query.scheduleActivities.findMany({
        where: and(eq(scheduleActivities.scheduleId, master.id), isNull(scheduleActivities.deletedAt)),
      });
      const masterDependencies = await this.loadDependencies(tx, master.id);

      const [baseline] = await tx
        .insert(schedules)
        .values({
          tenantId,
          projectId,
          kind: "baseline",
          baselineOfId: master.id,
          name: input.name,
          dataDate: master.dataDate,
          createdBy: actorId,
        })
        .returning();
      const created = baseline!;

      const idRemap = new Map<string, string>();
      const baselineActivities: (typeof scheduleActivities.$inferSelect)[] = [];
      for (const activity of masterActivities) {
        const [copy] = await tx
          .insert(scheduleActivities)
          .values({
            tenantId,
            scheduleId: created.id,
            wbsPath: activity.wbsPath,
            name: activity.name,
            durationDays: activity.durationDays,
            startDate: activity.startDate,
            endDate: activity.endDate,
            actualStartDate: activity.actualStartDate,
            actualEndDate: activity.actualEndDate,
            percentComplete: activity.percentComplete,
            isMilestone: activity.isMilestone,
            isCritical: activity.isCritical,
            totalFloatDays: activity.totalFloatDays,
            crew: activity.crew,
            costCodeId: activity.costCodeId,
            baselineSourceActivityId: activity.id,
            createdBy: actorId,
          })
          .returning();
        idRemap.set(activity.id, copy!.id);
        baselineActivities.push(copy!);
      }

      for (const dep of masterDependencies) {
        const predecessorId = idRemap.get(dep.predecessorId);
        const successorId = idRemap.get(dep.successorId);
        if (!predecessorId || !successorId) continue;
        await tx.insert(activityDependencies).values({
          tenantId,
          predecessorId,
          successorId,
          type: dep.type,
          lagDays: dep.lagDays,
          createdBy: actorId,
        });
      }

      await this.outbox.append(tx, {
        tenantId,
        eventType: "schedule_baseline.created.v1",
        dedupeKey: `schedule_baseline.created.v1:${created.id}`,
        actorId,
        payload: { companyId: tenantId, projectId, scheduleId: created.id, baselineOfId: master.id },
      });

      return { schedule: created, activities: baselineActivities };
    });
  }

  // Public (not private) — ActivitiesService/DependenciesService/
  // RecalculateService inject SchedulesService directly to reuse this and
  // bumpVersion below, same intra-module DI precedent as
  // EstimateLinesService calling EstimateService.recomputeTotals.
  async requireSchedule(tx: Database, scheduleId: string) {
    const schedule = await tx.query.schedules.findFirst({
      where: and(eq(schedules.id, scheduleId), isNull(schedules.deletedAt)),
    });
    if (!schedule) throw new ScheduleNotFoundError();
    return schedule;
  }

  // Every activity/dependency mutation and recalculate bumps this
  // application-managed counter (schedules.ts's schema comment) so
  // GET .../schedule's ETag reflects the whole schedule's content.
  async bumpVersion(tx: Database, scheduleId: string) {
    const [updated] = await tx
      .update(schedules)
      .set({ scheduleVersion: sql`${schedules.scheduleVersion} + 1` })
      .where(eq(schedules.id, scheduleId))
      .returning();
    return updated!;
  }

  async loadDependencies(tx: Database, scheduleId: string) {
    const activitiesOfSchedule = await tx.query.scheduleActivities.findMany({
      where: and(eq(scheduleActivities.scheduleId, scheduleId), isNull(scheduleActivities.deletedAt)),
      columns: { id: true },
    });
    const activityIds = activitiesOfSchedule.map((a) => a.id);
    if (activityIds.length === 0) return [];

    return tx.query.activityDependencies.findMany({
      where: and(
        isNull(activityDependencies.deletedAt),
        inArray(activityDependencies.predecessorId, activityIds),
        inArray(activityDependencies.successorId, activityIds),
      ),
    });
  }
}
