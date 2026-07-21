import path from "node:path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { z } from "zod";

// Deliberately narrower than the app's full env schema (config/env.ts):
// running migrations shouldn't require JWT/Redis/MFA secrets that are
// unrelated to applying SQL.
const migrateEnvSchema = z.object({ DATABASE_URL: z.string().url() });

async function main() {
  const env = migrateEnvSchema.parse(process.env);
  const client = postgres(env.DATABASE_URL, { max: 1, prepare: false });
  const db = drizzle(client);

  await migrate(db, { migrationsFolder: path.join(__dirname, "migrations") });
  await client.end();
}

void main();
