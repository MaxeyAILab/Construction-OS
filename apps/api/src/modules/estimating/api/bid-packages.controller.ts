import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Req } from "@nestjs/common";
import { createBidInvitationSchema, createBidPackageSchema, createBidSchema, updateBidPackageSchema } from "@constructionos/schemas";
import type { z } from "zod";
import { ZodValidationPipe } from "../../../platform/zod-validation.pipe";
import type { AuthenticatedRequest } from "../../auth";
import { RequirePermission } from "../../rbac";
import { BidInvitationsService } from "../application/bid-invitations.service";
import { BidPackagesService } from "../application/bid-packages.service";
import { BidsService } from "../application/bids.service";

// api.md §5: "GET/POST /bid-packages · nested /invitations, /bids |
// estimating.bid.* | Sub bidding (FR-EST-6)." AI bid-leveling
// (POST /bid-packages/{id}/level) stays unbuilt — Estimator AI is its
// own later roadmap row, see BidsService's doc comment.
@Controller()
export class BidPackagesController {
  constructor(
    private readonly bidPackages: BidPackagesService,
    private readonly bidInvitations: BidInvitationsService,
    private readonly bids: BidsService,
  ) {}

  @Get("projects/:id/bid-packages")
  @RequirePermission("estimating.bid.read")
  listForProject(@Param("id") projectId: string, @Req() req: AuthenticatedRequest) {
    return this.bidPackages.listForProject(req.auth!.tenantId, projectId);
  }

  @Post("projects/:id/bid-packages")
  @RequirePermission("estimating.bid.create")
  @HttpCode(HttpStatus.CREATED)
  create(
    @Param("id") projectId: string,
    @Body(new ZodValidationPipe(createBidPackageSchema)) body: z.infer<typeof createBidPackageSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.bidPackages.create(req.auth!.tenantId, req.auth!.sub, projectId, body);
  }

  @Get("bid-packages/:id")
  @RequirePermission("estimating.bid.read")
  getById(@Param("id") id: string, @Req() req: AuthenticatedRequest) {
    return this.bidPackages.getById(req.auth!.tenantId, id);
  }

  @Patch("bid-packages/:id")
  @RequirePermission("estimating.bid.update")
  update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateBidPackageSchema)) body: z.infer<typeof updateBidPackageSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.bidPackages.update(req.auth!.tenantId, req.auth!.sub, id, body);
  }

  @Get("bid-packages/:id/invitations")
  @RequirePermission("estimating.bid.read")
  listInvitations(@Param("id") bidPackageId: string, @Req() req: AuthenticatedRequest) {
    return this.bidInvitations.listForPackage(req.auth!.tenantId, bidPackageId);
  }

  // FR-SUB-2: eligibility-gated (see BidInvitationsService.create's doc
  // comment) — throws a 422 if the subcontractor has an expired
  // compliance document on file.
  @Post("bid-packages/:id/invitations")
  @RequirePermission("estimating.bid.create")
  @HttpCode(HttpStatus.CREATED)
  inviteSubcontractor(
    @Param("id") bidPackageId: string,
    @Body(new ZodValidationPipe(createBidInvitationSchema)) body: z.infer<typeof createBidInvitationSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.bidInvitations.create(req.auth!.tenantId, req.auth!.sub, bidPackageId, body);
  }

  @Get("bid-packages/:id/bids")
  @RequirePermission("estimating.bid.read")
  listBids(@Param("id") bidPackageId: string, @Req() req: AuthenticatedRequest) {
    return this.bids.listForPackage(req.auth!.tenantId, bidPackageId);
  }

  @Post("bid-invitations/:id/bids")
  @RequirePermission("estimating.bid.create")
  @HttpCode(HttpStatus.CREATED)
  submitBid(
    @Param("id") bidInvitationId: string,
    @Body(new ZodValidationPipe(createBidSchema)) body: z.infer<typeof createBidSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.bids.submit(req.auth!.tenantId, req.auth!.sub, bidInvitationId, body);
  }
}
