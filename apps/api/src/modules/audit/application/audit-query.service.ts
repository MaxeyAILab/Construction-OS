import { Inject, Injectable } from "@nestjs/common";
import type { ListAuditLogQuery } from "@constructionos/schemas";
import { and, eq, gte, lt, lte, or } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import { auditLog } from "../../../infrastructure/db/schema";

interface Cursor {
  occurredAt: string;
  id: string;
}

function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify(c)).toString("base64url");
}

function decodeCursor(raw: string): Cursor {
  return JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Cursor;
}

@Injectable()
export class AuditQueryService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  // api.md §15: GET /admin/audit-log — "Filter: actor, entity, action, date".
  async list(tenantId: string, query: ListAuditLogQuery) {
    return withTenant(this.db, tenantId, async (tx) => {
      const conditions = [eq(auditLog.tenantId, tenantId)];
      if (query.actorId) conditions.push(eq(auditLog.actorId, query.actorId));
      if (query.entityType) conditions.push(eq(auditLog.entityType, query.entityType));
      if (query.entityId) conditions.push(eq(auditLog.entityId, query.entityId));
      if (query.action) conditions.push(eq(auditLog.action, query.action));
      if (query.occurredFrom)
        conditions.push(gte(auditLog.occurredAt, new Date(query.occurredFrom)));
      if (query.occurredTo) conditions.push(lte(auditLog.occurredAt, new Date(query.occurredTo)));
      if (query.cursor) {
        const c = decodeCursor(query.cursor);
        conditions.push(
          or(
            lt(auditLog.occurredAt, new Date(c.occurredAt)),
            and(eq(auditLog.occurredAt, new Date(c.occurredAt)), lt(auditLog.id, c.id)),
          )!,
        );
      }

      const rows = await tx.query.auditLog.findMany({
        where: and(...conditions),
        orderBy: (a, { desc }) => [desc(a.occurredAt), desc(a.id)],
        limit: query.limit + 1,
      });

      const hasMore = rows.length > query.limit;
      const page = rows.slice(0, query.limit);
      const last = page.at(-1);
      const nextCursor =
        hasMore && last
          ? encodeCursor({ occurredAt: last.occurredAt.toISOString(), id: last.id })
          : null;

      return { data: page, meta: { cursor: nextCursor, hasMore } };
    });
  }
}
