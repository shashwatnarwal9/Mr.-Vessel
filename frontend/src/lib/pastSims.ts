// Past Simulations (M7 v4): browser persistence for saved runs.
// localStorage is fine at this scale (a run ≈ 4×90 numbers + 2×90 bands).

import type { Band } from "./montecarlo";
import type { Disruptions } from "./simulate";
import type { ShipEffect, WorldState } from "../store";

export type SavedRun = {
  id: number;
  name: string;
  ts: string; // ISO
  disruptions: Disruptions;
  ships: { mmsi: number; name: string; type: string; effect: ShipEffect }[];
  headline: string;
  traj: { fuel: number[]; gdp: number[]; run: number[]; stress: number[] };
  fanFuel: Band[];
  fanGdp: Band[];
  // full committed world (mix + disruptions + ships w/ positions) so a click
  // can re-load everything and re-run. Optional: runs saved before this field
  // fall back to the disruptions-only reload.
  world?: WorldState;
};

const KEY = "mrvessel.pastSims.v1";

export function listRuns(): SavedRun[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]") as SavedRun[];
  } catch {
    return [];
  }
}

export function saveRun(run: SavedRun): void {
  const all = listRuns().filter((r) => r.id !== run.id);
  all.unshift(run);
  localStorage.setItem(KEY, JSON.stringify(all.slice(0, 50))); // cap 50 runs
}

export function deleteRun(id: number): void {
  localStorage.setItem(
    KEY,
    JSON.stringify(listRuns().filter((r) => r.id !== id)),
  );
}
