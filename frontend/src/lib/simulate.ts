// Time-stepped cascade engine (M6): the simulation core.
// Pure and constant-injected. Day-by-day over a 90-day horizon with
//  - inventory depletion (buffer protects refinery runs until exhausted)
//  - crude price overshoot then mean-reversion toward a shock target
//  - feedback loop: price ↑ → demand destruction → shortfall relief
// Input is either a chokepoint severity σ (with a persistence mode) or a
// per-day supply-shortfall trajectory in bbl/day (from ship simulations).
// India is the only economic target; σ geography only shapes the shock.

import { clamp01, pumpFromBrent, BASE, COEFF } from "./cascade";

export const SIM = {
  days: 90,
  importsBblPerDay: COEFF.india_imports_bbl_d.value,
  hormuzImportShare: BASE.hormuzImportShare,
  mitigation: BASE.mitigation, // bypass pipelines + alt sourcing (cited)
  inventoryDaysCover: COEFF.spr_days_cover.value,
  drawCapShare: COEFF.draw_cap_share.value,
  worldSupplyBblPerDay: COEFF.world_supply_bbl_d.value,
  hormuzWorldBblPerDay: COEFF.hormuz_world_flow_bbl_d.value,
  worldMitigation: BASE.mitigation, // same bypass capacity serves the world flow
  priceElasticity: COEFF.price_elasticity_pct_per_pct.value,
  overshoot: COEFF.overshoot_factor.value,
  overshootDays: 10,
  priceSpeed: 0.25, // daily approach rate toward target (behavioral, assumption)
  demandElasticity: COEFF.demand_elasticity.value,
  stressPerRunRateLoss: 0.25, // fuel-scarcity spillover into power stress
  // domestic scarcity channel: a physical supply crunch moves Indian
  // prices/activity even when world crude is flat (ship-level effects)
  scarcityInrPerRunLoss: COEFF.scarcity_inr_per_run_loss.value,
  gdpPpPerRunLoss: COEFF.gdp_pp_per_run_loss.value,
};

export type SigmaMode = "sustained" | "decay" | "shock";

/** Combined-disruption model: the three scenarios can be active at once.
 *  hormuz → crude-supply shortfall (India's main artery)
 *  redsea → freight premium + transient reroute shortfall (cost-led)
 *  opec   → world price shock via supply cut (no India-access cut)   */
export type Disruptions = { hormuz?: number; redsea?: number; opec?: number };

export type SimInput = {
  sigma?: number; // legacy alias for disruptions.hormuz
  disruptions?: Disruptions;
  mode?: SigmaMode; // persistence (applies to all active disruptions)
  shortfallBblPerDay?: number[]; // from ship→India-impact model
  /** v7 coupled engine: when set, REPLACES the internal σ-share shortfall
   *  (the import-mix decides how much a closure bites); world-price and
   *  freight channels still run off the disruption values. */
  physicalShortfallOverride?: number; // bbl/day, σ-mode-scaled per day
  /** War Cabinet DM lever (defaults to the calibrated coefficient when unset,
   *  so absent === current behaviour). sprDrawCapShare — strategic-reserve
   *  release: fraction of the daily supply gap the inventory buffer may cover
   *  (base draw_cap_share=0.7; a release raises it toward 1.0). The Hormuz
   *  bypass is already credited at its cited 0.30 ceiling in the baseline, so
   *  there is deliberately no "more bypass" lever. */
  sprDrawCapShare?: number;
  days?: number;
};

export type Trajectory = {
  day: number[];
  run_rate: number[]; // 0..1
  fuel_price: number[]; // ₹/L
  power_stress: number[]; // 0..1
  gdp: number[]; // annualized pp drag at each day (negative)
  crude: number[]; // $/bbl
  inventory: number[]; // days of import cover remaining
};

function sigmaAt(sigma: number, mode: SigmaMode, t: number): number {
  if (mode === "decay") return sigma * Math.exp(-t / 30);
  if (mode === "shock") return t < 14 ? sigma : 0;
  return sigma;
}

