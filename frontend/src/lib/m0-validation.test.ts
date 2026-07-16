// M0 — CORE NUMBER VALIDATION (god-prompt Tier 0).
// Hardcoded scenario: Hormuz 50% closure, sustained, 90 days.
// Prints every headline number with its provenance and asserts each
// against a cited sanity range. The build does not proceed past M0
// until a human confirms these numbers look plausible.

import { describe, expect, it } from "vitest";
import { BASE, COEFF } from "./cascade";
import { SIM, simulate } from "./simulate";

describe("M0 — Hormuz 50% closure validation", () => {
  const SIGMA = 0.5;
  const t = simulate({ sigma: SIGMA, mode: "sustained" });

  // ---- derived headline numbers ----
  const rawShortfall =
    SIGMA * SIM.hormuzImportShare * SIM.importsBblPerDay * (1 - SIM.mitigation);
  const crudePeak = Math.max(...t.crude);
  const crudeSettled = t.crude[89];
  const pumpPeak = Math.max(...t.fuel_price);
  const pumpSettled = t.fuel_price[89];
  const runMin90 = Math.min(...t.run_rate);
  // structural run rate: the same engine with the buffer removed — what
  // refiners face once stocks are gone (at σ=0.5 the SPR outlasts 90d,
  // so the buffered minimum alone would hide the structural hit)
  const structural = simulate(
    { sigma: SIGMA, mode: "sustained" },
    { ...SIM, inventoryDaysCover: 0 },
  );
  const structuralRun = structural.run_rate[89];
  const stressPeak = Math.max(...t.power_stress);
  const gdpMean = t.gdp.reduce((a, b) => a + b, 0) / t.gdp.length;

  it("prints the M0 numbers for human eyeball", () => {
    const L = (s: string) => console.log(s);
    L("");
    L("================ M0 VALIDATION — HORMUZ 50% CLOSURE ================");
    L(`physical shortfall : ${(rawShortfall / 1000).toFixed(0)}k bbl/day`);
    L(`                     = σ0.5 × share ${SIM.hormuzImportShare} (cited EIA/PPAC) × imports ${(SIM.importsBblPerDay / 1e6).toFixed(1)}M (cited PPAC) × (1−mitigation ${SIM.mitigation} cited IEA bypass)`);
    L(`run_rate           : min over 90d = ${(runMin90 * 100).toFixed(1)}%  (buffer active)`);
    L(`                     structural (stocks exhausted) = ${(structuralRun * 100).toFixed(1)}%`);
    L(`                     SPR buffer ${SIM.inventoryDaysCover}d (cited ISPRL), draw cap ${SIM.drawCapShare} (assumption)`);
    L(`ΔP crude           : peak +$${(crudePeak - BASE.brentUsd).toFixed(0)} (overshoot ×${SIM.overshoot}, cited 2022 analog)`);
    L(`                     settled +$${(crudeSettled - BASE.brentUsd).toFixed(0)} (elasticity ${SIM.priceElasticity}%/1% cited IMF/EIA)`);
    L(`pump price change  : peak +₹${(pumpPeak - BASE.pumpInrPerL).toFixed(1)}/L, settled +₹${(pumpSettled - BASE.pumpInrPerL).toFixed(1)}/L`);
    L(`                     pass-through ₹${BASE.passThroughInrPerUsdBbl}/$/bbl (cited PPAC) × policy damping ${BASE.policyPassThrough} (cited RBI 2022 episode)`);
    L(`power-stress index : peak ${(stressPeak * 100).toFixed(1)}%  (vulnerable share ${BASE.vulnerablePowerShare} cited CEA)`);
    L(`GDP drag           : mean over 90d = ${gdpMean.toFixed(2)} pp  (${COEFF.gdp_pp_per_10usd.value} pp/$10 cited RBI + activity channel)`);
    L("=====================================================================");
    L("");
  });

  it("GDP drag for a severe shock sits in the cited band (−0.3 to −3 pp)", () => {
    expect(gdpMean).toBeLessThan(-0.3);
    expect(gdpMean).toBeGreaterThan(-3);
  });

  it("pump change is positive but policy-damped", () => {
    expect(pumpPeak - BASE.pumpInrPerL).toBeGreaterThan(0);
    // damped: strictly below the undamped pass-through of the same crude move
    const undampedPeak =
      (crudePeak - BASE.brentUsd) * BASE.passThroughInrPerUsdBbl;
    expect(pumpPeak - BASE.pumpInrPerL).toBeLessThan(undampedPeak);
  });

  it("structural run rate lands in the council band (60–95%)", () => {
    expect(structuralRun).toBeGreaterThan(0.6);
    expect(structuralRun).toBeLessThan(0.95);
  });

  it("crude settles elevated but below the panic peak", () => {
    expect(crudeSettled).toBeGreaterThan(BASE.brentUsd);
    expect(crudeSettled).toBeLessThan(crudePeak);
    expect(crudePeak).toBeLessThan(BASE.brentUsd * 2.5); // no runaway
  });

  it("shortfall magnitude is physically sane (0.4–1.0 Mb/d for σ=0.5)", () => {
    expect(rawShortfall).toBeGreaterThan(400_000);
    expect(rawShortfall).toBeLessThan(1_000_000);
  });
});

