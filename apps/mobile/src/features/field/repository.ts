// Local-first daily report + time entry CRUD (architecture.md §6,
// roadmap.md's "Daily reports + time + weather (offline)" row, FR-FIELD-1/2).
// Every write lands in SQLite first and enqueues a sync mutation — screens
// never hit the REST API directly for these entities.
import { getDb } from "../../lib/db";
import { enqueueMutation } from "../../lib/sync";
import { uuidv7 } from "../../lib/uuid";

export interface LocalWeather {
  conditions?: string;
  tempHighF?: number;
  tempLowF?: number;
}

export interface LocalDailyReport {
  id: string;
  projectId: string;
  reportDate: string;
  weather: LocalWeather | null;
  narrative: string | null;
  status: "draft" | "submitted";
  submittedAt: string | null;
  updatedSeq: number;
}

interface DailyReportRow {
  id: string;
  project_id: string;
  report_date: string;
  weather: string | null;
  narrative: string | null;
  status: "draft" | "submitted";
  submitted_at: string | null;
  updated_seq: number;
}

function fromReportRow(row: DailyReportRow): LocalDailyReport {
  return {
    id: row.id,
    projectId: row.project_id,
    reportDate: row.report_date,
    weather: row.weather ? (JSON.parse(row.weather) as LocalWeather) : null,
    narrative: row.narrative,
    status: row.status,
    submittedAt: row.submitted_at,
    updatedSeq: row.updated_seq,
  };
}

export async function getReportForDate(projectId: string, reportDate: string): Promise<LocalDailyReport | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<DailyReportRow>(
    "SELECT * FROM daily_reports WHERE project_id = ? AND report_date = ? AND deleted_at IS NULL",
    [projectId, reportDate],
  );
  return row ? fromReportRow(row) : null;
}

export async function createDailyReport(projectId: string, reportDate: string): Promise<LocalDailyReport> {
  const db = await getDb();
  const id = uuidv7();
  const now = new Date().toISOString();

  await db.runAsync(
    `INSERT INTO daily_reports (id, project_id, report_date, weather, narrative, status, submitted_at, updated_seq, updated_at, deleted_at)
     VALUES (?, ?, ?, NULL, NULL, 'draft', NULL, 0, ?, NULL)`,
    [id, projectId, reportDate, now],
  );

  await enqueueMutation({
    mutationId: uuidv7(),
    entity: "daily_reports",
    entityId: id,
    op: "create",
    changes: { projectId, reportDate },
    capturedAt: now,
  });

  return { id, projectId, reportDate, weather: null, narrative: null, status: "draft", submittedAt: null, updatedSeq: 0 };
}

export interface UpdateDailyReportInput {
  narrative?: string;
  weather?: LocalWeather;
  status?: "submitted";
}

export async function updateDailyReport(report: LocalDailyReport, changes: UpdateDailyReportInput): Promise<void> {
  const db = await getDb();
  const now = new Date().toISOString();
  const narrative = changes.narrative ?? report.narrative;
  const weather = changes.weather ?? report.weather;
  const status = changes.status ?? report.status;
  const submittedAt = changes.status === "submitted" ? now : report.submittedAt;

  await db.runAsync(
    "UPDATE daily_reports SET narrative = ?, weather = ?, status = ?, submitted_at = ?, updated_at = ? WHERE id = ?",
    [narrative, weather ? JSON.stringify(weather) : null, status, submittedAt, now, report.id],
  );

  await enqueueMutation({
    mutationId: uuidv7(),
    entity: "daily_reports",
    entityId: report.id,
    op: "update",
    changes: { ...changes },
    baseVersion: report.updatedSeq,
    capturedAt: now,
  });
}

export interface LocalTimeEntry {
  id: string;
  dailyReportId: string | null;
  projectId: string;
  userId: string | null;
  crewLabel: string | null;
  costCodeId: string;
  hours: string;
  workDate: string;
  kind: "regular" | "overtime";
  approvedAt: string | null;
}

interface TimeEntryRow {
  id: string;
  daily_report_id: string | null;
  project_id: string;
  user_id: string | null;
  crew_label: string | null;
  cost_code_id: string;
  hours: string;
  work_date: string;
  kind: "regular" | "overtime";
  approved_at: string | null;
}

function fromTimeEntryRow(row: TimeEntryRow): LocalTimeEntry {
  return {
    id: row.id,
    dailyReportId: row.daily_report_id,
    projectId: row.project_id,
    userId: row.user_id,
    crewLabel: row.crew_label,
    costCodeId: row.cost_code_id,
    hours: row.hours,
    workDate: row.work_date,
    kind: row.kind,
    approvedAt: row.approved_at,
  };
}

export async function listTimeEntriesForReport(dailyReportId: string): Promise<LocalTimeEntry[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<TimeEntryRow>(
    "SELECT * FROM time_entries WHERE daily_report_id = ? AND deleted_at IS NULL ORDER BY work_date DESC",
    [dailyReportId],
  );
  return rows.map(fromTimeEntryRow);
}

export interface CreateTimeEntryInput {
  dailyReportId: string;
  projectId: string;
  userId: string;
  costCodeId: string;
  hours: number;
  workDate: string;
}

export async function createTimeEntry(input: CreateTimeEntryInput): Promise<LocalTimeEntry> {
  const db = await getDb();
  const id = uuidv7();
  const now = new Date().toISOString();
  const hours = input.hours.toFixed(2);

  await db.runAsync(
    `INSERT INTO time_entries (id, daily_report_id, project_id, user_id, crew_label, cost_code_id, hours, work_date, kind, approved_at, updated_seq, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, NULL, ?, ?, ?, 'regular', NULL, 0, ?, NULL)`,
    [id, input.dailyReportId, input.projectId, input.userId, input.costCodeId, hours, input.workDate, now],
  );

  await enqueueMutation({
    mutationId: uuidv7(),
    entity: "time_entries",
    entityId: id,
    op: "create",
    changes: {
      dailyReportId: input.dailyReportId,
      projectId: input.projectId,
      userId: input.userId,
      costCodeId: input.costCodeId,
      hours: input.hours,
      workDate: input.workDate,
      kind: "regular",
    },
    capturedAt: now,
  });

  return {
    id,
    dailyReportId: input.dailyReportId,
    projectId: input.projectId,
    userId: input.userId,
    crewLabel: null,
    costCodeId: input.costCodeId,
    hours,
    workDate: input.workDate,
    kind: "regular",
    approvedAt: null,
  };
}
