import { z } from "zod";
import { paginationQuerySchema, uuidSchema } from "./common";

// api.md §10: "GET/POST /integrations/accounting/… | admin.integration.manage
// | Connect, mapping, sync runs, conflict queue (FR-PLAT-8)." roadmap.md's
// "Sage & Xero connectors" row lists "accounting framework" as its
// dependency (i.e. this QuickBooks-first pipeline existing) — a pilot
// customer choosing Sage or Xero unblocks it. All three route through the
// same AccountingProvider interface (accounting/domain/provider.ts) and
// AccountingProviderRegistry (one connection row per tenant+provider,
// database.md §11's accounting_links already carries the 3-way CHECK).
export const accountingProviderSchema = z.enum(["quickbooks", "sage", "xero"]);
export type AccountingProviderName = z.infer<typeof accountingProviderSchema>;

export const connectAccountingSchema = z.object({
  provider: accountingProviderSchema,
});
export type ConnectAccountingInput = z.infer<typeof connectAccountingSchema>;

export const costCodeMappingEntrySchema = z.object({
  costCodeId: uuidSchema,
  externalAccountId: z.string().min(1),
  externalAccountName: z.string().min(1).optional(),
});
export type CostCodeMappingEntry = z.infer<typeof costCodeMappingEntrySchema>;

// The "mapping" half of api.md's row — cost code -> chart-of-accounts entry
// on the connected provider, resolved from a real provider.listAccounts()
// call so externalAccountId always refers to something that actually
// exists there. defaultClearingAccountId is only needed for providers that
// enforce balanced double-entry postings (Sage/Xero journals — see
// XeroProvider/SageProvider doc comments); QuickBooks' Purchase entity
// balances implicitly against the payment account, so it ignores this.
export const updateAccountingMappingSchema = z.object({
  costCodeMappings: z.array(costCodeMappingEntrySchema).max(500),
  defaultExpenseAccountId: z.string().min(1).optional(),
  defaultClearingAccountId: z.string().min(1).optional(),
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
