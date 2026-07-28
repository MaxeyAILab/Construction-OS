import { z } from "zod";
import { paginationQuerySchema, uuidSchema } from "./common";

// api.md §10: "GET/POST /integrations/accounting/… | admin.integration.manage
// | Connect, mapping, sync runs, conflict queue (FR-PLAT-8)." Only
// 'quickbooks' has a real provider adapter today — see accounting.ts
// schema's own doc comment for why 'sage'/'xero' still exist in the DB CHECK
// constraint without being acceptable input here.
export const connectAccountingSchema = z.object({
  provider: z.literal("quickbooks"),
});
export type ConnectAccountingInput = z.infer<typeof connectAccountingSchema>;

export const costCodeMappingEntrySchema = z.object({
  costCodeId: uuidSchema,
  externalAccountId: z.string().min(1),
  externalAccountName: z.string().min(1).optional(),
});
export type CostCodeMappingEntry = z.infer<typeof costCodeMappingEntrySchema>;

// The "mapping" half of api.md's row — cost code -> QuickBooks chart-of-
// accounts entry, resolved from a real provider.listAccounts() call so
// externalAccountId always refers to something that actually exists in the
// connected QuickBooks company.
export const updateAccountingMappingSchema = z.object({
  costCodeMappings: z.array(costCodeMappingEntrySchema).max(500),
  defaultExpenseAccountId: z.string().min(1).optional(),
});
export type UpdateAccountingMappingInput = z.infer<typeof updateAccountingMappingSchema>;

export const listAccountingSyncRunsQuerySchema = paginationQuerySchema;
export type ListAccountingSyncRunsQuery = z.infer<typeof listAccountingSyncRunsQuerySchema>;

export const accountingConflictStatusSchema = z.enum(["open", "resolved_local", "resolved_remote"]);

export const listAccountingConflictsQuerySchema = paginationQuerySchema.extend({
  status: accountingConflictStatusSchema.optional(),
});
export type ListAccountingConflictsQuery = z.infer<typeof listAccountingConflictsQuerySchema>;

// keep_local re-pushes our value, overwriting the QuickBooks-side edit;
// keep_remote accepts QuickBooks' value, posting a cost_transactions
// adjustment locally (source='accounting_sync', database.md §11's own
// enum — "idempotent sync upserts").
export const resolveAccountingConflictSchema = z.object({
  resolution: z.enum(["keep_local", "keep_remote"]),
});
export type ResolveAccountingConflictInput = z.infer<typeof resolveAccountingConflictSchema>;
