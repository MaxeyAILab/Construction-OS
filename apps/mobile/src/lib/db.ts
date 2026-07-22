// Local SQLite store (architecture.md §6: "every field action writes to
// SQLite first ... the network is an optimization, never a dependency").
// Three tables: `tasks` (a mirror of the server's tasks working set, keyed
// by the same uuid), `mutation_queue` (outbox of not-yet-synced local
// writes, mirroring architecture.md §14.2's mutation record shape), and
// `sync_state` (a single-row cursor: the last-applied delta `since_seq`).
import * as SQLite from "expo-sqlite";

const DATABASE_NAME = "constructionos.db";

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

export function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = SQLite.openDatabaseAsync(DATABASE_NAME).then(async (db) => {
      await migrate(db);
      return db;
    });
  }
  return dbPromise;
}

async function migrate(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.execAsync(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY NOT NULL,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL,
      priority TEXT NOT NULL,
      due_date TEXT,
      assignee_id TEXT,
      kind TEXT NOT NULL,
      checklist TEXT,
      updated_seq INTEGER NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );

    CREATE INDEX IF NOT EXISTS ix_tasks_project ON tasks (project_id);

    CREATE TABLE IF NOT EXISTS mutation_queue (
      mutation_id TEXT PRIMARY KEY NOT NULL,
      client_id TEXT NOT NULL,
      entity TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      op TEXT NOT NULL,
      changes TEXT,
      base_version INTEGER,
      captured_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      message TEXT
    );

    CREATE TABLE IF NOT EXISTS sync_state (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL
    );
  `);
}
