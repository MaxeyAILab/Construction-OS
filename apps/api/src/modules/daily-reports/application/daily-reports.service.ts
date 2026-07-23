import { Inject, Injectable } from "@nestjs/common";
import type { CreateDailyReportInput, ListDailyReportsQuery, UpdateDailyReportInput } from "@constructionos/schemas";
import { and, desc, eq, gte, isNull, lte, lt, or, type SQL } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import { dailyReports, projects } from "../../../infrastructure/db/schema";
import { OutboxService } from "../../events";
import { DailyReportNotDraftError, DailyReportNotFoundError, ProjectNotFoundError, VersionConflictError } from "../domain/errors";

interface Cursor {
  reportDate: string;
  id: string;
}

function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify(c)).toString("base64url");
}

function decodeCursor(raw: string): Cursor {
  return JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Cursor;
}

// database.md §15 (M8, FR-FIELD-1). Offline-first: created on device with a
// client-generated UUIDv7 (architecture.md §14.2), same explicitId
// convention as tasks.create.
@Injectable()
export class DailyReportsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly outbox: OutboxService,
  ) {}

  async list(tenantId: string, query: ListDailyReportsQuery) {
    return withTenant(this.db, tenantId, async (tx) => {
      const conditions: SQL[] = [isNull(dailyReports.deletedAt)];
      if (query.projectId) conditions.push(eq(dailyReports.projectId, query.projectId));
      if (query.status) conditions.push(eq(dailyReports.status, query.status));
      if (query.reportDateBefore) conditions.push(lte(dailyReports.reportDate, query.reportDateBefore));
      if (query.reportDateAfter) conditions.push(gte(dailyReports.reportDate, query.reportDateAfter));
      if (query.cursor) {
        const c = decodeCursor(query.cursor);
        conditions.push(
          or(
            lt(dailyReports.reportDate, c.reportDate),
            and(eq(dailyReports.reportDate, c.reportDate), lt(dailyReports.id, c.id))!,
          )!,
        );
      }

      const rows = await tx.query.dailyReports.findMany({
        where: and(...conditions),
        orderBy: [desc(dailyReports.reportDate), desc(dailyReports.id)],
        limit: query.limit + 1,
      });

      const hasMore = rows.length > query.limit;
      const page = rows.slice(0, query.limit);
      const last = page.at(-1);
      const nextCursor = hasMore && last ? encodeCursor({ reportDate: last.reportDate, id: last.id }) : null;

      return { data: page, meta: { cursor: nextCursor, hasMore } };
    });
  }

  async getById(tenantId: string, id: string) {
    return withTenant(this.db, tenantId, (tx) => this.requireReport(tx, id));
  }

  async create(tenantId: string, actorId: string, input: CreateDailyReportInput, explicitId?: string) {
    return withTenant(this.db, tenantId, async (tx) => {
      const project = await tx.query.projects.findFirst({ where: eq(projects.id, input.projectId) });
      if (!project) throw new ProjectNotFoundError();

      const [report] = await tx
        .insert(dailyReports)
        .values({
          ...(explicitId ? { id: explicitId } : {}),
          tenantId,
          projectId: input.projectId,
          reportDate: input.reportDate,
          weather: input.weather,
          narrative: input.narrative,
          createdBy: actorId,
        })
        .returning();
      const created = report!;

      await this.outbox.append(tx, {
        tenantId,
        eventType: "daily_report.created.v1",
        dedupeKey: `daily_report.created.v1:${created.id}`,
        actorId,
        payload: { companyId: tenantId, projectId: input.projectId, dailyReportId: created.id },
      });

      return created;
    });
  }

  // Draft-only edits (mirrors change-orders.ts's pattern); status may only
  // move draft -> submitted, never backward — the same PATCH endpoint
  // covers both a narrative/weather edit and the submit transition since
  // FR-FIELD-1 documents no distinct "reviewer submits" actor (unlike
  // change orders' client-facing submit).
  async update(tenantId: string, actorId: string, id: string, input: UpdateDailyReportInput, ifMatchVersion?: number) {
    return withTenant(this.db, tenantId, async (tx) => {
      const current = await this.requireReport(tx, id);
      if (current.status !== "draft") throw new DailyReportNotDraftError();

      if (ifMatchVersion !== undefined && current.updatedSeq !== ifMatchVersion) {
        throw new VersionConflictError();
      }

      const changedFields = Object.keys(input).filter((key) => (input as Record<string, unknown>)[key] !== undefined);
      const isSubmitting = input.status === "submitted";

      const [updated] = await tx
        .update(dailyReports)
        .set({
          ...input,
          submittedAt: isSubmitting ? new Date() : undefined,
          updatedBy: actorId,
        })
        .where(and(eq(dailyReports.id, id), eq(dailyReports.updatedSeq, current.updatedSeq)))
        .returning();

      if (!updated) throw new VersionConflictError();

      if (changedFields.length > 0) {
        await this.outbox.append(tx, {
          tenantId,
          eventType: "daily_report.updated.v1",
          dedupeKey: `daily_report.updated.v1:${id}:${updated.updatedSeq}`,
          actorId,
          payload: { companyId: tenantId, projectId: current.projectId, dailyReportId: id, changedFields },
        });
      }

      if (isSubmitting) {
        await this.outbox.append(tx, {
          tenantId,
          eventType: "daily_report.submitted.v1",
          dedupeKey: `daily_report.submitted.v1:${id}`,
          actorId,
          payload: { companyId: tenantId, projectId: current.projectId, dailyReportId: id },
        });
      }

      return updated;
    });
  }

  private async requireReport(tx: Database, id: string) {
    const report = await tx.query.dailyReports.findFirst({
      where: and(eq(dailyReports.id, id), isNull(dailyReports.deletedAt)),
    });
    if (!report) throw new DailyReportNotFoundError();
    return report;
  }
}
