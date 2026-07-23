import { Inject, Injectable } from "@nestjs/common";
import type { CreateInventoryItemInput, ListInventoryItemsQuery } from "@constructionos/schemas";
import { and, desc, eq, ilike, isNull, lt, or, type SQL } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import { inventoryItems } from "../../../infrastructure/db/schema";
import { OutboxService } from "../../events";
import { DuplicateSkuError, InventoryItemNotFoundError } from "../domain/errors";

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

// database.md §12 (M10): tenant-wide item catalog (FR-INV-1).
@Injectable()
export class InventoryItemsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly outbox: OutboxService,
  ) {}

  async list(tenantId: string, query: ListInventoryItemsQuery) {
    return withTenant(this.db, tenantId, async (tx) => {
      const conditions: SQL[] = [isNull(inventoryItems.deletedAt)];
      if (query.q) conditions.push(ilike(inventoryItems.name, `%${query.q}%`));
      if (query.category) conditions.push(eq(inventoryItems.category, query.category));
      if (query.cursor) {
        const c = decodeCursor(query.cursor);
        conditions.push(
          or(
            lt(inventoryItems.createdAt, new Date(c.createdAt)),
            and(eq(inventoryItems.createdAt, new Date(c.createdAt)), lt(inventoryItems.id, c.id))!,
          )!,
        );
      }

      const rows = await tx.query.inventoryItems.findMany({
        where: and(...conditions),
        orderBy: [desc(inventoryItems.createdAt), desc(inventoryItems.id)],
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
    return withTenant(this.db, tenantId, (tx) => this.requireItem(tx, id));
  }

  async create(tenantId: string, actorId: string, input: CreateInventoryItemInput) {
    return withTenant(this.db, tenantId, async (tx) => {
      const existing = await tx.query.inventoryItems.findFirst({
        where: and(eq(inventoryItems.tenantId, tenantId), eq(inventoryItems.sku, input.sku)),
      });
      if (existing) throw new DuplicateSkuError();

      const [created] = await tx
        .insert(inventoryItems)
        .values({ tenantId, ...input, createdBy: actorId })
        .returning();

      await this.outbox.append(tx, {
        tenantId,
        eventType: "inventory_item.created.v1",
        dedupeKey: `inventory_item.created.v1:${created!.id}`,
        actorId,
        payload: { companyId: tenantId, inventoryItemId: created!.id },
      });

      return created!;
    });
  }

  async requireItem(tx: Database, id: string) {
    const row = await tx.query.inventoryItems.findFirst({
      where: and(eq(inventoryItems.id, id), isNull(inventoryItems.deletedAt)),
    });
    if (!row) throw new InventoryItemNotFoundError();
    return row;
  }
}
