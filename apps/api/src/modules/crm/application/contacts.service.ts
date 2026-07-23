import { Inject, Injectable } from "@nestjs/common";
import type { CreateContactInput, ListContactsQuery, UpdateContactInput } from "@constructionos/schemas";
import { and, desc, eq, ilike, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import { contacts } from "../../../infrastructure/db/schema";
import { OutboxService } from "../../events";
import { ContactNotFoundError } from "../domain/errors";

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

// database.md §8 (M1): "people (clients, architects, reps)."
@Injectable()
export class ContactsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly outbox: OutboxService,
  ) {}

  async list(tenantId: string, query: ListContactsQuery) {
    return withTenant(this.db, tenantId, async (tx) => {
      const conditions: SQL[] = [isNull(contacts.deletedAt)];
      if (query.contactCompanyId) conditions.push(eq(contacts.contactCompanyId, query.contactCompanyId));
      if (query.q) {
        conditions.push(
          or(
            ilike(sql`${contacts.firstName} || ' ' || ${contacts.lastName}`, `%${query.q}%`),
            ilike(contacts.email, `%${query.q}%`),
          )!,
        );
      }
      if (query.cursor) {
        const c = decodeCursor(query.cursor);
        conditions.push(
          or(lt(contacts.createdAt, new Date(c.createdAt)), and(eq(contacts.createdAt, new Date(c.createdAt)), lt(contacts.id, c.id))!)!,
        );
      }

      const rows = await tx.query.contacts.findMany({
        where: and(...conditions),
        orderBy: [desc(contacts.createdAt), desc(contacts.id)],
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
    return withTenant(this.db, tenantId, (tx) => this.requireContact(tx, id));
  }

  async create(tenantId: string, actorId: string, input: CreateContactInput) {
    return withTenant(this.db, tenantId, async (tx) => {
      const [created] = await tx
        .insert(contacts)
        .values({ tenantId, ...input, createdBy: actorId })
        .returning();

      await this.outbox.append(tx, {
        tenantId,
        eventType: "contact.created.v1",
        dedupeKey: `contact.created.v1:${created!.id}`,
        actorId,
        payload: { companyId: tenantId, contactId: created!.id },
      });

      return created!;
    });
  }

  async update(tenantId: string, actorId: string, id: string, input: UpdateContactInput) {
    return withTenant(this.db, tenantId, async (tx) => {
      await this.requireContact(tx, id);
      const [updated] = await tx
        .update(contacts)
        .set({ ...input, updatedBy: actorId })
        .where(eq(contacts.id, id))
        .returning();
      return updated!;
    });
  }

  async remove(tenantId: string, actorId: string, id: string): Promise<void> {
    await withTenant(this.db, tenantId, async (tx) => {
      await this.requireContact(tx, id);
      await tx.update(contacts).set({ deletedAt: new Date(), updatedBy: actorId }).where(eq(contacts.id, id));
    });
  }

  private async requireContact(tx: Database, id: string) {
    const row = await tx.query.contacts.findFirst({ where: and(eq(contacts.id, id), isNull(contacts.deletedAt)) });
    if (!row) throw new ContactNotFoundError();
    return row;
  }
}
