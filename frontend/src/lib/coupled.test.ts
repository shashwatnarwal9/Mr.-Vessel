import { describe, expect, it } from "vitest";
import DEP from "../../public/supplier_dependency.json";
import {
  coupledShortfall,
  defaultMix,
  normalizeMix,
  optimizeMitigation,
} from "./coupled";
import type { Supplier } from "./supplier";
import { COEFF } from "./cascade";

const suppliers = (DEP as unknown as { suppliers: Supplier[] }).suppliers;
const mix = defaultMix(suppliers);

describe("coupled disruption × import-mix engine (v7 M6) — IMMUTABLE", () => {
  it("panels are coupled: same shock, different mix → different shortfall", () => {
    const d = { hormuz: 0.5 };
    const gulfHeavy = normalizeMix({ saudi: 0.5, iraq: 0.4, russia: 0.1 }).mix;
    const russiaHeavy = normalizeMix({ saudi: 0.1, iraq: 0.1, russia: 0.8 }).mix;
    const a = coupledShortfall(suppliers, gulfHeavy, d);
    const b = coupledShortfall(suppliers, russiaHeavy, d);
    expect(a.shortfallBblPerDay).toBeGreaterThan(b.shortfallBblPerDay * 3);
  });

  it("a Hormuz shock bites Gulf suppliers, spares Nigeria/USA", () => {
    const r = coupledShortfall(suppliers, mix, { hormuz: 0.6 });
    const by = Object.fromEntries(r.perSupplier.map((p) => [p.id, p]));
    expect(by.iraq.lostShare).toBeGreaterThan(0);
    expect(by.kuwait.lostShare).toBeGreaterThan(0);
    expect(by.nigeria.lostShare).toBe(0);
    expect(by.usa.lostShare).toBe(0);
  });

  it("reroutable relief: Russia loses less of its at-risk share than Kuwait", () => {
    const r = coupledShortfall(suppliers, mix, { hormuz: 0.6, redsea: 0.6 });
    const by = Object.fromEntries(r.perSupplier.map((p) => [p.id, p]));
    expect(by.russia.lostShare / Math.max(1e-9, by.russia.atRiskShare)).toBeLessThan(
      by.kuwait.lostShare / Math.max(1e-9, by.kuwait.atRiskShare),
    );
  });

  it("normalizeMix corrects and flags non-100% inputs", () => {
    const { mix: m, corrected } = normalizeMix({ a: 0.5, b: 0.3 });
    expect(corrected).toBe(true);
    expect(m.a + m.b).toBeCloseTo(1);
  });

  it("OPEC alone causes zero physical shortfall (price-only channel)", () => {
    const r = coupledShortfall(suppliers, mix, { opec: 0.8 } as never);
    expect(r.shortfallBblPerDay).toBe(0);
  });

  it("optimizer reduces shortfall within spare-capacity caps and shows its frame", () => {
    const d = { hormuz: 0.6 };
    const m = optimizeMitigation(suppliers, mix, d);
    expect(m.after).toBeLessThan(m.before);
    expect(m.objective).toContain("minimize");
    expect(m.constraints.length).toBeGreaterThanOrEqual(3);
    // shares still sum to ~1 after the moves
    const sum = Object.values(m.newMix).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 5);
    // receivers never exceed cited spare capacity
    for (const move of m.moves) {
      expect(move.share).toBeGreaterThan(0);
    }
    const received: Record<string, number> = {};
    for (const move of m.moves) {
      const recv = suppliers.find((s) => s.name === move.to)!;
      received[recv.id] = (received[recv.id] ?? 0) + move.share;
      expect(received[recv.id]).toBeLessThanOrEqual(
        recv.spare_capacity_bbl_d / COEFF.india_imports_bbl_d.value + 1e-9,
      );
    }
  });
});
