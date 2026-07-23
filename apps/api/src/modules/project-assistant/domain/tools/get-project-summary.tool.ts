import { z } from "zod";
import type { DashboardsService } from "../../../dashboards";
import type { AiTool } from "../../../ai";

const inputSchema = z.object({});

// ai-spec.md §7.2: "status summarization ... risk flags." Wraps
// DashboardsService.getProject (M16's per-project rollup: status,
// health, live margin from projection_project_financials, and the same
// critical-activity/overdue-task/open-RFI counts the executive dashboard
// shows) rather than re-deriving the aggregation — "numeric truth from
// SQL, not tokens" (ai-spec §10.3): these figures are fetched fresh on
// every call, never invented by the model.
export function buildGetProjectSummaryTool(dashboards: DashboardsService, projectId: string): AiTool<z.infer<typeof inputSchema>> {
  return {
    name: "get_project_summary",
    description:
      "Get this project's current status, health, live margin/budget snapshot, and risk counts (critical schedule activities, overdue tasks, open RFIs).",
    inputSchema,
    permissionKey: "dashboard.project.read",
    consequenceClass: "read",
    module: "dashboards",
    async execute(ctx) {
      return dashboards.getProject(ctx.tenantId, projectId);
    },
  };
}
