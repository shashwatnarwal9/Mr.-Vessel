import { describe, expect, it } from "vitest";
import CORRIDORS from "../../public/corridors.json";
import {
  fuseAll,
  fuseCorridor,
  logit,
  sigmoid,
  topDriver,
  type Corridor,
  type Weights,
} from "./risk";

const corridors = (CORRIDORS as unknown as { corridors: Corridor[] }).corridors;
const weights = Object.fromEntries(
  Object.entries(
    (CORRIDORS as { meta: { weights: Record<string, { value: number }> } }).meta
      .weights,
  ).map(([k, v]) => [k, v.value]),
) as Weights;

describe("corridor risk fusion (RA2) — IMMUTABLE checks", () => {
  it("all probabilities stay in [0,1] with a band", () => {
    for (const r of fuseAll(corridors, weights)) {
      expect(r.p).toBeGreaterThan(0);
      expect(r.p).toBeLessThan(1);
      expect(r.band).toBeGreaterThanOrEqual(0.03);
      expect(r.band).toBeLessThanOrEqual(0.15);
    }
  });

  it("contributions exactly reconstruct the fused logit (provenance)", () => {
    for (const c of corridors) {
      const r = fuseCorridor(c, weights);
      const rebuilt = sigmoid(
        logit(c.p0) + r.contributions.reduce((s, t) => s + t.logOdds, 0),
      );
      expect(rebuilt).toBeCloseTo(r.p, 10);
    }
  });

  it("zero signals collapse to the base-rate prior", () => {
    const quiet: Corridor = {
      ...corridors[0],
      signals: { news: 0, ais: 0, sanctions: 0, market: 0 },
    };
    expect(fuseCorridor(quiet, weights).p).toBeCloseTo(corridors[0].p0, 6);
  });

  it("band shrinks as more signals corroborate", () => {
    const none = fuseCorridor(
      { ...corridors[0], signals: { news: 0, ais: 0, sanctions: 0, market: 0 } },
      weights,
    );
    const all = fuseCorridor(
      { ...corridors[0], signals: { news: 0.5, ais: 0.5, sanctions: 0.5, market: 0.5 } },
      weights,
    );
    expect(all.band).toBeLessThan(none.band);
  });

  it("baked snapshot ranks Bab el-Mandeb highest (2026 posture)", () => {
    const ranked = fuseAll(corridors, weights);
    expect(ranked[0].corridor.id).toBe("babmandeb");
    expect(ranked[0].p).toBeGreaterThan(0.3);
    expect(ranked.at(-1)!.p).toBeLessThan(0.05); // Cape ~quiet
  });

  it("driver line is plain language", () => {
    const r = fuseAll(corridors, weights)[0];
    expect(topDriver(r)).not.toMatch(/logit|odds/i);
  });
});
