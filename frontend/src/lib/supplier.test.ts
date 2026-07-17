import { describe, expect, it } from "vitest";
import DEP from "../../public/supplier_dependency.json";
import CORRIDORS from "../../public/corridors.json";
import { fuseAll, type Corridor, type Weights } from "./risk";
import { expectedShortfallBblPerDay, supplierRisk, type Supplier } from "./supplier";
import { COEFF } from "./cascade";

const suppliers = (DEP as unknown as { suppliers: Supplier[] }).suppliers;
const file = CORRIDORS as unknown as {
  meta: { weights: Record<string, { value: number }> };
  corridors: Corridor[];
};
const weights = Object.fromEntries(
  Object.entries(file.meta.weights).map(([k, v]) => [k, v.value]),
) as Weights;
const corridorP = Object.fromEntries(
  fuseAll(file.corridors, weights).map((r) => [r.corridor.id, r.p]),
);

describe("supplier risk (RA3) — IMMUTABLE checks", () => {
  it("all supplier probabilities stay in [0,1]", () => {
    for (const s of suppliers) {
      const p = supplierRisk(s, corridorP);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
    }
  });

  it("a supplier with no corridor exposure carries only its sanction friction (Oman)", () => {
    const oman = suppliers.find((s) => s.id === "oman")!;
    expect(supplierRisk(oman, corridorP)).toBeCloseTo(oman.sigma_k, 10);
  });

  it("Russia (two hot corridors, chained) outranks Saudi (Hormuz only) under the snapshot", () => {
    const rus = suppliers.find((s) => s.id === "russia")!;
    const sau = suppliers.find((s) => s.id === "saudi")!;
    expect(supplierRisk(rus, corridorP)).toBeGreaterThan(
      supplierRisk(sau, corridorP),
    );
  });

  it("chained corridors compound: two crossings beat either alone", () => {
    const stub = { reroutable: 0, spare_capacity_bbl_d: 0 };
    const both = supplierRisk(
      { id: "x", name: "x", coords: [0, 0], import_share: 1, sigma_k: 0, d: { suez: 1, babmandeb: 1 }, ...stub },
      corridorP,
    );
    const suezOnly = supplierRisk(
      { id: "x", name: "x", coords: [0, 0], import_share: 1, sigma_k: 0, d: { suez: 1 }, ...stub },
      corridorP,
    );
    expect(both).toBeGreaterThan(suezOnly);
    expect(both).toBeCloseTo(
      1 - (1 - corridorP.suez) * (1 - corridorP.babmandeb),
      10,
    );
  });

  it("expected shortfall is positive and physically bounded", () => {
    const e = expectedShortfallBblPerDay(suppliers, corridorP);
    expect(e).toBeGreaterThan(100_000); // snapshot is not a quiet world
    expect(e).toBeLessThan(COEFF.india_imports_bbl_d.value * 0.5); // not apocalypse
  });
});
