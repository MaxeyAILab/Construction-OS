import type { Database } from "../../src/infrastructure/db/client";
import { OutboxService } from "../../src/modules/events/application/outbox.service";
import { TasksService } from "../../src/modules/tasks/application/tasks.service";

export function buildTestTasksServices(db: Database) {
  const outbox = new OutboxService();
  return { tasksService: new TasksService(db, outbox) };
}
