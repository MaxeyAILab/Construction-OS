import { z } from "zod";
import { paginationQuerySchema, quantitySchema, unitRateAmountSchema, uuidSchema } from "./common";

// --- Inventory Items (database.md §12: "catalog") ---
export const createInventoryItemSchema = z.object({
  sku: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  uom: z.string().min(1),
  minQty: quantitySchema.optional(),
  defaultUnitCostAmount: unitRateAmountSchema.optional(),
  category: z.string().optional(),
});
export type CreateInventoryItemInput = z.infer<typeof createInventoryItemSchema>;

export const listInventoryItemsQuerySchema = paginationQuerySchema.extend({
  q: z.string().optional(),
  category: z.string().optional(),
});
export type ListInventoryItemsQuery = z.infer<typeof listInventoryItemsQuerySchema>;

// --- Inventory Locations (database.md §12: "warehouses & job-site
// stores") ---
export const createInventoryLocationSchema = z.object({
  name: z.string().min(1),
  projectId: uuidSchema.optional(),
  address: z.string().optional(),
});
export type CreateInventoryLocationInput = z.infer<typeof createInventoryLocationSchema>;

export const listInventoryLocationsQuerySchema = paginationQuerySchema.extend({
  projectId: uuidSchema.optional(),
});
export type ListInventoryLocationsQuery = z.infer<typeof listInventoryLocationsQuerySchema>;

// --- Stock levels (api.md §11: "GET /inventory/stock?location_id=&item_id=")
// ---
export const stockQuerySchema = z.object({
  locationId: uuidSchema.optional(),
  itemId: uuidSchema.optional(),
});
export type StockQuery = z.infer<typeof stockQuerySchema>;

// --- Stock movements (database.md §12; FR-INV-2) ---
export const stockMovementKindSchema = z.enum([
  "receipt",
  "issue",
  "transfer_out",
  "transfer_in",
  "adjustment",
  "return",
]);
export type StockMovementKind = z.infer<typeof stockMovementKindSchema>;

// api.md §11: "POST /inventory/movements | issue/transfer/adjust (kind),
// validated against stock; issues cost to project (FR-INV-2)". `kind`
// here is the client-facing action; 'transfer' fans out into the DB's
// paired transfer_out/transfer_in ledger rows inside StockService, so the
// caller never has to post two movements for one transfer. 'receipt'
// isn't accepted here — that kind is posted internally by
// DeliveriesService (Procurement) on a PO delivery, not a direct client
// action, same "system posts this, not the API caller" reasoning as
// cost_transactions.source='time_entry' being posted by TimeEntriesService
// rather than accepted from the client on POST /cost-transactions.
export const createStockMovementSchema = z
  .object({
    kind: z.enum(["issue", "transfer", "adjustment", "return"]),
    itemId: uuidSchema,
    // The location being drawn down (issue/transfer/return) or corrected
    // (adjustment).
    fromLocationId: uuidSchema,
    // Only meaningful (and required) for a transfer.
    toLocationId: uuidSchema.optional(),
    // Signed: adjustment qty may be negative (a correction downward);
    // every other kind is a positive quantity drawn from fromLocationId.
    qty: quantitySchema,
    unitCostAmount: unitRateAmountSchema.optional(),
    // Only meaningful for 'issue' — FR-INV-2's "value them into job
    // costs" posts a cost_transactions row when both are supplied.
    projectId: uuidSchema.optional(),
    costCodeId: uuidSchema.optional(),
    memo: z.string().optional(),
  })
  .refine((v) => v.kind !== "transfer" || v.toLocationId !== undefined, {
    message: "toLocationId is required for a transfer",
    path: ["toLocationId"],
  });
export type CreateStockMovementInput = z.infer<typeof createStockMovementSchema>;

export const listStockMovementsQuerySchema = paginationQuerySchema.extend({
  itemId: uuidSchema.optional(),
});
export type ListStockMovementsQuery = z.infer<typeof listStockMovementsQuerySchema>;
