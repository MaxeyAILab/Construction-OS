import { Inject, Injectable } from "@nestjs/common";
import type { ChildCompany, CompanySettings, UpdateCompanyInput } from "@constructionos/schemas";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import { companies } from "../../../infrastructure/db/schema";
import { OutboxService } from "../../events";
import { CompanyNotFoundError, InvalidParentCompanyError } from "../domain/errors";

// db.execute()'s row type must satisfy Record<string, unknown> — same shape
// as auth.service.ts's own CompanyMembership local type for the identical
// get_user_company_memberships query.
type CompanyMembershipRow = Record<string, unknown> & {
  companyId: string;
  companyName: string;
  companySlug: string;
};

// Cycle guard walks the proposed parent's ancestor chain one row at a time
// (companies has no RLS to bypass — database.md §7 "no tenant_id, it IS the
// tenant" — so a plain query per hop is all this needs). Bounded to stop a
// pre-existing bad chain (there shouldn't be one, since this same check
// gates every write) from looping forever.
const MAX_ANCESTOR_WALK = 100;

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
    if (input.parentCompanyId !== undefined && input.parentCompanyId !== null) {
      await this.assertValidParentLink(actorId, tenantId, input.parentCompanyId);
    }

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
          ...(input.parentCompanyId !== undefined && { parentCompanyId: input.parentCompanyId }),
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

  // api.md §15.7 GET /admin/company/children — always the caller's own
  // tenant (never a client-supplied id), so this is a plain query, no
  // different from any other own-row read this service already does.
  async listChildren(tenantId: string): Promise<ChildCompany[]> {
    const rows = await this.db.query.companies.findMany({
      where: and(eq(companies.parentCompanyId, tenantId), isNull(companies.deletedAt)),
      orderBy: [asc(companies.name)],
      columns: { id: true, name: true, slug: true },
    });
    return rows.map((r) => ({ companyId: r.id, companyName: r.name, companySlug: r.slug }));
  }

  // FR-PLAT-9: the three rejections a parent-link write can hit — self,
  // non-membership, and cycle — see InvalidParentCompanyError's own doc
  // comment for why all three collapse to one error code.
  private async assertValidParentLink(actorId: string, tenantId: string, parentCompanyId: string): Promise<void> {
    if (parentCompanyId === tenantId) throw new InvalidParentCompanyError("self");

    // SECURITY DEFINER function (0003_user_company_lookup.sql) — company_users
    // (unlike companies) IS RLS'd, so this is the same narrow cross-tenant
    // lookup resolveSoleCompanyId uses to detect an ambiguous login.
    const membershipRows = await this.db.execute<CompanyMembershipRow>(
      sql`select company_id as "companyId", company_name as "companyName", company_slug as "companySlug"
          from get_user_company_memberships(${actorId})`,
    );
    const isMember = Array.from(membershipRows).some((m) => m.companyId === parentCompanyId);
    if (!isMember) throw new InvalidParentCompanyError("not_a_member");

    let currentId: string | null = parentCompanyId;
    for (let i = 0; i < MAX_ANCESTOR_WALK && currentId; i++) {
      const row: { parentCompanyId: string | null } | undefined = await this.db.query.companies.findFirst({
        where: eq(companies.id, currentId),
        columns: { parentCompanyId: true },
      });
      currentId = row?.parentCompanyId ?? null;
      if (currentId === tenantId) throw new InvalidParentCompanyError("cycle");
    }
  }
}
