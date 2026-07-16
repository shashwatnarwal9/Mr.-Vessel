import { describe, expect, it } from "vitest";
import { BASE } from "./cascade";
import { SIM, simulate } from "./simulate";

describe("time-stepped simulate", () => {
  it("σ=0 baseline is flat: full runs, base pump, zero drag", () => {
    const t = simulate({ sigma: 0 });
    expect(t.day).toHaveLength(90);
    expect(t.run_rate.every((v) => v === 1)).toBe(true);
    expect(t.fuel_price.every((v) => Math.abs(v - BASE.pumpInrPerL) < 1e-6)).toBe(true);
    expect(t.gdp.every((v) => Math.abs(v) < 1e-9)).toBe(true);
    expect(t.inventory.at(-1)).toBeCloseTo(SIM.inventoryDaysCover);
  });

  it("inventory softens the early hit, stockout deepens it (sustained σ)", () => {
    const t = simulate({ sigma: 0.8, mode: "sustained" });
    expect(t.run_rate[3]).toBeLessThan(1); // shallow immediate dip (draw cap)
    expect(t.run_rate[3]).toBeGreaterThan(0.9);
    expect(t.inventory.at(-1)).toBe(0); // buffer exhausted within horizon
    expect(t.run_rate.at(-1)!).toBeLessThan(t.run_rate[3]); // deeper after stockout
  });

  it("crude overshoots early then settles lower (mean reversion)", () => {
    const t = simulate({ sigma: 0.6, mode: "sustained" });
    const peak = Math.max(...t.crude);
    const peakDay = t.crude.indexOf(peak);
    expect(peakDay).toBeLessThan(20);
    expect(t.crude.at(-1)!).toBeLessThan(peak); // settled below the panic peak
    expect(t.crude.at(-1)!).toBeGreaterThan(BASE.brentUsd); // but still elevated
  });

  it("shock mode recovers: prices revert toward base after day 14", () => {
    const t = simulate({ sigma: 0.7, mode: "shock" });
    expect(t.crude[10]).toBeGreaterThan(BASE.brentUsd * 1.1);
    expect(t.crude.at(-1)!).toBeLessThan(BASE.brentUsd * 1.05); // reverted
  });

  it("demand destruction eases the shortfall (feedback loop)", () => {
    const noFeedback = simulate(
      { sigma: 0.8 },
      { ...SIM, demandElasticity: 0 },
    );
    const withFeedback = simulate({ sigma: 0.8 });
    // feedback keeps more inventory and higher run rates late in the run
    expect(withFeedback.run_rate.at(-1)!).toBeGreaterThan(
      noFeedback.run_rate.at(-1)!,
    );
  });

  it("ship-shortfall trajectory: bounded dip then recovery", () => {
    // one VLCC (2M bbl) sanctioned, spread over 10 days
    const shortfall = Array(90).fill(0).map((_, t) => (t < 10 ? 200_000 : 0));
    const t = simulate({ shortfallBblPerDay: shortfall });
    expect(Math.min(...t.inventory)).toBeLessThan(SIM.inventoryDaysCover);
    expect(Math.min(...t.run_rate)).toBeGreaterThan(0.98); // one ship = small dip
    expect(t.run_rate.at(-1)).toBe(1); // full recovery after the delay window
    expect(t.crude[0]).toBeCloseTo(BASE.brentUsd, 1); // world price unmoved
    // pump carries only the bounded domestic scarcity premium
    expect(Math.max(...t.fuel_price) - BASE.pumpInrPerL).toBeLessThan(1.5);
    expect(t.fuel_price.at(-1)).toBeCloseTo(BASE.pumpInrPerL, 1); // premium fades
  });

  it("scarcity channel: a sanctioned VLCC visibly moves pump & GDP", () => {
    // 2M bbl never arrives: gap persists from ETA to horizon end
    const shortfall = Array(90).fill(0).map((_, t) => (t >= 5 ? 2_000_000 / 15 : 0));
    const t = simulate({ shortfallBblPerDay: shortfall });
    const maxPumpDelta = Math.max(
      ...t.fuel_price.map((v) => v - BASE.pumpInrPerL),
    );
    const minGdp = Math.min(...t.gdp);
    expect(maxPumpDelta).toBeGreaterThan(0.3); // visible on a chart
    expect(minGdp).toBeLessThan(-0.03);
    expect(t.crude.every((c) => Math.abs(c - BASE.brentUsd) < 0.01)).toBe(true); // world price still unmoved
  });

  it("combined disruptions compound: worse than either alone", () => {
    const h = simulate({ disruptions: { hormuz: 0.5 } });
    const r = simulate({ disruptions: { redsea: 0.4 } });
    const both = simulate({ disruptions: { hormuz: 0.5, redsea: 0.4 } });
    const pumpEnd = (t: ReturnType<typeof simulate>) => t.fuel_price[89];
    const gdpMean = (t: ReturnType<typeof simulate>) =>
      t.gdp.reduce((a, b) => a + b, 0) / t.gdp.length;
    expect(pumpEnd(both)).toBeGreaterThan(Math.max(pumpEnd(h), pumpEnd(r)));
    expect(gdpMean(both)).toBeLessThan(Math.min(gdpMean(h), gdpMean(r)));
  });

  it("Red Sea is cost-led: pump moves, crude ~flat, small shortfall", () => {
    const t = simulate({ disruptions: { redsea: 0.4 } });
    expect(t.crude[89]).toBeCloseTo(BASE.brentUsd, 0); // barrels reroute, not lost
    expect(t.fuel_price[89]).toBeGreaterThan(BASE.pumpInrPerL + 0.5); // freight premium
    expect(Math.min(...t.run_rate)).toBeGreaterThan(0.95); // transient gap only
  });

  it("OPEC is price-led: crude moves, zero India physical shortfall", () => {
    const t = simulate({ disruptions: { opec: 0.6 } });
    expect(t.crude[89]).toBeGreaterThan(BASE.brentUsd + 5);
    expect(t.run_rate.every((v) => v === 1)).toBe(true); // no access cut
    expect(t.inventory.at(-1)).toBeCloseTo(SIM.inventoryDaysCover);
  });

  it("legacy sigma input still maps to hormuz", () => {
    const a = simulate({ sigma: 0.5 });
    const b = simulate({ disruptions: { hormuz: 0.5 } });
    expect(a.fuel_price[89]).toBeCloseTo(b.fuel_price[89]);
    expect(a.gdp[89]).toBeCloseTo(b.gdp[89]);
  });

  it("clamps σ outside [0,1]", () => {
    expect(simulate({ sigma: 7 }).crude[5]).toBeCloseTo(
      simulate({ sigma: 1 }).crude[5],
    );
  });
});
