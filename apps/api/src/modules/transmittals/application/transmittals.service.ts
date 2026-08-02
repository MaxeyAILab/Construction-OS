import { Inject, Injectable } from "@nestjs/common";
import type { CreateTransmittalInput, ListTransmittalsQuery } from "@constructionos/schemas";
import { and, eq, inArray, sql } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import {
  documentVersions,
  projects,
  transmittalItems,
  transmittalRecipients,
  transmittals,
} from "../../../infrastructure/db/schema";
import { OutboxService } from "../../events";
import {
  DocumentVersionNotFoundError,
  NotATransmittalRecipientError,
  ProjectNotFoundError,
  TransmittalNotDraftError,
  TransmittalNotFoundError,
} from "../domain/errors";

// database.md §25 (FR-DOC-8). The transmittals/transmittal_items/
// transmittal_recipients tables' only write path.
@Injectable()
export class TransmittalsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly outbox: OutboxService,
  ) {}

  async list(tenantId: string, projectId: string, query: ListTransmittalsQuery) {
    return withTenant(this.db, tenantId, (tx) => {
      const conditions = [eq(transmittals.projectId, projectId)];
      if (query.status) conditions.push(eq(transmittals.status, query.status));
      return tx.query.transmittals.findMany({
        where: and(...conditions),
        orderBy: (t, { desc }) => [desc(t.number)],
        limit: query.limit,
      });
    });
  }

  async getById(tenantId: string, transmittalId: string) {
    return withTenant(this.db, tenantId, async (tx) => {
      const transmittal = await this.requireTransmittal(tx, transmittalId);
      const items = await tx.query.transmittalItems.findMany({
        where: eq(transmittalItems.transmittalId, transmittalId),
      });
      const recipients = await tx.query.transmittalRecipients.findMany({
        where: eq(transmittalRecipients.transmittalId, transmittalId),
      });
      return { ...transmittal, items, recipients };
    });
  }

  async create(tenantId: string, actorId: string, projectId: string, input: CreateTransmittalInput) {
    return withTenant(this.db, tenantId, async (tx) => {
      const project = await tx.query.projects.findFirst({ where: eq(projects.id, projectId) });
      if (!project) throw new ProjectNotFoundError();

      const versionIds = input.items.map((i) => i.documentVersionId);
      const versions = await tx.query.documentVersions.findMany({
        where: inArray(documentVersions.id, versionIds),
      });
      if (versions.length !== new Set(versionIds).size) throw new DocumentVersionNotFoundError();

      const [maxNumberRow] = await tx
        .select({ maxNumber: sql<number | null>`max(${transmittals.number})` })
        .from(transmittals)
        .where(eq(transmittals.projectId, projectId));
      const number = (maxNumberRow!.maxNumber ?? 0) + 1;

      const [created] = await tx
        .insert(transmittals)
        .values({
          tenantId,
          projectId,
          number,
          purpose: input.purpose,
          subject: input.subject,
          message: input.message,
          createdBy: actorId,
        })
        .returning();
      const transmittal = created!;

      await tx.insert(transmittalItems).values(
        input.items.map((item) => ({
          tenantId,
          transmittalId: transmittal.id,
          documentVersionId: item.documentVersionId,
          description: item.description,
        })),
      );
      await tx.insert(transmittalRecipients).values(
        input.recipientUserIds.map((recipientUserId) => ({
          tenantId,
          transmittalId: transmittal.id,
          recipientUserId,
        })),
      );

      await this.outbox.append(tx, {
        tenantId,
        eventType: "transmittal.created.v1",
        dedupeKey: `transmittal.created.v1:${transmittal.id}`,
        actorId,
        payload: { companyId: tenantId, projectId, transmittalId: transmittal.id, number },
      });

      return transmittal;
    });
  }

  async send(tenantId: string, actorId: string, transmittalId: string) {
    return withTenant(this.db, tenantId, async (tx) => {
      const transmittal = await this.requireTransmittal(tx, transmittalId);
      if (transmittal.status !== "draft") throw new TransmittalNotDraftError();

      const recipients = await tx.query.transmittalRecipients.findMany({
        where: eq(transmittalRecipients.transmittalId, transmittalId),
      });

      const [updated] = await tx
        .update(transmittals)
        .set({ status: "sent", sentAt: new Date(), sentBy: actorId, updatedBy: actorId })
        .where(eq(transmittals.id, transmittalId))
        .returning();

      await this.outbox.append(tx, {
        tenantId,
        eventType: "transmittal.sent.v1",
        dedupeKey: `transmittal.sent.v1:${transmittalId}`,
        actorId,
        payload: {
          companyId: tenantId,
          projectId: transmittal.projectId,
          transmittalId,
          notifyUserIds: recipients.map((r) => r.recipientUserId),
        },
      });

      return updated!;
    });
  }

  // Idempotent: acknowledging twice just leaves acknowledged_at as the
  // first timestamp, same "second call is a no-op, not an error" shape as
  // most read-then-conditionally-write mutations in this codebase.
  async acknowledge(tenantId: string, actorId: string, transmittalId: string) {
    return withTenant(this.db, tenantId, async (tx) => {
      await this.requireTransmittal(tx, transmittalId);
      const recipient = await tx.query.transmittalRecipients.findFirst({
        where: and(
          eq(transmittalRecipients.transmittalId, transmittalId),
          eq(transmittalRecipients.recipientUserId, actorId),
        ),
      });
      if (!recipient) throw new NotATransmittalRecipientError();
      if (recipient.acknowledgedAt) return recipient;

      const [updated] = await tx
        .update(transmittalRecipients)
        .set({ acknowledgedAt: new Date(), updatedBy: actorId })
        .where(eq(transmittalRecipients.id, recipient.id))
        .returning();

      await this.outbox.append(tx, {
        tenantId,
        eventType: "transmittal.acknowledged.v1",
        dedupeKey: `transmittal.acknowledged.v1:${recipient.id}`,
        actorId,
        payload: { companyId: tenantId, transmittalId, recipientUserId: actorId },
      });

      return updated!;
    });
  }

  private async requireTransmittal(tx: Database, transmittalId: string) {
    const transmittal = await tx.query.transmittals.findFirst({ where: eq(transmittals.id, transmittalId) });
    if (!transmittal) throw new TransmittalNotFoundError();
    return transmittal;
  }
}
