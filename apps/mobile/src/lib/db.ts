// Local SQLite store (architecture.md §6: "every field action writes to
// SQLite first ... the network is an optimization, never a dependency").
// Mirrors of the server's synced entities (tasks, daily_reports,
// time_entries — roadmap.md's "Daily reports + time + weather (offline)"
// row), a `mutation_queue` outbox (architecture.md §14.2's mutation
// record shape), and `sync_state` (key/value: the delta cursor + this
// device's client_id).
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

    CREATE TABLE IF NOT EXISTS daily_reports (
      id TEXT PRIMARY KEY NOT NULL,
      project_id TEXT NOT NULL,
      report_date TEXT NOT NULL,
      weather TEXT,
      narrative TEXT,
      status TEXT NOT NULL,
      submitted_at TEXT,
      updated_seq INTEGER NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );

    CREATE INDEX IF NOT EXISTS ix_daily_reports_project ON daily_reports (project_id);

    CREATE TABLE IF NOT EXISTS time_entries (
      id TEXT PRIMARY KEY NOT NULL,
      daily_report_id TEXT,
      project_id TEXT NOT NULL,
      user_id TEXT,
      crew_label TEXT,
      cost_code_id TEXT NOT NULL,
      hours TEXT NOT NULL,
      work_date TEXT NOT NULL,
      kind TEXT NOT NULL,
      approved_at TEXT,
      updated_seq INTEGER NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );

    CREATE INDEX IF NOT EXISTS ix_time_entries_project ON time_entries (project_id);
    CREATE INDEX IF NOT EXISTS ix_time_entries_report ON time_entries (daily_report_id);

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
