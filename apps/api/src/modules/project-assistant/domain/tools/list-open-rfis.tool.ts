import { z } from "zod";
import type { AiTool } from "../../../ai";
import type { RfisService } from "../../../rfis";

const inputSchema = z.object({});

const CLOSED_RFI_STATUSES = new Set(["closed", "void"]);
// ai-spec.md §7.2 names "stale RFIs" as a risk signal — no fixed
// threshold is specified in any spec doc, so 14 days is a documented,
// adjustable default (same "smallest spec-consistent default" precedent
// as ai_budgets.softLimitRatio).
const STALE_AFTER_DAYS = 14;

// ai-spec.md §7.2: "risk flags with reasoning ... stale RFIs" — gives the
// model the actual open RFI subjects/questions/ages to reason over,
// complementing get_project_summary's count-only openRfiCount.
export function buildListOpenRfisTool(rfis: RfisService, projectId: string): AiTool<z.infer<typeof inputSchema>> {
  return {
    name: "list_open_rfis",
    description: "List this project's open (not closed/void) RFIs, flagging which ones are stale (open 14+ days).",
    inputSchema,
    permissionKey: "docs.rfi.read",
    consequenceClass: "read",
    module: "rfis",
    async execute(ctx) {
      const result = await rfis.list(ctx.tenantId, projectId, { limit: 50 });
      const now = Date.now();
      return result.data
        .filter((r) => !CLOSED_RFI_STATUSES.has(r.status))
        .map((r) => {
          const ageDays = Math.floor((now - new Date(r.createdAt).getTime()) / (1000 * 60 * 60 * 24));
          return { id: r.id, subject: r.subject, status: r.status, ageDays, stale: ageDays >= STALE_AFTER_DAYS };
        });
    },
  };
}
