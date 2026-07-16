// Pure cascade model: Hormuz disruption probability/severity π (0..1)
// → India energy-economy outputs. All constants named and overridable
// so the backend (Phase B) and backtest (M18) reuse the same math.

import { rerouteDelta } from "./reroute";
import COEFF from "./coefficients.json";

// Provenance rule: every cited value comes from coefficients.json
// ({value, range, source, as_of}); derived values are computed here.
export { COEFF };

export const BASE = {
  brentUsd: COEFF.brent_baseline_usd.value,
  pumpInrPerL: COEFF.pump_baseline_inr_l.value,
  hormuzImportShare: COEFF.hormuz_import_share.value,
  mitigation: COEFF.mitigation_hormuz.value,
  crudeShockAtFullClosure: 0.8, // legacy instant-cascade shock (superseded by simulate's elasticity path)
  passThroughInrPerUsdBbl: COEFF.pass_through_inr_per_usd_bbl.value,
  policyPassThrough: COEFF.policy_pass_through.value, // excise/OMC damping
  vulnerablePowerShare: COEFF.vulnerable_power_share.value,
  gdpPpPer10Usd: COEFF.gdp_pp_per_10usd.value,
  // derived: added voyage days via Cape at full closure (Haversine)
  rerouteDaysAtFull: rerouteDelta("hormuz").addedDays,
  rerouteDaysRedSea: rerouteDelta("redsea").addedDays,
  freightPerAddedDay: COEFF.freight_per_added_day.value,
};

export type CascadeOut = {
  run_rate: number; // refinery utilization 0..1
  fuel_price: number; // pump price ₹/L
  power_stress: number; // 0..1 share of generation at risk
  gdp_delta: number; // percentage points, negative = drag
};

export const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

export function crudePrice(pi: number, base = BASE): number {
  return base.brentUsd * (1 + clamp01(pi) * base.crudeShockAtFullClosure);
}

/** Modelled pump ₹/L from an observed Brent price; freight is π-scaled.
 *  Shared by the live Fuel Simulator (M16) and the 2022 backtest (M18). */
export function pumpFromBrent(brent: number, pi = 0, base = BASE): number {
  const p = clamp01(pi);
  const freight = 1 + base.freightPerAddedDay * p * base.rerouteDaysAtFull;
  // policyPassThrough: India retail is excise/OMC-damped (cited, 2022 episode)
  return (
    base.pumpInrPerL +
    (brent - base.brentUsd) *
      base.passThroughInrPerUsdBbl *
      base.policyPassThrough *
      freight
  );
}

export function cascade(pi: number, base = BASE): CascadeOut {
  const p = clamp01(pi);
  const disrupted = p * base.hormuzImportShare * (1 - base.mitigation);
  const brent = crudePrice(p, base);
  const brentDelta = brent - base.brentUsd;
  return {
    run_rate: 1 - disrupted,
    fuel_price: pumpFromBrent(brent, p, base),
    power_stress: p * base.vulnerablePowerShare,
    gdp_delta: -(brentDelta / 10) * base.gdpPpPer10Usd,
  };
}
