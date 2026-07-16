import { describe, expect, it } from "vitest";
import { aggregateShortfall, DELIVERY_SPREAD_DAYS, shipShortfall } from "./impact";
import type { SimShip } from "../store";

const inboundVLCC = (effect: SimShip["effect"]): SimShip => ({
  props: {
    mmsi: 1, name: "T", type: "VLCC", course: 100, speed: 12,
    dest: "Sikka", lon: 61, lat: 24, // Gulf of Oman → Sikka, ~4-5 d out
  },
  effect,
});

describe("ship → India shortfall", () => {
  it("sanctioned VLCC: full cargo lost across the horizon", () => {
    const s = shipShortfall(inboundVLCC({ kind: "sanction" }));
    const total = s.reduce((a, b) => a + b, 0);
    // 2M bbl at cargo/SPREAD per day from ETA to end of horizon
    expect(Math.max(...s)).toBeCloseTo(2_000_000 / DELIVERY_SPREAD_DAYS);
    expect(total).toBeGreaterThan(2_000_000); // gap persists (never arrives)
  });

  it("manual 10-day delay: gap only during the delay window", () => {
    const s = shipShortfall(inboundVLCC({ kind: "delay", delayDays: 10 }));
    const daysHit = s.filter((v) => v > 0).length;
    expect(daysHit).toBe(10);
    expect(s.reduce((a, b) => a + b, 0)).toBeCloseTo(
      (2_000_000 / DELIVERY_SPREAD_DAYS) * 10,
    );
  });

  it("closure uses the chokepoint's reroute delay", () => {
    const s = shipShortfall(inboundVLCC({ kind: "closure", chokepoint: "hormuz" }));
    const daysHit = s.filter((v) => v > 0).length;
    expect(daysHit).toBeGreaterThan(20); // Cape replacement ≈ +26 d
    expect(daysHit).toBeLessThan(40);
  });

  it("transit / non-crude ships contribute nothing", () => {
    const transit: SimShip = {
      props: { mmsi: 2, name: "X", type: "VLCC", course: 330, speed: 12, dest: "Rotterdam", lon: 38.5, lat: 20.5 },
      effect: { kind: "sanction" },
    };
    expect(Math.max(...shipShortfall(transit))).toBe(0);
    const lng: SimShip = {
      ...inboundVLCC({ kind: "sanction" }),
      props: { ...inboundVLCC({ kind: "sanction" }).props, type: "LNG Carrier" },
    };
    expect(Math.max(...shipShortfall(lng))).toBe(0);
  });

  it("aggregation sums per-ship contributions", () => {
    const a = inboundVLCC({ kind: "delay", delayDays: 10 });
    const b = inboundVLCC({ kind: "delay", delayDays: 10 });
    b.props = { ...b.props, mmsi: 3 };
    const agg = aggregateShortfall([a, b]);
    const one = shipShortfall(a);
    expect(Math.max(...agg)).toBeCloseTo(2 * Math.max(...one));
  });
});
