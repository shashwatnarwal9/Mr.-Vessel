// War Cabinet: turn a minister's PolicyLevers into a SimInput the calibrated
// engine already understands, then run each plan. GLM does judgment, the engine
// does arithmetic — every lever here maps to a real, cited engine knob.

import {
  simulate,
  type Disruptions,
  type SigmaMode,
  type SimInput,
  type Trajectory,
} from "./simulate";
import {
  coupledShortfall,
  normalizeMix,
  optimizeMitigation,
  type Mix,
} from "./coupled";
import type { Supplier } from "./supplier";

export type Escalation = { channel: keyof Disruptions; delta: number };
export type PolicyLevers = {
  resource_reallocation?: boolean; // FM: re-source under IEA spare-capacity caps
  opec_negotiation?: number; // FM: 0..1, talk OPEC+ down (world-price channel)
  deescalation?: number; // FM: 0..1, diplomacy → taper Hormuz + decay mode
  spr_release?: number; // DM: 0..1, draw the strategic reserve harder
  naval_escort?: number; // DM: 0..1, convoy Red Sea → cut reroute losses (proxy)
  escalation?: Escalation[]; // DM/PM: raise a channel's σ — can worsen the outcome
};

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const DRAW_CAP_BASE = 0.7; // coefficients.draw_cap_share

// Lever EFFECTIVENESS caps: a lever at 1.0 is full political effort, NOT a
// magic reset. Diplomacy can't reopen a mined strait or reverse an OPEC quota
// inside the 90-day horizon — without these caps the PM trivially drives every
// shock to zero (petrol +₹0.0) and the graphs go flat.
// ponytail: first-order effectiveness caps, tune if a channel is re-calibrated.
const DEESC_MAX = 0.4; // diplomacy trims the Hormuz shock ≤40% (+ decay over time)
const OPEC_MAX = 0.5; // India's leverage over an OPEC+ quota decision ≤50%
const ESCORT_MAX = 0.6; // convoys cut Red Sea reroute losses ≤60% (proxy, not a fleet model)

/** Apply a lever set to the baseline crisis, producing a SimInput. */
export function leversToInput(
  base: Disruptions,
  mode: SigmaMode,
  levers: PolicyLevers,
  suppliers: Supplier[],
  mix: Mix,
): SimInput {
  const d: Disruptions = {
    hormuz: base.hormuz ?? 0,
    redsea: base.redsea ?? 0,
    opec: base.opec ?? 0,
  };
  // de-escalation LOWERS the shock's severity (capped) but does NOT flip the
  // scenario to decay — a mined strait doesn't fade to zero by the horizon end
  // just because diplomacy is underway; that collapsed every plan to ~₹0.
  const m = mode;
  if (levers.opec_negotiation)
    d.opec = clamp01((d.opec ?? 0) * (1 - OPEC_MAX * levers.opec_negotiation));
  if (levers.deescalation)
    d.hormuz = clamp01((d.hormuz ?? 0) * (1 - DEESC_MAX * levers.deescalation));
  if (levers.naval_escort)
    d.redsea = clamp01((d.redsea ?? 0) * (1 - ESCORT_MAX * levers.naval_escort));
  for (const e of levers.escalation ?? [])
    d[e.channel] = clamp01((d[e.channel] ?? 0) + e.delta);

  const input: SimInput = { disruptions: d, mode: m };
  if (levers.spr_release)
    input.sprDrawCapShare = DRAW_CAP_BASE + levers.spr_release * (1 - DRAW_CAP_BASE);

  // physical shortfall via the coupled import-mix; re-sourcing swaps the mix
  // under cited spare-capacity caps (optimizeMitigation), then re-costs it.
  if (suppliers.length) {
    const useMix = levers.resource_reallocation
      ? optimizeMitigation(suppliers, mix, d).newMix
      : mix;
    input.physicalShortfallOverride = coupledShortfall(
      suppliers,
      normalizeMix(useMix).mix,
      d,
    ).shortfallBblPerDay;
  }
  return input;
}

export type PlanSpec = { name: string; color: string; levers: PolicyLevers };
export type Plan = PlanSpec & { input: SimInput; traj: Trajectory };

/** Run every plan deterministically off one shared baseline. */
export function runPlans(
  base: Disruptions,
  mode: SigmaMode,
  specs: PlanSpec[],
  suppliers: Supplier[],
  mix: Mix,
): Plan[] {
  return specs.map((s) => {
    const input = leversToInput(base, mode, s.levers, suppliers, mix);
    return { ...s, input, traj: simulate(input) };
  });
}
