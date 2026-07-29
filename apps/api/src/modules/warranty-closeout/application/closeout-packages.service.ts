import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, isNull, ne } from "drizzle-orm";
import { DATABASE, type Database, withTenant } from "../../../infrastructure/db/client";
import { closeoutChecklistItems, closeoutPackages, documents, tasks, warranties } from "../../../infrastructure/db/schema";
import { OutboxService } from "../../events";
import { FileUploadService } from "../../files";
import { ChecklistIncompleteError, PunchListOpenError } from "../domain/errors";
import { WarrantiesService } from "./warranties.service";

// FR-CLOSE-2/3 (roadmap.md "closeout package assembly ≤ 1 day"). The
// bundle is a JSON manifest of the checklist's linked documents and
// current warranties, stored as a real generated file
// (FileUploadService.storeGeneratedFile) — not a merged PDF/zip. Actual
// document-merging into a single downloadable artifact is a follow-up,
// same explicit-scope-cut treatment as api.md §18's "delivery to the
// client is out of scope for this row."
@Injectable()
export class CloseoutPackagesService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly outbox: OutboxService,
    private readonly fileUpload: FileUploadService,
    private readonly warrantiesService: WarrantiesService,
  ) {}

  async getStatus(tenantId: string, projectId: string) {
    return withTenant(this.db, tenantId, async (tx) => {
      const history = await tx.query.closeoutPackages.findMany({
        where: eq(closeoutPackages.projectId, projectId),
        orderBy: [desc(closeoutPackages.assembledAt)],
      });
      return { currentStatus: history[0]?.status ?? "draft", history };
    });
  }

  async assemble(tenantId: string, actorId: string, projectId: string, actorType?: "ai") {
    await this.assertReady(tenantId, projectId);

    const manifest = await this.buildManifest(tenantId, projectId);
    const { fileId } = await this.fileUpload.storeGeneratedFile(tenantId, actorId, {
      filename: `closeout-package-${projectId}.json`,
      contentType: "application/json",
      buffer: Buffer.from(JSON.stringify(manifest, null, 2)),
    });

    return withTenant(this.db, tenantId, async (tx) => {
      const [created] = await tx
        .insert(closeoutPackages)
        .values({ tenantId, projectId, fileId, assembledBy: actorId })
        .returning();

      await this.outbox.append(tx, {
        tenantId,
        eventType: "closeout_package.assembled.v1",
        dedupeKey: `closeout_package.assembled.v1:${created!.id}`,
        actorId,
        ...(actorType ? { actorType } : {}),
        payload: { companyId: tenantId, projectId, closeoutPackageId: created!.id, fileId },
      });

      return created!;
    });
  }

  private async assertReady(tenantId: string, projectId: string): Promise<void> {
    await withTenant(this.db, tenantId, async (tx) => {
      const pending = await tx.query.closeoutChecklistItems.findFirst({
        where: and(
          eq(closeoutChecklistItems.projectId, projectId),
          eq(closeoutChecklistItems.status, "pending"),
          isNull(closeoutChecklistItems.deletedAt),
        ),
      });
      if (pending) throw new ChecklistIncompleteError();

      // "Closed" = not open/in_progress/blocked (tasks.status, §7) — a
      // cancelled punch item doesn't block closeout, same as it wouldn't
      // in a real punch-list workflow.
      const openPunch = await tx.query.tasks.findFirst({
        where: and(
          eq(tasks.projectId, projectId),
          eq(tasks.kind, "punch"),
          ne(tasks.status, "done"),
          ne(tasks.status, "cancelled"),
          isNull(tasks.deletedAt),
        ),
      });
      if (openPunch) throw new PunchListOpenError();
    });
  }

  private async buildManifest(tenantId: string, projectId: string) {
    return withTenant(this.db, tenantId, async (tx) => {
      const checklistItems = await tx.query.closeoutChecklistItems.findMany({
        where: and(eq(closeoutChecklistItems.projectId, projectId), isNull(closeoutChecklistItems.deletedAt)),
      });
      const documentIds = checklistItems.map((item) => item.documentId).filter((id): id is string => !!id);
      const linkedDocuments = documentIds.length
        ? await tx.query.documents.findMany({ where: and(eq(documents.projectId, projectId), isNull(documents.deletedAt)) })
        : [];
      const documentTitleById = new Map(linkedDocuments.map((doc) => [doc.id, doc.name]));

      const activeWarranties = await tx.query.warranties.findMany({
        where: and(eq(warranties.projectId, projectId), isNull(warranties.deletedAt)),
      });

      return {
        generatedAt: new Date().toISOString(),
        projectId,
        checklistItems: checklistItems.map((item) => ({
          category: item.category,
          title: item.title,
          status: item.status,
          documentId: item.documentId,
          documentTitle: item.documentId ? (documentTitleById.get(item.documentId) ?? null) : null,
        })),
        warranties: activeWarranties.map((w) => ({
          scope: w.scope,
          warrantyType: w.warrantyType,
          responsiblePartyType: w.responsiblePartyType,
          startDate: w.startDate,
          durationMonths: w.durationMonths,
        })),
      };
    });
  }
}
