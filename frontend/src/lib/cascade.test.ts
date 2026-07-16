import { describe, expect, it } from "vitest";
import { BASE, cascade, crudePrice } from "./cascade";

describe("cascade", () => {
  it("π=0 is the baseline: no disruption anywhere", () => {
    const out = cascade(0);
    expect(out.run_rate).toBe(1);
    expect(out.fuel_price).toBe(BASE.pumpInrPerL);
    expect(out.power_stress).toBe(0);
    expect(out.gdp_delta).toBe(-0);
  });

  it("is monotonic: more disruption is strictly worse", () => {
    const lo = cascade(0.2);
    const hi = cascade(0.8);
    expect(hi.run_rate).toBeLessThan(lo.run_rate);
    expect(hi.fuel_price).toBeGreaterThan(lo.fuel_price);
    expect(hi.power_stress).toBeGreaterThan(lo.power_stress);
    expect(hi.gdp_delta).toBeLessThan(lo.gdp_delta);
  });

  it("clamps π outside [0,1]", () => {
    expect(cascade(-5)).toEqual(cascade(0));
    expect(cascade(7)).toEqual(cascade(1));
  });

  it("keeps outputs in physical ranges at the extreme", () => {
    const out = cascade(1);
    expect(out.run_rate).toBeGreaterThan(0);
    expect(out.run_rate).toBeLessThanOrEqual(1);
    expect(out.power_stress).toBeLessThanOrEqual(1);
    expect(out.fuel_price).toBeGreaterThan(BASE.pumpInrPerL);
  });

  it("crude shock scales linearly to +80% at full closure", () => {
    expect(crudePrice(0)).toBe(BASE.brentUsd);
    expect(crudePrice(1)).toBeCloseTo(BASE.brentUsd * 1.8);
  });

  it("honors overridden constants (backtest reuse path)", () => {
    const base = { ...BASE, brentUsd: 100, pumpInrPerL: 96.72 };
    expect(cascade(0, base).fuel_price).toBeCloseTo(96.72);
  });
});
