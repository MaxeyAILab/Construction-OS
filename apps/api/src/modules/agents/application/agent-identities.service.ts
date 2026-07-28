import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { CreateAgentIdentityInput, UpdateAgentIdentityInput } from "@constructionos/schemas";
import { and, eq, gte, isNull, sum } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import { agentIdentities, aiRuns, companyUsers, userRoles, users } from "../../../infrastructure/db/schema";
import { OutboxService } from "../../events";
// Deep import, not the "../../rbac" barrel — same cycle-avoidance
// precedent documented in auth/application/scim-groups.service.ts.
import { RbacService } from "../../rbac/application/rbac.service";
import { AgentBudgetExceededError, AgentIdentityNotFoundError, AgentPausedError, UnknownAgentToolError } from "../domain/errors";

// ai-spec.md §6's tool-runner registry doesn't expose a single introspect-
// able catalog (tools are assembled per-conversation-type from live
// service deps, not a static list) — this is the closest available
// equivalent, the literal tool names declared across
// project-assistant/domain/tools/*.ts. Kept manually in sync (documented
// limitation): the same "validate against a real catalog" intent as
// api_keys.scopes[], just without a queryable table to check against.
const KNOWN_TOOL_NAMES = new Set([
  "search_project_records",
  "get_project_summary",
  "list_overdue_tasks",
  "list_open_rfis",
  "suggest_tasks",
  "search_company_records",
  "get_company_summary",
  // api.md §15.2 "Procurement Agent" — ProcurementAgentRunnerService's
  // daily tick processes every active agent whose tool_allowlist contains
  // this entry (the declared capability doubles as "is this a Procurement
  // Agent", no separate agent-type column).
  "draft_and_route_purchase_orders",
  // api.md §15.3 "Billing Agent" — same capability-is-identity precedent,
  // for BillingAgentRunnerService's monthly tick.
  "assemble_and_route_pay_applications",
  // api.md §15.4 "Compliance Agent" — same capability-is-identity
  // precedent, for ComplianceAgentRunnerService's daily tick.
  "chase_expiring_subcontractor_compliance",
]);

function agentEmail(): string {
  return `agent+${randomUUID()}@agents.internal.constructionos.local`;
}

