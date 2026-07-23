import { Inject, Injectable } from "@nestjs/common";
import type { CreateEquipmentInput, ListEquipmentQuery, UpdateEquipmentInput } from "@constructionos/schemas";
import { and, desc, eq, ilike, isNull, lt, or, type SQL } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import { equipment } from "../../../infrastructure/db/schema";
import { OutboxService } from "../../events";
import { DuplicateAssetNoError, EquipmentNotFoundError } from "../domain/errors";

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

// database.md §13 (M11): equipment registry (FR-EQ-1).
@Injectable()
export class EquipmentService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly outbox: OutboxService,
  ) {}

  async list(tenantId: string, query: ListEquipmentQuery) {
    return withTenant(this.db, tenantId, async (tx) => {
      const conditions: SQL[] = [isNull(equipment.deletedAt)];
      if (query.q) conditions.push(ilike(equipment.name, `%${query.q}%`));
      if (query.status) conditions.push(eq(equipment.status, query.status));
      if (query.category) conditions.push(eq(equipment.category, query.category));
      if (query.cursor) {
        const c = decodeCursor(query.cursor);
        conditions.push(
          or(
            lt(equipment.createdAt, new Date(c.createdAt)),
            and(eq(equipment.createdAt, new Date(c.createdAt)), lt(equipment.id, c.id))!,
          )!,
        );
      }

      const rows = await tx.query.equipment.findMany({
        where: and(...conditions),
        orderBy: [desc(equipment.createdAt), desc(equipment.id)],
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
    return withTenant(this.db, tenantId, (tx) => this.requireEquipment(tx, id));
  }

  async create(tenantId: string, actorId: string, input: CreateEquipmentInput) {
    return withTenant(this.db, tenantId, async (tx) => {
      const existing = await tx.query.equipment.findFirst({
        where: and(eq(equipment.tenantId, tenantId), eq(equipment.assetNo, input.assetNo)),
      });
      if (existing) throw new DuplicateAssetNoError();

      const [created] = await tx
        .insert(equipment)
        .values({ tenantId, ...input, createdBy: actorId })
        .returning();

      await this.outbox.append(tx, {
        tenantId,
        eventType: "equipment.created.v1",
        dedupeKey: `equipment.created.v1:${created!.id}`,
        actorId,
        payload: { companyId: tenantId, equipmentId: created!.id },
      });

      return created!;
    });
  }

  async update(tenantId: string, actorId: string, id: string, input: UpdateEquipmentInput) {
    return withTenant(this.db, tenantId, async (tx) => {
      await this.requireEquipment(tx, id);
      const [updated] = await tx
        .update(equipment)
        .set({ ...input, updatedBy: actorId })
        .where(eq(equipment.id, id))
        .returning();
      return updated!;
    });
  }

  async requireEquipment(tx: Database, id: string) {
    const row = await tx.query.equipment.findFirst({
      where: and(eq(equipment.id, id), isNull(equipment.deletedAt)),
    });
    if (!row) throw new EquipmentNotFoundError();
    return row;
  }
}
