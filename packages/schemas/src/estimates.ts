import { z } from "zod";
import {
  moneyAmountSchema,
  paginationQuerySchema,
  percentageSchema,
  quantitySchema,
  unitRateAmountSchema,
  uuidSchema,
} from "./common";

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected an ISO-8601 date (YYYY-MM-DD)");

export const estimateStatusSchema = z.enum(["draft", "submitted", "won", "lost", "superseded"]);
export type EstimateStatus = z.infer<typeof estimateStatusSchema>;

export const estimateLineSourceSchema = z.enum(["manual", "assembly", "ai", "historical"]);
export type EstimateLineSource = z.infer<typeof estimateLineSourceSchema>;

// Every estimate built against this codebase attaches to a project —
// opportunity-based pre-award estimating needs CRM (M1), which doesn't
// exist yet (see estimates.opportunityId's schema comment).
export const createEstimateSchema = z.object({
  projectId: uuidSchema,
  markupPct: percentageSchema.optional(),
  overheadPct: percentageSchema.optional(),
  contingencyPct: percentageSchema.optional(),
  taxPct: percentageSchema.optional(),
  currency: z.string().length(3).default("USD"),
  validUntil: isoDateSchema.optional(),
});
export type CreateEstimateInput = z.infer<typeof createEstimateSchema>;

export const updateEstimateSchema = z.object({
  status: estimateStatusSchema.optional(),
  markupPct: percentageSchema.optional(),
  overheadPct: percentageSchema.optional(),
  contingencyPct: percentageSchema.optional(),
  taxPct: percentageSchema.optional(),
  validUntil: isoDateSchema.nullable().optional(),
});
export type UpdateEstimateInput = z.infer<typeof updateEstimateSchema>;

export const listEstimatesQuerySchema = paginationQuerySchema.extend({
  projectId: uuidSchema.optional(),
  status: estimateStatusSchema.optional(),
});
export type ListEstimatesQuery = z.infer<typeof listEstimatesQuerySchema>;

export const createEstimateLineSchema = z.object({
  costCodeRef: z.string().min(1),
  description: z.string().min(1),
  qty: quantitySchema,
  uom: z.string().min(1),
  unitCostAmount: unitRateAmountSchema,
  unitPriceAmount: unitRateAmountSchema.optional(),
  assemblyId: uuidSchema.optional(),
  sortOrder: z.number().int().optional(),
});
export type CreateEstimateLineInput = z.infer<typeof createEstimateLineSchema>;

export const updateEstimateLineSchema = createEstimateLineSchema.partial();
export type UpdateEstimateLineInput = z.infer<typeof updateEstimateLineSchema>;

// api.md §5: "POST /lines:batch (<=500/req)".
export const batchCreateEstimateLinesSchema = z.object({
  lines: z.array(createEstimateLineSchema).min(1).max(500),
});
export type BatchCreateEstimateLinesInput = z.infer<typeof batchCreateEstimateLinesSchema>;

// Explodes an assembly's items into priced lines at the given quantity
// (e.g. "50 SF of this wall assembly").
export const addAssemblyToEstimateSchema = z.object({
  assemblyId: uuidSchema,
  qty: quantitySchema,
  costCodeRef: z.string().min(1),
});
export type AddAssemblyToEstimateInput = z.infer<typeof addAssemblyToEstimateSchema>;

export const createCostItemSchema = z.object({
  code: z.string().min(1),
  description: z.string().min(1),
  uom: z.string().min(1),
  currentUnitCostAmount: unitRateAmountSchema,
  laborHoursPerUnit: z.string().optional(),
});
export type CreateCostItemInput = z.infer<typeof createCostItemSchema>;

export const updateCostItemSchema = createCostItemSchema.partial();
export type UpdateCostItemInput = z.infer<typeof updateCostItemSchema>;

export const recordPriceObservationSchema = z.object({
  unitCostAmount: unitRateAmountSchema,
});
export type RecordPriceObservationInput = z.infer<typeof recordPriceObservationSchema>;

export const createAssemblyItemSchema = z.object({
  costItemId: uuidSchema,
  qtyPerUnit: unitRateAmountSchema,
});
export type CreateAssemblyItemInput = z.infer<typeof createAssemblyItemSchema>;

export const createAssemblySchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  uom: z.string().min(1),
  items: z.array(createAssemblyItemSchema).min(1),
});
export type CreateAssemblyInput = z.infer<typeof createAssemblySchema>;

// api.md §5: money-string re-export for convert-to-budget response typing
// (kept here rather than importing budgets.ts to avoid a cross-file
// dependency for one type alias).
export type EstimateMoney = z.infer<typeof moneyAmountSchema>;

// --- Sub bidding: bid_packages/bid_invitations/bids (database.md §10;
// api.md §5 `estimating.bid.*`; FR-EST-6). Deferred when Estimating was
// first built since subcontractors didn't exist yet — see estimates.ts
// schema file's doc comment on bidPackages for the full precedent. ---
export const bidPackageStatusSchema = z.enum(["draft", "open", "closed"]);
export type BidPackageStatus = z.infer<typeof bidPackageStatusSchema>;

export const createBidPackageSchema = z.object({
  name: z.string().min(1),
  scope: z.string().optional(),
  dueDate: isoDateSchema.optional(),
});
export type CreateBidPackageInput = z.infer<typeof createBidPackageSchema>;

export const updateBidPackageSchema = z.object({
  name: z.string().min(1).optional(),
  scope: z.string().nullable().optional(),
  status: bidPackageStatusSchema.optional(),
  dueDate: isoDateSchema.nullable().optional(),
});
export type UpdateBidPackageInput = z.infer<typeof updateBidPackageSchema>;

export const bidInvitationStatusSchema = z.enum(["invited", "declined", "submitted"]);
export type BidInvitationStatus = z.infer<typeof bidInvitationStatusSchema>;

export const createBidInvitationSchema = z.object({
  subcontractorId: uuidSchema,
  dueDate: isoDateSchema.optional(),
});
export type CreateBidInvitationInput = z.infer<typeof createBidInvitationSchema>;

// database.md's literal "inclusions/exclusions jsonb" groups both under
// one column — a documented assumption on internal shape, same treatment
// as daily_reports.weather's shape.
export const bidInclusionsExclusionsSchema = z.object({
  inclusions: z.array(z.string()).optional(),
  exclusions: z.array(z.string()).optional(),
});
export type BidInclusionsExclusions = z.infer<typeof bidInclusionsExclusionsSchema>;

export const createBidSchema = z.object({
  amount: moneyAmountSchema,
  inclusionsExclusions: bidInclusionsExclusionsSchema.optional(),
});
export type CreateBidInput = z.infer<typeof createBidSchema>;

export const listBidInvitationsQuerySchema = paginationQuerySchema.extend({
  subcontractorId: uuidSchema.optional(),
  status: bidInvitationStatusSchema.optional(),
});
export type ListBidInvitationsQuery = z.infer<typeof listBidInvitationsQuerySchema>;
