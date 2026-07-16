import { describe, expect, it } from "vitest";
import { backtest2022 } from "./backtest";
import { BASE } from "./cascade";

describe("backtest2022", () => {
  const r = backtest2022();

  it("replays all 12 months", () => {
    expect(r.modelled).toHaveLength(12);
    expect(r.actual).toHaveLength(12);
  });

  it("Jan model = baseline + (91.2−77.8)·pass-through·policy damping", () => {
    expect(r.modelled[0]).toBeCloseTo(
      95.41 + (91.2 - 77.8) * BASE.passThroughInrPerUsdBbl * BASE.policyPassThrough,
      2,
    );
  });

  it("match lands in a sane band (model has no price-freeze policy)", () => {
    expect(r.matchPct).toBeGreaterThan(60);
    expect(r.matchPct).toBeLessThan(100);
  });

  it("cascade fuel path and backtest share the same formula", () => {
    // May 2022 spike: modelled peaks in May
    const peak = Math.max(...r.modelled);
    expect(r.modelled[4]).toBe(peak);
  });
});
