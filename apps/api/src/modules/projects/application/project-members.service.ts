import { Inject, Injectable } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import { companyUsers, projectUsers, users } from "../../../infrastructure/db/schema";
import { OutboxService } from "../../events";
import { AlreadyAProjectMemberError, NotAProjectMemberError, UserNotInCompanyError } from "../domain/errors";

// database.md §9: project_users is team roster (field-working-set/sync
// scope driver), separate from RBAC's user_roles (permission grants) —
// FR-RBAC-2's project-scoped roles live there, not here.
@Injectable()
export class ProjectMembersService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly outbox: OutboxService,
  ) {}

  async list(tenantId: string, projectId: string) {
    return withTenant(this.db, tenantId, (tx) =>
      tx
        .select({
          userId: projectUsers.userId,
          email: users.email,
          fullName: users.fullName,
          addedAt: projectUsers.createdAt,
        })
        .from(projectUsers)
        .innerJoin(users, eq(users.id, projectUsers.userId))
        .where(and(eq(projectUsers.tenantId, tenantId), eq(projectUsers.projectId, projectId))),
    );
  }

  async add(tenantId: string, actorId: string, projectId: string, userId: string) {
    return withTenant(this.db, tenantId, async (tx) => {
      const membership = await tx.query.companyUsers.findFirst({
        where: and(eq(companyUsers.tenantId, tenantId), eq(companyUsers.userId, userId)),
      });
      if (!membership) throw new UserNotInCompanyError();

      const existing = await tx.query.projectUsers.findFirst({
        where: and(eq(projectUsers.projectId, projectId), eq(projectUsers.userId, userId)),
      });
      if (existing) throw new AlreadyAProjectMemberError();

      await tx.insert(projectUsers).values({ tenantId, projectId, userId, createdBy: actorId });

      await this.outbox.append(tx, {
        tenantId,
        eventType: "project_member.added.v1",
        dedupeKey: `project_member.added.v1:${projectId}:${userId}`,
        actorId,
        payload: { companyId: tenantId, projectId, userId },
      });
    });
  }

  async remove(tenantId: string, actorId: string, projectId: string, userId: string): Promise<void> {
    await withTenant(this.db, tenantId, async (tx) => {
      const deleted = await tx
        .delete(projectUsers)
        .where(
          and(
            eq(projectUsers.tenantId, tenantId),
            eq(projectUsers.projectId, projectId),
            eq(projectUsers.userId, userId),
          ),
        )
        .returning();
      if (deleted.length === 0) throw new NotAProjectMemberError();

      await this.outbox.append(tx, {
        tenantId,
        eventType: "project_member.removed.v1",
        dedupeKey: `project_member.removed.v1:${projectId}:${userId}:${Date.now()}`,
        actorId,
        payload: { companyId: tenantId, projectId, userId },
      });
    });
  }
}
