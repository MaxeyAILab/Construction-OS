import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import { createCommentSchema, createTaskSchema, listTasksQuerySchema, updateTaskSchema } from "@constructionos/schemas";
import type { z } from "zod";
import { ZodValidationPipe } from "../../../platform/zod-validation.pipe";
import type { AuthenticatedRequest } from "../../auth";
import { CommentsService } from "../../comments";
import { RequirePermission } from "../../rbac";
import { TasksService } from "../application/tasks.service";

@Controller()
export class TasksController {
  constructor(
    private readonly tasks: TasksService,
    private readonly comments: CommentsService,
  ) {}

  // api.md §7: "GET /tasks?filter[assignee_id]=me = My Work" — resolved to
  // the caller's own id here so the service only ever sees a real uuid.
  @Get("tasks")
  @RequirePermission("tasks.task.read")
  list(
    @Query(new ZodValidationPipe(listTasksQuerySchema)) query: z.infer<typeof listTasksQuerySchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    const assigneeId = query.assigneeId === "me" ? req.auth!.sub : query.assigneeId;
    return this.tasks.list(req.auth!.tenantId, { ...query, assigneeId });
  }

  @Post("tasks")
  @RequirePermission("tasks.task.create")
  @HttpCode(HttpStatus.CREATED)
  create(
    @Body(new ZodValidationPipe(createTaskSchema)) body: z.infer<typeof createTaskSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.tasks.create(req.auth!.tenantId, req.auth!.sub, body);
  }

  @Get("tasks/:id")
  @RequirePermission("tasks.task.read")
  getById(@Param("id") id: string, @Req() req: AuthenticatedRequest) {
    return this.tasks.getById(req.auth!.tenantId, id);
  }

  @Patch("tasks/:id")
  @RequirePermission("tasks.task.update")
  update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateTaskSchema)) body: z.infer<typeof updateTaskSchema>,
    @Headers("if-match") ifMatch: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    const version = ifMatch !== undefined ? Number.parseInt(ifMatch, 10) : undefined;
    return this.tasks.update(req.auth!.tenantId, req.auth!.sub, id, body, version);
  }

  @Delete("tasks/:id")
  @RequirePermission("tasks.task.delete")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param("id") id: string, @Req() req: AuthenticatedRequest): Promise<void> {
    await this.tasks.remove(req.auth!.tenantId, req.auth!.sub, id);
  }

  @Get("tasks/:id/comments")
  @RequirePermission("tasks.task.read")
  listComments(@Param("id") id: string, @Req() req: AuthenticatedRequest) {
    return this.comments.list(req.auth!.tenantId, "task", id);
  }

  @Post("tasks/:id/comments")
  @RequirePermission("tasks.task.comment")
  @HttpCode(HttpStatus.CREATED)
  addComment(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(createCommentSchema)) body: z.infer<typeof createCommentSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.comments.create(req.auth!.tenantId, req.auth!.sub, "task", id, body);
  }
}
