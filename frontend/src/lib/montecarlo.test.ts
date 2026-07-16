import { describe, expect, it } from "vitest";
import { BASE } from "./cascade";
import { mcBands } from "./montecarlo";
import { simulate } from "./simulate";

describe("mcBands (time-stepped MC)", () => {
  it("returns ordered quantile bands for every day", () => {
    const { pump, gdp } = mcBands({ sigma: 0.5, days: 20 }, 300);
    expect(pump).toHaveLength(20);
    for (const series of [pump, gdp]) {
      for (const b of series) {
        expect(b.p5).toBeLessThanOrEqual(b.p25);
        expect(b.p25).toBeLessThanOrEqual(b.p50);
        expect(b.p50).toBeLessThanOrEqual(b.p75);
        expect(b.p75).toBeLessThanOrEqual(b.p95);
      }
    }
  });

  it("σ=0 stays exactly at baseline with zero spread", () => {
    const { pump, gdp } = mcBands({ sigma: 0, days: 10 }, 200);
    for (const b of pump) {
      expect(b.p5).toBeCloseTo(BASE.pumpInrPerL, 6);
      expect(b.p95).toBeCloseTo(BASE.pumpInrPerL, 6);
    }
    for (const b of gdp) expect(Math.abs(b.p50)).toBeLessThan(1e-9);
  });

  it("median tracks the deterministic engine", () => {
    const det = simulate({ sigma: 0.6, days: 15 });
    const { pump } = mcBands({ sigma: 0.6, days: 15 }, 2000);
    expect(pump[14].p50).toBeCloseTo(det.fuel_price[14], -1);
  });
});
