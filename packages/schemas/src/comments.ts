import { z } from "zod";
import { uuidSchema } from "./common";

// entity_type is not client-supplied — each consuming module's endpoint
// (e.g. POST /tasks/{id}/comments) fixes it server-side and takes
// entity_id from the path, matching api.md §7's shape.
export const createCommentSchema = z.object({
  body: z.string().min(1),
  mentions: z.array(uuidSchema).optional(),
});
export type CreateCommentInput = z.infer<typeof createCommentSchema>;
