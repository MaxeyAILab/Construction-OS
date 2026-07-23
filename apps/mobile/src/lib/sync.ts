// Client-side half of Mobile Sync v1 (architecture.md §14.2, api.md §16.2)
// against the already-built server endpoints POST /sync/mutations and
// GET /sync/delta. Every local write goes through `enqueueMutation` first
// (architecture.md §6: "the network is an optimization, never a
// dependency") — `syncNow` is only ever called opportunistically, never
// awaited by the write path itself.
import { apiRequest } from "./api";
import type { Session } from "./auth";
import { getDb } from "./db";
import { uploadQueuedPhotos } from "./photo-upload";
import { uuidv7 } from "./uuid";

export type SyncOp = "create" | "update" | "delete";
export type SyncEntity = "tasks" | "daily_reports" | "time_entries";

const ALL_SCOPES: SyncEntity[] = ["tasks", "daily_reports", "time_entries"];

export interface EnqueuedMutation {
  mutationId: string;
  entity: SyncEntity;
  entityId: string;
  op: SyncOp;
  changes?: Record<string, unknown>;
  baseVersion?: number;
  capturedAt: string;
}

interface QueuedMutationRow {
  mutation_id: string;
  client_id: string;
  entity: SyncEntity;
  entity_id: string;
  op: SyncOp;
  changes: string | null;
  base_version: number | null;
  captured_at: string;
}

interface SyncMutationResult {
  mutationId: string;
  result: "applied" | "merged" | "conflict" | "rejected";
  message?: string;
}

export interface ServerTask {
  id: string;
  projectId: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  dueDate: string | null;
  assigneeId: string | null;
  kind: string;
  checklist: unknown;
  updatedSeq: number;
  updatedAt: string;
  deletedAt: string | null;
}

export interface ServerDailyReport {
  id: string;
  projectId: string;
  reportDate: string;
  weather: unknown;
  narrative: string | null;
  status: string;
  submittedAt: string | null;
  updatedSeq: number;
  updatedAt: string;
  deletedAt: string | null;
}

export interface ServerTimeEntry {
  id: string;
  dailyReportId: string | null;
  projectId: string;
  userId: string | null;
  crewLabel: string | null;
  costCodeId: string;
  hours: string;
  workDate: string;
  kind: string;
  approvedAt: string | null;
  updatedSeq: number;
  updatedAt: string;
  deletedAt: string | null;
}

async function getClientId(): Promise<string> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ value: string }>("SELECT value FROM sync_state WHERE key = 'client_id'");
  if (row) return row.value;

  const clientId = uuidv7();
  await db.runAsync("INSERT INTO sync_state (key, value) VALUES ('client_id', ?)", [clientId]);
  return clientId;
}

