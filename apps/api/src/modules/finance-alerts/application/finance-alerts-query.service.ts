import { Inject, Injectable } from "@nestjs/common";
import type { ListFinanceAlertsQuery } from "@constructionos/schemas";
import { and, desc, eq, lt, or, type SQL } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import { financeAlerts } from "../../../infrastructure/db/schema";

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

// api.md §10: `GET /finance/alerts` — "Margin-erosion & anomaly feed
// (FR-FIN-6)." Company-wide across all the caller's projects, not
// project-scoped in the URL — reuses finance.budget.read (same "read"
// shorthand api.md uses for /crm/opportunities/{id}/ai-insights) since
// alerts are a derived view over the same budget data that permission
// already governs.
@Injectable()
export class FinanceAlertsQueryService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async list(tenantId: string, query: ListFinanceAlertsQuery) {
    return withTenant(this.db, tenantId, async (tx) => {
      const conditions: SQL[] = [];
      if (query.projectId) conditions.push(eq(financeAlerts.projectId, query.projectId));
      if (query.cursor) {
        const c = decodeCursor(query.cursor);
        conditions.push(
          or(
            lt(financeAlerts.createdAt, new Date(c.createdAt)),
            and(eq(financeAlerts.createdAt, new Date(c.createdAt)), lt(financeAlerts.id, c.id))!,
          )!,
        );
      }

      const rows = await tx.query.financeAlerts.findMany({
        where: conditions.length > 0 ? and(...conditions) : undefined,
        orderBy: [desc(financeAlerts.createdAt), desc(financeAlerts.id)],
        limit: query.limit + 1,
      });

      const hasMore = rows.length > query.limit;
      const page = rows.slice(0, query.limit);
      const last = page.at(-1);
      const nextCursor = hasMore && last ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id }) : null;

      return { data: page, meta: { cursor: nextCursor, hasMore } };
    });
  }
}
