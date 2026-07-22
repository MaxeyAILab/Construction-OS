import { Inject, Injectable } from "@nestjs/common";
import type {
  ListNotificationsQuery,
  MarkNotificationsReadInput,
  NotificationPreference,
  RegisterDeviceInput,
} from "@constructionos/schemas";
import { and, eq, inArray, lt, or, sql } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import {
  notificationPreferences,
  notifications,
  pushDevices,
} from "../../../infrastructure/db/schema";

interface Cursor {
  updatedSeq: number;
  id: string;
}

function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify(c)).toString("base64url");
}

function decodeCursor(raw: string): Cursor {
  return JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Cursor;
}

@Injectable()
export class NotificationsService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  // api.md §1.5: keyset pagination on (updated_seq, id) — stable under
  // concurrent writes, unlike offset pagination.
  async list(tenantId: string, userId: string, query: ListNotificationsQuery) {
    return withTenant(this.db, tenantId, async (tx) => {
      const conditions = [eq(notifications.tenantId, tenantId), eq(notifications.userId, userId)];
      if (query.unread) conditions.push(sql`${notifications.readAt} is null`);
      if (query.cursor) {
        const c = decodeCursor(query.cursor);
        conditions.push(
          or(
            lt(notifications.updatedSeq, c.updatedSeq),
            and(eq(notifications.updatedSeq, c.updatedSeq), lt(notifications.id, c.id)),
          )!,
        );
      }

      const rows = await tx.query.notifications.findMany({
        where: and(...conditions),
        orderBy: (n, { desc }) => [desc(n.updatedSeq), desc(n.id)],
        limit: query.limit + 1,
      });

      const hasMore = rows.length > query.limit;
      const page = rows.slice(0, query.limit);
      const last = page.at(-1);
      const nextCursor =
        hasMore && last ? encodeCursor({ updatedSeq: last.updatedSeq, id: last.id }) : null;

      return { data: page, meta: { cursor: nextCursor, hasMore } };
    });
  }

  async markRead(
    tenantId: string,
    userId: string,
    input: MarkNotificationsReadInput,
  ): Promise<void> {
    await withTenant(this.db, tenantId, async (tx) => {
      const base = and(eq(notifications.tenantId, tenantId), eq(notifications.userId, userId));
      if (input.ids) {
        await tx
          .update(notifications)
          .set({ readAt: new Date() })
          .where(and(base, inArray(notifications.id, input.ids)));
      } else if (input.allBefore) {
        await tx
          .update(notifications)
          .set({ readAt: new Date() })
          .where(and(base, sql`${notifications.createdAt} <= ${input.allBefore}`));
      }
    });
  }

  async getPreferences(tenantId: string, userId: string): Promise<NotificationPreference[]> {
    const rows = await withTenant(this.db, tenantId, (tx) =>
      tx.query.notificationPreferences.findMany({
        where: and(
          eq(notificationPreferences.tenantId, tenantId),
          eq(notificationPreferences.userId, userId),
        ),
      }),
    );
    return rows.map((r) => ({
      category: r.category,
      channel: r.channel as NotificationPreference["channel"],
      enabled: r.enabled,
      digest: r.digest as NotificationPreference["digest"],
    }));
  }

  // PUT replaces the caller's full matrix (api.md §12) — upsert each row
  // rather than delete-then-insert so unspecified categories/channels the
  // client didn't touch are left as-is only if they weren't included; since
  // this endpoint receives the *full* matrix, a delete-then-insert inside
  // one transaction is simplest and can't be observed half-applied.
  async replacePreferences(
    tenantId: string,
    userId: string,
    preferences: NotificationPreference[],
  ): Promise<void> {
    await withTenant(this.db, tenantId, async (tx) => {
      await tx
        .delete(notificationPreferences)
        .where(
          and(
            eq(notificationPreferences.tenantId, tenantId),
            eq(notificationPreferences.userId, userId),
          ),
        );
      if (preferences.length > 0) {
        await tx.insert(notificationPreferences).values(
          preferences.map((p) => ({
            tenantId,
            userId,
            category: p.category,
            channel: p.channel,
            enabled: p.enabled,
            digest: p.digest,
          })),
        );
      }
    });
  }

  async registerDevice(
    tenantId: string,
    userId: string,
    input: RegisterDeviceInput,
  ): Promise<void> {
    await withTenant(this.db, tenantId, (tx) =>
      tx
        .insert(pushDevices)
        .values({
          tenantId,
          userId,
          platform: input.platform,
          pushToken: input.pushToken,
          deviceName: input.deviceName,
        })
        .onConflictDoUpdate({
          target: [pushDevices.tenantId, pushDevices.pushToken],
          set: {
            userId,
            platform: input.platform,
            deviceName: input.deviceName,
            lastSeenAt: new Date(),
          },
        }),
    );
  }
}
