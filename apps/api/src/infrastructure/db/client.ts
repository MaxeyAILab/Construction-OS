import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { z } from "zod";
import type { Env } from "../../config/env.js";
import * as schema from "./schema/index.js";

const tenantIdSchema = z.string().uuid();

export type Database = ReturnType<typeof drizzle<typeof schema>>;

export function createDatabase(env: Pick<Env, "DATABASE_URL">) {
  const client = postgres(env.DATABASE_URL, { prepare: false });
  return drizzle(client, { schema });
}

/**
 * Every tenant-scoped query must run inside this so RLS has
 * `app.tenant_id` to compare against (database.md §2, architecture.md §17).
 * Never query tenant tables outside a tenant context.
 */
export async function withTenant<T>(
  db: Database,
  tenantId: string,
  fn: (tx: Database) => Promise<T>,
): Promise<T> {
  const safeTenantId = tenantIdSchema.parse(tenantId);
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.tenant_id', ${safeTenantId}, true)`);
    return fn(tx as unknown as Database);
  });
}
