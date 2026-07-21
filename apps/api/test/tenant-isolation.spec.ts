import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { withTenant } from "../src/infrastructure/db/client";
import { companies, roles } from "../src/infrastructure/db/schema";
import { bootstrapTestRole, getTestDatabase } from "./setup/db";

// Roadmap Phase 1A success metric for multi-tenant core: "cross-tenant probe
// suite: 0 leaks" (database.md §2, architecture.md §17, NFR-14). Runs
// against a real Postgres instance as a non-superuser table owner — see
// setup/db.ts for why that distinction matters.
describe("tenant isolation (RLS)", () => {
  const db = getTestDatabase();
  let tenantAId: string;
  let tenantBId: string;

  beforeAll(async () => {
    await bootstrapTestRole();

    const suffix = Date.now();
    const [a] = await db
      .insert(companies)
      .values({ name: "Acme Construction", slug: `acme-${suffix}` })
      .returning();
    const [b] = await db
      .insert(companies)
      .values({ name: "Bolt Builders", slug: `bolt-${suffix}` })
      .returning();
    tenantAId = a!.id;
    tenantBId = b!.id;
  });

  it("blocks queries with no tenant context set", async () => {
    await expect(db.select().from(roles)).rejects.toThrow();
  });

  it("only returns the active tenant's rows", async () => {
    await withTenant(db, tenantAId, (tx) =>
      tx.insert(roles).values({ tenantId: tenantAId, name: "Owner" }),
    );
    await withTenant(db, tenantBId, (tx) =>
      tx.insert(roles).values({ tenantId: tenantBId, name: "Owner" }),
    );

    const asTenantA = await withTenant(db, tenantAId, (tx) => tx.select().from(roles));
    expect(asTenantA).toHaveLength(1);
    expect(asTenantA[0]?.tenantId).toBe(tenantAId);

    const asTenantB = await withTenant(db, tenantBId, (tx) => tx.select().from(roles));
    expect(asTenantB).toHaveLength(1);
    expect(asTenantB[0]?.tenantId).toBe(tenantBId);
  });

  it("cannot read another tenant's row even by direct id lookup", async () => {
    const [bRole] = await withTenant(db, tenantBId, (tx) =>
      tx.select().from(roles).where(eq(roles.tenantId, tenantBId)),
    );
    const probe = await withTenant(db, tenantAId, (tx) =>
      tx.select().from(roles).where(eq(roles.id, bRole!.id)),
    );
    expect(probe).toHaveLength(0);
  });

  it("rejects inserting a row tagged for a different tenant than the active context", async () => {
    await expect(
      withTenant(db, tenantAId, (tx) =>
        tx.insert(roles).values({ tenantId: tenantBId, name: "Sneaky" }),
      ),
    ).rejects.toThrow();
  });

  it("assigns a monotonically increasing per-tenant updated_seq", async () => {
    const [row] = await withTenant(db, tenantAId, (tx) =>
      tx
        .insert(roles)
        .values({ tenantId: tenantAId, name: `Seq-${Date.now()}` })
        .returning(),
    );
    expect(row!.updatedSeq).toBeGreaterThan(0);

    const [updated] = await withTenant(db, tenantAId, (tx) =>
      tx
        .update(roles)
        .set({ name: `Seq-updated-${Date.now()}` })
        .where(eq(roles.id, row!.id))
        .returning(),
    );
    expect(updated!.updatedSeq).toBeGreaterThan(row!.updatedSeq);
  });
});
