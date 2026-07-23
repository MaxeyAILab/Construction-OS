import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { aiRuns } from "./ai";
import { tenantColumns } from "./columns";
import { costCodes, projects } from "./projects";
import { users } from "./users";

// database.md §12 (M5): "name, contact info, terms, default_lead_time_days,
// rating jsonb (AI-maintained score...), status". rating stays null until
// Procurement AI (FR-PROC-5, a separate later roadmap row per this
// session's "AI gets its own row" convention) starts writing it.
export const suppliers = pgTable(
  "suppliers",
  {
    ...tenantColumns(),
    name: text("name").notNull(),
    email: text("email"),
    phone: text("phone"),
    address: text("address"),
    terms: text("terms"),
    defaultLeadTimeDays: integer("default_lead_time_days"),
    rating: jsonb("rating"),
    status: text("status").notNull().default("active"),
  },
  (table) => [
    check("ck_suppliers_status", sql`${table.status} in ('active', 'inactive')`),
    index("ix_suppliers_tenant_name_trgm").using("gin", sql`${table.name} gin_trgm_ops`),
  ],
);

// database.md §12: number ux (tenant_id, number) — auto-assigned per
// tenant (unlike change_orders/rfis, which number per-project, a PO
// number is tenant-global per the doc's literal unique index).
// ai_run_id: real FK since ai_runs (M17) already exists by this row —
// unlike estimate_lines.aiRunId, built before ai_runs existed. Stays
// unwritten until Procurement AI PO-drafting (FR-PROC-6) lands.
export const purchaseOrders = pgTable(
  "purchase_orders",
  {
    ...tenantColumns(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    supplierId: uuid("supplier_id")
      .notNull()
      .references(() => suppliers.id),
    number: integer("number").notNull(),
    status: text("status").notNull().default("draft"),
    orderDate: date("order_date"),
    requiredByDate: date("required_by_date"),
    promisedDate: date("promised_date"),
    shipTo: text("ship_to"),
    totalAmount: numeric("total_amount", { precision: 14, scale: 2 }).notNull().default("0"),
    currency: text("currency").notNull().default("USD"),
    approvedBy: uuid("approved_by").references(() => users.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    aiRunId: uuid("ai_run_id").references(() => aiRuns.id),
  },
  (table) => [
    check(
      "ck_purchase_orders_status",
      sql`${table.status} in ('draft', 'pending_approval', 'approved', 'sent', 'confirmed', 'partially_received', 'received', 'closed', 'cancelled')`,
    ),
    uniqueIndex("ux_purchase_orders_tenant_number").on(table.tenantId, table.number),
    index("ix_po_tenant_project_status").on(table.tenantId, table.projectId, table.status),
    index("ix_po_supplier_status").on(table.supplierId, table.status),
  ],
);

// database.md §12: "inventory_item_id NULL or free-text description".
// inventory_item_id has no FK yet — Inventory (M10) is a later, separate
// roadmap row (same "flag it, don't invent" precedent as every other
// cross-module forward-reference this session); every line is
// free-text-described until that module exists to be referenced.
export const purchaseOrderLines = pgTable(
  "purchase_order_lines",
  {
    ...tenantColumns(),
    purchaseOrderId: uuid("purchase_order_id")
      .notNull()
      .references(() => purchaseOrders.id),
    inventoryItemId: uuid("inventory_item_id"),
    description: text("description").notNull(),
    costCodeId: uuid("cost_code_id")
      .notNull()
      .references(() => costCodes.id),
    qtyOrdered: numeric("qty_ordered", { precision: 14, scale: 3 }).notNull(),
    qtyReceived: numeric("qty_received", { precision: 14, scale: 3 }).notNull().default("0"),
    uom: text("uom").notNull(),
    unitCostAmount: numeric("unit_cost_amount", { precision: 14, scale: 4 }).notNull(),
    lineTotalAmount: numeric("line_total_amount", { precision: 14, scale: 2 }).generatedAlwaysAs(
      sql`round(qty_ordered * unit_cost_amount, 2)`,
    ),
  },
  (table) => [index("ix_po_lines_purchase_order").on(table.purchaseOrderId)],
);

// database.md §12: "Quote workflow feeding PO creation and
// cost_item_price_history." number is per-project (same convention as
// change_orders/rfis).
export const rfqs = pgTable(
  "rfqs",
  {
    ...tenantColumns(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    number: integer("number").notNull(),
    title: text("title").notNull(),
    status: text("status").notNull().default("draft"),
    dueDate: date("due_date"),
    notes: text("notes"),
  },
  (table) => [
    check("ck_rfqs_status", sql`${table.status} in ('draft', 'sent', 'closed', 'cancelled')`),
    uniqueIndex("ux_rfqs_tenant_project_number").on(table.tenantId, table.projectId, table.number),
    index("ix_rfqs_project_status").on(table.projectId, table.status),
  ],
);

export const rfqLines = pgTable(
  "rfq_lines",
  {
    ...tenantColumns(),
    rfqId: uuid("rfq_id")
      .notNull()
      .references(() => rfqs.id),
    description: text("description").notNull(),
    // Nullable: an RFQ can go out before scope is mapped to a specific
    // project cost code (same "exploratory, pre-commitment" reasoning as
    // estimate_lines.costCodeRef being text-only pre-project).
    costCodeId: uuid("cost_code_id").references(() => costCodes.id),
    qty: numeric("qty", { precision: 14, scale: 3 }).notNull(),
    uom: text("uom").notNull(),
  },
  (table) => [index("ix_rfq_lines_rfq").on(table.rfqId)],
);

// One supplier's priced response to one RFQ line. "selected" is what
// PurchaseOrdersService.createFromQuote reads to pre-fill a PO line.
export const supplierQuotes = pgTable(
  "supplier_quotes",
  {
    ...tenantColumns(),
    rfqId: uuid("rfq_id")
      .notNull()
      .references(() => rfqs.id),
    rfqLineId: uuid("rfq_line_id")
      .notNull()
      .references(() => rfqLines.id),
    supplierId: uuid("supplier_id")
      .notNull()
      .references(() => suppliers.id),
    unitCostAmount: numeric("unit_cost_amount", { precision: 14, scale: 4 }).notNull(),
    leadTimeDays: integer("lead_time_days"),
    notes: text("notes"),
    status: text("status").notNull().default("submitted"),
  },
  (table) => [
    check("ck_supplier_quotes_status", sql`${table.status} in ('submitted', 'selected', 'rejected')`),
    uniqueIndex("ux_supplier_quotes_line_supplier").on(table.rfqLineId, table.supplierId),
    index("ix_supplier_quotes_rfq").on(table.rfqId),
  ],
);

// database.md §12: "Receipt against PO lines... triggers stock_levels
// update (on-site receipt) and 3-way-match state for supplier invoices
// (FR-VEND-2)." Both are flagged, not built: Inventory (M10) is a later
// roadmap row, and no invoices/AP module exists yet (confirmed via
// `ls apps/api/src/modules` — no invoices/payments module). Delivery
// photos need no new column: photos.entityType is open-ended text and
// already lists "delivery" as an anticipated value (database.md §15).
export const deliveries = pgTable(
  "deliveries",
  {
    ...tenantColumns(),
    purchaseOrderId: uuid("purchase_order_id")
      .notNull()
      .references(() => purchaseOrders.id),
    deliveryDate: date("delivery_date").notNull(),
    receivedBy: uuid("received_by").references(() => users.id),
    notes: text("notes"),
  },
  (table) => [index("ix_deliveries_purchase_order").on(table.purchaseOrderId)],
);

export const deliveryLines = pgTable(
  "delivery_lines",
  {
    ...tenantColumns(),
    deliveryId: uuid("delivery_id")
      .notNull()
      .references(() => deliveries.id),
    purchaseOrderLineId: uuid("purchase_order_line_id")
      .notNull()
      .references(() => purchaseOrderLines.id),
    qtyReceived: numeric("qty_received", { precision: 14, scale: 3 }).notNull(),
  },
  (table) => [index("ix_delivery_lines_delivery").on(table.deliveryId)],
);
