import { describe, expect, it } from "vitest";
import { fuseRrf } from "../src/modules/rag/domain/rrf";

describe("fuseRrf (pure domain logic)", () => {
  it("ranks an item appearing near the top of both lists above one appearing in only one list", () => {
    const vectorList = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const ftsList = [{ id: "b" }, { id: "d" }, { id: "a" }];

    const fused = fuseRrf(vectorList, ftsList);

    expect(fused[0]!.id).toBe("b"); // rank 2 + rank 1 -> highest combined score
    // d (fts rank 2, absent from vector list) outranks c (vector rank 3,
    // absent from fts list) since a higher single rank beats a lower one
    // when neither appears in both lists.
    expect(fused.map((r) => r.id)).toEqual(["b", "a", "d", "c"]);
  });

  it("an item present in only one list still scores (just lower than items in both)", () => {
    const fused = fuseRrf([{ id: "only-vector" }], [{ id: "only-fts" }]);
    expect(fused).toHaveLength(2);
    expect(fused.every((r) => r.score > 0)).toBe(true);
  });

  it("returns an empty list when given no candidates", () => {
    expect(fuseRrf([], [])).toEqual([]);
  });
});
