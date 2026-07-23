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
      location_document_version_id TEXT,
      location_x REAL,
      location_y REAL,
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

    -- FR-FIELD-3 (roadmap.md's "Photo capture pipeline (offline, EXIF,
    -- resumable)" row): a photo is captured to local storage immediately
    -- and queued here — separate from mutation_queue since sync_mutations
    -- carries JSON diffs, not binary uploads. parts_json tracks per-part
    -- ETags for multipart uploads so an interrupted upload resumes from
    -- the first un-acked part instead of restarting.
    CREATE TABLE IF NOT EXISTS photo_queue (
      id TEXT PRIMARY KEY NOT NULL,
      project_id TEXT NOT NULL,
      entity_type TEXT,
      entity_id TEXT,
      local_uri TEXT NOT NULL,
      content_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      taken_at TEXT NOT NULL,
      geo_lat REAL,
      geo_lng REAL,
      heading REAL,
      device_id TEXT,
      status TEXT NOT NULL DEFAULT 'queued',
      file_id TEXT,
      photo_id TEXT,
      upload_mode TEXT,
      upload_id TEXT,
      upload_url TEXT,
      parts_json TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS ix_photo_queue_status ON photo_queue (status);

    -- roadmap.md's "Field tasks/punch + drawing viewer offline" row
    -- (FR-DOC-5). Caches the field working set's currently-published
    -- drawing set for offline viewing — one row per sheet, keyed by
    -- document_version_id since a sheet only ever belongs to one
    -- published set at a time (server enforces a single published set
    -- per project). local_uri/content_type/downloaded_at stay NULL until
    -- src/features/drawings/repository.ts's downloadSheet() runs.
    CREATE TABLE IF NOT EXISTS drawing_sheets (
      document_version_id TEXT PRIMARY KEY NOT NULL,
      project_id TEXT NOT NULL,
      drawing_set_id TEXT NOT NULL,
      drawing_set_name TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      download_url TEXT NOT NULL,
      content_type TEXT,
      local_uri TEXT,
      downloaded_at TEXT
    );

    CREATE INDEX IF NOT EXISTS ix_drawing_sheets_project ON drawing_sheets (project_id);

    -- roadmap.md's "Field UX hardening: high-contrast, 52 px targets,
    -- voice notes" row. Local-only for this pass — no fileId/upload
    -- pipeline yet (flagged follow-up: same files.id FK pattern Photos
    -- already uses once a server-side voice-note entity is built,
    -- database.md has no such table today so this isn't invented ahead of
    -- spec). Recordings and playback both work fully offline; only
    -- cross-device sync is deferred.
    CREATE TABLE IF NOT EXISTS voice_notes (
      id TEXT PRIMARY KEY NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      local_uri TEXT NOT NULL,
      duration_millis INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS ix_voice_notes_entity ON voice_notes (entity_type, entity_id);
  `);
}
