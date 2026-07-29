import { Inject, Injectable } from "@nestjs/common";
import type { CreateWarrantyInput, ListWarrantiesQuery, UpdateWarrantyInput, WarrantyDueState } from "@constructionos/schemas";
import { and, desc, eq, isNull } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import { warranties } from "../../../infrastructure/db/schema";
import { OutboxService } from "../../events";
import { WarrantyNotFoundError } from "../domain/errors";

// FR-CLOSE-4: "computed due-state (active/expiring_soon/expired)." Due-
// state is computed on read from start_date + duration_months, same
// "no reconciliation job, plain read is always exact" pattern as
// Safety's certifications and Equipment's maintenance schedules — not a
// stored/maintained column. The 30-day window isn't numerically
// specified anywhere in the docs — a documented assumption, same
// treatment as certifications' own window.
const EXPIRING_SOON_WINDOW_DAYS = 30;

function addMonths(isoDate: string, months: number): Date {
  const d = new Date(isoDate);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d;
}

@Injectable()
export class WarrantiesService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly outbox: OutboxService,
  ) {}

  async list(tenantId: string, projectId: string, query: ListWarrantiesQuery) {
    return withTenant(this.db, tenantId, async (tx) => {
      const rows = await tx.query.warranties.findMany({
        where: and(eq(warranties.projectId, projectId), isNull(warranties.deletedAt)),
        orderBy: [desc(warranties.createdAt)],
      });

      const withDueState = rows.map((row) => ({ ...row, dueState: this.dueState(row.startDate, row.durationMonths) }));
      return query.dueState ? withDueState.filter((row) => row.dueState === query.dueState) : withDueState;
    });
  }

  async create(tenantId: string, actorId: string, projectId: string, input: CreateWarrantyInput) {
    return withTenant(this.db, tenantId, async (tx) => {
      const [created] = await tx
        .insert(warranties)
        .values({
          tenantId,
          projectId,
          scope: input.scope,
          warrantyType: input.warrantyType,
          responsiblePartyType: input.responsiblePartyType,
          responsibleSubcontractorId: input.responsibleSubcontractorId,
          responsibleSupplierId: input.responsibleSupplierId,
          startDate: input.startDate,
          durationMonths: input.durationMonths,
          documentId: input.documentId,
          createdBy: actorId,
        })
        .returning();

      await this.outbox.append(tx, {
        tenantId,
        eventType: "warranty.created.v1",
        dedupeKey: `warranty.created.v1:${created!.id}`,
        actorId,
        payload: { companyId: tenantId, projectId, warrantyId: created!.id },
      });

      return { ...created!, dueState: this.dueState(created!.startDate, created!.durationMonths) };
    });
  }

  async update(tenantId: string, actorId: string, id: string, input: UpdateWarrantyInput) {
    return withTenant(this.db, tenantId, async (tx) => {
      const existing = await this.requireWarranty(tx, id);

      const [updated] = await tx
        .update(warranties)
        .set({ ...input, updatedBy: actorId })
        .where(eq(warranties.id, id))
        .returning();

      await this.outbox.append(tx, {
        tenantId,
        eventType: "warranty.updated.v1",
        dedupeKey: `warranty.updated.v1:${id}:${Date.now()}`,
        actorId,
        payload: { companyId: tenantId, projectId: existing.projectId, warrantyId: id, changedFields: Object.keys(input) },
      });

      return { ...updated!, dueState: this.dueState(updated!.startDate, updated!.durationMonths) };
    });
  }

  // Consumed by WarrantyClaimsService (index.ts's public surface) to gate
  // claim submission to a warranty's active period (FR-CLOSE-5) — same
  // cross-module reuse-a-service precedent as Safety's
  // hasExpiredCompliance/requireEligible.
  async requireForClaim(tx: Database, id: string) {
    const row = await this.requireWarranty(tx, id);
    return { ...row, dueState: this.dueState(row.startDate, row.durationMonths) };
  }

  private dueState(startDate: string, durationMonths: number): WarrantyDueState {
    const expiresAt = addMonths(startDate, durationMonths);
    const daysUntil = Math.floor((expiresAt.getTime() - Date.now()) / 86_400_000);
    if (daysUntil <= 0) return "expired";
    if (daysUntil <= EXPIRING_SOON_WINDOW_DAYS) return "expiring_soon";
    return "active";
  }

  private async requireWarranty(tx: Database, id: string) {
    const row = await tx.query.warranties.findFirst({ where: and(eq(warranties.id, id), isNull(warranties.deletedAt)) });
    if (!row) throw new WarrantyNotFoundError();
    return row;
  }
}
