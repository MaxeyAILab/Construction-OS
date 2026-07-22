import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq, gt, inArray } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import { projectUsers, tasks } from "../../../infrastructure/db/schema";

const PAGE_SIZE = 200;

// api.md §16.2: "GET /sync/delta?since_seq=&scopes= — Keyset delta for
// working set; tombstones included." v1 syncs 'tasks' only (same scope as
// the mutation-apply engine); scoped to the caller's assigned projects
// (architecture.md §14.2's "working set: server-defined... assigned
// projects"), not every task in the tenant. Soft-deleted rows are
// returned as tombstones (deletedAt set) rather than omitted — the client
// needs to know to purge them locally, not just never hear about them again.
@Injectable()
export class SyncDeltaService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async getDelta(tenantId: string, userId: string, sinceSeq: number, scopes: string[]) {
    if (!scopes.includes("tasks")) {
      return { tasks: [], nextSinceSeq: sinceSeq };
    }

    return withTenant(this.db, tenantId, async (tx) => {
      const memberships = await tx.query.projectUsers.findMany({
        where: eq(projectUsers.userId, userId),
      });
      const projectIds = memberships.map((m) => m.projectId);
      if (projectIds.length === 0) {
        return { tasks: [], nextSinceSeq: sinceSeq };
      }

      const rows = await tx.query.tasks.findMany({
        where: and(inArray(tasks.projectId, projectIds), gt(tasks.updatedSeq, sinceSeq)),
        orderBy: [asc(tasks.updatedSeq)],
        limit: PAGE_SIZE,
      });

      const nextSinceSeq = rows.length > 0 ? Number(rows[rows.length - 1]!.updatedSeq) : sinceSeq;
      return { tasks: rows, nextSinceSeq };
    });
  }
}
