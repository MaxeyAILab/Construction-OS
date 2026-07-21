import path from "node:path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { loadEnv } from "../../config/env";

async function main() {
  const env = loadEnv();
  const client = postgres(env.DATABASE_URL, { max: 1, prepare: false });
  const db = drizzle(client);

  await migrate(db, { migrationsFolder: path.join(__dirname, "migrations") });
  await client.end();
}

void main();
