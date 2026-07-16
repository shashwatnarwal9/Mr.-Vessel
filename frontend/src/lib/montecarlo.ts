// Monte Carlo (M7): sample uncertain economics, run the time-stepped
// engine (simulate.ts) N times, return per-day quantile bands. Pure —
// runs in the Web Worker and, later, server-side.

import { BASE } from "./cascade";
import { SIM, simulate, type SimInput } from "./simulate";

export type Band = {
  p5: number;
  p25: number;
  p50: number;
  p75: number;
  p95: number;
};
export type McResult = { pump: Band[]; gdp: Band[] };

function randn(): number {
  // Box-Muller
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const jitter = (x: number, sd: number) => x * Math.max(0.1, 1 + sd * randn());

function bandOf(xs: number[]): Band {
  xs.sort((a, b) => a - b);
  const q = (f: number) => xs[Math.min(xs.length - 1, Math.floor(f * xs.length))];
  return { p5: q(0.05), p25: q(0.25), p50: q(0.5), p75: q(0.75), p95: q(0.95) };
}

export function mcBands(input: SimInput, runs = 10_000): McResult {
  const days = input.days ?? SIM.days;
  const pump: number[][] = Array.from({ length: days }, () => new Array(runs));
  const gdp: number[][] = Array.from({ length: days }, () => new Array(runs));

  for (let r = 0; r < runs; r++) {
    // uncertain economics, one draw per run
    const P = {
      ...SIM,
      priceElasticity: jitter(SIM.priceElasticity, 0.2),
      mitigation: Math.min(0.9, jitter(SIM.mitigation, 0.15)),
      demandElasticity: jitter(SIM.demandElasticity, 0.3),
      inventoryDaysCover: jitter(SIM.inventoryDaysCover, 0.15),
    };
    const base = {
      ...BASE,
      passThroughInrPerUsdBbl: jitter(BASE.passThroughInrPerUsdBbl, 0.2),
    };
    const t = simulate(input, P, base);
    for (let d = 0; d < days; d++) {
      pump[d][r] = t.fuel_price[d];
      gdp[d][r] = t.gdp[d];
    }
  }

  return { pump: pump.map(bandOf), gdp: gdp.map(bandOf) };
}
