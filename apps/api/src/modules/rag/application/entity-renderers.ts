import type { DailyReportsService } from "../../daily-reports/application/daily-reports.service";
import type { RfisService } from "../../rfis/application/rfis.service";
import type { TasksService } from "../../tasks/application/tasks.service";
import { ENTITY_PERMISSIONS } from "../domain/entity-permissions";
import type { RagEntityRenderer } from "../domain/entity-renderer";

// ai-spec.md §3's corpus list names many more entity types (documents,
// submittals, contracts, estimates, safety records, supplier history,
// curated reference content) — this pass indexes the three that already
// have plain-text fields ready to render with no extra extraction work
// (tasks, RFIs, daily reports). Documents need PDF/OCR text extraction
// that doesn't exist yet (same "flagged, not built" precedent as the
// drawing viewer's PDF rendering) — a real follow-up, not an oversight.
export function buildEntityRenderers(
  tasksService: TasksService,
  rfisService: RfisService,
  dailyReportsService: DailyReportsService,
): Record<string, RagEntityRenderer> {
  return {
    task: {
      entityType: "task",
      permissionKey: ENTITY_PERMISSIONS.task!,
      async render(tenantId, entityId) {
        const task = await tasksService.getById(tenantId, entityId).catch(() => null);
        if (!task) return null;
        const text = [task.title, task.description].filter((v): v is string => Boolean(v)).join("\n\n");
        return { title: task.title, text, projectId: task.projectId };
      },
    },
    rfi: {
      entityType: "rfi",
      permissionKey: ENTITY_PERMISSIONS.rfi!,
      async render(tenantId, entityId) {
        const rfi = await rfisService.getById(tenantId, entityId).catch(() => null);
        if (!rfi) return null;
        const text = [rfi.subject, rfi.question, rfi.answer].filter((v): v is string => Boolean(v)).join("\n\n");
        return { title: rfi.subject, text, projectId: rfi.projectId };
      },
    },
    daily_report: {
      entityType: "daily_report",
      permissionKey: ENTITY_PERMISSIONS.daily_report!,
      async render(tenantId, entityId) {
        const report = await dailyReportsService.getById(tenantId, entityId).catch(() => null);
        if (!report || !report.narrative) return null;
        return { title: `Daily report ${report.reportDate}`, text: report.narrative, projectId: report.projectId };
      },
    },
  };
}
