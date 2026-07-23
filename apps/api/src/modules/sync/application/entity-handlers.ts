import {
  createDailyReportSchema,
  createTaskSchema,
  createTimeEntrySchema,
  updateDailyReportSchema,
  updateTaskSchema,
} from "@constructionos/schemas";
import type { SyncMutationOp } from "@constructionos/schemas";
import type { ZodType } from "zod";
import { DailyReportsService, TimeEntriesService } from "../../daily-reports";
import { TasksService } from "../../tasks";

// api.md §16.2 / architecture.md §14.2. One handler per syncable entity —
// the apply/conflict/idempotency mechanics in sync-mutations.service.ts are
// entity-agnostic; adding an entity here is "one more row", not a redesign
// (same "second entity is one more row" comment the original PERMISSIONS
// map carried before there was a second entity to prove it).
export interface SyncEntityHandler {
  permissions: Partial<Record<SyncMutationOp, string>>;
  createSchema?: ZodType;
  updateSchema?: ZodType;
  create?: (tenantId: string, actorId: string, data: unknown, explicitId: string) => Promise<Record<string, unknown>>;
  update?: (
    tenantId: string,
    actorId: string,
    id: string,
    data: Record<string, unknown>,
    baseVersion?: number,
  ) => Promise<Record<string, unknown>>;
  remove?: (tenantId: string, actorId: string, id: string) => Promise<void>;
  getById: (tenantId: string, id: string) => Promise<Record<string, unknown>>;
}

export function buildEntityHandlers(
  tasks: TasksService,
  dailyReports: DailyReportsService,
  timeEntries: TimeEntriesService,
): Record<string, SyncEntityHandler> {
  return {
    tasks: {
      permissions: { create: "tasks.task.create", update: "tasks.task.update", delete: "tasks.task.delete" },
      createSchema: createTaskSchema,
      updateSchema: updateTaskSchema,
      create: (tenantId, actorId, data, explicitId) =>
        tasks.create(tenantId, actorId, data as Parameters<typeof tasks.create>[2], explicitId),
      update: (tenantId, actorId, id, data, baseVersion) =>
        tasks.update(tenantId, actorId, id, data as Parameters<typeof tasks.update>[3], baseVersion),
      remove: (tenantId, actorId, id) => tasks.remove(tenantId, actorId, id),
      getById: (tenantId, id) => tasks.getById(tenantId, id),
    },
    // FR-FIELD-1: no delete — a daily report is never removed via sync,
    // only edited while draft or moved to submitted (DailyReportsService.
    // update's own comment explains why submit rides the same op).
    daily_reports: {
      permissions: { create: "field.daily_report.create", update: "field.daily_report.update" },
      createSchema: createDailyReportSchema,
      updateSchema: updateDailyReportSchema,
      create: (tenantId, actorId, data, explicitId) =>
        dailyReports.create(tenantId, actorId, data as Parameters<typeof dailyReports.create>[2], explicitId),
      update: (tenantId, actorId, id, data, baseVersion) =>
        dailyReports.update(tenantId, actorId, id, data as Parameters<typeof dailyReports.update>[3], baseVersion),
      getById: (tenantId, id) => dailyReports.getById(tenantId, id),
    },
    // FR-FIELD-2: append-only — create only. No update/delete permission is
    // registered, so those ops fall through to "unsupported_operation"
    // automatically rather than needing special-cased rejection here.
    time_entries: {
      permissions: { create: "field.time_entry.create" },
      createSchema: createTimeEntrySchema,
      create: (tenantId, actorId, data, explicitId) =>
        timeEntries.create(tenantId, actorId, data as Parameters<typeof timeEntries.create>[2], explicitId),
      getById: (tenantId, id) => timeEntries.getById(tenantId, id),
    },
  };
}
