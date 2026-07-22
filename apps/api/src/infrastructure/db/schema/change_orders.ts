import { sql } from "drizzle-orm";
import { check, index, integer, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { tenantColumns } from "./columns";
import { costCodes, projects } from "./projects";
import { users } from "./users";

// database.md §11 (M9): "Lines mirror estimate_lines per cost code. On
// approval (one transaction): budget_lines.approved_changes update +
// schedule impact event + client-portal visibility (FR-FIN-2 propagation)."
// number is auto-assigned per project (max+1 at creation), not client-
// supplied — matches how COs are numbered in practice (CO #1, #2, ...).
export const changeOrders = pgTable(
  "change_orders",
  {
    ...tenantColumns(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    number: integer("number").notNull(),
    title: text("title").notNull(),
    reason: text("reason"),
    status: text("status").notNull().default("draft"),
    // Cost-basis impact (sum of change_order_lines.cost_impact_amount,
    // recomputed on every line mutation — same "consistency over
    // cleverness" convention as estimates.subtotal_amount) — this is what
    // propagates to budget_lines.approved_changes_amount on approval.
    costImpactAmount: numeric("cost_impact_amount", { precision: 14, scale: 2 }).notNull().default("0"),
    // Client-facing contract price change — set directly at creation, not
    // derived (may differ from cost_impact_amount by markup, same
    // "informational override" reasoning as estimate_lines.unit_price_amount).
    priceImpactAmount: numeric("price_impact_amount", { precision: 14, scale: 2 }).notNull().default("0"),
    scheduleImpactDays: integer("schedule_impact_days").notNull().default(0),
    // Populated only by the future client-portal external-approval path
    // (Client portal v1, not built) — today's internal finance.co.approve
    // endpoint approves without claiming to be the client, so these stay
    // null on that path.
    clientApprovedBy: uuid("client_approved_by").references(() => users.id),
    clientApprovedAt: timestamp("client_approved_at", { withTimezone: true }),
    clientApprovalChannel: text("client_approval_channel"),
  },
  (table) => [
    check(
      "ck_change_orders_status",
      sql`${table.status} in ('draft', 'pending_client', 'approved', 'rejected', 'void')`,
    ),
    uniqueIndex("ux_change_orders_tenant_project_number").on(table.tenantId, table.projectId, table.number),
    index("ix_change_orders_project_status").on(table.projectId, table.status),
  ],
);

export const changeOrderLines = pgTable(
  "change_order_lines",
  {
    ...tenantColumns(),
    changeOrderId: uuid("change_order_id")
      .notNull()
      .references(() => changeOrders.id),
    // Real FK (unlike estimate_lines.cost_code_ref) — a change order always
    // belongs to an existing project, which already has real cost codes.
    costCodeId: uuid("cost_code_id")
      .notNull()
      .references(() => costCodes.id),
    description: text("description").notNull(),
    // Can be negative (a deductive change order).
    costImpactAmount: numeric("cost_impact_amount", { precision: 14, scale: 2 }).notNull(),
  },
  (table) => [index("ix_co_lines_change_order").on(table.changeOrderId)],
);
