import { readFileSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { createDatabase } from "../../src/infrastructure/db/client";

const ADMIN_DATABASE_URL = process.env.DATABASE_URL;

if (!ADMIN_DATABASE_URL) {
  throw new Error("DATABASE_URL must point at a disposable test Postgres instance");
}

function asAppRoleUrl(adminUrl: string): string {
  const url = new URL(adminUrl);
  url.username = "constructionos_app";
  url.password = "constructionos_app";
  return url.toString();
}

export const appDatabaseUrl = asAppRoleUrl(ADMIN_DATABASE_URL);

// Docker's default postgres:16 image makes its bootstrap role an actual
// superuser, which bypasses RLS unconditionally — unlike Supabase's
// non-superuser "postgres" role. This creates an equivalent non-superuser
// owner so tests exercise the same FORCE ROW LEVEL SECURITY path production
// will (see bootstrap_test_role.sql).
export async function bootstrapTestRole(): Promise<void> {
  const admin = postgres(ADMIN_DATABASE_URL!, { max: 1, prepare: false });
  const fixture = readFileSync(
    path.join(__dirname, "../../src/infrastructure/db/test-fixtures/bootstrap_test_role.sql"),
    "utf8",
  );
  await admin.unsafe(fixture);
  await admin.end();
}

export function getTestDatabase() {
  return createDatabase({ DATABASE_URL: appDatabaseUrl });
}
