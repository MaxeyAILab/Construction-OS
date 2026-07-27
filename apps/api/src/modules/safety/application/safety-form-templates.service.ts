import { Inject, Injectable } from "@nestjs/common";
import type { CreateSafetyFormTemplateInput } from "@constructionos/schemas";
import { and, eq, isNull } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import { safetyFormTemplates } from "../../../infrastructure/db/schema";
import { OutboxService } from "../../events";
import { SafetyFormTemplateNotFoundError } from "../domain/errors";

// database.md §15 (M12): tenant-configurable jsonb form schemas (toolbox
// talk, inspection checklists) — reused across every project.
@Injectable()
export class SafetyFormTemplatesService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly outbox: OutboxService,
  ) {}

  async list(tenantId: string) {
    return withTenant(this.db, tenantId, (tx) =>
      tx.query.safetyFormTemplates.findMany({
        where: and(eq(safetyFormTemplates.active, true), isNull(safetyFormTemplates.deletedAt)),
        orderBy: (t, { desc }) => [desc(t.createdAt)],
      }),
    );
  }

  async create(tenantId: string, actorId: string, input: CreateSafetyFormTemplateInput) {
    return withTenant(this.db, tenantId, async (tx) => {
      const [created] = await tx
        .insert(safetyFormTemplates)
        .values({
          tenantId,
          name: input.name,
          kind: input.kind,
          schema: input.schema,
          active: input.active,
          createdBy: actorId,
        })
        .returning();

      await this.outbox.append(tx, {
        tenantId,
        eventType: "safety_form_template.created.v1",
        dedupeKey: `safety_form_template.created.v1:${created!.id}`,
        actorId,
        payload: { companyId: tenantId, safetyFormTemplateId: created!.id },
      });

      return created!;
    });
  }

  async requireTemplate(tx: Database, id: string) {
    const row = await tx.query.safetyFormTemplates.findFirst({
      where: and(eq(safetyFormTemplates.id, id), isNull(safetyFormTemplates.deletedAt)),
    });
    if (!row) throw new SafetyFormTemplateNotFoundError();
    return row;
  }
}
