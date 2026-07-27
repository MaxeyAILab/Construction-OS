import { Inject, Injectable } from "@nestjs/common";
import type { CreateSafetyFormInput, ListSafetyFormsQuery } from "@constructionos/schemas";
import { and, desc, eq, lt, or, type SQL } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import { projects, safetyForms } from "../../../infrastructure/db/schema";
import { OutboxService } from "../../events";
import { ProjectNotFoundError } from "../domain/errors";
import { SafetyFormTemplatesService } from "./safety-form-templates.service";

interface Cursor {
  createdAt: string;
  id: string;
}

function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify(c)).toString("base64url");
}

function decodeCursor(raw: string): Cursor {
  return JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Cursor;
}

// database.md §15 (M12): "safety_forms: filled instances ... offline-
// created." FR-SAFE-1.
@Injectable()
export class SafetyFormsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly outbox: OutboxService,
    private readonly templates: SafetyFormTemplatesService,
  ) {}

  async listForProject(tenantId: string, projectId: string, query: ListSafetyFormsQuery) {
    return withTenant(this.db, tenantId, async (tx) => {
      const conditions: SQL[] = [eq(safetyForms.projectId, projectId)];
      if (query.templateId) conditions.push(eq(safetyForms.templateId, query.templateId));
      if (query.cursor) {
        const c = decodeCursor(query.cursor);
        conditions.push(
          or(
            lt(safetyForms.createdAt, new Date(c.createdAt)),
            and(eq(safetyForms.createdAt, new Date(c.createdAt)), lt(safetyForms.id, c.id))!,
          )!,
        );
      }

      const rows = await tx.query.safetyForms.findMany({
        where: and(...conditions),
        orderBy: [desc(safetyForms.createdAt), desc(safetyForms.id)],
        limit: query.limit + 1,
      });

      const hasMore = rows.length > query.limit;
      const page = rows.slice(0, query.limit);
      const last = page.at(-1);
      const nextCursor = hasMore && last ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id }) : null;

      return { data: page, meta: { cursor: nextCursor, hasMore } };
    });
  }

  // explicitId: field clients mint the id offline (architecture.md §14.2),
  // same convention as tasks.create/dailyReports.create.
  async create(tenantId: string, actorId: string, projectId: string, input: CreateSafetyFormInput, explicitId?: string) {
    return withTenant(this.db, tenantId, async (tx) => {
      const project = await tx.query.projects.findFirst({ where: eq(projects.id, projectId) });
      if (!project) throw new ProjectNotFoundError();
      await this.templates.requireTemplate(tx, input.templateId);

      const [created] = await tx
        .insert(safetyForms)
        .values({
          ...(explicitId ? { id: explicitId } : {}),
          tenantId,
          templateId: input.templateId,
          projectId,
          responses: input.responses,
          signatures: input.signatures,
          createdBy: actorId,
        })
        .returning();
      const form = created!;

      await this.outbox.append(tx, {
        tenantId,
        eventType: "safety_form.created.v1",
        dedupeKey: `safety_form.created.v1:${form.id}`,
        actorId,
        payload: { companyId: tenantId, projectId, safetyFormId: form.id, templateId: input.templateId },
      });

      return form;
    });
  }
}
