import { z } from "zod";

// api.md §15: "GET/PATCH /admin/company | admin.company.manage | Settings,
// locale, branding, fiscal config." Roadmap Phase 2 "Second locale +
// metric units (NFR-30 activation)" row.
//
// database.md §7's companies row has dedicated `locale`/`currency_code`
// columns plus a loose `settings jsonb` blob — "branding" and "fiscal
// config" both live inside that jsonb (no dedicated columns exist for
// them). This schema shapes `settings` narrowly to what the roadmap row
// actually needs activated: a per-tenant unit system (the "metric units"
// half of the row) plus the branding/fiscal fields api.md's one-line
// description names. Anything else is out of scope, not silently
// accepted via a passthrough.
export const companyBrandingSchema = z.object({
  logoUrl: z.string().url().optional(),
  primaryColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "primaryColor must be a 6-digit hex color")
    .optional(),
});
export type CompanyBranding = z.infer<typeof companyBrandingSchema>;

export const companySettingsSchema = z.object({
  unitSystem: z.enum(["imperial", "metric"]).optional(),
  fiscalYearStartMonth: z.number().int().min(1).max(12).optional(),
  branding: companyBrandingSchema.optional(),
  // spec.md §10.2: "Financial approvals, change-order approvals ... support
  // maker/checker workflows for enterprise tenants." architecture.md §12:
  // "modeled as workflow rules on top of permissions, not new permission
  // types" — hence a plain settings toggle, not a new RBAC concept. When
  // true, the record's creator (createdBy) is barred from also being the
  // approver on change-order approve, invoice approve, and payment
  // application approve.
  enforceMakerChecker: z.boolean().optional(),
});
export type CompanySettings = z.infer<typeof companySettingsSchema>;

// PATCH semantics: provided top-level settings keys replace the
// corresponding stored key (branding replaces as a whole object, not
// deep-merged field-by-field) — omitted keys are left untouched.
export const updateCompanySchema = z.object({
  name: z.string().min(1).optional(),
  locale: z.string().min(2).max(35).optional(),
  currencyCode: z.string().length(3).optional(),
  settings: companySettingsSchema.optional(),
  // FR-PLAT-9 (api.md §15.7): links/unlinks this company under a holding
  // company. `null` clears an existing link; omitted leaves it untouched.
  parentCompanyId: z.string().uuid().nullable().optional(),
});
export type UpdateCompanyInput = z.infer<typeof updateCompanySchema>;

// api.md §15.7 GET /admin/company/children.
export const childCompanySchema = z.object({
  companyId: z.string().uuid(),
  companyName: z.string(),
  companySlug: z.string(),
});
export type ChildCompany = z.infer<typeof childCompanySchema>;
