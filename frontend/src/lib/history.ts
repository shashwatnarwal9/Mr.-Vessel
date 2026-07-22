// Historical-analog grounding (M9b): numeric-signature retrieval over
// the baked episode corpus. Pure TS cosine — offline, no key, no store.
// Backend adds an optional bge-m3 semantic blend when live.

import type { Disruptions } from "./simulate";
import { BASE } from "./cascade";

/** Episodes in the baked corpus (public/history_corpus.json). Stated here so
 *  the landing can quote it without bundling the 20KB file; history.test.ts
 *  asserts it against the real corpus so the two can never drift apart. */
export const HISTORICAL_SHOCKS = 28;

export type Episode = {
  id: string;
  name: string;
  year: number;
  cause: string;
  disruption: string;
  duration_days: number;
  crude_move_pct: number;
  outcome: string;
  summary: string;
  signature: number[]; // [hormuz, redsea, opec, crude_move/100, duration/365]
  source: { name: string; url: string };
};

export type Analog = { episode: Episode; score: number };

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

/** Same 5-dim signature space the corpus uses, built from a running
 *  scenario: disruption values + the model's settled crude move. */
export function scenarioSignature(
  d: Disruptions,
  crudeSettledUsd: number,
  durationDays = 90,
): number[] {
  const crudePct = (crudeSettledUsd - BASE.brentUsd) / BASE.brentUsd;
  return [
    d.hormuz ?? 0,
    d.redsea ?? 0,
    // opec axis doubles as generic supply-loss severity: σ=1 ≈ 4 Mb/d,
    // the same normalization the corpus signatures use (loss / 4 Mb/d)
    d.opec ?? 0,
    Math.max(-1, Math.min(2, crudePct)),
    Math.min(durationDays, 365) / 365,
  ];
}

export function topAnalogs(
  sig: number[],
  corpus: Episode[],
  k = 3,
  semantic?: Record<string, number>, // id → 0..1 (backend blend)
): Analog[] {
  // baseline guard: no cause and no price move = nothing to ground
  // (duration alone is not a scenario)
  if (sig.slice(0, 4).every((v) => Math.abs(v) < 1e-9)) return [];
  return corpus
    .map((episode) => {
      const numeric = cosine(sig, episode.signature);
      const sem = semantic?.[episode.id];
      const score = sem === undefined ? numeric : 0.6 * numeric + 0.4 * sem;
      return { episode, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

export type BandPlacement = "inside" | "above" | "below";

/** Where the model's crude move sits vs the episode's real move. */
export function placement(modelPct: number, episodePct: number): BandPlacement {
  const band = Math.max(5, Math.abs(episodePct) / 3); // ±⅓, floor 5pts
  if (modelPct > episodePct + band) return "above";
  if (modelPct < episodePct - band) return "below";
  return "inside";
}

/** One reference frame for chip AND narrative: the model's move vs the
 *  RANGE of the retrieved episodes' real moves (avoids the chip citing
 *  one episode while the narration cites another). */
export function rangePlacement(
  modelPct: number,
  analogs: Analog[],
): BandPlacement {
  const moves = analogs.map((a) => a.episode.crude_move_pct);
  const lo = Math.min(...moves);
  const hi = Math.max(...moves);
  const margin = Math.max(5, (hi - lo) * 0.1);
  if (modelPct > hi + margin) return "above";
  if (modelPct < lo - margin) return "below";
  return "inside";
}

/** Key-off fallback: grounded, cited, no LLM required. */
export function templateNarrative(
  analogs: Analog[],
  modelCrudePct: number,
): string {
  const e = analogs[0].episode;
  const place = rangePlacement(modelCrudePct, analogs);
  const rel =
    place === "inside"
      ? "sits inside the range these episodes produced"
      : place === "above"
        ? "is above everything these episodes produced — treat it as a severe case"
        : "is below everything these episodes produced — history suggests upside risk";
  return (
    `This looks most like the ${e.name} (${e.year}): ${e.disruption}. ` +
    `Crude actually moved ${e.crude_move_pct > 0 ? "+" : ""}${e.crude_move_pct}%. ` +
    `Your model's ${modelCrudePct >= 0 ? "+" : ""}${modelCrudePct.toFixed(0)}% ${rel}.`
  );
}
