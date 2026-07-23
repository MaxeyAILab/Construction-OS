import { Inject, Injectable } from "@nestjs/common";
import type { CreateInventoryLocationInput, ListInventoryLocationsQuery } from "@constructionos/schemas";
import { and, desc, eq, isNull, lt, or, type SQL } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import { inventoryLocations, projects } from "../../../infrastructure/db/schema";
import { OutboxService } from "../../events";
import { InventoryLocationNotFoundError, ProjectNotFoundError } from "../domain/errors";

interface Cursor {
  createdAt: string;
  id: string;
}

function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify(c)).toString("base64url");
}

function decodeCursor(raw: string): Cursor {
  return JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Cursor;
}

// database.md §12 (M10): "warehouses & job-site stores" (FR-INV-1).
@Injectable()
export class InventoryLocationsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly outbox: OutboxService,
  ) {}

  async list(tenantId: string, query: ListInventoryLocationsQuery) {
    return withTenant(this.db, tenantId, async (tx) => {
      const conditions: SQL[] = [isNull(inventoryLocations.deletedAt)];
      if (query.projectId) conditions.push(eq(inventoryLocations.projectId, query.projectId));
      if (query.cursor) {
        const c = decodeCursor(query.cursor);
        conditions.push(
          or(
            lt(inventoryLocations.createdAt, new Date(c.createdAt)),
            and(eq(inventoryLocations.createdAt, new Date(c.createdAt)), lt(inventoryLocations.id, c.id))!,
          )!,
        );
      }

      const rows = await tx.query.inventoryLocations.findMany({
        where: and(...conditions),
        orderBy: [desc(inventoryLocations.createdAt), desc(inventoryLocations.id)],
        limit: query.limit + 1,
      });

      const hasMore = rows.length > query.limit;
      const page = rows.slice(0, query.limit);
      const last = page.at(-1);
      const nextCursor = hasMore && last ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id }) : null;

      return { data: page, meta: { cursor: nextCursor, hasMore } };
    });
  }

  async getById(tenantId: string, id: string) {
    return withTenant(this.db, tenantId, (tx) => this.requireLocation(tx, id));
  }

  async create(tenantId: string, actorId: string, input: CreateInventoryLocationInput) {
    return withTenant(this.db, tenantId, async (tx) => {
      if (input.projectId) {
        const project = await tx.query.projects.findFirst({ where: eq(projects.id, input.projectId) });
        if (!project) throw new ProjectNotFoundError();
      }

      const [created] = await tx
        .insert(inventoryLocations)
        .values({ tenantId, ...input, createdBy: actorId })
        .returning();

      await this.outbox.append(tx, {
        tenantId,
        eventType: "inventory_location.created.v1",
        dedupeKey: `inventory_location.created.v1:${created!.id}`,
        actorId,
        payload: { companyId: tenantId, inventoryLocationId: created!.id },
      });

      return created!;
    });
  }

  async requireLocation(tx: Database, id: string) {
    const row = await tx.query.inventoryLocations.findFirst({
      where: and(eq(inventoryLocations.id, id), isNull(inventoryLocations.deletedAt)),
    });
    if (!row) throw new InventoryLocationNotFoundError();
    return row;
  }
}
