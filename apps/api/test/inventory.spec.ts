import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenant } from "../src/infrastructure/db/client";
import { stockLevels } from "../src/infrastructure/db/schema";
import { buildTestAuthService } from "./setup/auth";
import { buildTestBudgetServices } from "./setup/budgets";
import { bootstrapTestRole, getTestDatabase } from "./setup/db";
import { buildTestInventoryServices } from "./setup/inventory";
import { buildTestProcurementServices } from "./setup/procurement";
import { buildTestProjectServices } from "./setup/projects";

// M10 Inventory & Materials (FR-INV-1..2, database.md §12, api.md §11).
describe("Inventory & Materials", () => {
  const db = getTestDatabase();
  const { authService, redis } = buildTestAuthService(db);
  const { projectsService, costCodesService } = buildTestProjectServices(db);
  const { budgetService } = buildTestBudgetServices(db);
  const { itemsService, locationsService, stockService } = buildTestInventoryServices(db);
  const { suppliersService, purchaseOrdersService, lifecycleService, deliveriesService } = buildTestProcurementServices(
    db,
    stockService,
  );

  beforeAll(async () => {
    await bootstrapTestRole();
  });

  afterAll(async () => {
    await redis.quit();
  });

  async function signUpCompanyWithProject(label: string) {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const signUp = await authService.signUp({
      email: `inv-${label}-${suffix}@example.com`,
      password: "correct horse battery staple",
      fullName: "Owner",
      companyName: `Inv ${label} ${suffix}`,
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

  async function stockLevelFor(tenantId: string, itemId: string, locationId: string) {
    return withTenant(db, tenantId, (tx) =>
      tx.query.stockLevels.findFirst({
        where: (t, { and: andOp, eq: eqOp }) => andOp(eqOp(t.itemId, itemId), eqOp(t.locationId, locationId)),
      }),
    );
  }

  it("creates an item and a location", async () => {
    const { tenantId, ownerId } = await signUpCompanyWithProject("catalog");
    const item = await itemsService.create(tenantId, ownerId, { sku: "REBAR-4", name: "#4 Rebar", uom: "ea" });
    expect(item.sku).toBe("REBAR-4");

    const location = await locationsService.create(tenantId, ownerId, { name: "Main Warehouse" });
    expect(location.name).toBe("Main Warehouse");
  });

  it("rejects a duplicate SKU within a tenant", async () => {
    const { tenantId, ownerId } = await signUpCompanyWithProject("dup-sku");
    await itemsService.create(tenantId, ownerId, { sku: "PLY-05", name: "Plywood 1/2in", uom: "sheet" });
    await expect(itemsService.create(tenantId, ownerId, { sku: "PLY-05", name: "Plywood dup", uom: "sheet" })).rejects.toThrow(
      /already exists/,
    );
  });

  it("adjustment seeds stock from nothing, issue draws it down and posts a job cost (FR-INV-2)", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithProject("issue");
    const budget = await budgetService.create(tenantId, ownerId, project.id, { currency: "USD" });
    const costCode = await costCodesService.create(tenantId, ownerId, project.id, { code: "01", name: "GC", kind: "other" });
    await budgetService.addLine(tenantId, ownerId, budget.id, { costCodeId: costCode.id, originalAmount: "1000.00" });
    const item = await itemsService.create(tenantId, ownerId, { sku: "NAIL-16D", name: "16d nails", uom: "lb" });
    const location = await locationsService.create(tenantId, ownerId, { name: "Site Store", projectId: project.id });

    await stockService.postMovement(tenantId, ownerId, {
      kind: "adjustment",
      itemId: item.id,
      fromLocationId: location.id,
      qty: "100.000",
    });
    let level = await stockLevelFor(tenantId, item.id, location.id);
    expect(level!.qtyOnHand).toBe("100.000");

    await stockService.postMovement(tenantId, ownerId, {
      kind: "issue",
      itemId: item.id,
      fromLocationId: location.id,
      qty: "30.000",
      unitCostAmount: "2.5000",
      projectId: project.id,
      costCodeId: costCode.id,
    });
    level = await stockLevelFor(tenantId, item.id, location.id);
    expect(level!.qtyOnHand).toBe("70.000");

    const budgetAfter = await budgetService.getByProject(tenantId, project.id);
    const line = budgetAfter.lines.find((l) => l.costCodeId === costCode.id)!;
    expect(line.actualAmount).toBe("75.00");
  });

  it("rejects an issue that exceeds stock on hand", async () => {
    const { tenantId, ownerId } = await signUpCompanyWithProject("insufficient");
    const item = await itemsService.create(tenantId, ownerId, { sku: "CONC-BAG", name: "Concrete bag", uom: "bag" });
    const location = await locationsService.create(tenantId, ownerId, { name: "Yard" });

    await stockService.postMovement(tenantId, ownerId, {
      kind: "adjustment",
      itemId: item.id,
      fromLocationId: location.id,
      qty: "10.000",
    });

    await expect(
      stockService.postMovement(tenantId, ownerId, {
        kind: "issue",
        itemId: item.id,
        fromLocationId: location.id,
        qty: "11.000",
      }),
    ).rejects.toThrow(/insufficient/);
  });

  it("transfers stock between two locations", async () => {
    const { tenantId, ownerId } = await signUpCompanyWithProject("transfer");
    const item = await itemsService.create(tenantId, ownerId, { sku: "CONDUIT-1", name: "1in conduit", uom: "ft" });
    const warehouse = await locationsService.create(tenantId, ownerId, { name: "Warehouse" });
    const site = await locationsService.create(tenantId, ownerId, { name: "Site" });

    await stockService.postMovement(tenantId, ownerId, {
      kind: "adjustment",
      itemId: item.id,
      fromLocationId: warehouse.id,
      qty: "500.000",
    });

    await stockService.postMovement(tenantId, ownerId, {
      kind: "transfer",
      itemId: item.id,
      fromLocationId: warehouse.id,
      toLocationId: site.id,
      qty: "200.000",
    });

    const warehouseLevel = await stockLevelFor(tenantId, item.id, warehouse.id);
    const siteLevel = await stockLevelFor(tenantId, item.id, site.id);
    expect(warehouseLevel!.qtyOnHand).toBe("300.000");
    expect(siteLevel!.qtyOnHand).toBe("200.000");
  });

  it("a PO delivery for an inventory-linked line posts a receipt and updates stock_levels (closes FR-PROC-4)", async () => {
    const { tenantId, ownerId, project } = await signUpCompanyWithProject("delivery-stock");
    await budgetService.create(tenantId, ownerId, project.id, { currency: "USD" });
    const costCode = await costCodesService.create(tenantId, ownerId, project.id, { code: "01", name: "GC", kind: "other" });
    const item = await itemsService.create(tenantId, ownerId, { sku: "REBAR-5", name: "#5 Rebar", uom: "ea" });
    const location = await locationsService.create(tenantId, ownerId, { name: "Site Store", projectId: project.id });
    const supplier = await suppliersService.create(tenantId, ownerId, { name: "Acme Steel" });

    const po = await purchaseOrdersService.create(tenantId, ownerId, {
      projectId: project.id,
      supplierId: supplier.id,
      lines: [
        {
          description: "Rebar #5",
          costCodeId: costCode.id,
          inventoryItemId: item.id,
          qtyOrdered: "50.000",
          uom: "ea",
          unitCostAmount: "4.0000",
        },
      ],
    });
    await lifecycleService.submit(tenantId, ownerId, po.id);
    await lifecycleService.approve(tenantId, ownerId, po.id);
    await lifecycleService.send(tenantId, ownerId, po.id);

    const lineId = (await purchaseOrdersService.getById(tenantId, po.id)).lines[0]!.id;
    await deliveriesService.create(tenantId, ownerId, po.id, {
      deliveryDate: "2026-02-01",
      locationId: location.id,
      lines: [{ purchaseOrderLineId: lineId, qtyReceived: "50.000" }],
    });

    const level = await stockLevelFor(tenantId, item.id, location.id);
    expect(level!.qtyOnHand).toBe("50.000");
  });

  it("RLS: a tenant only sees its own inventory items, locations, and stock levels", async () => {
    const a = await signUpCompanyWithProject("rls-a");
    const b = await signUpCompanyWithProject("rls-b");
    const item = await itemsService.create(a.tenantId, a.ownerId, { sku: "RLS-ITEM", name: "RLS item", uom: "ea" });
    const location = await locationsService.create(a.tenantId, a.ownerId, { name: "RLS Location" });
    await stockService.postMovement(a.tenantId, a.ownerId, {
      kind: "adjustment",
      itemId: item.id,
      fromLocationId: location.id,
      qty: "5.000",
    });

    const { data: bItems } = await itemsService.list(b.tenantId, { limit: 20 });
    expect(bItems).toHaveLength(0);
    const { data: bLocations } = await locationsService.list(b.tenantId, { limit: 20 });
    expect(bLocations).toHaveLength(0);
    const bStock = await withTenant(db, b.tenantId, (tx) =>
      tx.query.stockLevels.findMany({ where: eq(stockLevels.tenantId, b.tenantId) }),
    );
    expect(bStock).toHaveLength(0);
  });
});
