// Local-first task CRUD (architecture.md §6, roadmap.md's "offline SQLite
// store" row). Every write lands in SQLite first and enqueues a sync
// mutation — callers never hit the REST API directly for tasks.
import type { ChecklistItem, TaskKind, TaskPriority, TaskStatus } from "@constructionos/schemas";
import { getDb } from "../../lib/db";
import { enqueueMutation } from "../../lib/sync";
import { uuidv7 } from "../../lib/uuid";

export interface LocalTask {
  id: string;
  projectId: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string | null;
  assigneeId: string | null;
  kind: TaskKind;
  checklist: ChecklistItem[] | null;
  locationDocumentVersionId: string | null;
  locationX: number | null;
  locationY: number | null;
  updatedSeq: number;
  updatedAt: string;
}

interface TaskRow {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  due_date: string | null;
  assignee_id: string | null;
  kind: TaskKind;
  checklist: string | null;
  location_document_version_id: string | null;
  location_x: number | null;
  location_y: number | null;
  updated_seq: number;
  updated_at: string;
}

function fromRow(row: TaskRow): LocalTask {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    dueDate: row.due_date,
    assigneeId: row.assignee_id,
    kind: row.kind,
    checklist: row.checklist ? (JSON.parse(row.checklist) as ChecklistItem[]) : null,
    locationDocumentVersionId: row.location_document_version_id,
    locationX: row.location_x,
    locationY: row.location_y,
    updatedSeq: row.updated_seq,
    updatedAt: row.updated_at,
  };
}

export async function listTasks(projectId?: string): Promise<LocalTask[]> {
  const db = await getDb();
  const rows = projectId
    ? await db.getAllAsync<TaskRow>(
        "SELECT * FROM tasks WHERE deleted_at IS NULL AND project_id = ? ORDER BY due_date ASC, updated_at DESC",
        [projectId],
      )
    : await db.getAllAsync<TaskRow>("SELECT * FROM tasks WHERE deleted_at IS NULL ORDER BY due_date ASC, updated_at DESC");
  return rows.map(fromRow);
}

export interface CreateTaskInput {
  projectId: string;
  title: string;
  description?: string;
  priority?: TaskPriority;
  dueDate?: string;
  assigneeId?: string;
  kind?: TaskKind;
  checklist?: ChecklistItem[];
  // FR-DOC-5 / roadmap.md's "drawing viewer offline" row: set when a punch
  // item is created by tapping a pin on a cached drawing sheet (see
  // app/drawings/[sheetId].tsx) rather than from the plain Punch list form.
  locationDocumentVersionId?: string;
  locationX?: number;
  locationY?: number;
}

export async function createTask(input: CreateTaskInput): Promise<LocalTask> {
  const db = await getDb();
  const id = uuidv7();
  const now = new Date().toISOString();
  const status: TaskStatus = "todo";
  const priority = input.priority ?? "medium";
  const kind = input.kind ?? "task";

  await db.runAsync(
    `INSERT INTO tasks (id, project_id, title, description, status, priority, due_date, assignee_id, kind, checklist, location_document_version_id, location_x, location_y, updated_seq, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, NULL)`,
    [
      id,
      input.projectId,
      input.title,
      input.description ?? null,
      status,
      priority,
      input.dueDate ?? null,
      input.assigneeId ?? null,
      kind,
      input.checklist ? JSON.stringify(input.checklist) : null,
      input.locationDocumentVersionId ?? null,
      input.locationX ?? null,
      input.locationY ?? null,
      now,
    ],
  );

  await enqueueMutation({
    mutationId: uuidv7(),
    entity: "tasks",
    entityId: id,
    op: "create",
    changes: { ...input, priority, kind },
    capturedAt: now,
  });

  return {
    id,
    projectId: input.projectId,
    title: input.title,
    description: input.description ?? null,
    status,
    priority,
    dueDate: input.dueDate ?? null,
    assigneeId: input.assigneeId ?? null,
    kind,
    checklist: input.checklist ?? null,
    locationDocumentVersionId: input.locationDocumentVersionId ?? null,
    locationX: input.locationX ?? null,
    locationY: input.locationY ?? null,
    updatedSeq: 0,
    updatedAt: now,
  };
}

export interface UpdateTaskInput {
  title?: string;
  description?: string | null;
  status?: TaskStatus;
  priority?: TaskPriority;
  dueDate?: string | null;
  assigneeId?: string | null;
  checklist?: ChecklistItem[] | null;
}

export async function updateTask(id: string, changes: UpdateTaskInput): Promise<void> {
  const db = await getDb();
  const existing = await db.getFirstAsync<TaskRow>("SELECT * FROM tasks WHERE id = ?", [id]);
  if (!existing) throw new Error(`local task ${id} not found`);

  const now = new Date().toISOString();
  const merged: TaskRow = {
    ...existing,
    title: changes.title ?? existing.title,
    description: changes.description !== undefined ? changes.description : existing.description,
    status: changes.status ?? existing.status,
    priority: changes.priority ?? existing.priority,
    due_date: changes.dueDate !== undefined ? changes.dueDate : existing.due_date,
    assignee_id: changes.assigneeId !== undefined ? changes.assigneeId : existing.assignee_id,
    checklist: changes.checklist !== undefined ? (changes.checklist ? JSON.stringify(changes.checklist) : null) : existing.checklist,
    updated_at: now,
  };

  await db.runAsync(
    `UPDATE tasks SET title = ?, description = ?, status = ?, priority = ?, due_date = ?, assignee_id = ?, checklist = ?, updated_at = ?
     WHERE id = ?`,
    [merged.title, merged.description, merged.status, merged.priority, merged.due_date, merged.assignee_id, merged.checklist, merged.updated_at, id],
  );

  await enqueueMutation({
    mutationId: uuidv7(),
    entity: "tasks",
    entityId: id,
    op: "update",
    changes: { ...changes },
    baseVersion: existing.updated_seq,
    capturedAt: now,
  });
}