describe("M0 — all scenarios + combination (v4 combined engine)", () => {
  const stats = (t: ReturnType<typeof simulate>) => ({
    pumpEnd: t.fuel_price[89] - BASE.pumpInrPerL,
    pumpPeak: Math.max(...t.fuel_price) - BASE.pumpInrPerL,
    crudeEnd: t.crude[89] - BASE.brentUsd,
    runMin: Math.min(...t.run_rate),
    gdpMean: t.gdp.reduce((a, b) => a + b, 0) / t.gdp.length,
    stressPeak: Math.max(...t.power_stress),
  });
  const H = stats(simulate({ disruptions: { hormuz: 0.5 } }));
  const R = stats(simulate({ disruptions: { redsea: 0.4 } }));
  const O = stats(simulate({ disruptions: { opec: 0.6 } }));
  const C = stats(simulate({ disruptions: { hormuz: 0.5, redsea: 0.4 } }));

  it("prints the scenario table for human eyeball", () => {
    const row = (name: string, s: ReturnType<typeof stats>) =>
      console.log(
        `${name.padEnd(26)} pump +₹${s.pumpEnd.toFixed(1)}/L (peak +₹${s.pumpPeak.toFixed(1)}) · crude +$${s.crudeEnd.toFixed(0)} · run ${(s.runMin * 100).toFixed(1)}% · stress ${(s.stressPeak * 100).toFixed(1)}% · GDP ${s.gdpMean.toFixed(2)}pp`,
      );
    console.log("\n========== M0 v4 — SCENARIOS + COMBINATION ==========");
    row("Hormuz 50% closure", H);
    row("Red Sea 40% suspension", R);
    row("OPEC+ cut 60% (2.4 Mb/d)", O);
    row("COMBINED H50 + RS40", C);
    console.log("=====================================================\n");
  });

  it("combination is worse than either component alone", () => {
    expect(C.pumpEnd).toBeGreaterThan(Math.max(H.pumpEnd, R.pumpEnd));
    expect(C.gdpMean).toBeLessThan(Math.min(H.gdpMean, R.gdpMean));
    expect(C.runMin).toBeLessThanOrEqual(Math.min(H.runMin, R.runMin));
  });

  it("each scenario keeps its economic character", () => {
    expect(R.crudeEnd).toBeLessThan(2); // redsea: cost-led, crude ~flat
    expect(O.crudeEnd).toBeGreaterThan(5); // opec: price-led
    expect(O.runMin).toBe(1); // opec: no physical India cut
    expect(H.runMin).toBeLessThan(1); // hormuz: the crude artery
  });
});
