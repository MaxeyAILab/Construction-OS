import { z } from "zod";
import { paginationQuerySchema, quantitySchema, unitRateAmountSchema, uuidSchema } from "./common";

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected an ISO-8601 date (YYYY-MM-DD)");

// --- Suppliers (database.md §12) ---
export const supplierStatusSchema = z.enum(["active", "inactive"]);
export type SupplierStatus = z.infer<typeof supplierStatusSchema>;

export const createSupplierSchema = z.object({
  name: z.string().min(1),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  address: z.string().optional(),
  terms: z.string().optional(),
  defaultLeadTimeDays: z.number().int().min(0).optional(),
});
export type CreateSupplierInput = z.infer<typeof createSupplierSchema>;

export const updateSupplierSchema = createSupplierSchema.partial().extend({
  status: supplierStatusSchema.optional(),
});
export type UpdateSupplierInput = z.infer<typeof updateSupplierSchema>;

export const listSuppliersQuerySchema = paginationQuerySchema.extend({
  q: z.string().optional(),
  status: supplierStatusSchema.optional(),
});
export type ListSuppliersQuery = z.infer<typeof listSuppliersQuerySchema>;

// --- Purchase Orders (database.md §12; api.md §11) ---
export const purchaseOrderStatusSchema = z.enum([
  "draft",
  "pending_approval",
  "approved",
  "sent",
  "confirmed",
  "partially_received",
  "received",
  "closed",
  "cancelled",
]);
export type PurchaseOrderStatus = z.infer<typeof purchaseOrderStatusSchema>;

// inventoryItemId is optional — a line can stay free-text-described
// without ever touching the Inventory (M10) catalog, but linking one
// closes the loop for DeliveriesService to post a stock receipt.
export const createPurchaseOrderLineSchema = z.object({
  description: z.string().min(1),
  costCodeId: uuidSchema,
  inventoryItemId: uuidSchema.optional(),
  qtyOrdered: quantitySchema,
  uom: z.string().min(1),
  unitCostAmount: unitRateAmountSchema,
});
export type CreatePurchaseOrderLineInput = z.infer<typeof createPurchaseOrderLineSchema>;

export const updatePurchaseOrderLineSchema = createPurchaseOrderLineSchema.partial();
export type UpdatePurchaseOrderLineInput = z.infer<typeof updatePurchaseOrderLineSchema>;

// api.md §11: "GET/POST /purchase-orders | Filter: project, supplier,
// status..." — a flat resource (unlike change_orders' project-nested
// route), so projectId travels in the body/query rather than a route
// param. total_amount is maintained from lines (sum of line_total_amount)
// — same "consistency over cleverness" recompute-on-every-mutation
// convention as estimates.subtotal_amount/change_orders.cost_impact_amount
// — not accepted here.
export const createPurchaseOrderSchema = z.object({
  projectId: uuidSchema,
  supplierId: uuidSchema,
  requiredByDate: isoDateSchema.optional(),
  shipTo: z.string().optional(),
  currency: z.string().length(3).optional(),
  lines: z.array(createPurchaseOrderLineSchema).min(1),
});
export type CreatePurchaseOrderInput = z.infer<typeof createPurchaseOrderSchema>;

// Header-only, draft-only edits — status moves only via the dedicated
// lifecycle actions (submit/approve/send/cancel), never a generic PATCH
// {status}, same convention as change_orders.
export const updatePurchaseOrderSchema = z.object({
  supplierId: uuidSchema.optional(),
  requiredByDate: isoDateSchema.nullable().optional(),
  promisedDate: isoDateSchema.nullable().optional(),
  shipTo: z.string().nullable().optional(),
});
export type UpdatePurchaseOrderInput = z.infer<typeof updatePurchaseOrderSchema>;

export const listPurchaseOrdersQuerySchema = paginationQuerySchema.extend({
  projectId: uuidSchema.optional(),
  supplierId: uuidSchema.optional(),
  status: purchaseOrderStatusSchema.optional(),
});
export type ListPurchaseOrdersQuery = z.infer<typeof listPurchaseOrdersQuerySchema>;

// --- RFQs & Supplier Quotes (database.md §12: "Quote workflow feeding PO
// creation") ---
export const rfqStatusSchema = z.enum(["draft", "sent", "closed", "cancelled"]);
export type RfqStatus = z.infer<typeof rfqStatusSchema>;

export const createRfqLineSchema = z.object({
  description: z.string().min(1),
  costCodeId: uuidSchema.optional(),
  qty: quantitySchema,
  uom: z.string().min(1),
});
export type CreateRfqLineInput = z.infer<typeof createRfqLineSchema>;

export const createRfqSchema = z.object({
  projectId: uuidSchema,
  title: z.string().min(1),
  dueDate: isoDateSchema.optional(),
  notes: z.string().optional(),
  lines: z.array(createRfqLineSchema).min(1),
});
export type CreateRfqInput = z.infer<typeof createRfqSchema>;

export const listRfqsQuerySchema = paginationQuerySchema.extend({
  projectId: uuidSchema.optional(),
  status: rfqStatusSchema.optional(),
});
export type ListRfqsQuery = z.infer<typeof listRfqsQuerySchema>;

export const createSupplierQuoteSchema = z.object({
  rfqLineId: uuidSchema,
  supplierId: uuidSchema,
  unitCostAmount: unitRateAmountSchema,
  leadTimeDays: z.number().int().min(0).optional(),
  notes: z.string().optional(),
});
export type CreateSupplierQuoteInput = z.infer<typeof createSupplierQuoteSchema>;

// --- Deliveries (database.md §12: "Receipt against PO lines"; FR-PROC-4)
// ---
export const createDeliveryLineSchema = z.object({
  purchaseOrderLineId: uuidSchema,
  qtyReceived: quantitySchema,
});
export type CreateDeliveryLineInput = z.infer<typeof createDeliveryLineSchema>;

// locationId: where the material physically landed — required for
// StockService to post a receipt movement for any line whose PO line
// carries an inventory_item_id (Inventory M10 row); a delivery with no
// inventory-linked lines can omit it.
export const createDeliverySchema = z.object({
  deliveryDate: isoDateSchema,
  locationId: uuidSchema.optional(),
  notes: z.string().optional(),
  lines: z.array(createDeliveryLineSchema).min(1),
});
export type CreateDeliveryInput = z.infer<typeof createDeliverySchema>;
