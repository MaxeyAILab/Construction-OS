import { Inject, Injectable } from "@nestjs/common";
import type { ResourceConflictsQuery } from "@constructionos/schemas";
import { sql } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";

interface ConflictRow {
  resource_key: string;
  resource_type: "crew" | "equipment";
  a_id: string;
  a_activity_id: string;
  a_start_at: Date;
  a_end_at: Date;
  b_id: string;
  b_activity_id: string;
  b_start_at: Date;
  b_end_at: Date;
}

// api.md §6: "GET /resources/conflicts?from=&to= | schedule.resources |
// Cross-project crew/equipment conflicts (FR-SCH-5)." Reads through the
// GIST index resource_assignments carries specifically for this (see that
// table's own schema comment) via a self-join on matching resource_key
// with overlapping tstzranges — cross-project by design (RLS scopes to the
// tenant, not a single project), matching database.md §14's own "cross-
// project resource views" framing.
@Injectable()
export class ResourceConflictsService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async listConflicts(tenantId: string, query: ResourceConflictsQuery) {
    return withTenant(this.db, tenantId, async (tx) => {
      const rows = (await tx.execute(sql`
        select
          ra1.resource_key as resource_key,
          ra1.resource_type as resource_type,
          ra1.id as a_id, ra1.activity_id as a_activity_id, ra1.start_at as a_start_at, ra1.end_at as a_end_at,
          ra2.id as b_id, ra2.activity_id as b_activity_id, ra2.start_at as b_start_at, ra2.end_at as b_end_at
        from resource_assignments ra1
        join resource_assignments ra2
          on ra1.resource_key = ra2.resource_key
          and ra1.id < ra2.id
          and tstzrange(ra1.start_at, ra1.end_at, '[)') && tstzrange(ra2.start_at, ra2.end_at, '[)')
        where ra1.deleted_at is null and ra2.deleted_at is null
          and ra1.start_at < ${query.to}::timestamptz
          and ra1.end_at > ${query.from}::timestamptz
        order by ra1.start_at
      `)) as unknown as ConflictRow[];

      return rows.map((row) => ({
        resourceKey: row.resource_key,
        resourceType: row.resource_type,
        a: { resourceAssignmentId: row.a_id, activityId: row.a_activity_id, startAt: row.a_start_at, endAt: row.a_end_at },
        b: { resourceAssignmentId: row.b_id, activityId: row.b_activity_id, startAt: row.b_start_at, endAt: row.b_end_at },
      }));
    });
  }
}
