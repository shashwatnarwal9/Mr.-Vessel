// v7 coupled engine (M6): the shock panel and the import-mix panel are
// NOT independent — shortfall is computed jointly:
//   at_risk_s      = share_s × Σ_c exposure[s][c] × disruption[c]
//   total_shortfall = Σ_s at_risk_s × (1 − reroutable_s) × imports
// OPEC acts on world price only (no India-access cut). The SPR buffer is
// applied inside the time-stepped engine, not here.
// Also here: the constrained mitigation optimizer (greedy under cited
// spare-capacity caps — objective and constraints are surfaced, never a
// bare "optimal").

import type { Disruptions } from "./simulate";
import type { Supplier } from "./supplier";
import { COEFF } from "./cascade";

export type Mix = Record<string, number>; // supplier id → share (0..1)

export function defaultMix(suppliers: Supplier[]): Mix {
  // cited shares sum to ~0.95 (implicit "other" bucket) — normalize so
  // the 100% constraint holds from the start
  return normalizeMix(
    Object.fromEntries(suppliers.map((s) => [s.id, s.import_share])),
  ).mix;
}

/** Shares must sum to 1 — auto-normalize (UI warns when it corrected). */
export function normalizeMix(mix: Mix): { mix: Mix; corrected: boolean } {
  const sum = Object.values(mix).reduce((a, b) => a + b, 0);
  if (sum <= 0) return { mix, corrected: false };
  const corrected = Math.abs(sum - 1) > 0.001;
  return {
    mix: Object.fromEntries(
      Object.entries(mix).map(([k, v]) => [k, v / sum]),
    ),
    corrected,
  };
}

export type CoupledResult = {
  perSupplier: {
    id: string;
    name: string;
    share: number;
    atRiskShare: number; // share of imports interdicted before rerouting
    lostShare: number; // after reroutable relief
  }[];
  shortfallBblPerDay: number;
  shortfallShare: number; // of total imports
};

export function coupledShortfall(
  suppliers: Supplier[],
  mix: Mix,
  d: Disruptions,
  importsBblPerDay = COEFF.india_imports_bbl_d.value,
): CoupledResult {
  const dis: Record<string, number> = {
    hormuz: d.hormuz ?? 0,
    redsea: Math.max(d.redsea ?? 0, 0), // suez rides the same corridor value
    suez: d.redsea ?? 0,
    babmandeb: d.redsea ?? 0,
    cape: 0, // fallback route, not a closable input here
  };
  const perSupplier = suppliers.map((s) => {
    const share = mix[s.id] ?? 0;
    const exposure = Object.entries(s.d).reduce(
      (sum, [c, e]) => sum + e * (dis[c] ?? 0),
      0,
    );
    const atRiskShare = share * Math.min(1, exposure);
    const lostShare = atRiskShare * (1 - s.reroutable);
    return { id: s.id, name: s.name, share, atRiskShare, lostShare };
  });
  const shortfallShare = perSupplier.reduce((a, b) => a + b.lostShare, 0);
  return {
    perSupplier,
    shortfallShare,
    shortfallBblPerDay: shortfallShare * importsBblPerDay,
  };
}

/* ---------------- constrained mitigation optimizer ---------------- */

export type Mitigation = {
  objective: string;
  constraints: string[];
  moves: { from: string; to: string; share: number }[];
  newMix: Mix;
  before: number; // shortfall bbl/d
  after: number;
  residualNote: string;
};

/** Greedy re-sourcing under cited spare-capacity caps: move interdicted
 *  share from the hardest-hit suppliers to unaffected ones with headroom,
 *  cheapest-risk-first. Honest framing: greedy, not a global optimum. */
export function optimizeMitigation(
  suppliers: Supplier[],
  mix: Mix,
  d: Disruptions,
  importsBblPerDay = COEFF.india_imports_bbl_d.value,
): Mitigation {
  const before = coupledShortfall(suppliers, mix, d, importsBblPerDay);
  const lossRate = (s: Supplier) => {
    const one = coupledShortfall(suppliers, { [s.id]: 1 }, d, importsBblPerDay);
    return one.shortfallShare; // lost share per unit of mix given to s
  };

  // donors: suppliers actually losing crude; receivers: low-loss + spare
  const donors = [...before.perSupplier]
    .filter((p) => p.lostShare > 0.002)
    .sort((a, b) => b.lostShare - a.lostShare);
  const receivers = suppliers
    .filter((s) => s.spare_capacity_bbl_d > 0 && s.sigma_k < 0.5)
    .map((s) => ({ s, rate: lossRate(s) }))
    .sort((a, b) => a.rate - b.rate);

  const newMix: Mix = { ...mix };
  const moves: Mitigation["moves"] = [];
  const headroom: Record<string, number> = Object.fromEntries(
    receivers.map(({ s }) => [s.id, s.spare_capacity_bbl_d / importsBblPerDay]),
  );

  for (const donor of donors) {
    // only the interdicted, non-reroutable slice is worth moving
    let toMove = donor.lostShare;
    for (const { s: recv, rate } of receivers) {
      if (toMove <= 0.001) break;
      if (recv.id === donor.id) continue;
      const donorRate = lossRate(suppliers.find((x) => x.id === donor.id)!);
      if (rate >= donorRate) continue; // no improvement, skip
      const take = Math.min(toMove, headroom[recv.id] ?? 0);
      if (take <= 0.001) continue;
      newMix[donor.id] = (newMix[donor.id] ?? 0) - take;
      newMix[recv.id] = (newMix[recv.id] ?? 0) + take;
      headroom[recv.id] -= take;
      moves.push({ from: donor.name, to: recv.name, share: take });
      toMove -= take;
    }
  }

  const after = coupledShortfall(suppliers, newMix, d, importsBblPerDay);
  return {
    objective:
      "minimize India's modeled 90-day GDP loss (via physical shortfall)",
    constraints: [
      "re-sourcing capped by each supplier's cited spare capacity (IEA)",
      "import shares always sum to 100%",
      "sanctioned suppliers (σ≥0.5) excluded as receivers",
      "reroute freight cost accepted (priced by the engine)",
    ],
    moves,
    newMix,
    before: before.shortfallBblPerDay,
    after: after.shortfallBblPerDay,
    residualNote:
      after.shortfallBblPerDay > 1000
        ? `residual ${(after.shortfallBblPerDay / 1000).toFixed(0)}k bbl/day cannot be re-sourced within spare-capacity caps — the SPR buffer and demand response absorb it in the trajectory`
        : "shortfall fully re-sourced within cited caps; freight premium remains",
  };
}
