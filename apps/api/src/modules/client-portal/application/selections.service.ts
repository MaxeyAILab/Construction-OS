import { Inject, Injectable } from "@nestjs/common";
import type {
  ClientSelectionOption,
  CreateClientSelectionInput,
  DecideClientSelectionInput,
  UpdateClientSelectionInput,
} from "@constructionos/schemas";
import { and, desc, eq, isNull } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import { clientSelections, projects } from "../../../infrastructure/db/schema";
import { OutboxService } from "../../events";
import { ExternalSharesService, PermissionResolverService } from "../../rbac";
import {
  ClientSelectionDecisionDeniedError,
  ClientSelectionNotFoundError,
  ClientSelectionNotPendingError,
  ClientSelectionOptionNotFoundError,
  ClientSelectionReadDeniedError,
  ProjectNotFoundError,
} from "../domain/errors";

// database.md §17 (M13, FR-CLIENT-2). Create/update are internal-only
// (gated by client.selection.manage via @RequirePermission on the
// controller — no client-portal share lets a client author a selection,
// only decide one already offered to them). list/getById/decide accept a
// project-level "view" share (or, for decide, a per-selection "approve"
// share) alongside the internal permission — same dual-path pattern as
// Change Orders' approve() and Scheduling/Documents' broadened reads.
@Injectable()
export class SelectionsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly outbox: OutboxService,
    private readonly permissions: PermissionResolverService,
    private readonly externalShares: ExternalSharesService,
  ) {}

  async list(tenantId: string, actorId: string, projectId: string) {
    await this.authorizeRead(tenantId, actorId, projectId);
    return withTenant(this.db, tenantId, (tx) =>
      tx.query.clientSelections.findMany({
        where: and(eq(clientSelections.projectId, projectId), isNull(clientSelections.deletedAt)),
        orderBy: [desc(clientSelections.createdAt)],
      }),
    );
  }

  async getById(tenantId: string, actorId: string, selectionId: string) {
    const selection = await withTenant(this.db, tenantId, (tx) => this.requireSelection(tx, selectionId));
    await this.authorizeRead(tenantId, actorId, selection.projectId);
    return selection;
  }

  async create(tenantId: string, actorId: string, projectId: string, input: CreateClientSelectionInput) {
    return withTenant(this.db, tenantId, async (tx) => {
      const project = await tx.query.projects.findFirst({
        where: and(eq(projects.id, projectId), isNull(projects.deletedAt)),
      });
      if (!project) throw new ProjectNotFoundError();

      const [created] = await tx
        .insert(clientSelections)
        .values({
          tenantId,
          projectId,
          title: input.title,
          description: input.description,
          options: input.options,
          allowanceAmount: input.allowanceAmount,
          createdBy: actorId,
        })
        .returning();
      const selection = created!;

      await this.outbox.append(tx, {
        tenantId,
        eventType: "client_selection.created.v1",
        dedupeKey: `client_selection.created.v1:${selection.id}`,
        actorId,
        payload: { companyId: tenantId, projectId, selectionId: selection.id, title: selection.title },
      });

      return selection;
    });
  }

  async update(tenantId: string, actorId: string, selectionId: string, input: UpdateClientSelectionInput) {
    return withTenant(this.db, tenantId, async (tx) => {
      const current = await this.requireSelection(tx, selectionId);
      if (current.status !== "pending") throw new ClientSelectionNotPendingError();

      const changedFields = Object.keys(input).filter((key) => (input as Record<string, unknown>)[key] !== undefined);
      const [updated] = await tx
        .update(clientSelections)
        .set({ ...input, updatedBy: actorId })
        .where(eq(clientSelections.id, selectionId))
        .returning();

      if (changedFields.length > 0) {
        await this.outbox.append(tx, {
          tenantId,
          eventType: "client_selection.updated.v1",
          dedupeKey: `client_selection.updated.v1:${selectionId}:${updated!.updatedSeq}`,
          actorId,
          payload: { companyId: tenantId, projectId: current.projectId, selectionId, changedFields },
        });
      }

      return updated!;
    });
  }

  // api.md has no documented shape for this (no Client Portal API section
  // exists at all) — mirrors Change Orders' approve() dual path: internal
  // client.selection.manage, or a per-selection external_shares grant
  // (entity_type='client_selection', access='approve').
  async decide(tenantId: string, actorId: string, selectionId: string, input: DecideClientSelectionInput) {
    return withTenant(this.db, tenantId, async (tx) => {
      const current = await this.requireSelection(tx, selectionId);
      if (current.status !== "pending") throw new ClientSelectionNotPendingError();

      await this.authorizeDecide(tenantId, actorId, selectionId);

      const options = current.options as ClientSelectionOption[];
      const chosen = options.find((option) => option.label === input.selectedOption);
      if (!chosen) throw new ClientSelectionOptionNotFoundError(input.selectedOption);

      const [updated] = await tx
        .update(clientSelections)
        .set({
          status: "decided",
          selectedOption: input.selectedOption,
          decidedBy: actorId,
          decidedAt: new Date(),
          updatedBy: actorId,
        })
        .where(eq(clientSelections.id, selectionId))
        .returning();

      const allowance = current.allowanceAmount ? Number(current.allowanceAmount) : 0;
      const costDeltaAmount = (Number(chosen.costImpactAmount) - allowance).toFixed(2);

      await this.outbox.append(tx, {
        tenantId,
        eventType: "client_selection.decided.v1",
        dedupeKey: `client_selection.decided.v1:${selectionId}`,
        actorId,
        payload: {
          companyId: tenantId,
          projectId: current.projectId,
          selectionId,
          selectedOption: input.selectedOption,
          costDeltaAmount,
        },
      });

      return updated!;
    });
  }

  private async requireSelection(tx: Database, selectionId: string) {
    const selection = await tx.query.clientSelections.findFirst({
      where: and(eq(clientSelections.id, selectionId), isNull(clientSelections.deletedAt)),
    });
    if (!selection) throw new ClientSelectionNotFoundError();
    return selection;
  }

  private async authorizeRead(tenantId: string, actorId: string, projectId: string): Promise<void> {
    const hasPermission = await this.permissions.has(tenantId, actorId, "client.selection.read");
    if (hasPermission) return;
    const hasShare = await this.externalShares.hasAccess(tenantId, actorId, "project", projectId, "view");
    if (!hasShare) throw new ClientSelectionReadDeniedError();
  }

  private async authorizeDecide(tenantId: string, actorId: string, selectionId: string): Promise<void> {
    const hasPermission = await this.permissions.has(tenantId, actorId, "client.selection.manage");
    if (hasPermission) return;
    const hasShare = await this.externalShares.hasAccess(tenantId, actorId, "client_selection", selectionId, "approve");
    if (!hasShare) throw new ClientSelectionDecisionDeniedError();
  }
}
