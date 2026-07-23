import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Req } from "@nestjs/common";
import { completePhotoUploadSchema, initiatePhotoUploadSchema, listPhotosQuerySchema } from "@constructionos/schemas";
import type { z } from "zod";
import { ZodValidationPipe } from "../../../platform/zod-validation.pipe";
import type { AuthenticatedRequest } from "../../auth";
import { RequirePermission } from "../../rbac";
import { PhotosService } from "../application/photos.service";

// api.md conventions (M8 Field Operations). FR-FIELD-3.
@Controller("photos")
export class PhotosController {
  constructor(private readonly photos: PhotosService) {}

  @Get()
  @RequirePermission("field.photo.read")
  list(
    @Query(new ZodValidationPipe(listPhotosQuerySchema)) query: z.infer<typeof listPhotosQuerySchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.photos.list(req.auth!.tenantId, query);
  }

  @Post("initiate")
  @RequirePermission("field.photo.create")
  initiateUpload(
    @Body(new ZodValidationPipe(initiatePhotoUploadSchema)) body: z.infer<typeof initiatePhotoUploadSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.photos.initiateUpload(req.auth!.tenantId, req.auth!.sub, body);
  }

  @Post("complete")
  @RequirePermission("field.photo.create")
  @HttpCode(HttpStatus.CREATED)
  completeUpload(
    @Body(new ZodValidationPipe(completePhotoUploadSchema)) body: z.infer<typeof completePhotoUploadSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.photos.completeUpload(req.auth!.tenantId, req.auth!.sub, body);
  }

  @Get(":id")
  @RequirePermission("field.photo.read")
  getById(@Param("id") id: string, @Req() req: AuthenticatedRequest) {
    return this.photos.getById(req.auth!.tenantId, id);
  }

  @Get(":id/download-url")
  @RequirePermission("field.photo.read")
  async getDownloadUrl(@Param("id") id: string, @Req() req: AuthenticatedRequest) {
    return { url: await this.photos.getDownloadUrl(req.auth!.tenantId, id) };
  }

  @Get(":id/thumbnail-url")
  @RequirePermission("field.photo.read")
  async getThumbnailUrl(@Param("id") id: string, @Req() req: AuthenticatedRequest) {
    return { url: await this.photos.getThumbnailUrl(req.auth!.tenantId, id) };
  }
}
