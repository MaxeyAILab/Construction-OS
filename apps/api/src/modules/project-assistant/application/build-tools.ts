import type { AiTool } from "../../ai";
import type { DashboardsService } from "../../dashboards";
import type { RagSearchService } from "../../rag";
import type { RfisService } from "../../rfis";
import type { TasksService } from "../../tasks";
import { buildGetProjectSummaryTool } from "../domain/tools/get-project-summary.tool";
import { buildListOpenRfisTool } from "../domain/tools/list-open-rfis.tool";
import { buildListOverdueTasksTool } from "../domain/tools/list-overdue-tasks.tool";
import { buildSearchProjectRecordsTool } from "../domain/tools/search-project-records.tool";
import { buildSuggestTasksTool } from "../domain/tools/suggest-tasks.tool";

// ai-spec.md §7.2's full tool set for one project-scoped conversation —
// every tool here is closed over that one projectId, so the model can
// never point a tool at a different project than the one the
// conversation was opened against.
export function buildProjectAssistantTools(
  deps: {
    ragSearch: RagSearchService;
    dashboards: DashboardsService;
    tasks: TasksService;
    rfis: RfisService;
  },
  projectId: string,
): AiTool[] {
  return [
    buildSearchProjectRecordsTool(deps.ragSearch, projectId),
    buildGetProjectSummaryTool(deps.dashboards, projectId),
    buildListOverdueTasksTool(deps.tasks, projectId),
    buildListOpenRfisTool(deps.rfis, projectId),
    buildSuggestTasksTool(),
  ];
}