export function simulate(input: SimInput, P = SIM, base = BASE): Trajectory {
  const days = input.days ?? P.days;
  const d0 = {
    hormuz: clamp01(input.disruptions?.hormuz ?? input.sigma ?? 0),
    redsea: clamp01(input.disruptions?.redsea ?? 0),
    opec: clamp01(input.disruptions?.opec ?? 0),
  };
  const anyDisruption = d0.hormuz > 0 || d0.redsea > 0 || d0.opec > 0;
  const mode = input.mode ?? "sustained";
  const shipShortfall = input.shortfallBblPerDay ?? [];
  // DM strategic-reserve release lever (defaults to calibrated coefficient)
  const drawCapShare = clamp01(input.sprDrawCapShare ?? P.drawCapShare);

  const out: Trajectory = {
    day: [], run_rate: [], fuel_price: [], power_stress: [],
    gdp: [], crude: [], inventory: [],
  };

  let crude = base.brentUsd;
  let inventory = P.inventoryDaysCover; // in days of total imports

  for (let t = 0; t < days; t++) {
    const h = sigmaAt(d0.hormuz, mode, t);
    const r = sigmaAt(d0.redsea, mode, t);
    const o = sigmaAt(d0.opec, mode, t);
    const s = h; // Hormuz drives gas-import power exposure + hormuz freight

    // raw India shortfall (bbl/day): compounding = shortfalls sum
    // hormuz: crude-artery cut; redsea: transient reroute gap (cost-led)
    // v7: the coupled mix engine can override the σ-share formula —
    // scaled by the same persistence mode (peak disruption of the day)
    const modeScale =
      d0.hormuz + d0.redsea > 0
        ? Math.max(h, r) / Math.max(d0.hormuz, d0.redsea, 1e-9)
        : 1;
    const sigmaShortfall =
      input.physicalShortfallOverride !== undefined
        ? input.physicalShortfallOverride * modeScale
        : h * P.hormuzImportShare * P.importsBblPerDay * (1 - P.mitigation) +
          r *
            COEFF.redsea_import_share.value *
            P.importsBblPerDay *
            COEFF.redsea_shortfall_factor.value;
    const raw = sigmaShortfall + (shipShortfall[t] ?? 0);

    // feedback: elevated price destroys demand, easing the shortfall
    const priceRatio = crude / base.brentUsd;
    const demandCut =
      Math.max(0, priceRatio - 1) * P.demandElasticity * P.importsBblPerDay;
    const eff = Math.max(0, raw - demandCut);

    // inventory absorbs most of the gap (logistics-capped) until it runs out
    const gapDays = eff / P.importsBblPerDay; // shortfall in days-of-import
    const draw = Math.min(inventory, gapDays * drawCapShare);
    inventory -= draw;
    const uncovered = gapDays - draw; // hits refinery runs directly
    const run_rate = clamp01(1 - uncovered);

    // world crude: losses sum (hormuz flow cut + OPEC quota cut; redsea
    // barrels reroute, they are not lost to the world market)
    const worldLoss =
      (h * P.hormuzWorldBblPerDay * (1 - P.worldMitigation) +
        o * COEFF.opec_max_cut_bbl_d.value) /
      P.worldSupplyBblPerDay;
    let target = base.brentUsd * (1 + worldLoss * 100 * (P.priceElasticity / 100));
    if (t < P.overshootDays && anyDisruption) target *= P.overshoot;
    crude += (target - crude) * P.priceSpeed;

    // freight premium: added voyage days convert to $/bbl landed cost
    // (additive, cited) — hormuz replacement barrels + redsea Cape detour
    const freightDays = h * BASE.rerouteDaysAtFull + r * BASE.rerouteDaysRedSea;
    const landedCrude =
      crude + freightDays * COEFF.freight_usd_per_bbl_day.value;

    const runLoss = 1 - run_rate;
    const fuel_price =
      pumpFromBrent(landedCrude, 0, base) + runLoss * P.scarcityInrPerRunLoss;
    const power_stress = clamp01(
      s * base.vulnerablePowerShare + runLoss * P.stressPerRunRateLoss,
    );
    const gdp =
      -((crude - base.brentUsd) / 10) * base.gdpPpPer10Usd -
      runLoss * P.gdpPpPerRunLoss;

    out.day.push(t);
    out.run_rate.push(run_rate);
    out.fuel_price.push(fuel_price);
    out.power_stress.push(power_stress);
    out.gdp.push(gdp);
    out.crude.push(crude);
    out.inventory.push(inventory);
  }
  return out;
}
