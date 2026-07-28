import { Inject, Injectable } from "@nestjs/common";
import type { CompanySettings, UpdateCompanyInput } from "@constructionos/schemas";
import { eq } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import { companies } from "../../../infrastructure/db/schema";
import { OutboxService } from "../../events";
import { CompanyNotFoundError } from "../domain/errors";

// api.md §15: GET/PATCH /admin/company (admin.company.manage) — roadmap
// Phase 2 "Second locale + metric units (NFR-30 activation)" row.
// database.md §7's companies row has dedicated locale/currency_code
// columns; "branding" and "fiscal config" both live inside the loose
// `settings` jsonb (no dedicated columns) — see
// @constructionos/schemas' companySettingsSchema doc comment for the
// exact shape this activates (unitSystem/fiscalYearStartMonth/branding).
@Injectable()
export class CompanySettingsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly outbox: OutboxService,
  ) {}

  async get(tenantId: string) {
    const company = await this.db.query.companies.findFirst({ where: eq(companies.id, tenantId) });
    if (!company) throw new CompanyNotFoundError();
    return company;
  }

  // Reused by Change Orders/Finance approve() call sites (FR-RBAC segregation
  // of duties, spec.md §10.2) — same "broaden an existing module's public
  // surface for a legitimate new cross-module need" precedent as
  // EncryptionService. No CompanyNotFoundError here: a missing company mid-
  // request is a different failure the caller's own tenant resolution would
  // already have surfaced.
  async isMakerCheckerEnabled(tenantId: string): Promise<boolean> {
    const company = await this.db.query.companies.findFirst({ where: eq(companies.id, tenantId) });
    return Boolean((company?.settings as CompanySettings | null)?.enforceMakerChecker);
  }

  // PATCH semantics: a top-level settings key present in the body replaces
  // the corresponding stored key (branding replaces as a whole object, not
  // deep-merged field-by-field); omitted keys are left untouched.
  async update(tenantId: string, actorId: string, input: UpdateCompanyInput) {
    return withTenant(this.db, tenantId, async (tx) => {
      const existing = await tx.query.companies.findFirst({ where: eq(companies.id, tenantId) });
      if (!existing) throw new CompanyNotFoundError();

      const mergedSettings: CompanySettings | undefined =
        input.settings === undefined
          ? undefined
          : { ...(existing.settings as CompanySettings), ...input.settings };

      const [updated] = await tx
        .update(companies)
        .set({
          ...(input.name !== undefined && { name: input.name }),
          ...(input.locale !== undefined && { locale: input.locale }),
          ...(input.currencyCode !== undefined && { currencyCode: input.currencyCode }),
          ...(mergedSettings !== undefined && { settings: mergedSettings }),
        })
        .where(eq(companies.id, tenantId))
        .returning();

      await this.outbox.append(tx, {
        tenantId,
        eventType: "company.updated.v1",
        dedupeKey: `company.updated.v1:${tenantId}:${Date.now()}`,
        actorId,
        payload: { companyId: tenantId, changedFields: Object.keys(input) },
      });

      return updated!;
    });
  }
}
