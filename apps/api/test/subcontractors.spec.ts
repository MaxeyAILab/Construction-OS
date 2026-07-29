import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTestAuthService } from "./setup/auth";
import { buildTestBudgetServices } from "./setup/budgets";
import { bootstrapTestRole, getTestDatabase } from "./setup/db";
import { buildTestEstimatingServices } from "./setup/estimating";
import { buildTestProjectServices } from "./setup/projects";
import { buildTestSubcontractorServices } from "./setup/subcontractors";

// M14 Subcontractor Management (FR-SUB-1..3, database.md §17) + FR-EST-6
// sub bidding (owned by Estimating, api.md §5 estimating.bid.*).
describe("Subcontractor Management & Bidding", () => {
  const db = getTestDatabase();
  const { authService, redis } = buildTestAuthService(db);
  const { projectsService, costCodesService } = buildTestProjectServices(db);
  const { budgetService } = buildTestBudgetServices(db);
  const { certificationsService, subcontractorsService, subcontractsService } = buildTestSubcontractorServices(db);
  const { bidPackagesService, bidInvitationsService, bidsService, bidLevelingService, bidLevelingProvider } =
    buildTestEstimatingServices(db, subcontractorsService);

  beforeAll(async () => {
    await bootstrapTestRole();
  });

  afterAll(async () => {
    await redis.quit();
  });

  async function signUpCompanyWithProject(label: string) {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const signUp = await authService.signUp({
      email: `sub-${label}-${suffix}@example.com`,
      password: "correct horse battery staple",
      fullName: "Owner",
      companyName: `Sub ${label} ${suffix}`,
    });
    const ownerId = decodeSub(signUp.accessToken);
    const project = await projectsService.create(signUp.companyId, ownerId, {
      name: `${label} Project`,
      code: `${label.toUpperCase()}-1`,
      currency: "USD",
      contractValueAmount: "1000000.00",
    });
    return { tenantId: signUp.companyId, ownerId, project };
  }

  function decodeSub(jwt: string): string {
    const payload = JSON.parse(Buffer.from(jwt.split(".")[1]!, "base64url").toString());
    return payload.sub;
  }

  it("creates a subcontractor and updates its prequal status", async () => {
    const { tenantId, ownerId } = await signUpCompanyWithProject("registry");
    const sub = await subcontractorsService.create(tenantId, ownerId, {
      name: "Ace Electric",
      trades: ["electrical"],
      prequalStatus: "pending",
    });
    expect(sub.prequalStatus).toBe("pending");

    const updated = await subcontractorsService.update(tenantId, ownerId, sub.id, { prequalStatus: "approved" });
    expect(updated.prequalStatus).toBe("approved");
  });

  it("rejects engaging a subcontractor with an expired compliance document (FR-SUB-2)", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithProject("ineligible");
    const sub = await subcontractorsService.create(tenantId, ownerId, { name: "Risky Roofing" });
    await certificationsService.create(tenantId, ownerId, {
      holderSubcontractorId: sub.id,
      holderName: "Risky Roofing",
      certType: "General Liability Insurance",
      expiresAt: "2020-01-01",
    });

    await expect(
      subcontractsService.create(tenantId, ownerId, project.id, { subcontractorId: sub.id }),
    ).rejects.toMatchObject({ code: "ineligible", status: 422 });
  });

  it("engages an eligible subcontractor, approves the subcontract, and posts a commitment (FR-SUB-1/FR-SUB-3)", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithProject("engage");
    const sub = await subcontractorsService.create(tenantId, ownerId, { name: "Solid Concrete" });
    const budget = await budgetService.create(tenantId, ownerId, project.id, { currency: "USD" });
    const costCode = await costCodesService.create(tenantId, ownerId, project.id, {
      code: "03",
      name: "Concrete",
      kind: "subcontract",
    });
    await budgetService.addLine(tenantId, ownerId, budget.id, { costCodeId: costCode.id, originalAmount: "50000.00" });

    const subcontract = await subcontractsService.create(tenantId, ownerId, project.id, { subcontractorId: sub.id });
    expect(subcontract.status).toBe("draft");

    await subcontractsService.addLine(tenantId, ownerId, subcontract.id, {
      costCodeId: costCode.id,
      description: "Foundation pour",
      amount: "42000.00",
    });

    await subcontractsService.submit(tenantId, ownerId, subcontract.id);
    const approved = await subcontractsService.approve(tenantId, ownerId, subcontract.id);
    expect(approved.status).toBe("approved");

    const budgetAfter = await budgetService.getByProject(tenantId, project.id);
    const line = budgetAfter.lines.find((l) => l.costCodeId === costCode.id)!;
    expect(line.committedAmount).toBe("42000.00");
  });

  it("voids a draft subcontract but refuses to void an approved one", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithProject("void");
    const sub = await subcontractorsService.create(tenantId, ownerId, { name: "Steel Frames" });
    const budget = await budgetService.create(tenantId, ownerId, project.id, { currency: "USD" });
    const costCode = await costCodesService.create(tenantId, ownerId, project.id, {
      code: "05",
      name: "Steel",
      kind: "subcontract",
    });
    await budgetService.addLine(tenantId, ownerId, budget.id, { costCodeId: costCode.id, originalAmount: "10000.00" });

    const draft = await subcontractsService.create(tenantId, ownerId, project.id, { subcontractorId: sub.id });
    const voided = await subcontractsService.void(tenantId, ownerId, draft.id);
    expect(voided.status).toBe("void");

    const another = await subcontractsService.create(tenantId, ownerId, project.id, { subcontractorId: sub.id });
    await subcontractsService.addLine(tenantId, ownerId, another.id, {
      costCodeId: costCode.id,
      description: "Steel frame erection",
      amount: "9000.00",
    });
    await subcontractsService.submit(tenantId, ownerId, another.id);
    await subcontractsService.approve(tenantId, ownerId, another.id);

    await expect(subcontractsService.void(tenantId, ownerId, another.id)).rejects.toThrow(/cannot be voided/);
  });

  it("runs the bid package -> invitation -> bid flow and rejects duplicates (FR-EST-6)", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithProject("bidding");
    const sub = await subcontractorsService.create(tenantId, ownerId, { name: "Glass Co" });

    const bidPackage = await bidPackagesService.create(tenantId, ownerId, project.id, {
      name: "Curtain Wall",
      scope: "Full building glazing package",
    });
    expect(bidPackage.status).toBe("draft");

    const invitation = await bidInvitationsService.create(tenantId, ownerId, bidPackage.id, {
      subcontractorId: sub.id,
    });
    expect(invitation.status).toBe("invited");

    await expect(
      bidInvitationsService.create(tenantId, ownerId, bidPackage.id, { subcontractorId: sub.id }),
    ).rejects.toThrow(/already been invited/);

    const bid = await bidsService.submit(tenantId, ownerId, invitation.id, {
      amount: "185000.00",
      inclusionsExclusions: { inclusions: ["glazing", "hardware"], exclusions: ["permits"] },
    });
    expect(bid.amount).toBe("185000.00");

    await expect(
      bidsService.submit(tenantId, ownerId, invitation.id, { amount: "190000.00" }),
    ).rejects.toThrow(/already been submitted/);

    const bids = await bidsService.listForPackage(tenantId, bidPackage.id);
    expect(bids).toHaveLength(1);
  });

  it("rejects inviting an ineligible subcontractor to bid (FR-SUB-2)", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithProject("bid-ineligible");
    const sub = await subcontractorsService.create(tenantId, ownerId, { name: "Lapsed Roofing" });
    await certificationsService.create(tenantId, ownerId, {
      holderSubcontractorId: sub.id,
      holderName: "Lapsed Roofing",
      certType: "License",
      expiresAt: "2019-06-01",
    });
    const bidPackage = await bidPackagesService.create(tenantId, ownerId, project.id, { name: "Roofing" });

    await expect(
      bidInvitationsService.create(tenantId, ownerId, bidPackage.id, { subcontractorId: sub.id }),
    ).rejects.toMatchObject({ code: "ineligible", status: 422 });
  });

  it("enforces tenant isolation for subcontractors", async () => {
    const { tenantId: tenantA, ownerId: ownerA } = await signUpCompanyWithProject("iso-a");
    const { tenantId: tenantB } = await signUpCompanyWithProject("iso-b");
    const sub = await subcontractorsService.create(tenantA, ownerA, { name: "Isolated Sub" });

    await expect(subcontractorsService.getById(tenantB, sub.id)).rejects.toThrow(/not found/);
  });

  // api.md §5 POST /bid-packages/{id}/level (ai-spec.md §7.3 Estimator AI).
  describe("Bid leveling", () => {
    it("blends a deterministic price-competitiveness score with the AI completeness score, writing leveled_score", async () => {
      const { tenantId, ownerId, project } = await signUpCompanyWithProject("level");
      const subA = await subcontractorsService.create(tenantId, ownerId, { name: "Complete Co" });
      const subB = await subcontractorsService.create(tenantId, ownerId, { name: "Lowball LLC" });
      const bidPackage = await bidPackagesService.create(tenantId, ownerId, project.id, {
        name: "Curtain Wall",
        scope: "Full building glazing package including hardware and sealants",
      });
      const invitationA = await bidInvitationsService.create(tenantId, ownerId, bidPackage.id, { subcontractorId: subA.id });
      const invitationB = await bidInvitationsService.create(tenantId, ownerId, bidPackage.id, { subcontractorId: subB.id });

      // subA: pricier but complete. subB: cheapest (100 price score) but the AI will flag gaps.
      const bidA = await bidsService.submit(tenantId, ownerId, invitationA.id, {
        amount: "200000.00",
        inclusionsExclusions: { inclusions: ["glazing", "hardware", "sealants"], exclusions: [] },
      });
      const bidB = await bidsService.submit(tenantId, ownerId, invitationB.id, {
        amount: "100000.00",
        inclusionsExclusions: { inclusions: ["glazing"], exclusions: ["hardware", "sealants"] },
      });

      bidLevelingProvider.setScores([
        { bidId: bidA.id, completenessScore: 95, gapsSummary: "Covers the full stated scope." },
        { bidId: bidB.id, completenessScore: 30, gapsSummary: "Excludes hardware and sealants called for in the scope." },
      ]);

      const result = await bidLevelingService.level(tenantId, ownerId, bidPackage.id);

      expect(result.aiRunId).toBeTruthy();
      expect(result.bids).toHaveLength(2);

      const leveledA = result.bids.find((b) => b.bidId === bidA.id)!;
      const leveledB = result.bids.find((b) => b.bidId === bidB.id)!;

      // A: priceScore 50% (100000/200000*100), completeness 95 -> 0.6*95+0.4*50 = 77.
      expect(leveledA.priceScore).toBe(50);
      expect(leveledA.leveledScore).toBe("77.00");
      // B: priceScore 100% (lowest bid), completeness 30 -> 0.6*30+0.4*100 = 58.
      expect(leveledB.priceScore).toBe(100);
      expect(leveledB.leveledScore).toBe("58.00");
      // Despite being far cheaper, B's scope gaps keep it below A once leveled.
      expect(Number(leveledA.leveledScore)).toBeGreaterThan(Number(leveledB.leveledScore));
      expect(leveledB.gapsSummary).toContain("Excludes hardware");

      const persisted = await bidsService.listForPackage(tenantId, bidPackage.id);
      expect(persisted.find((b) => b.id === bidA.id)!.leveledScore).toBe("77.00");
      expect(persisted.find((b) => b.id === bidB.id)!.leveledScore).toBe("58.00");
    });

    it("throws a 422 when there are no submitted bids to level", async () => {
      const { tenantId, ownerId, project } = await signUpCompanyWithProject("level-empty");
      const bidPackage = await bidPackagesService.create(tenantId, ownerId, project.id, { name: "Empty Package" });

      await expect(bidLevelingService.level(tenantId, ownerId, bidPackage.id)).rejects.toMatchObject({
        code: "no_bids",
        status: 422,
      });
    });
  });
});
