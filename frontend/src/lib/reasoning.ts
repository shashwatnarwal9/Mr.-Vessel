// Plain-language reasoning (v7 M6): WHY the run came out this way.
// Deterministic template from the run's own numbers — offline, no LLM,
// every figure traceable to the same engine state the graphs use.

import type { Disruptions, Trajectory } from "./simulate";
import type { CoupledResult } from "./coupled";
import { BASE } from "./cascade";
import { SIM } from "./simulate";

export function runReasoning(
  d: Disruptions,
  coupled: CoupledResult,
  traj: Trajectory,
): string[] {
  const lines: string[] = [];
  const gulfExposed = coupled.perSupplier
    .filter((p) => p.atRiskShare > 0.001)
    .sort((a, b) => b.atRiskShare - a.atRiskShare);

  if ((d.hormuz ?? 0) > 0 || (d.redsea ?? 0) > 0) {
    const exposedShare = coupled.perSupplier.reduce((s, p) => s + p.atRiskShare, 0);
    lines.push(
      `${Math.round(exposedShare * 100)}% of your import mix travels through the disrupted water` +
        (gulfExposed.length
          ? ` — mostly ${gulfExposed
              .slice(0, 2)
              .map((p) => p.name.split(" (")[0])
              .join(" and ")}.`
          : "."),
    );
    lines.push(
      `After rerouting relief, ~${(coupled.shortfallBblPerDay / 1000).toFixed(0)}k barrels/day don't arrive. India's reserve buffer (${SIM.inventoryDaysCover} days of cover, drawn at most ${Math.round(SIM.drawCapShare * 100)}% of the daily gap) absorbs the first weeks.`,
    );
  }
  if ((d.opec ?? 0) > 0) {
    lines.push(
      `The OPEC+ cut removes barrels from the WORLD market — no tanker to India is blocked, but everyone pays more for crude.`,
    );
  }
  const pumpEnd = traj.fuel_price[89] - BASE.pumpInrPerL;
  const runMin = Math.min(...traj.run_rate);
  const gdpMean = traj.gdp.reduce((a, b) => a + b, 0) / traj.gdp.length;
  lines.push(
    `Result: petrol settles ~₹${pumpEnd.toFixed(0)}/L higher (policy-damped pass-through), refineries bottom out at ${(runMin * 100).toFixed(0)}%, and the 90-day growth drag averages ${gdpMean.toFixed(1)} pp.`,
  );
  return lines;
}
