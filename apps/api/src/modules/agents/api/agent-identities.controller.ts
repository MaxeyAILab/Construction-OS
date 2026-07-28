import { Body, Controller, Delete, Get, Param, Patch, Post, Req } from "@nestjs/common";
import { createAgentIdentitySchema, updateAgentIdentitySchema } from "@constructionos/schemas";
import type { z } from "zod";
import { ZodValidationPipe } from "../../../platform/zod-validation.pipe";
import type { AuthenticatedRequest } from "../../auth";
import { RequirePermission } from "../../rbac";
import { AgentIdentitiesService } from "../application/agent-identities.service";

// api.md §15.1 "Agent identities" — admin.agent.manage-gated CRUD +
// kill-switch. Does not execute any agent behavior (see the service's own
// doc comment); this is the admin surface the roadmap row asks for.
@Controller("admin/agents")
export class AgentIdentitiesController {
  constructor(private readonly agents: AgentIdentitiesService) {}

  @Get()
  @RequirePermission("admin.agent.manage")
  list(@Req() req: AuthenticatedRequest) {
    return this.agents.list(req.auth!.tenantId);
  }

  @Post()
  @RequirePermission("admin.agent.manage")
  create(
    @Body(new ZodValidationPipe(createAgentIdentitySchema)) body: z.infer<typeof createAgentIdentitySchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.agents.create(req.auth!.tenantId, req.auth!.sub, body);
  }

  @Get(":id")
  @RequirePermission("admin.agent.manage")
  get(@Param("id") id: string, @Req() req: AuthenticatedRequest) {
    return this.agents.get(req.auth!.tenantId, id);
  }

  @Patch(":id")
  @RequirePermission("admin.agent.manage")
  update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateAgentIdentitySchema)) body: z.infer<typeof updateAgentIdentitySchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.agents.update(req.auth!.tenantId, req.auth!.sub, id, body);
  }

  @Post(":id/pause")
  @RequirePermission("admin.agent.manage")
  pause(@Param("id") id: string, @Req() req: AuthenticatedRequest) {
    return this.agents.pause(req.auth!.tenantId, req.auth!.sub, id);
  }

  @Post(":id/resume")
  @RequirePermission("admin.agent.manage")
  resume(@Param("id") id: string, @Req() req: AuthenticatedRequest) {
    return this.agents.resume(req.auth!.tenantId, req.auth!.sub, id);
  }

  @Delete(":id")
  @RequirePermission("admin.agent.manage")
  delete(@Param("id") id: string, @Req() req: AuthenticatedRequest) {
    return this.agents.delete(req.auth!.tenantId, req.auth!.sub, id);
  }
}
