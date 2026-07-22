import { Inject, Injectable } from "@nestjs/common";
import type { CreateProjectInput, ProjectStatus, UpdateProjectInput } from "@constructionos/schemas";
import { and, eq, isNull } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import { projects, projectUsers } from "../../../infrastructure/db/schema";
import { OutboxService } from "../../events";
import {
  DuplicateProjectCodeError,
  OpportunityConversionNotSupportedError,
  ProjectNotFoundError,
  VersionConflictError,
} from "../domain/errors";
import { assertLegalStatusTransition } from "../domain/status-transitions";
import { ProjectTemplatesService } from "./project-templates.service";

// FR-PM-2: health subscores are computed elsewhere (Schedule/Finance/
// Safety, none of which exist yet) — every project starts with this
// stub structure so /summary (FR-PM-3) has something well-shaped to
// return rather than a missing field.
const STUB_HEALTH = { schedule: null, budget: null, safety: null, quality: null, overall: null };

@Injectable()
export class ProjectsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly outbox: OutboxService,
    private readonly templates: ProjectTemplatesService,
  ) {}

  async create(tenantId: string, actorId: string, input: CreateProjectInput) {
    if (input.fromOpportunityId) {
      throw new OpportunityConversionNotSupportedError();
    }

    return withTenant(this.db, tenantId, async (tx) => {
      const existing = await tx.query.projects.findFirst({
        where: and(eq(projects.tenantId, tenantId), eq(projects.code, input.code)),
      });
      if (existing) throw new DuplicateProjectCodeError(input.code);

      const [project] = await tx
        .insert(projects)
        .values({
          tenantId,
          name: input.name,
          code: input.code,
          clientContactCompanyId: input.clientContactCompanyId,
          address: input.address,
          startDate: input.startDate,
          targetEndDate: input.targetEndDate,
          contractValueAmount: input.contractValueAmount,
          currency: input.currency,
          templateId: input.templateId,
          health: STUB_HEALTH,
          createdBy: actorId,
        })
        .returning();
      const created = project!;

      // The creator is automatically a member — matches RBAC's own
      // pattern of the acting user always ending up in scope for what
      // they just created (see AuthService.signUp's Owner role grant).
      await tx.insert(projectUsers).values({ tenantId, projectId: created.id, userId: actorId });

      if (input.templateId) {
        await this.templates.applyToProject(tx, tenantId, created.id, input.templateId);
      }

      await this.outbox.append(tx, {
        tenantId,
        eventType: "project.created.v1",
        dedupeKey: `project.created.v1:${created.id}`,
        actorId,
        payload: {
          companyId: tenantId,
          projectId: created.id,
          name: created.name,
          code: created.code,
          templateId: created.templateId,
        },
      });

      return created;
    });
  }

  async get(tenantId: string, projectId: string) {
    return withTenant(this.db, tenantId, async (tx) => {
      const project = await tx.query.projects.findFirst({
        where: and(eq(projects.id, projectId), isNull(projects.deletedAt)),
      });
      if (!project) throw new ProjectNotFoundError();
      return project;
    });
  }

  async update(
    tenantId: string,
    actorId: string,
    projectId: string,
    input: UpdateProjectInput,
    ifMatchVersion?: number,
  ) {
    return withTenant(this.db, tenantId, async (tx) => {
      const current = await tx.query.projects.findFirst({
        where: and(eq(projects.id, projectId), isNull(projects.deletedAt)),
      });
      if (!current) throw new ProjectNotFoundError();

      if (ifMatchVersion !== undefined && current.updatedSeq !== ifMatchVersion) {
        throw new VersionConflictError();
      }

      if (input.status) {
        assertLegalStatusTransition(current.status as ProjectStatus, input.status);
      }

      const changedFields = Object.keys(input).filter(
        (key) => (input as Record<string, unknown>)[key] !== undefined,
      );

      const [updated] = await tx
        .update(projects)
        .set({ ...input, updatedBy: actorId })
        .where(and(eq(projects.id, projectId), eq(projects.updatedSeq, current.updatedSeq)))
        .returning();

      if (!updated) throw new VersionConflictError();

      if (changedFields.length > 0) {
        await this.outbox.append(tx, {
          tenantId,
          eventType: "project.updated.v1",
          dedupeKey: `project.updated.v1:${projectId}:${updated.updatedSeq}`,
          actorId,
          payload: { companyId: tenantId, projectId, changedFields },
        });
      }

      return updated;
    });
  }

  async remove(tenantId: string, actorId: string, projectId: string): Promise<void> {
    await withTenant(this.db, tenantId, async (tx) => {
      const current = await tx.query.projects.findFirst({
        where: and(eq(projects.id, projectId), isNull(projects.deletedAt)),
      });
      if (!current) throw new ProjectNotFoundError();

      await tx
        .update(projects)
        .set({ deletedAt: new Date(), updatedBy: actorId })
        .where(eq(projects.id, projectId));

      await this.outbox.append(tx, {
        tenantId,
        eventType: "project.deleted.v1",
        dedupeKey: `project.deleted.v1:${projectId}`,
        actorId,
        payload: { companyId: tenantId, projectId },
      });
    });
  }
}
