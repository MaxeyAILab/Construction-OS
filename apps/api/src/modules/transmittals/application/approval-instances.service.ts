import { Inject, Injectable } from "@nestjs/common";
import type {
  ApprovalEntityType,
  DecideApprovalInstanceInput,
  StartApprovalInstanceInput,
} from "@constructionos/schemas";
import { and, eq, gt } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import { approvalInstanceDecisions, approvalInstances, approvalMatrixSteps } from "../../../infrastructure/db/schema";
import { OutboxService } from "../../events";
import { PermissionDeniedError, PermissionResolverService } from "../../rbac";
import {
  ApprovalAlreadyInProgressError,
  ApprovalEntityTypeMismatchError,
  ApprovalInstanceNotFoundError,
  ApprovalInstanceNotInProgressError,
  NotCurrentApproverError,
} from "../domain/errors";
import { ApprovalMatricesService } from "./approval-matrices.service";

// api.md §20: starting/reading a chain has no single fixed permission —
// resolved per entity_type, same "no single fixed permission fits" shape
// as Custom Fields' CustomFieldValuesService.
const ENTITY_PERMISSIONS: Record<ApprovalEntityType, { read: string; write: string }> = {
  document: { read: "docs.document.read", write: "docs.document.update" },
  transmittal: { read: "docs.transmittal.read", write: "docs.transmittal.send" },
};

// database.md §25 (FR-DOC-9). Sequential-only, by construction: decide()
// only ever accepts a decision from the current step's named
// approver_user_id, and a rejected decision halts the chain immediately.
// There is no branching and nothing resembling one.
@Injectable()
export class ApprovalInstancesService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly outbox: OutboxService,
    private readonly matrices: ApprovalMatricesService,
    private readonly permissions: PermissionResolverService,
  ) {}

  async getById(tenantId: string, actorId: string, instanceId: string) {
    return withTenant(this.db, tenantId, async (tx) => {
      const instance = await this.requireInstance(tx, instanceId);
      await this.authorize(tenantId, actorId, instance.entityType as ApprovalEntityType, "read");
      const decisions = await tx.query.approvalInstanceDecisions.findMany({
        where: eq(approvalInstanceDecisions.approvalInstanceId, instanceId),
        orderBy: (d, { asc }) => [asc(d.stepOrder)],
      });
      return { ...instance, decisions };
    });
  }

  async start(tenantId: string, actorId: string, input: StartApprovalInstanceInput) {
    await this.authorize(tenantId, actorId, input.entityType, "write");
    return withTenant(this.db, tenantId, async (tx) => {
      const matrix = await this.matrices.requireMatrix(tx, input.approvalMatrixId);
      if (matrix.entityType !== input.entityType) throw new ApprovalEntityTypeMismatchError();

      const existing = await tx.query.approvalInstances.findFirst({
        where: and(
          eq(approvalInstances.entityType, input.entityType),
          eq(approvalInstances.entityId, input.entityId),
          eq(approvalInstances.status, "in_progress"),
        ),
      });
      if (existing) throw new ApprovalAlreadyInProgressError();

      const steps = await tx.query.approvalMatrixSteps.findMany({
        where: eq(approvalMatrixSteps.approvalMatrixId, matrix.id),
        orderBy: (s, { asc }) => [asc(s.stepOrder)],
      });
      const firstStep = steps[0]!;

      const [created] = await tx
        .insert(approvalInstances)
        .values({
          tenantId,
          approvalMatrixId: matrix.id,
          entityType: input.entityType,
          entityId: input.entityId,
          currentStepOrder: firstStep.stepOrder,
          createdBy: actorId,
        })
        .returning();
      const instance = created!;

      await this.outbox.append(tx, {
        tenantId,
        eventType: "approval_instance.started.v1",
        dedupeKey: `approval_instance.started.v1:${instance.id}`,
        actorId,
        payload: {
          companyId: tenantId,
          approvalMatrixId: matrix.id,
          approvalInstanceId: instance.id,
          entityType: input.entityType,
          entityId: input.entityId,
        },
      });

      return instance;
    });
  }

  async decide(tenantId: string, actorId: string, instanceId: string, input: DecideApprovalInstanceInput) {
    return withTenant(this.db, tenantId, async (tx) => {
      const instance = await this.requireInstance(tx, instanceId);
      if (instance.status !== "in_progress") throw new ApprovalInstanceNotInProgressError();

      const currentStep = await tx.query.approvalMatrixSteps.findFirst({
        where: and(
          eq(approvalMatrixSteps.approvalMatrixId, instance.approvalMatrixId),
          eq(approvalMatrixSteps.stepOrder, instance.currentStepOrder),
        ),
      });
      if (!currentStep || currentStep.approverUserId !== actorId) throw new NotCurrentApproverError();

      await tx.insert(approvalInstanceDecisions).values({
        tenantId,
        approvalInstanceId: instanceId,
        stepOrder: currentStep.stepOrder,
        approverUserId: actorId,
        decision: input.decision,
        comments: input.comments,
        createdBy: actorId,
      });

      let status: "in_progress" | "approved" | "rejected" = instance.status as "in_progress";
      let notifyUserId: string | null = null;
      let nextStepOrder = instance.currentStepOrder;

      if (input.decision === "rejected") {
        status = "rejected";
      } else {
        const nextStep = await tx.query.approvalMatrixSteps.findFirst({
          where: and(
            eq(approvalMatrixSteps.approvalMatrixId, instance.approvalMatrixId),
            gt(approvalMatrixSteps.stepOrder, currentStep.stepOrder),
          ),
          orderBy: (s, { asc }) => [asc(s.stepOrder)],
        });
        if (nextStep) {
          status = "in_progress";
          nextStepOrder = nextStep.stepOrder;
          notifyUserId = nextStep.approverUserId;
        } else {
          status = "approved";
        }
      }

      const [updated] = await tx
        .update(approvalInstances)
        .set({ status, currentStepOrder: nextStepOrder, updatedBy: actorId })
        .where(eq(approvalInstances.id, instanceId))
        .returning();

      await this.outbox.append(tx, {
        tenantId,
        eventType: "approval_instance.decided.v1",
        dedupeKey: `approval_instance.decided.v1:${instanceId}:${currentStep.stepOrder}`,
        actorId,
        payload: {
          companyId: tenantId,
          approvalInstanceId: instanceId,
          entityType: instance.entityType,
          entityId: instance.entityId,
          stepOrder: currentStep.stepOrder,
          decision: input.decision,
          status,
          notifyUserId,
        },
      });

      return updated!;
    });
  }

  private async requireInstance(tx: Database, instanceId: string) {
    const instance = await tx.query.approvalInstances.findFirst({ where: eq(approvalInstances.id, instanceId) });
    if (!instance) throw new ApprovalInstanceNotFoundError();
    return instance;
  }

  private async authorize(
    tenantId: string,
    actorId: string,
    entityType: ApprovalEntityType,
    mode: "read" | "write",
  ): Promise<void> {
    const required = ENTITY_PERMISSIONS[entityType][mode];
    const granted = await this.permissions.has(tenantId, actorId, required);
    if (!granted) throw new PermissionDeniedError(required);
  }
}
