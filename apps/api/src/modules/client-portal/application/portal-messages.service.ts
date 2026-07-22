import { Inject, Injectable } from "@nestjs/common";
import type { CreatePortalMessageInput } from "@constructionos/schemas";
import { and, asc, eq, isNull } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import { portalMessages, projects } from "../../../infrastructure/db/schema";
import { OutboxService } from "../../events";
import { ExternalSharesService, PermissionResolverService } from "../../rbac";
import { PortalMessageCreateDeniedError, PortalMessageReadDeniedError, ProjectNotFoundError } from "../domain/errors";

// database.md §17 (FR-CLIENT-3): "Threaded external communication scoped
// to entity_type/id with audience — kept separate from internal comments."
// v1 only ever uses entity_type='project' + audience='client' (Client
// Portal, M13) — subcontractor/supplier portals (M14/M15) are separate,
// unbuilt roadmap rows that would use the same table with a different
// audience once they exist.
@Injectable()
export class PortalMessagesService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly outbox: OutboxService,
    private readonly permissions: PermissionResolverService,
    private readonly externalShares: ExternalSharesService,
  ) {}

  async list(tenantId: string, actorId: string, projectId: string) {
    await this.authorizeRead(tenantId, actorId, projectId);
    return withTenant(this.db, tenantId, (tx) =>
      tx.query.portalMessages.findMany({
        where: and(
          eq(portalMessages.entityType, "project"),
          eq(portalMessages.entityId, projectId),
          isNull(portalMessages.deletedAt),
        ),
        orderBy: [asc(portalMessages.createdAt)],
      }),
    );
  }

  async create(tenantId: string, actorId: string, projectId: string, input: CreatePortalMessageInput) {
    await this.authorizeCreate(tenantId, actorId, projectId);

    return withTenant(this.db, tenantId, async (tx) => {
      const project = await tx.query.projects.findFirst({
        where: and(eq(projects.id, projectId), isNull(projects.deletedAt)),
      });
      if (!project) throw new ProjectNotFoundError();

      const [created] = await tx
        .insert(portalMessages)
        .values({ tenantId, entityType: "project", entityId: projectId, audience: "client", body: input.body, createdBy: actorId })
        .returning();
      const message = created!;

      await this.outbox.append(tx, {
        tenantId,
        eventType: "portal_message.created.v1",
        dedupeKey: `portal_message.created.v1:${message.id}`,
        actorId,
        payload: { companyId: tenantId, entityType: "project", entityId: projectId, messageId: message.id, audience: "client" },
      });

      return message;
    });
  }

  private async authorizeRead(tenantId: string, actorId: string, projectId: string): Promise<void> {
    const hasPermission = await this.permissions.has(tenantId, actorId, "client.message.read");
    if (hasPermission) return;
    const hasShare = await this.externalShares.hasAccess(tenantId, actorId, "project", projectId, "view");
    if (!hasShare) throw new PortalMessageReadDeniedError();
  }

  private async authorizeCreate(tenantId: string, actorId: string, projectId: string): Promise<void> {
    const hasPermission = await this.permissions.has(tenantId, actorId, "client.message.create");
    if (hasPermission) return;
    const hasShare = await this.externalShares.hasAccess(tenantId, actorId, "project", projectId, "comment");
    if (!hasShare) throw new PortalMessageCreateDeniedError();
  }
}
