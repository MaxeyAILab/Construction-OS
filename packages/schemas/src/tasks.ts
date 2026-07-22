import { z } from "zod";
import { paginationQuerySchema, uuidSchema } from "./common";

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected an ISO-8601 date (YYYY-MM-DD)");

export const taskStatusSchema = z.enum(["todo", "in_progress", "blocked", "done", "cancelled"]);
export type TaskStatus = z.infer<typeof taskStatusSchema>;

// database.md §15 doesn't enumerate priority's values — this set is a
// documented assumption (see tasks schema's own comment).
export const taskPrioritySchema = z.enum(["low", "medium", "high", "urgent"]);
export type TaskPriority = z.infer<typeof taskPrioritySchema>;

export const taskKindSchema = z.enum(["task", "punch"]);
export type TaskKind = z.infer<typeof taskKindSchema>;

export const checklistItemSchema = z.object({
  label: z.string().min(1),
  done: z.boolean().default(false),
});
export type ChecklistItem = z.infer<typeof checklistItemSchema>;

// api.md §7: tasks live at a flat /tasks (not nested under /projects/{id}),
// so project_id is a body field here rather than a path parameter.
export const createTaskSchema = z.object({
  projectId: uuidSchema,
  title: z.string().min(1),
  description: z.string().optional(),
  priority: taskPrioritySchema.optional(),
  dueDate: isoDateSchema.optional(),
  assigneeId: uuidSchema.optional(),
  kind: taskKindSchema.optional(),
  locationDocumentVersionId: uuidSchema.optional(),
  locationX: z.number().optional(),
  locationY: z.number().optional(),
  scheduleActivityId: uuidSchema.optional(),
  rfiId: uuidSchema.optional(),
  checklist: z.array(checklistItemSchema).optional(),
});
export type CreateTaskInput = z.infer<typeof createTaskSchema>;

export const updateTaskSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  status: taskStatusSchema.optional(),
  priority: taskPrioritySchema.optional(),
  dueDate: isoDateSchema.nullable().optional(),
  assigneeId: uuidSchema.nullable().optional(),
  kind: taskKindSchema.optional(),
  locationDocumentVersionId: uuidSchema.nullable().optional(),
  locationX: z.number().nullable().optional(),
  locationY: z.number().nullable().optional(),
  scheduleActivityId: uuidSchema.nullable().optional(),
  rfiId: uuidSchema.nullable().optional(),
  checklist: z.array(checklistItemSchema).nullable().optional(),
});
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;

// api.md §7: "Filter: project_id, assignee_id, status, kind (task|punch),
// due window. GET /tasks?filter[assignee_id]=me = My Work" — "me" passes
// validation here, then the controller resolves it to the caller's own id
// before calling TasksService.list, which only ever sees a real uuid.
export const listTasksQuerySchema = paginationQuerySchema.extend({
  projectId: uuidSchema.optional(),
  assigneeId: z.union([uuidSchema, z.literal("me")]).optional(),
  status: taskStatusSchema.optional(),
  kind: taskKindSchema.optional(),
  dueBefore: isoDateSchema.optional(),
  dueAfter: isoDateSchema.optional(),
});
export type ListTasksQuery = z.infer<typeof listTasksQuerySchema>;
