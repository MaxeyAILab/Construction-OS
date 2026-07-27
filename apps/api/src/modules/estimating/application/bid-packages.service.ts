import { Inject, Injectable } from "@nestjs/common";
import type { CreateBidPackageInput, UpdateBidPackageInput } from "@constructionos/schemas";
import { and, eq, isNull } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import { bidPackages, projects } from "../../../infrastructure/db/schema";
import { OutboxService } from "../../events";
import { BidPackageNotFoundError, ProjectNotFoundError } from "../domain/errors";

// database.md §10 (M2): "Bid process to subs (FR-EST-6): package (scope +
// docs) ..." — see estimates.ts schema file's doc comment for why this
// was deferred until Subcontractor mgmt (M14) existed.
@Injectable()
export class BidPackagesService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly outbox: OutboxService,
  ) {}

  async listForProject(tenantId: string, projectId: string) {
    return withTenant(this.db, tenantId, (tx) =>
      tx.query.bidPackages.findMany({
        where: and(eq(bidPackages.projectId, projectId), isNull(bidPackages.deletedAt)),
        orderBy: (t, { desc }) => [desc(t.createdAt)],
      }),
    );
  }

  async getById(tenantId: string, id: string) {
    return withTenant(this.db, tenantId, (tx) => this.requireBidPackage(tx, id));
  }

  async create(tenantId: string, actorId: string, projectId: string, input: CreateBidPackageInput) {
    return withTenant(this.db, tenantId, async (tx) => {
      const project = await tx.query.projects.findFirst({ where: eq(projects.id, projectId) });
      if (!project) throw new ProjectNotFoundError();

      const [created] = await tx
        .insert(bidPackages)
        .values({
          tenantId,
          projectId,
          name: input.name,
          scope: input.scope,
          dueDate: input.dueDate,
          createdBy: actorId,
        })
        .returning();

      await this.outbox.append(tx, {
        tenantId,
        eventType: "bid_package.created.v1",
        dedupeKey: `bid_package.created.v1:${created!.id}`,
        actorId,
        payload: { companyId: tenantId, projectId, bidPackageId: created!.id },
      });

      return created!;
    });
  }

  async update(tenantId: string, actorId: string, id: string, input: UpdateBidPackageInput) {
    return withTenant(this.db, tenantId, async (tx) => {
      await this.requireBidPackage(tx, id);
      const [updated] = await tx
        .update(bidPackages)
        .set({ ...input, updatedBy: actorId })
        .where(eq(bidPackages.id, id))
        .returning();
      return updated!;
    });
  }

  async requireBidPackage(tx: Database, id: string) {
    const row = await tx.query.bidPackages.findFirst({
      where: and(eq(bidPackages.id, id), isNull(bidPackages.deletedAt)),
    });
    if (!row) throw new BidPackageNotFoundError();
    return row;
  }
}
