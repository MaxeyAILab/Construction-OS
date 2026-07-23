import { Inject, Injectable } from "@nestjs/common";
import type { CreateEquipmentAssignmentInput } from "@constructionos/schemas";
import { and, eq } from "drizzle-orm";
import postgres from "postgres";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import { equipment, equipmentAssignments, projects } from "../../../infrastructure/db/schema";
import { OutboxService } from "../../events";
import {
  EquipmentAssignmentAlreadyEndedError,
  EquipmentAssignmentNotFoundError,
  EquipmentAssignmentOverlapError,
  ProjectNotFoundError,
} from "../domain/errors";
import { EquipmentService } from "./equipment.service";

// Postgres error code 23P01 = exclusion_violation — raised by
// ck_equipment_assignments_no_overlap (FR-EQ-1, api.md §11: "409 overlap
// on double-book (DB exclusion)").
const EXCLUSION_VIOLATION = "23P01";

@Injectable()
export class EquipmentAssignmentsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly outbox: OutboxService,
    private readonly equipmentService: EquipmentService,
  ) {}

  async listForEquipment(tenantId: string, equipmentId: string) {
    return withTenant(this.db, tenantId, (tx) =>
      tx.query.equipmentAssignments.findMany({
        where: eq(equipmentAssignments.equipmentId, equipmentId),
        orderBy: (t, { desc: descOp }) => [descOp(t.startAt)],
      }),
    );
  }

  // FR-EQ-1: creating an open-ended assignment (no endAt) also marks the
  // equipment 'assigned' and stamps current_project_id — a dated/historical
  // assignment (both start and end supplied up front, e.g. a future
  // booking) leaves the equipment's live status alone since it isn't
  // necessarily the equipment's *current* state.
  async create(tenantId: string, actorId: string, equipmentId: string, input: CreateEquipmentAssignmentInput) {
    return withTenant(this.db, tenantId, async (tx) => {
      await this.equipmentService.requireEquipment(tx, equipmentId);
      const project = await tx.query.projects.findFirst({ where: eq(projects.id, input.projectId) });
      if (!project) throw new ProjectNotFoundError();

      const startAt = input.startAt ? new Date(input.startAt) : new Date();
      const endAt = input.endAt ? new Date(input.endAt) : null;

      let created;
      try {
        [created] = await tx
          .insert(equipmentAssignments)
          .values({
            tenantId,
            equipmentId,
            projectId: input.projectId,
            startAt,
            endAt,
            assignedBy: actorId,
          })
          .returning();
      } catch (error) {
        if (error instanceof postgres.PostgresError && error.code === EXCLUSION_VIOLATION) {
          throw new EquipmentAssignmentOverlapError();
        }
        throw error;
      }

      if (!endAt) {
        await tx
          .update(equipment)
          .set({ status: "assigned", currentProjectId: input.projectId, updatedBy: actorId })
          .where(eq(equipment.id, equipmentId));
      }

      await this.outbox.append(tx, {
        tenantId,
        eventType: "equipment_assignment.created.v1",
        dedupeKey: `equipment_assignment.created.v1:${created!.id}`,
        actorId,
        payload: { companyId: tenantId, equipmentId, equipmentAssignmentId: created!.id, projectId: input.projectId },
      });

      return created!;
    });
  }

  // Gap-fill: FR-EQ-1's assignment model needs a way to release equipment
  // back to 'available' — api.md §11 doesn't document a dedicated route,
  // same "the model requires it, add a documented gap-fill action"
  // precedent as Procurement's confirm/close.
  async end(tenantId: string, actorId: string, equipmentId: string, assignmentId: string) {
    return withTenant(this.db, tenantId, async (tx) => {
      const assignment = await tx.query.equipmentAssignments.findFirst({
        where: and(eq(equipmentAssignments.id, assignmentId), eq(equipmentAssignments.equipmentId, equipmentId)),
      });
      if (!assignment) throw new EquipmentAssignmentNotFoundError();
      if (assignment.endAt) throw new EquipmentAssignmentAlreadyEndedError();

      const [updated] = await tx
        .update(equipmentAssignments)
        .set({ endAt: new Date(), updatedBy: actorId })
        .where(eq(equipmentAssignments.id, assignmentId))
        .returning();

      await tx
        .update(equipment)
        .set({ status: "available", currentProjectId: null, updatedBy: actorId })
        .where(eq(equipment.id, equipmentId));

      await this.outbox.append(tx, {
        tenantId,
        eventType: "equipment_assignment.ended.v1",
        dedupeKey: `equipment_assignment.ended.v1:${assignmentId}`,
        actorId,
        payload: { companyId: tenantId, equipmentId, equipmentAssignmentId: assignmentId },
      });

      return updated!;
    });
  }
}
