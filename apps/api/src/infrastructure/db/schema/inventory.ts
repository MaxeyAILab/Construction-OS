import { sql } from "drizzle-orm";
import { check, index, numeric, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { tenantColumns } from "./columns";
import { costCodes, projects } from "./projects";

// database.md §12 (M10): "catalog (sku ux (tenant_id, sku), uom, min_qty,
// default_unit_cost_amount, category)". min_qty feeds the reorder-suggestions
// feed (FR-INV-3, a later Procurement/Inventory AI row — deferred, not
// built this pass).
export const inventoryItems = pgTable(
  "inventory_items",
  {
    ...tenantColumns(),
    sku: text("sku").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    uom: text("uom").notNull(),
    minQty: numeric("min_qty", { precision: 14, scale: 3 }),
    defaultUnitCostAmount: numeric("default_unit_cost_amount", { precision: 14, scale: 4 })
      .notNull()
      .default("0"),
    category: text("category"),
  },
  (table) => [uniqueIndex("ux_inventory_items_tenant_sku").on(table.tenantId, table.sku)],
);

// database.md §12: "warehouses & job-site stores (project_id NULL for
// site locations)" — read literally, this means the reverse of the usual
// nullability: a tenant-wide warehouse has no project, while a job-site
// store is scoped to one. project_id stays optional either way (the doc's
// parenthetical only clarifies what NULL means for site locations, not
// that project_id is ever required).
export const inventoryLocations = pgTable(
  "inventory_locations",
  {
    ...tenantColumns(),
    name: text("name").notNull(),
    projectId: uuid("project_id").references(() => projects.id),
    address: text("address"),
  },
  (table) => [index("ix_inventory_locations_tenant_project").on(table.tenantId, table.projectId)],
);

// database.md §12: "maintained aggregate (item_id, location_id) unique,
// qty_on_hand" — same ledger/rollup pattern as budget_lines/commitments:
// stock_movements is the source of truth, this is a cheap-to-read cache
// maintained in the same transaction as each movement.
export const stockLevels = pgTable(
  "stock_levels",
  {
    ...tenantColumns(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => inventoryItems.id),
    locationId: uuid("location_id")
      .notNull()
      .references(() => inventoryLocations.id),
    qtyOnHand: numeric("qty_on_hand", { precision: 14, scale: 3 }).notNull().default("0"),
  },
  (table) => [uniqueIndex("ux_stock_levels_item_location").on(table.itemId, table.locationId)],
);

// database.md §12: "append-only ledger — kind CHECK IN ('receipt','issue',
// 'transfer_out','transfer_in','adjustment','return'), item_id, from/to
// location, qty, unit_cost_amount, project_id/cost_code_id NULL (issues ->
// cost_transactions)." unit_cost_amount here is the movement's own
// valuation (from the PO line on receipt, or the item's
// default_unit_cost_amount on issue/adjustment — FR-INV-2's "value them
// into job costs" doesn't require full moving-average costing, a
// documented simplification, same class as budgets' simple
// forecast-to-complete formula).
export const stockMovements = pgTable(
  "stock_movements",
  {
    ...tenantColumns(),
    kind: text("kind").notNull(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => inventoryItems.id),
    fromLocationId: uuid("from_location_id").references(() => inventoryLocations.id),
    toLocationId: uuid("to_location_id").references(() => inventoryLocations.id),
    qty: numeric("qty", { precision: 14, scale: 3 }).notNull(),
    unitCostAmount: numeric("unit_cost_amount", { precision: 14, scale: 4 }).notNull(),
    projectId: uuid("project_id").references(() => projects.id),
    costCodeId: uuid("cost_code_id").references(() => costCodes.id),
    memo: text("memo"),
  },
  (table) => [
    check(
      "ck_stock_movements_kind",
      sql`${table.kind} in ('receipt', 'issue', 'transfer_out', 'transfer_in', 'adjustment', 'return')`,
    ),
    index("ix_stock_movements_tenant_item").on(table.tenantId, table.itemId),
  ],
);
