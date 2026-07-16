// RA2: corridor disruption probability — Bayesian log-odds fusion of
// four normalized signals over a cited base-rate prior. MVP runs on the
// BAKED signal snapshot in corridors.json; live mode (RA5) swaps the
// snapshot for computed signals, same math. Simplest correct version
// (ponytail): no Hawkes term yet — that is RA4's layer.

export type Corridor = {
  id: string;
  name: string;
  centroid: [number, number];
  polygon: [number, number][];
  p0: number;
  p0_basis: string;
  india_flow_share: number;
  signals: { news: number; ais: number; sanctions: number; market: number };
  signals_basis: string;
};

export type Weights = Record<keyof Corridor["signals"], number>;

export type CorridorRisk = {
  corridor: Corridor;
  p: number; // fused probability 0..1
  band: number; // ± half-width
  contributions: { signal: string; value: number; logOdds: number }[];
};

export const logit = (p: number) => Math.log(p / (1 - p));
export const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

const CORROBORATION_THRESHOLD = 0.25;

export function fuseCorridor(c: Corridor, w: Weights): CorridorRisk {
  const entries = Object.entries(c.signals) as [keyof Weights, number][];
  const contributions = entries.map(([signal, value]) => ({
    signal,
    value,
    logOdds: w[signal] * value,
  }));
  const x = logit(c.p0) + contributions.reduce((s, t) => s + t.logOdds, 0);
  const p = sigmoid(x);

  // confidence: band shrinks as independent signals corroborate
  const corroborating = entries.filter(
    ([, v]) => v >= CORROBORATION_THRESHOLD,
  ).length;
  const band = Math.max(0.03, 0.15 - 0.03 * corroborating);

  return { corridor: c, p, band, contributions };
}

export function fuseAll(corridors: Corridor[], w: Weights): CorridorRisk[] {
  return corridors
    .map((c) => fuseCorridor(c, w))
    .sort((a, b) => b.p - a.p);
}

// browser-side lazy loader: corridors.json → fused risks (cached)
let _risks: CorridorRisk[] | null = null;
export async function loadCorridorRisks(): Promise<CorridorRisk[]> {
  if (_risks) return _risks;
  const file = await fetch("/corridors.json").then((r) => r.json());
  const weights = Object.fromEntries(
    Object.entries(
      file.meta.weights as Record<string, { value: number }>,
    ).map(([k, v]) => [k, v.value]),
  ) as Weights;
  _risks = fuseAll(file.corridors as Corridor[], weights);
  return _risks;
}

/** Plain-language driver line: which signal moved this score most. */
export function topDriver(r: CorridorRisk): string {
  const top = [...r.contributions].sort((a, b) => b.logOdds - a.logOdds)[0];
  const names: Record<string, string> = {
    news: "news reports near the corridor",
    ais: "unusual ship behaviour",
    sanctions: "sanctioned/shadow-fleet traffic",
    market: "market risk pricing",
  };
  return names[top.signal] ?? top.signal;
}
