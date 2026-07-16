import { describe, expect, it } from "vitest";
import { BASE, cascade, crudePrice } from "./cascade";
import { etaDays, haversineNm, rerouteDelta } from "./reroute";

describe("reroute", () => {
  it("haversine: 1° of latitude ≈ 60 nm", () => {
    expect(haversineNm([0, 0], [0, 1])).toBeCloseTo(60, 0);
  });

  it("Hormuz replacement barrels add 15–45 days", () => {
    const { addedDays, freightMultiplier } = rerouteDelta("hormuz");
    expect(addedDays).toBeGreaterThan(15);
    expect(addedDays).toBeLessThan(45);
    expect(freightMultiplier).toBeGreaterThan(1);
  });

  it("Red Sea Cape detour adds 10–35 days (Black Sea origin)", () => {
    const { addedDays } = rerouteDelta("redsea");
    expect(addedDays).toBeGreaterThan(10);
    expect(addedDays).toBeLessThan(35);
    // Suez closure severs the same corridor — identical economics
    expect(rerouteDelta("suez").addedDays).toBeCloseTo(addedDays);
  });

  it("freight amplifies fuel pass-through at π>0, not at baseline", () => {
    const noFreight = { ...BASE, rerouteDaysAtFull: 0 };
    expect(cascade(0.5).fuel_price).toBeGreaterThan(cascade(0.5, noFreight).fuel_price);
    expect(cascade(0).fuel_price).toBe(BASE.pumpInrPerL);
    // sanity: without freight the linear damped formula holds
    expect(cascade(0.5, noFreight).fuel_price).toBeCloseTo(
      BASE.pumpInrPerL +
        (crudePrice(0.5) - BASE.brentUsd) *
          BASE.passThroughInrPerUsdBbl *
          BASE.policyPassThrough,
    );
  });

  it("etaDays: nearby port is hours away; unknown port is null", () => {
    const eta = etaDays([69.0, 22.0], 12, "Sikka");
    expect(eta).not.toBeNull();
    expect(eta!).toBeLessThan(1);
    expect(etaDays([69, 22], 12, "Atlantis")).toBeNull();
  });
});
