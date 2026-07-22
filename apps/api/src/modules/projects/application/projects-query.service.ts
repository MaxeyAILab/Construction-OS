import { Inject, Injectable } from "@nestjs/common";
import type { ListProjectsQuery } from "@constructionos/schemas";
import { and, asc, desc, eq, gt, ilike, isNull, lt, or, type SQL } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import { projects } from "../../../infrastructure/db/schema";

interface Cursor {
  sortValue: string;
  id: string;
}

function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify(c)).toString("base64url");
}

function decodeCursor(raw: string): Cursor {
  return JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Cursor;
}

const SORT_COLUMNS = {
  name: projects.name,
  start_date: projects.startDate,
  created_at: projects.createdAt,
} as const;

function parseSort(sort: ListProjectsQuery["sort"]): { column: (typeof SORT_COLUMNS)[keyof typeof SORT_COLUMNS]; direction: "asc" | "desc" } {
  const desc_ = sort.startsWith("-");
  const field = (desc_ ? sort.slice(1) : sort) as keyof typeof SORT_COLUMNS;
  return { column: SORT_COLUMNS[field], direction: desc_ ? "desc" : "asc" };
}

@Injectable()
export class ProjectsQueryService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  // api.md §3: GET /projects — "filter: status, q, client; sort: name,
  // start_date, health" (health sorting deferred — it's a computed jsonb
  // field, not a simple column, until real health scoring exists).
  async list(tenantId: string, query: ListProjectsQuery) {
    return withTenant(this.db, tenantId, async (tx) => {
      const { column, direction } = parseSort(query.sort);
      const conditions: SQL[] = [eq(projects.tenantId, tenantId), isNull(projects.deletedAt)];
      if (query.status) conditions.push(eq(projects.status, query.status));
      if (query.clientContactCompanyId) {
        conditions.push(eq(projects.clientContactCompanyId, query.clientContactCompanyId));
      }
      if (query.q) conditions.push(ilike(projects.name, `%${query.q}%`));
      if (query.cursor) {
        const c = decodeCursor(query.cursor);
        const cmp = direction === "desc" ? lt : gt;
        conditions.push(
          or(cmp(column, c.sortValue), and(eq(column, c.sortValue), cmp(projects.id, c.id))!)!,
        );
      }

      const rows = await tx.query.projects.findMany({
        where: and(...conditions),
        orderBy:
          direction === "desc" ? [desc(column), desc(projects.id)] : [asc(column), asc(projects.id)],
        limit: query.limit + 1,
      });

      const hasMore = rows.length > query.limit;
      const page = rows.slice(0, query.limit);
      const last = page.at(-1);
      const nextCursor =
        hasMore && last
          ? encodeCursor({ sortValue: String(last[toKey(query.sort)] ?? ""), id: last.id })
          : null;

      return { data: page, meta: { cursor: nextCursor, hasMore } };
    });
  }
}

function toKey(sort: ListProjectsQuery["sort"]): "name" | "startDate" | "createdAt" {
  const field = sort.startsWith("-") ? sort.slice(1) : sort;
  return field === "name" ? "name" : field === "start_date" ? "startDate" : "createdAt";
}
