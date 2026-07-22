import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Req } from "@nestjs/common";
import {
  createImportJobSchema,
  exportEntityTypeSchema,
  mapImportJobSchema,
} from "@constructionos/schemas";
import type { z } from "zod";
import { ZodValidationPipe } from "../../../platform/zod-validation.pipe";
import type { AuthenticatedRequest } from "../../auth";
import { RequirePermission } from "../../rbac";
import { ExportsService } from "../application/exports.service";
import { ImportsService } from "../application/imports.service";

// api.md §14 (FR-PLAT-7, M18 Platform/Admin).
@Controller()
export class ImportsExportsController {
  constructor(
    private readonly exports: ExportsService,
    private readonly imports: ImportsService,
  ) {}

  @Post("exports/:entity")
  @RequirePermission("platform.export.manage")
  @HttpCode(HttpStatus.ACCEPTED)
  requestExport(
    @Param("entity", new ZodValidationPipe(exportEntityTypeSchema)) entity: z.infer<typeof exportEntityTypeSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.exports.requestExport(req.auth!.tenantId, req.auth!.sub, entity);
  }

  @Get("exports/:id")
  @RequirePermission("platform.export.manage")
  getExportJob(@Param("id") id: string, @Req() req: AuthenticatedRequest) {
    return this.exports.getJob(req.auth!.tenantId, id);
  }

  @Get("exports/:id/download")
  @RequirePermission("platform.export.manage")
  async getExportDownloadUrl(@Param("id") id: string, @Req() req: AuthenticatedRequest) {
    const url = await this.exports.getDownloadUrl(req.auth!.tenantId, id);
    return { downloadUrl: url };
  }

  @Post("imports")
  @RequirePermission("platform.import.manage")
  @HttpCode(HttpStatus.CREATED)
  createImport(
    @Body(new ZodValidationPipe(createImportJobSchema)) body: z.infer<typeof createImportJobSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.imports.create(req.auth!.tenantId, req.auth!.sub, body);
  }

  @Get("imports/:id")
  @RequirePermission("platform.import.manage")
  getImportJob(@Param("id") id: string, @Req() req: AuthenticatedRequest) {
    return this.imports.getJob(req.auth!.tenantId, id);
  }

  @Post("imports/:id/map")
  @RequirePermission("platform.import.manage")
  mapImport(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(mapImportJobSchema)) body: z.infer<typeof mapImportJobSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.imports.map(req.auth!.tenantId, req.auth!.sub, id, body);
  }

  @Post("imports/:id/validate")
  @RequirePermission("platform.import.manage")
  validateImport(@Param("id") id: string, @Req() req: AuthenticatedRequest) {
    return this.imports.validate(req.auth!.tenantId, req.auth!.sub, id);
  }

  @Post("imports/:id/commit")
  @RequirePermission("platform.import.manage")
  @HttpCode(HttpStatus.ACCEPTED)
  commitImport(@Param("id") id: string, @Req() req: AuthenticatedRequest) {
    return this.imports.commit(req.auth!.tenantId, req.auth!.sub, id);
  }
}
