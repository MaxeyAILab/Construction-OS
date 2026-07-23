import { Inject, Injectable } from "@nestjs/common";
import type { CreateSupplierInput, ListSuppliersQuery, UpdateSupplierInput } from "@constructionos/schemas";
import { and, desc, eq, ilike, isNull, lt, or, type SQL } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import { suppliers } from "../../../infrastructure/db/schema";
import { OutboxService } from "../../events";
import { SupplierNotFoundError } from "../domain/errors";

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

// database.md §12 (M5): supplier registry (FR-PROC-2). `rating` stays
// null until Procurement AI (FR-PROC-5, a separate later roadmap row)
// starts maintaining it.
@Injectable()
export class SuppliersService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly outbox: OutboxService,
  ) {}

  async list(tenantId: string, query: ListSuppliersQuery) {
    return withTenant(this.db, tenantId, async (tx) => {
      const conditions: SQL[] = [isNull(suppliers.deletedAt)];
      if (query.q) conditions.push(ilike(suppliers.name, `%${query.q}%`));
      if (query.status) conditions.push(eq(suppliers.status, query.status));
      if (query.cursor) {
        const c = decodeCursor(query.cursor);
        conditions.push(
          or(
            lt(suppliers.createdAt, new Date(c.createdAt)),
            and(eq(suppliers.createdAt, new Date(c.createdAt)), lt(suppliers.id, c.id))!,
          )!,
        );
      }

      const rows = await tx.query.suppliers.findMany({
        where: and(...conditions),
        orderBy: [desc(suppliers.createdAt), desc(suppliers.id)],
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
    return withTenant(this.db, tenantId, (tx) => this.requireSupplier(tx, id));
  }

  async create(tenantId: string, actorId: string, input: CreateSupplierInput) {
    return withTenant(this.db, tenantId, async (tx) => {
      const [created] = await tx
        .insert(suppliers)
        .values({ tenantId, ...input, createdBy: actorId })
        .returning();

      await this.outbox.append(tx, {
        tenantId,
        eventType: "supplier.created.v1",
        dedupeKey: `supplier.created.v1:${created!.id}`,
        actorId,
        payload: { companyId: tenantId, supplierId: created!.id },
      });

      return created!;
    });
  }

  async update(tenantId: string, actorId: string, id: string, input: UpdateSupplierInput) {
    return withTenant(this.db, tenantId, async (tx) => {
      await this.requireSupplier(tx, id);
      const [updated] = await tx
        .update(suppliers)
        .set({ ...input, updatedBy: actorId })
        .where(eq(suppliers.id, id))
        .returning();
      return updated!;
    });
  }

  async requireSupplier(tx: Database, id: string) {
    const row = await tx.query.suppliers.findFirst({
      where: and(eq(suppliers.id, id), isNull(suppliers.deletedAt)),
    });
    if (!row) throw new SupplierNotFoundError();
    return row;
  }
}