// Same "current month" boundary as AiGatewayService's own budget check
// (ai-spec.md §2) — UTC calendar month, not a rolling 30 days.
function startOfCurrentMonth(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

// api.md §15.1 "Agent identities" (ai-spec.md §15, roadmap "Agent runtime
// GA"). An agent is declared, budgeted, and kill-switchable admin
// surface on top of the existing tool registry/audit spine — this
// service does not execute any agent behavior itself (no "planned
// agents" are built here, see api.md §15.1's doc comment).
@Injectable()
export class AgentIdentitiesService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly outbox: OutboxService,
    private readonly rbac: RbacService,
  ) {}

  async list(tenantId: string) {
    const rows = await withTenant(this.db, tenantId, (tx) =>
      tx
        .select({ agent: agentIdentities, user: users })
        .from(agentIdentities)
        .innerJoin(users, eq(users.id, agentIdentities.userId))
        .where(and(eq(agentIdentities.tenantId, tenantId), isNull(agentIdentities.deletedAt))),
    );
    return Promise.all(rows.map(async (row) => this.toDto(row.agent, row.user, await this.getUsageThisMonth(tenantId, row.agent.userId))));
  }

  async get(tenantId: string, id: string) {
    const { agent, user } = await this.requireAgent(tenantId, id);
    return this.toDto(agent, user, await this.getUsageThisMonth(tenantId, agent.userId));
  }

  async create(tenantId: string, actorId: string, input: CreateAgentIdentityInput) {
    this.assertKnownTools(input.toolAllowlist);

    const [user] = await this.db.insert(users).values({ email: agentEmail(), fullName: input.name, passwordHash: null }).returning();

    const agent = await withTenant(this.db, tenantId, async (tx) => {
      await tx.insert(companyUsers).values({ tenantId, userId: user!.id, kind: "agent", createdBy: actorId });
      const [created] = await tx
        .insert(agentIdentities)
        .values({
          tenantId,
          userId: user!.id,
          name: input.name,
          purpose: input.purpose,
          toolAllowlist: input.toolAllowlist,
          budgetMonthlyUsd: input.budgetMonthlyUsd,
          escalationContacts: input.escalationContacts ?? [],
          createdBy: actorId,
        })
        .returning();

      await this.outbox.append(tx, {
        tenantId,
        eventType: "agent_identity.created.v1",
        dedupeKey: `agent_identity.created.v1:${created!.id}`,
        actorId,
        payload: { companyId: tenantId, agentId: created!.id, name: created!.name },
      });

      return created!;
    });

    // Its "permission_set (narrow, explicit)" (ai-spec.md §15) is an
    // ordinary role assignment via the same RbacService every human user
    // goes through — not a parallel mechanism.
    await this.rbac.assignRole(tenantId, user!.id, input.roleId, { scopeType: "company" }, actorId);

    return this.toDto(agent, user!, "0.00");
  }

  async update(tenantId: string, actorId: string, id: string, input: UpdateAgentIdentityInput) {
    if (input.toolAllowlist) this.assertKnownTools(input.toolAllowlist);

    return withTenant(this.db, tenantId, async (tx) => {
      const { agent, user } = await this.requireAgentTx(tx, tenantId, id);
      const [updated] = await tx
        .update(agentIdentities)
        .set({
          ...(input.purpose !== undefined ? { purpose: input.purpose } : {}),
          ...(input.toolAllowlist !== undefined ? { toolAllowlist: input.toolAllowlist } : {}),
          ...(input.budgetMonthlyUsd !== undefined ? { budgetMonthlyUsd: input.budgetMonthlyUsd } : {}),
          ...(input.escalationContacts !== undefined ? { escalationContacts: input.escalationContacts } : {}),
          updatedBy: actorId,
        })
        .where(eq(agentIdentities.id, id))
        .returning();

      return this.toDto(updated!, user, await this.getUsageThisMonth(tenantId, agent.userId));
    });
  }

  // ai-spec.md §15: "human 'pause agent' kill-switch per tenant."
  async pause(tenantId: string, actorId: string, id: string) {
    return this.setStatus(tenantId, actorId, id, "paused", "agent_identity.paused.v1");
  }

  async resume(tenantId: string, actorId: string, id: string) {
    return this.setStatus(tenantId, actorId, id, "active", "agent_identity.resumed.v1");
  }

  // api.md §15.1: "revokes the agent's role assignment and deactivates
  // its identity; the underlying users/ai_runs history is retained."
  async delete(tenantId: string, actorId: string, id: string) {
    const { agent } = await this.requireAgent(tenantId, id);

    const assignedRoles = await withTenant(this.db, tenantId, (tx) =>
      tx
        .select({ roleId: userRoles.roleId })
        .from(userRoles)
        .where(and(eq(userRoles.tenantId, tenantId), eq(userRoles.userId, agent.userId))),
    );
    for (const { roleId } of assignedRoles) {
      await this.rbac.revokeRole(tenantId, agent.userId, roleId, actorId);
    }

    await withTenant(this.db, tenantId, async (tx) => {
      await tx
        .update(agentIdentities)
        .set({ deletedAt: new Date(), updatedBy: actorId })
        .where(eq(agentIdentities.id, id));
      await tx
        .update(companyUsers)
        .set({ deletedAt: new Date(), updatedBy: actorId })
        .where(and(eq(companyUsers.tenantId, tenantId), eq(companyUsers.userId, agent.userId)));

      await this.outbox.append(tx, {
        tenantId,
        eventType: "agent_identity.deleted.v1",
        dedupeKey: `agent_identity.deleted.v1:${id}`,
        actorId,
        payload: { companyId: tenantId, agentId: id },
      });
    });
  }

  // The kill-switch enforcement point (ai-spec.md §15) and the budget
  // check "the same computation an actual agent implementation calls
  // before acting" (api.md §15.1) — no concrete agent execution loop
  // calls this yet (none of the "planned agents" are built), but this is
  // the primitive the roadmap row asks for, not speculative dead code.
  async assertCanAct(tenantId: string, agentUserId: string): Promise<void> {
    const agent = await withTenant(this.db, tenantId, (tx) =>
      tx.query.agentIdentities.findFirst({
        where: and(eq(agentIdentities.tenantId, tenantId), eq(agentIdentities.userId, agentUserId), isNull(agentIdentities.deletedAt)),
      }),
    );
    if (!agent) throw new AgentIdentityNotFoundError();
    if (agent.status !== "active") throw new AgentPausedError();

    if (agent.budgetMonthlyUsd) {
      const usage = await this.getUsageThisMonth(tenantId, agentUserId);
      if (Number(usage) >= Number(agent.budgetMonthlyUsd)) throw new AgentBudgetExceededError();
    }
  }

  private async setStatus(tenantId: string, actorId: string, id: string, status: "active" | "paused", eventType: "agent_identity.paused.v1" | "agent_identity.resumed.v1") {
    return withTenant(this.db, tenantId, async (tx) => {
      const { user } = await this.requireAgentTx(tx, tenantId, id);
      const [updated] = await tx
        .update(agentIdentities)
        .set({
          status,
          pausedAt: status === "paused" ? new Date() : null,
          pausedBy: status === "paused" ? actorId : null,
          updatedBy: actorId,
        })
        .where(eq(agentIdentities.id, id))
        .returning();

      await this.outbox.append(tx, {
        tenantId,
        eventType,
        dedupeKey: `${eventType}:${id}:${Date.now()}`,
        actorId,
        payload: { companyId: tenantId, agentId: id },
      });

      return this.toDto(updated!, user, await this.getUsageThisMonth(tenantId, updated!.userId));
    });
  }

  private assertKnownTools(toolAllowlist: string[]): void {
    for (const tool of toolAllowlist) {
      if (!KNOWN_TOOL_NAMES.has(tool)) throw new UnknownAgentToolError(tool);
    }
  }

  private async getUsageThisMonth(tenantId: string, agentUserId: string): Promise<string> {
    const [row] = await withTenant(this.db, tenantId, (tx) =>
      tx
        .select({ total: sum(aiRuns.costUsd) })
        .from(aiRuns)
        .where(
          and(
            eq(aiRuns.tenantId, tenantId),
            eq(aiRuns.actorId, agentUserId),
            gte(aiRuns.createdAt, startOfCurrentMonth()),
          ),
        ),
    );
    return row?.total ?? "0.00";
  }

  private async requireAgent(tenantId: string, id: string) {
    return withTenant(this.db, tenantId, (tx) => this.requireAgentTx(tx, tenantId, id));
  }

  private async requireAgentTx(tx: Database, tenantId: string, id: string) {
    const agent = await tx.query.agentIdentities.findFirst({
      where: and(eq(agentIdentities.tenantId, tenantId), eq(agentIdentities.id, id), isNull(agentIdentities.deletedAt)),
    });
    if (!agent) throw new AgentIdentityNotFoundError();
    const user = await tx.query.users.findFirst({ where: eq(users.id, agent.userId) });
    if (!user) throw new AgentIdentityNotFoundError();
    return { agent, user };
  }

  private toDto(agent: typeof agentIdentities.$inferSelect, user: typeof users.$inferSelect, usageThisMonthUsd: string) {
    return {
      id: agent.id,
      userId: agent.userId,
      name: agent.name,
      fullName: user.fullName,
      purpose: agent.purpose,
      status: agent.status,
      toolAllowlist: agent.toolAllowlist,
      budgetMonthlyUsd: agent.budgetMonthlyUsd,
      escalationContacts: agent.escalationContacts,
      usageThisMonthUsd,
      pausedAt: agent.pausedAt,
      createdAt: agent.createdAt,
    };
  }
}
