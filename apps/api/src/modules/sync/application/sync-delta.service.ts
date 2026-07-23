import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq, gt, inArray } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import { dailyReports, projectUsers, tasks, timeEntries } from "../../../infrastructure/db/schema";

const PAGE_SIZE = 200;

// api.md §16.2: "GET /sync/delta?since_seq=&scopes= — Keyset delta for
// working set; tombstones included." Scoped to the caller's assigned
// projects (architecture.md §14.2's "working set: server-defined...
// assigned projects"), not every row in the tenant. Soft-deleted rows are
// returned as tombstones (deletedAt set) rather than omitted — the client
// needs to know to purge them locally, not just never hear about them
// again. updated_seq is a single per-tenant sequence shared across every
// table (database.md §3's trigger), so nextSinceSeq is one watermark that
// advances correctly across all three scopes together.
@Injectable()
export class SyncDeltaService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async getDelta(tenantId: string, userId: string, sinceSeq: number, scopes: string[]) {
    return withTenant(this.db, tenantId, async (tx) => {
      const memberships = await tx.query.projectUsers.findMany({ where: eq(projectUsers.userId, userId) });
      const projectIds = memberships.map((m) => m.projectId);

      let nextSinceSeq = sinceSeq;

      const taskRows =
        scopes.includes("tasks") && projectIds.length > 0
          ? await tx.query.tasks.findMany({
              where: and(inArray(tasks.projectId, projectIds), gt(tasks.updatedSeq, sinceSeq)),
              orderBy: [asc(tasks.updatedSeq)],
              limit: PAGE_SIZE,
            })
          : [];
      nextSinceSeq = maxSeq(nextSinceSeq, taskRows);

      const dailyReportRows =
        scopes.includes("daily_reports") && projectIds.length > 0
          ? await tx.query.dailyReports.findMany({
              where: and(inArray(dailyReports.projectId, projectIds), gt(dailyReports.updatedSeq, sinceSeq)),
              orderBy: [asc(dailyReports.updatedSeq)],
              limit: PAGE_SIZE,
            })
          : [];
      nextSinceSeq = maxSeq(nextSinceSeq, dailyReportRows);

      const timeEntryRows =
        scopes.includes("time_entries") && projectIds.length > 0
          ? await tx.query.timeEntries.findMany({
              where: and(inArray(timeEntries.projectId, projectIds), gt(timeEntries.updatedSeq, sinceSeq)),
              orderBy: [asc(timeEntries.updatedSeq)],
              limit: PAGE_SIZE,
            })
          : [];
      nextSinceSeq = maxSeq(nextSinceSeq, timeEntryRows);

      return { tasks: taskRows, dailyReports: dailyReportRows, timeEntries: timeEntryRows, nextSinceSeq };
    });
  }
}

function maxSeq(current: number, rows: { updatedSeq: number }[]): number {
  if (rows.length === 0) return current;
  return Math.max(current, Number(rows[rows.length - 1]!.updatedSeq));
}
