import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Redirect,
  Req,
} from "@nestjs/common";
import {
  completeDocumentVersionSchema,
  createDocumentSchema,
  createDrawingSetSchema,
  createFolderSchema,
  initiateDocumentVersionSchema,
  listDocumentsQuerySchema,
  updateDocumentSchema,
  updateFolderSchema,
} from "@constructionos/schemas";
import type { z } from "zod";
import { ZodValidationPipe } from "../../../platform/zod-validation.pipe";
import type { AuthenticatedRequest } from "../../auth";
import { RequirePermission } from "../../rbac";
import { DocumentVersionsService } from "../application/document-versions.service";
import { DocumentsService } from "../application/documents.service";
import { DrawingSetsService } from "../application/drawing-sets.service";
import { FoldersService } from "../application/folders.service";

@Controller()
export class DocumentsController {
  constructor(
    private readonly folders: FoldersService,
    private readonly documents: DocumentsService,
    private readonly versions: DocumentVersionsService,
    private readonly drawingSets: DrawingSetsService,
  ) {}

  @Get("projects/:id/folders")
  @RequirePermission("docs.document.read")
  listFolders(@Param("id") projectId: string, @Req() req: AuthenticatedRequest) {
    return this.folders.list(req.auth!.tenantId, projectId);
  }

  @Post("projects/:id/folders")
  @RequirePermission("docs.document.create")
  @HttpCode(HttpStatus.CREATED)
  createFolder(
    @Param("id") projectId: string,
    @Body(new ZodValidationPipe(createFolderSchema)) body: z.infer<typeof createFolderSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.folders.create(req.auth!.tenantId, req.auth!.sub, projectId, body);
  }

  // Gap-fill (see FoldersService.update's doc comment).
  @Patch("folders/:id")
  @RequirePermission("docs.document.update")
  updateFolder(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateFolderSchema)) body: z.infer<typeof updateFolderSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.folders.update(req.auth!.tenantId, req.auth!.sub, id, body);
  }

  @Get("projects/:id/documents")
  @RequirePermission("docs.document.read")
  listDocuments(
    @Param("id") projectId: string,
    @Query(new ZodValidationPipe(listDocumentsQuerySchema)) query: z.infer<typeof listDocumentsQuerySchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.documents.list(req.auth!.tenantId, projectId, query);
  }

  @Post("projects/:id/documents")
  @RequirePermission("docs.document.create")
  @HttpCode(HttpStatus.CREATED)
  createDocument(
    @Param("id") projectId: string,
    @Body(new ZodValidationPipe(createDocumentSchema)) body: z.infer<typeof createDocumentSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.documents.create(req.auth!.tenantId, req.auth!.sub, projectId, body);
  }

  @Get("documents/:id")
  @RequirePermission("docs.document.read")
  getDocument(@Param("id") id: string, @Req() req: AuthenticatedRequest) {
    return this.documents.getById(req.auth!.tenantId, id);
  }

  @Patch("documents/:id")
  @RequirePermission("docs.document.update")
  updateDocument(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateDocumentSchema)) body: z.infer<typeof updateDocumentSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.documents.update(req.auth!.tenantId, req.auth!.sub, id, body);
  }

  // find-my-way (Fastify's router) treats a bare mid-segment ":" as a
  // parameter start, which collides with the sibling versions:complete
  // route below (both would register as "versions" + an anonymous param).
  // "::" escapes it to a literal colon per find-my-way's docs, while the
  // path clients actually call is still the literal api.md-documented
  // "versions:initiate".
  @Post("documents/:id/versions::initiate")
  @RequirePermission("docs.document.update")
  initiateVersion(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(initiateDocumentVersionSchema)) body: z.infer<typeof initiateDocumentVersionSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.versions.initiateVersion(req.auth!.tenantId, req.auth!.sub, id, body);
  }

  @Post("documents/:id/versions::complete")
  @RequirePermission("docs.document.update")
  @HttpCode(HttpStatus.ACCEPTED)
  completeVersion(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(completeDocumentVersionSchema)) body: z.infer<typeof completeDocumentVersionSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.versions.completeVersion(req.auth!.tenantId, req.auth!.sub, id, body);
  }

  @Get("document-versions/:id/download")
  @RequirePermission("docs.document.read")
  @Redirect()
  async download(@Param("id") id: string, @Req() req: AuthenticatedRequest) {
    const url = await this.versions.getDownloadUrl(req.auth!.tenantId, id);
    return { url, statusCode: HttpStatus.FOUND };
  }

  @Get("projects/:id/drawing-sets")
  @RequirePermission("docs.document.read")
  listDrawingSets(@Param("id") projectId: string, @Req() req: AuthenticatedRequest) {
    return this.drawingSets.list(req.auth!.tenantId, projectId);
  }

  @Post("projects/:id/drawing-sets")
  @RequirePermission("docs.drawings.manage")
  @HttpCode(HttpStatus.CREATED)
  createDrawingSet(
    @Param("id") projectId: string,
    @Body(new ZodValidationPipe(createDrawingSetSchema)) body: z.infer<typeof createDrawingSetSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.drawingSets.create(req.auth!.tenantId, req.auth!.sub, projectId, body);
  }

  // Gap-fill: not itemized in api.md §8 but needed to view a drawing set's
  // sheets before publishing it.
  @Get("drawing-sets/:id")
  @RequirePermission("docs.document.read")
  getDrawingSet(@Param("id") id: string, @Req() req: AuthenticatedRequest) {
    return this.drawingSets.getById(req.auth!.tenantId, id);
  }

  @Post("drawing-sets/:id/publish")
  @RequirePermission("docs.drawings.manage")
  publish(@Param("id") id: string, @Req() req: AuthenticatedRequest) {
    return this.drawingSets.publish(req.auth!.tenantId, req.auth!.sub, id);
  }
}
