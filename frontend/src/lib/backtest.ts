// 2022 backtest: replay the real 2022 crude spike through the engine.
// Data below is the public historical record (end-of-month), baked —
// not a faked live call. Baseline = Dec 2021 (Brent $77.8, Delhi ₹95.41).

import { BASE, pumpFromBrent } from "./cascade";

export const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

// Brent EOM close $/bbl, 2022
export const BRENT_2022 = [
  91.2, 101.0, 107.9, 109.3, 122.8, 114.8,
  110.0, 96.5, 87.9, 94.8, 85.4, 85.9,
];

// Delhi petrol EOM ₹/L, 2022 (Mar–Apr hikes; May 22 excise cut then freeze)
export const ACTUAL_PUMP_2022 = [
  95.41, 95.41, 101.81, 105.41, 96.72, 96.72,
  96.72, 96.72, 96.72, 96.72, 96.72, 96.72,
];

const BASE_2021 = {
  ...BASE,
  brentUsd: 77.8,
  pumpInrPerL: 95.41,
  rerouteDaysAtFull: 0, // 2022 had no chokepoint closure — pure pass-through
};

export type BacktestResult = {
  months: string[];
  modelled: number[];
  actual: number[];
  matchPct: number; // 100 − MAPE
};

export function backtest2022(): BacktestResult {
  const modelled = BRENT_2022.map((b) => pumpFromBrent(b, 0, BASE_2021));
  const mape =
    (ACTUAL_PUMP_2022.reduce(
      (s, a, i) => s + Math.abs(modelled[i] - a) / a,
      0,
    ) /
      ACTUAL_PUMP_2022.length) *
    100;
  return {
    months: MONTHS,
    modelled,
    actual: ACTUAL_PUMP_2022,
    matchPct: 100 - mape,
  };
}
