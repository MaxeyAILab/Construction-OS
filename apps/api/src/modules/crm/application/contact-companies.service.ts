import { Inject, Injectable } from "@nestjs/common";
import type { CreateContactCompanyInput, ListContactCompaniesQuery, UpdateContactCompanyInput } from "@constructionos/schemas";
import { and, desc, eq, ilike, isNull, lt, or, type SQL } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import { contactCompanies } from "../../../infrastructure/db/schema";
import { OutboxService } from "../../events";
import { ContactCompanyNotFoundError } from "../domain/errors";

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

// database.md §8 (M1): "external organizations (client orgs, design
// firms)." api.md §4 groups this under the same crm.contact.* permission
// namespace as contacts — a documented simplification, not a separate
// crm.contactcompany.*.
@Injectable()
export class ContactCompaniesService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly outbox: OutboxService,
  ) {}

  async list(tenantId: string, query: ListContactCompaniesQuery) {
    return withTenant(this.db, tenantId, async (tx) => {
      const conditions: SQL[] = [isNull(contactCompanies.deletedAt)];
      if (query.q) conditions.push(ilike(contactCompanies.name, `%${query.q}%`));
      if (query.cursor) {
        const c = decodeCursor(query.cursor);
        conditions.push(
          or(
            lt(contactCompanies.createdAt, new Date(c.createdAt)),
            and(eq(contactCompanies.createdAt, new Date(c.createdAt)), lt(contactCompanies.id, c.id))!,
          )!,
        );
      }

      const rows = await tx.query.contactCompanies.findMany({
        where: and(...conditions),
        orderBy: [desc(contactCompanies.createdAt), desc(contactCompanies.id)],
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
    return withTenant(this.db, tenantId, (tx) => this.requireContactCompany(tx, id));
  }

  async create(tenantId: string, actorId: string, input: CreateContactCompanyInput) {
    return withTenant(this.db, tenantId, async (tx) => {
      const [created] = await tx
        .insert(contactCompanies)
        .values({ tenantId, ...input, createdBy: actorId })
        .returning();

      await this.outbox.append(tx, {
        tenantId,
        eventType: "contact_company.created.v1",
        dedupeKey: `contact_company.created.v1:${created!.id}`,
        actorId,
        payload: { companyId: tenantId, contactCompanyId: created!.id },
      });

      return created!;
    });
  }

  async update(tenantId: string, actorId: string, id: string, input: UpdateContactCompanyInput) {
    return withTenant(this.db, tenantId, async (tx) => {
      await this.requireContactCompany(tx, id);
      const [updated] = await tx
        .update(contactCompanies)
        .set({ ...input, updatedBy: actorId })
        .where(eq(contactCompanies.id, id))
        .returning();
      return updated!;
    });
  }

  async remove(tenantId: string, actorId: string, id: string): Promise<void> {
    await withTenant(this.db, tenantId, async (tx) => {
      await this.requireContactCompany(tx, id);
      await tx.update(contactCompanies).set({ deletedAt: new Date(), updatedBy: actorId }).where(eq(contactCompanies.id, id));
    });
  }

  private async requireContactCompany(tx: Database, id: string) {
    const row = await tx.query.contactCompanies.findFirst({
      where: and(eq(contactCompanies.id, id), isNull(contactCompanies.deletedAt)),
    });
    if (!row) throw new ContactCompanyNotFoundError();
    return row;
  }
}
