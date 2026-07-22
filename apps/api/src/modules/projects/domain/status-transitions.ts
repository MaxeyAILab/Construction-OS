import type { ProjectStatus } from "@constructionos/schemas";
import { IllegalStatusTransitionError } from "./errors";

// api.md §3: "status transitions ... validated against state machine".
// No document spells out the exact transition graph — this is a
// reasonable default for a construction project lifecycle (open a job,
// pause it, close it, then a warranty tail); revisit if real workflows
// need something looser (e.g. reopening a closed project).
const ALLOWED_TRANSITIONS: Record<ProjectStatus, ProjectStatus[]> = {
  planning: ["active"],
  active: ["on_hold", "closed"],
  on_hold: ["active", "closed"],
  closed: ["warranty"],
  warranty: [],
};

export function assertLegalStatusTransition(from: ProjectStatus, to: ProjectStatus): void {
  if (from === to) return;
  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    throw new IllegalStatusTransitionError(from, to);
  }
}
