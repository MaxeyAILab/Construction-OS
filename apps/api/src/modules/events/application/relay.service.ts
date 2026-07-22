import { Inject, Injectable, Logger } from "@nestjs/common";
import type { OutboxEnvelope } from "@constructionos/schemas";
import { eq, sql } from "drizzle-orm";
import { JSONCodec, type NatsConnection } from "nats";
import { DATABASE, type Database } from "../../../infrastructure/db/client";
import { jobRuns } from "../../../infrastructure/db/schema";
import { eventSubject, NATS_CONNECTION } from "../../../infrastructure/nats/client";

type ClaimedOutboxRow = Record<string, unknown> & {
  id: string;
  tenant_id: string;
  event_type: string;
  payload: unknown;
  dedupe_key: string;
  // postgres.js doesn't apply drizzle's schema-aware type parsing to raw
  // sql`` results from a SETOF-returning function call, so this arrives as
  // a string rather than a pre-parsed Date.
  occurred_at: string;
  claimed_at: string | null;
  published_at: string | null;
};

const jsonCodec = JSONCodec<OutboxEnvelope>();

/**
 * Relays claimed outbox rows to NATS JetStream (architecture.md §8). This is
 * the ONLY code path allowed to call the outbox_claim_pending_events /
 * outbox_mark_published SECURITY DEFINER functions — see
 * 0006_outbox_rls_and_relay_functions.sql for why those exist at all.
 */
@Injectable()
export class RelayService {
  private readonly logger = new Logger(RelayService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(NATS_CONNECTION) private readonly nc: NatsConnection,
  ) {}

  async relayBatch(limit = 50): Promise<{ claimed: number; published: number }> {
    const startedAt = Date.now();
    const [jobRun] = await this.db
      .insert(jobRuns)
      .values({ queue: "outbox-relay", status: "running" })
      .returning();
    const jobRunId = jobRun!.id;

    try {
      const rows = Array.from(
        await this.db.execute<ClaimedOutboxRow>(
          sql`select * from outbox_claim_pending_events(${limit})`,
        ),
      );
      if (rows.length === 0) {
        await this.db
          .update(jobRuns)
          .set({
            status: "completed",
            attempts: 1,
            durationMs: Date.now() - startedAt,
            completedAt: new Date(),
          })
          .where(eq(jobRuns.id, jobRunId));
        return { claimed: 0, published: 0 };
      }

      const jetstream = this.nc.jetstream();
      const publishedIds: string[] = [];
      for (const row of rows) {
        const envelope: OutboxEnvelope = {
          id: row.id,
          tenantId: row.tenant_id,
          eventType: row.event_type,
          payload: row.payload,
          dedupeKey: row.dedupe_key,
          occurredAt: new Date(row.occurred_at).toISOString(),
        };
        await jetstream.publish(eventSubject(row.event_type), jsonCodec.encode(envelope), {
          msgID: row.dedupe_key,
        });
        publishedIds.push(row.id);
      }

      const idArray = sql.join(
        publishedIds.map((id) => sql`${id}::uuid`),
        sql`, `,
      );
      await this.db.execute(sql`select outbox_mark_published(ARRAY[${idArray}])`);

      await this.db
        .update(jobRuns)
        .set({
          status: "completed",
          attempts: 1,
          durationMs: Date.now() - startedAt,
          completedAt: new Date(),
        })
        .where(eq(jobRuns.id, jobRunId));

      return { claimed: rows.length, published: publishedIds.length };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`outbox relay batch failed: ${message}`);
      await this.db
        .update(jobRuns)
        .set({
          status: "failed",
          attempts: 1,
          error: message,
          durationMs: Date.now() - startedAt,
          completedAt: new Date(),
        })
        .where(eq(jobRuns.id, jobRunId));
      throw err;
    }
  }
}
