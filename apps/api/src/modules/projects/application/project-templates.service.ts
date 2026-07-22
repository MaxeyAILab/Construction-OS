import { Inject, Injectable } from "@nestjs/common";
import type { CreateProjectTemplateInput } from "@constructionos/schemas";
import { eq } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import { costCodes, projectTemplates } from "../../../infrastructure/db/schema";
import { ProjectTemplateNotFoundError } from "../domain/errors";

@Injectable()
export class ProjectTemplatesService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async list(tenantId: string) {
    return withTenant(this.db, tenantId, (tx) =>
      tx.query.projectTemplates.findMany({ where: eq(projectTemplates.tenantId, tenantId) }),
    );
  }

  async create(tenantId: string, actorId: string, input: CreateProjectTemplateInput) {
    return withTenant(this.db, tenantId, async (tx) => {
      const [template] = await tx
        .insert(projectTemplates)
        .values({
          tenantId,
          name: input.name,
          description: input.description,
          manifest: input.manifest,
          createdBy: actorId,
        })
        .returning();
      return template!;
    });
  }

  // FR-PM-4: "rapid, consistent setup" — clones the manifest's cost codes
  // onto the newly created project. Called from inside ProjectsService
  // .create()'s own transaction (`tx` passed in, not opened here) so a
  // failed clone rolls back the project creation too. Milestones-from-
  // "phases" and folder-skeleton/checklists have no consuming module yet
  // (Documents M3 / Tasks M6) — only cost codes are actually applied today.
  async applyToProject(
    tx: Database,
    tenantId: string,
    projectId: string,
    templateId: string,
  ): Promise<void> {
    const template = await tx.query.projectTemplates.findFirst({
      where: eq(projectTemplates.id, templateId),
    });
    if (!template) throw new ProjectTemplateNotFoundError();

    const manifest = template.manifest as { costCodes?: { code: string; name: string; kind: string; parentCode?: string }[] };
    const entries = manifest.costCodes ?? [];
    if (entries.length === 0) return;

    const idByCode = new Map<string, string>();
    // parent-before-child insertion order isn't guaranteed by manifest
    // authors, so entries without a parent (or whose parent isn't in this
    // manifest) go first; this is a best-effort single pass, not a full
    // topological sort — deeply nested templates may need re-running.
    const [roots, children] = partition(entries, (e) => !e.parentCode);
    for (const entry of [...roots, ...children]) {
      const [row] = await tx
        .insert(costCodes)
        .values({
          tenantId,
          projectId,
          code: entry.code,
          name: entry.name,
          kind: entry.kind,
          parentId: entry.parentCode ? idByCode.get(entry.parentCode) : undefined,
        })
        .returning();
      idByCode.set(entry.code, row!.id);
    }
  }
}

function partition<T>(items: T[], predicate: (item: T) => boolean): [T[], T[]] {
  const yes: T[] = [];
  const no: T[] = [];
  for (const item of items) (predicate(item) ? yes : no).push(item);
  return [yes, no];
}