export async function enqueueMutation(mutation: EnqueuedMutation): Promise<void> {
  const db = await getDb();
  const clientId = await getClientId();
  await db.runAsync(
    `INSERT INTO mutation_queue (mutation_id, client_id, entity, entity_id, op, changes, base_version, captured_at, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
    [
      mutation.mutationId,
      clientId,
      mutation.entity,
      mutation.entityId,
      mutation.op,
      mutation.changes ? JSON.stringify(mutation.changes) : null,
      mutation.baseVersion ?? null,
      mutation.capturedAt,
    ],
  );
}

async function pushMutations(session: Session): Promise<number> {
  const db = await getDb();
  const pending = await db.getAllAsync<QueuedMutationRow>(
    "SELECT * FROM mutation_queue WHERE status = 'pending' ORDER BY captured_at ASC LIMIT 50",
  );
  if (pending.length === 0) return 0;

  const mutations = pending.map((row) => ({
    mutationId: row.mutation_id,
    clientId: row.client_id,
    entity: row.entity,
    entityId: row.entity_id,
    op: row.op,
    changes: row.changes ? JSON.parse(row.changes) : undefined,
    baseVersion: row.base_version ?? undefined,
    capturedAt: row.captured_at,
  }));

  const results = await apiRequest<SyncMutationResult[]>("/sync/mutations", {
    method: "POST",
    token: session.accessToken,
    body: { mutations },
  });

  for (const result of results) {
    if (result.result === "applied" || result.result === "merged") {
      await db.runAsync("DELETE FROM mutation_queue WHERE mutation_id = ?", [result.mutationId]);
    } else {
      // conflict/rejected: left in the queue (status updated) rather than
      // silently dropped or retried in a loop — a genuine conflict needs
      // /sync/conflicts resolution, not another blind push.
      await db.runAsync("UPDATE mutation_queue SET status = ?, message = ? WHERE mutation_id = ?", [
        result.result,
        result.message ?? null,
        result.mutationId,
      ]);
    }
  }

  return pending.length;
}

async function applyTaskDeltas(db: Awaited<ReturnType<typeof getDb>>, rows: ServerTask[]): Promise<void> {
  for (const task of rows) {
    if (task.deletedAt) {
      await db.runAsync("DELETE FROM tasks WHERE id = ?", [task.id]);
      continue;
    }
    await db.runAsync(
      `INSERT INTO tasks (id, project_id, title, description, status, priority, due_date, assignee_id, kind, checklist, updated_seq, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         project_id = excluded.project_id, title = excluded.title, description = excluded.description,
         status = excluded.status, priority = excluded.priority, due_date = excluded.due_date,
         assignee_id = excluded.assignee_id, kind = excluded.kind, checklist = excluded.checklist,
         updated_seq = excluded.updated_seq, updated_at = excluded.updated_at, deleted_at = excluded.deleted_at`,
      [
        task.id,
        task.projectId,
        task.title,
        task.description,
        task.status,
        task.priority,
        task.dueDate,
        task.assigneeId,
        task.kind,
        task.checklist ? JSON.stringify(task.checklist) : null,
        task.updatedSeq,
        task.updatedAt,
        task.deletedAt,
      ],
    );
  }
}

async function applyDailyReportDeltas(db: Awaited<ReturnType<typeof getDb>>, rows: ServerDailyReport[]): Promise<void> {
  for (const report of rows) {
    if (report.deletedAt) {
      await db.runAsync("DELETE FROM daily_reports WHERE id = ?", [report.id]);
      continue;
    }
    await db.runAsync(
      `INSERT INTO daily_reports (id, project_id, report_date, weather, narrative, status, submitted_at, updated_seq, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         project_id = excluded.project_id, report_date = excluded.report_date, weather = excluded.weather,
         narrative = excluded.narrative, status = excluded.status, submitted_at = excluded.submitted_at,
         updated_seq = excluded.updated_seq, updated_at = excluded.updated_at, deleted_at = excluded.deleted_at`,
      [
        report.id,
        report.projectId,
        report.reportDate,
        report.weather ? JSON.stringify(report.weather) : null,
        report.narrative,
        report.status,
        report.submittedAt,
        report.updatedSeq,
        report.updatedAt,
        report.deletedAt,
      ],
    );
  }
}

async function applyTimeEntryDeltas(db: Awaited<ReturnType<typeof getDb>>, rows: ServerTimeEntry[]): Promise<void> {
  for (const entry of rows) {
    if (entry.deletedAt) {
      await db.runAsync("DELETE FROM time_entries WHERE id = ?", [entry.id]);
      continue;
    }
    await db.runAsync(
      `INSERT INTO time_entries (id, daily_report_id, project_id, user_id, crew_label, cost_code_id, hours, work_date, kind, approved_at, updated_seq, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         daily_report_id = excluded.daily_report_id, project_id = excluded.project_id, user_id = excluded.user_id,
         crew_label = excluded.crew_label, cost_code_id = excluded.cost_code_id, hours = excluded.hours,
         work_date = excluded.work_date, kind = excluded.kind, approved_at = excluded.approved_at,
         updated_seq = excluded.updated_seq, updated_at = excluded.updated_at, deleted_at = excluded.deleted_at`,
      [
        entry.id,
        entry.dailyReportId,
        entry.projectId,
        entry.userId,
        entry.crewLabel,
        entry.costCodeId,
        entry.hours,
        entry.workDate,
        entry.kind,
        entry.approvedAt,
        entry.updatedSeq,
        entry.updatedAt,
        entry.deletedAt,
      ],
    );
  }
}

async function pullDelta(session: Session, scopes: SyncEntity[] = ALL_SCOPES): Promise<number> {
  const db = await getDb();
  const cursorRow = await db.getFirstAsync<{ value: string }>("SELECT value FROM sync_state WHERE key = 'since_seq'");
  const sinceSeq = cursorRow ? Number(cursorRow.value) : 0;

  const delta = await apiRequest<{
    tasks: ServerTask[];
    dailyReports: ServerDailyReport[];
    timeEntries: ServerTimeEntry[];
    nextSinceSeq: number;
  }>(`/sync/delta?sinceSeq=${sinceSeq}&scopes=${scopes.join(",")}`, { token: session.accessToken });

  await applyTaskDeltas(db, delta.tasks);
  await applyDailyReportDeltas(db, delta.dailyReports);
  await applyTimeEntryDeltas(db, delta.timeEntries);

  await db.runAsync(
    "INSERT INTO sync_state (key, value) VALUES ('since_seq', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    [String(delta.nextSinceSeq)],
  );

  return delta.tasks.length + delta.dailyReports.length + delta.timeEntries.length;
}

export async function syncNow(session: Session): Promise<{ pushed: number; pulled: number; photosUploaded: number }> {
  const pushed = await pushMutations(session);
  const pulled = await pullDelta(session);
  const { uploaded: photosUploaded } = await uploadQueuedPhotos(session);
  return { pushed, pulled, photosUploaded };
}
