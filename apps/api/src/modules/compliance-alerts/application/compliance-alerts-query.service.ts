import { Inject, Injectable } from "@nestjs/common";
import type { ListComplianceAlertsQuery } from "@constructionos/schemas";
import { and, desc, eq, lt, or, type SQL } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import { complianceAlerts } from "../../../infrastructure/db/schema";

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

// api.md §15.4: `GET /compliance/alerts` — same "derived view over data
// that permission already governs" reasoning as FinanceAlertsQueryService
// reusing finance.budget.read, here reusing safety.certification.read.
@Injectable()
export class ComplianceAlertsQueryService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async list(tenantId: string, query: ListComplianceAlertsQuery) {
    return withTenant(this.db, tenantId, async (tx) => {
      const conditions: SQL[] = [];
      if (query.subcontractorId) conditions.push(eq(complianceAlerts.subcontractorId, query.subcontractorId));
      if (query.cursor) {
        const c = decodeCursor(query.cursor);
        conditions.push(
          or(
            lt(complianceAlerts.createdAt, new Date(c.createdAt)),
            and(eq(complianceAlerts.createdAt, new Date(c.createdAt)), lt(complianceAlerts.id, c.id))!,
          )!,
        );
      }

      const rows = await tx.query.complianceAlerts.findMany({
        where: conditions.length > 0 ? and(...conditions) : undefined,
        orderBy: [desc(complianceAlerts.createdAt), desc(complianceAlerts.id)],
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
