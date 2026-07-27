import { Inject, Injectable } from "@nestjs/common";
import type { CreateCertificationInput, ListCertificationsQuery, UpdateCertificationInput } from "@constructionos/schemas";
import { and, desc, eq, lte, lt, or, type SQL } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import { certifications } from "../../../infrastructure/db/schema";
import { OutboxService } from "../../events";
import { CertificationNotFoundError } from "../domain/errors";

interface Cursor {
  createdAt: string;
  id: string;
}

function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify(c)).toString("base64url");
}

function decodeCursor(raw: string): Cursor {
  return JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Cursor;
}

export type CertificationDueState = "valid" | "expiring_soon" | "expired";

// FR-SAFE-2: "track certifications ... with expiry alerts." Due-state is
// computed on read from expires_at — same "no reconciliation job, plain
// read is always exact" pattern as Equipment's maintenance due-state
// projection, not a stored/maintained column. The 30-day window isn't
// numerically specified anywhere in the docs — a documented assumption,
// same treatment as tasks.priority's enum.
const EXPIRING_SOON_WINDOW_DAYS = 30;

@Injectable()
export class CertificationsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly outbox: OutboxService,
  ) {}

  async list(tenantId: string, query: ListCertificationsQuery) {
    return withTenant(this.db, tenantId, async (tx) => {
      const conditions: SQL[] = [];
      if (query.holderUserId) conditions.push(eq(certifications.holderUserId, query.holderUserId));
      if (query.holderSubcontractorId) conditions.push(eq(certifications.holderSubcontractorId, query.holderSubcontractorId));
      if (query.expiringOnly) {
        const threshold = new Date();
        threshold.setDate(threshold.getDate() + EXPIRING_SOON_WINDOW_DAYS);
        conditions.push(lte(certifications.expiresAt, threshold.toISOString().slice(0, 10)));
      }
      if (query.cursor) {
        const c = decodeCursor(query.cursor);
        conditions.push(
          or(
            lt(certifications.createdAt, new Date(c.createdAt)),
            and(eq(certifications.createdAt, new Date(c.createdAt)), lt(certifications.id, c.id))!,
          )!,
        );
      }

      const rows = await tx.query.certifications.findMany({
        where: conditions.length ? and(...conditions) : undefined,
        orderBy: [desc(certifications.createdAt), desc(certifications.id)],
        limit: query.limit + 1,
      });

      const hasMore = rows.length > query.limit;
      const page = rows.slice(0, query.limit).map((row) => ({ ...row, dueState: this.dueState(row.expiresAt) }));
      const last = page.at(-1);
      const nextCursor = hasMore && last ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id }) : null;

      return { data: page, meta: { cursor: nextCursor, hasMore } };
    });
  }

  async create(tenantId: string, actorId: string, input: CreateCertificationInput) {
    return withTenant(this.db, tenantId, async (tx) => {
      const [created] = await tx
        .insert(certifications)
        .values({
          tenantId,
          holderUserId: input.holderUserId,
          holderSubcontractorId: input.holderSubcontractorId,
          holderName: input.holderName,
          certType: input.certType,
          issuedAt: input.issuedAt,
          expiresAt: input.expiresAt,
          createdBy: actorId,
        })
        .returning();

      await this.outbox.append(tx, {
        tenantId,
        eventType: "certification.created.v1",
        dedupeKey: `certification.created.v1:${created!.id}`,
        actorId,
        payload: { companyId: tenantId, certificationId: created!.id },
      });

      return created!;
    });
  }

  async update(tenantId: string, actorId: string, id: string, input: UpdateCertificationInput) {
    return withTenant(this.db, tenantId, async (tx) => {
      await this.requireCertification(tx, id);

      const [updated] = await tx
        .update(certifications)
        .set({ ...input, updatedBy: actorId })
        .where(eq(certifications.id, id))
        .returning();

      await this.outbox.append(tx, {
        tenantId,
        eventType: "certification.updated.v1",
        dedupeKey: `certification.updated.v1:${id}:${Date.now()}`,
        actorId,
        payload: { companyId: tenantId, certificationId: id, changedFields: Object.keys(input) },
      });

      return updated!;
    });
  }

  // FR-SUB-2: "eligibility gating" — reused by SubcontractorsService.
  // requireEligible() (safety/index.ts's public surface — cross-module
  // reuse, same "broaden an existing module's public surface" precedent
  // as postFromTimeEntry/postFromInventoryIssue). No compliance docs on
  // file is treated as eligible (nothing to block on); only an expired
  // one blocks.
  async hasExpiredCompliance(tenantId: string, subcontractorId: string): Promise<boolean> {
    return withTenant(this.db, tenantId, async (tx) => {
      const rows = await tx.query.certifications.findMany({
        where: eq(certifications.holderSubcontractorId, subcontractorId),
      });
      return rows.some((row) => this.dueState(row.expiresAt) === "expired");
    });
  }

  private dueState(expiresAt: string | null): CertificationDueState {
    if (!expiresAt) return "valid";
    const daysUntil = Math.floor((new Date(expiresAt).getTime() - Date.now()) / 86_400_000);
    if (daysUntil <= 0) return "expired";
    if (daysUntil <= EXPIRING_SOON_WINDOW_DAYS) return "expiring_soon";
    return "valid";
  }

  private async requireCertification(tx: Database, id: string) {
    const row = await tx.query.certifications.findFirst({ where: eq(certifications.id, id) });
    if (!row) throw new CertificationNotFoundError();
    return row;
  }
}
