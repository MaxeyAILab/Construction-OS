import { Inject, Injectable } from "@nestjs/common";
import type { ApprovalEntityType, CreateApprovalMatrixInput } from "@constructionos/schemas";
import { and, eq } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import { approvalMatrices, approvalMatrixSteps } from "../../../infrastructure/db/schema";
import { OutboxService } from "../../events";
import { ApprovalMatrixNotFoundError } from "../domain/errors";

// database.md §25 (FR-DOC-9). The approval_matrices/approval_matrix_steps
// tables' only write path.
@Injectable()
export class ApprovalMatricesService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly outbox: OutboxService,
  ) {}

  async list(tenantId: string, entityType: ApprovalEntityType) {
    return withTenant(this.db, tenantId, (tx) =>
      tx.query.approvalMatrices.findMany({
        where: and(eq(approvalMatrices.entityType, entityType), eq(approvalMatrices.isActive, true)),
        orderBy: (m, { asc }) => [asc(m.createdAt)],
      }),
    );
  }

  async getById(tenantId: string, matrixId: string) {
    return withTenant(this.db, tenantId, async (tx) => {
      const matrix = await this.requireMatrix(tx, matrixId);
      const steps = await tx.query.approvalMatrixSteps.findMany({
        where: eq(approvalMatrixSteps.approvalMatrixId, matrixId),
        orderBy: (s, { asc }) => [asc(s.stepOrder)],
      });
      return { ...matrix, steps };
    });
  }

  async create(tenantId: string, actorId: string, input: CreateApprovalMatrixInput) {
    return withTenant(this.db, tenantId, async (tx) => {
      const [created] = await tx
        .insert(approvalMatrices)
        .values({ tenantId, entityType: input.entityType, name: input.name, createdBy: actorId })
        .returning();
      const matrix = created!;

      await tx.insert(approvalMatrixSteps).values(
        input.steps.map((step) => ({
          tenantId,
          approvalMatrixId: matrix.id,
          stepOrder: step.stepOrder,
          approverUserId: step.approverUserId,
          label: step.label,
        })),
      );

      await this.outbox.append(tx, {
        tenantId,
        eventType: "approval_matrix.created.v1",
        dedupeKey: `approval_matrix.created.v1:${matrix.id}`,
        actorId,
        payload: { companyId: tenantId, entityType: input.entityType, approvalMatrixId: matrix.id },
      });

      return matrix;
    });
  }

  async requireMatrix(tx: Database, matrixId: string) {
    const matrix = await tx.query.approvalMatrices.findFirst({ where: eq(approvalMatrices.id, matrixId) });
    if (!matrix) throw new ApprovalMatrixNotFoundError();
    return matrix;
  }
}
