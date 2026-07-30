import { Inject, Injectable } from "@nestjs/common";
import type { CreateResourceAssignmentInput } from "@constructionos/schemas";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import { equipment, resourceAssignments, scheduleActivities } from "../../../infrastructure/db/schema";
import { OutboxService } from "../../events";
import { EquipmentNotFoundError, ResourceAssignmentNotFoundError, ScheduleActivityNotFoundError } from "../domain/errors";

// database.md §14 (FR-SCH-5): "Crew/equipment <-> activity with tstzrange."
// Lives alongside ActivitiesService/SchedulesService in the Scheduling
// module (not Equipment) — this is a schedule-level resource *plan*
// (allowed to overlap, surfaced via ResourceConflictsService), distinct
// from equipment_assignments' hard utilization/costing booking.
@Injectable()
export class ResourceAssignmentsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly outbox: OutboxService,
  ) {}

  async listForActivity(tenantId: string, activityId: string) {
    return withTenant(this.db, tenantId, (tx) =>
      tx.query.resourceAssignments.findMany({
        where: and(eq(resourceAssignments.activityId, activityId), isNull(resourceAssignments.deletedAt)),
        orderBy: (t, { asc }) => [asc(t.startAt)],
      }),
    );
  }

  async create(tenantId: string, actorId: string, activityId: string, input: CreateResourceAssignmentInput) {
    return withTenant(this.db, tenantId, async (tx) => {
      const activity = await tx.query.scheduleActivities.findFirst({
        where: and(eq(scheduleActivities.id, activityId), isNull(scheduleActivities.deletedAt)),
      });
      if (!activity) throw new ScheduleActivityNotFoundError();

      if (input.resourceType === "equipment") {
        const item = await tx.query.equipment.findFirst({ where: eq(equipment.id, input.equipmentId!) });
        if (!item) throw new EquipmentNotFoundError();
      }

      const [created] = await tx
        .insert(resourceAssignments)
        .values({
          tenantId,
          activityId,
          resourceType: input.resourceType,
          equipmentId: input.resourceType === "equipment" ? input.equipmentId : null,
          crewLabel: input.resourceType === "crew" ? input.crewLabel : null,
          startAt: new Date(input.startAt),
          endAt: new Date(input.endAt),
          createdBy: actorId,
        })
        .returning();
      const assignment = created!;

      await this.outbox.append(tx, {
        tenantId,
        eventType: "resource_assignment.created.v1",
        dedupeKey: `resource_assignment.created.v1:${assignment.id}`,
        actorId,
        payload: { companyId: tenantId, activityId, resourceAssignmentId: assignment.id, resourceType: input.resourceType },
      });

      return assignment;
    });
  }

  // Gap-fill: api.md §6 doesn't itemize a create/remove route for
  // resource_assignments at all (only the read-side lookahead/conflicts
  // rows) — FR-SCH-5's "assign resources to activities" requires one, same
  // "the model requires it, add a documented gap-fill action" precedent as
  // Equipment's own AssignmentsService.end(). A soft-delete (not an "end"
  // action) since startAt/endAt are both required up front — there's no
  // open-ended assignment to close out, only a booking to cancel.
  async remove(tenantId: string, actorId: string, assignmentId: string): Promise<void> {
    await withTenant(this.db, tenantId, async (tx) => {
      const assignment = await tx.query.resourceAssignments.findFirst({
        where: and(eq(resourceAssignments.id, assignmentId), isNull(resourceAssignments.deletedAt)),
      });
      if (!assignment) throw new ResourceAssignmentNotFoundError();

      await tx
        .update(resourceAssignments)
        .set({ deletedAt: new Date(), updatedBy: actorId })
        .where(eq(resourceAssignments.id, assignmentId));

      await this.outbox.append(tx, {
        tenantId,
        eventType: "resource_assignment.deleted.v1",
        dedupeKey: `resource_assignment.deleted.v1:${assignmentId}`,
        actorId,
        payload: { companyId: tenantId, activityId: assignment.activityId, resourceAssignmentId: assignmentId },
      });
    });
  }

  // Reused by WhatIfSimulationService (dashboards module, FR-EXEC-4 "crew
  // move" what-if scenario) — same "broaden an existing module's public
  // surface" precedent as SchedulesService.loadDependencies. Returns fewer
  // rows than `ids` when some don't exist/are deleted; the caller decides
  // whether that's an error.
  async listByIdsWithActivity(tenantId: string, ids: string[]) {
    return withTenant(this.db, tenantId, (tx) =>
      tx
        .select({
          assignment: resourceAssignments,
          activityId: scheduleActivities.id,
          activityName: scheduleActivities.name,
          activityScheduleId: scheduleActivities.scheduleId,
        })
        .from(resourceAssignments)
        .innerJoin(scheduleActivities, eq(scheduleActivities.id, resourceAssignments.activityId))
        .where(and(inArray(resourceAssignments.id, ids), isNull(resourceAssignments.deletedAt))),
    );
  }

  // Same "crew move" what-if scenario: does moving a resource onto
  // `targetActivityId` create a new overlap for the same crew/equipment,
  // mirroring ResourceConflictsService's overlap predicate (tstzrange
  // intersection) but scoped to one candidate activity/window instead of a
  // cross-project time range — a hypothetical check, not the GIST-indexed
  // query, since nothing is actually being inserted.
  async findOverlapping(
    tenantId: string,
    targetActivityId: string,
    resourceType: "crew" | "equipment",
    resourceLabel: string,
    startAt: Date,
    endAt: Date,
  ) {
    return withTenant(this.db, tenantId, async (tx) => {
      const candidates = await tx.query.resourceAssignments.findMany({
        where: and(eq(resourceAssignments.activityId, targetActivityId), isNull(resourceAssignments.deletedAt)),
      });
      return candidates.filter((candidate) => {
        if (candidate.resourceType !== resourceType) return false;
        const label = resourceType === "equipment" ? candidate.equipmentId : candidate.crewLabel;
        if (label !== resourceLabel) return false;
        return candidate.startAt < endAt && candidate.endAt > startAt;
      });
    });
  }
}
