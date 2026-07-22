import axe from "axe-core";
import { expect } from "vitest";

// Roadmap Phase 1A success metric for the design-system row: "a11y CI
// green" — ui-design-system.md §8: "WCAG 2.1 AA audited per release (axe
// CI + manual screen-reader pass on core flows)." This runs the automated
// half against a mounted component's DOM.
export async function expectNoA11yViolations(
  container: Element,
  disabledRules: string[] = [],
): Promise<void> {
  const results = await axe.run(container, {
    // Radix portals render outside `container` (Dialog/Select/Popover
    // content mounts on document.body); axe.run(container) only sees the
    // trigger unless the caller passes document.body for those cases.
    resultTypes: ["violations"],
    rules: Object.fromEntries(disabledRules.map((id) => [id, { enabled: false }])),
  });
  const summary = results.violations
    .map((v) => `[${v.impact}] ${v.id}: ${v.help} (${v.nodes.length} node(s))`)
    .join("\n");
  expect(results.violations, summary).toHaveLength(0);
}
