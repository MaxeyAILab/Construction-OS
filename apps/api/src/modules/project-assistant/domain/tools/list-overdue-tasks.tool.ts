import { z } from "zod";
import type { AiTool } from "../../../ai";
import type { TasksService } from "../../../tasks";

const inputSchema = z.object({});

// database.md-backed OPEN_TASK_STATUSES mirror: a task counts as overdue
// only while it's still actually open — same exclusion set
// DashboardsService.getProject's overdueTaskCount already uses (kept as
// its own small constant here rather than importing a private one, same
// as that service's own comment notes for its analogous RFI constant).
const CLOSED_TASK_STATUSES = new Set(["done", "cancelled"]);

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

// ai-spec.md §7.2: "risk flags with reasoning (schedule slip probability,
// budget pressure, stale RFIs)" — this tool gives the model the actual
// overdue task titles/due dates to reason over, complementing
// get_project_summary's count-only risk signal.
export function buildListOverdueTasksTool(tasks: TasksService, projectId: string): AiTool<z.infer<typeof inputSchema>> {
  return {
    name: "list_overdue_tasks",
    description: "List this project's open tasks/punch items that are past their due date.",
    inputSchema,
    permissionKey: "tasks.task.read",
    consequenceClass: "read",
    module: "tasks",
    async execute(ctx) {
      const result = await tasks.list(ctx.tenantId, { projectId, dueBefore: today(), limit: 50 });
      return result.data
        .filter((t) => !CLOSED_TASK_STATUSES.has(t.status))
        .map((t) => ({ id: t.id, title: t.title, status: t.status, dueDate: t.dueDate, assigneeId: t.assigneeId }));
    },
  };
}
