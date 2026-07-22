import type { Database } from "../../src/infrastructure/db/client";
import { CommentsService } from "../../src/modules/comments/application/comments.service";
import { OutboxService } from "../../src/modules/events/application/outbox.service";

export function buildTestCommentsServices(db: Database) {
  const outbox = new OutboxService();
  return { commentsService: new CommentsService(db, outbox) };
}
