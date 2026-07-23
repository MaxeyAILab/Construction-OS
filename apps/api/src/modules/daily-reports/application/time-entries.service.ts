import { Inject, Injectable } from "@nestjs/common";
import type { CreateTimeEntryInput, ListTimeEntriesQuery } from "@constructionos/schemas";
import { and, desc, eq, gte, isNull, lte, lt, or, type SQL } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import { companyUsers, costCodes, projects, timeEntries } from "../../../infrastructure/db/schema";
import { CostTransactionsService } from "../../budgets";
import { OutboxService } from "../../events";
import { CostCodeNotOnProjectError, ProjectNotFoundError, TimeEntryAlreadyApprovedError, TimeEntryNotFoundError } from "../domain/errors";

interface Cursor {
  workDate: string;
  id: string;
}

function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify(c)).toString("base64url");
}

function decodeCursor(raw: string): Cursor {
  return JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Cursor;
}

// database.md §15 (M8, FR-FIELD-2): "Append-only ... Approval ->
// cost_transactions at labor rate." No update/delete after creation —
// corrections are a new entry, matching cost_transactions' own ledger
// pattern.
@Injectable()
export class TimeEntriesService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly outbox: OutboxService,
    private readonly costTransactions: CostTransactionsService,
  ) {}

  async list(tenantId: string, query: ListTimeEntriesQuery) {
    return withTenant(this.db, tenantId, async (tx) => {
      const conditions: SQL[] = [];
      if (query.projectId) conditions.push(eq(timeEntries.projectId, query.projectId));
      if (query.userId) conditions.push(eq(timeEntries.userId, query.userId));
      if (query.dailyReportId) conditions.push(eq(timeEntries.dailyReportId, query.dailyReportId));
      if (query.workDateBefore) conditions.push(lte(timeEntries.workDate, query.workDateBefore));
      if (query.workDateAfter) conditions.push(gte(timeEntries.workDate, query.workDateAfter));
      if (query.cursor) {
        const c = decodeCursor(query.cursor);
        conditions.push(
          or(lt(timeEntries.workDate, c.workDate), and(eq(timeEntries.workDate, c.workDate), lt(timeEntries.id, c.id))!)!,
        );
      }

      const rows = await tx.query.timeEntries.findMany({
        where: conditions.length > 0 ? and(...conditions) : undefined,
        orderBy: [desc(timeEntries.workDate), desc(timeEntries.id)],
        limit: query.limit + 1,
      });

      const hasMore = rows.length > query.limit;
      const page = rows.slice(0, query.limit);
      const last = page.at(-1);
      const nextCursor = hasMore && last ? encodeCursor({ workDate: last.workDate, id: last.id }) : null;

      return { data: page, meta: { cursor: nextCursor, hasMore } };
    });
  }

  async getById(tenantId: string, id: string) {
    return withTenant(this.db, tenantId, (tx) => this.requireEntry(tx, id));
  }

  async create(tenantId: string, actorId: string, input: CreateTimeEntryInput, explicitId?: string) {
    return withTenant(this.db, tenantId, async (tx) => {
      const project = await tx.query.projects.findFirst({ where: eq(projects.id, input.projectId) });
      if (!project) throw new ProjectNotFoundError();

      const costCode = await tx.query.costCodes.findFirst({
        where: and(eq(costCodes.id, input.costCodeId), eq(costCodes.projectId, input.projectId)),
      });
      if (!costCode) throw new CostCodeNotOnProjectError();

      const [entry] = await tx
        .insert(timeEntries)
        .values({
          ...(explicitId ? { id: explicitId } : {}),
          tenantId,
          dailyReportId: input.dailyReportId,
          projectId: input.projectId,
          userId: input.userId,
          crewLabel: input.crewLabel,
          costCodeId: input.costCodeId,
          hours: input.hours.toFixed(2),
          workDate: input.workDate,
          kind: input.kind,
          createdBy: actorId,
        })
        .returning();
      const created = entry!;

      await this.outbox.append(tx, {
        tenantId,
        eventType: "time_entry.created.v1",
        dedupeKey: `time_entry.created.v1:${created.id}`,
        actorId,
        payload: { companyId: tenantId, projectId: input.projectId, timeEntryId: created.id },
      });

      return created;
    });
  }

  // FR-FIELD-2: posts to job costing at the worker's configured hourly
  // rate (company_users.hourlyRateAmount — a documented gap-fill, see that
  // column's schema comment: no rate configured means approval still
  // succeeds, it just doesn't post a cost transaction).
  async approve(tenantId: string, actorId: string, id: string) {
    const entry = await withTenant(this.db, tenantId, (tx) => this.requireEntry(tx, id));
    if (entry.approvedAt) throw new TimeEntryAlreadyApprovedError();

    let costTransactionId: string | null = null;
    if (entry.userId) {
      const membership = await withTenant(this.db, tenantId, (tx) =>
        tx.query.companyUsers.findFirst({ where: eq(companyUsers.userId, entry.userId!) }),
      );
      if (membership?.hourlyRateAmount) {
        const amount = (Number(membership.hourlyRateAmount) * Number(entry.hours)).toFixed(2);
        const posted = await this.costTransactions.postFromTimeEntry(tenantId, actorId, entry.projectId, {
          costCodeId: entry.costCodeId,
          timeEntryId: entry.id,
          txnDate: entry.workDate,
          amount,
          qty: entry.hours,
        });
        costTransactionId = posted.id;
      }
    }

    return withTenant(this.db, tenantId, async (tx) => {
      const [updated] = await tx
        .update(timeEntries)
        .set({ approvedBy: actorId, approvedAt: new Date(), costTransactionId, updatedBy: actorId })
        .where(eq(timeEntries.id, id))
        .returning();

      await this.outbox.append(tx, {
        tenantId,
        eventType: "time_entry.approved.v1",
        dedupeKey: `time_entry.approved.v1:${id}`,
        actorId,
        payload: { companyId: tenantId, projectId: entry.projectId, timeEntryId: id, costTransactionId },
      });

      return updated!;
    });
  }

  private async requireEntry(tx: Database, id: string) {
    const entry = await tx.query.timeEntries.findFirst({ where: and(eq(timeEntries.id, id), isNull(timeEntries.deletedAt)) });
    if (!entry) throw new TimeEntryNotFoundError();
    return entry;
  }
}
