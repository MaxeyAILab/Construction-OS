import { z } from "zod";
import type { DashboardsService } from "../../../dashboards";
import type { AiTool } from "../../../ai";

const inputSchema = z.object({});

// ai-spec.md §7.1: "NL company Q&A ... anomaly surfacing" needs a
// portfolio-wide numeric baseline first. Wraps DashboardsService.getCompany
// (M16's company-wide KPI rollup: project counts, aggregate profitability,
// and portfolio risk counts) — "numeric truth from SQL, not tokens"
// (ai-spec §10.3), same precedent as get_project_summary.
export function buildGetCompanySummaryTool(dashboards: DashboardsService): AiTool<z.infer<typeof inputSchema>> {
  return {
    name: "get_company_summary",
    description:
      "Get the company's portfolio-wide status: project counts, aggregate profitability (revised/actual/forecast-at-completion), and risk counts (critical schedule activities, overdue tasks, open RFIs) across all projects.",
    inputSchema,
    permissionKey: "dashboard.company.read",
    consequenceClass: "read",
    module: "dashboards",
    async execute(ctx) {
      return dashboards.getCompany(ctx.tenantId);
    },
  };
}
