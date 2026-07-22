import { useEffect, useRef, useState } from "react";
import { useStore, type SimShip } from "../store";
import { aggregateShortfall } from "../lib/impact";
import { simulate, type Disruptions } from "../lib/simulate";
import type { McResult } from "../lib/montecarlo";
import { BASE } from "../lib/cascade";
import { saveRun, type SavedRun } from "../lib/pastSims";
import { type Supplier } from "../lib/supplier";
import {
  coupledShortfall,
  defaultMix,
  normalizeMix,
  optimizeMitigation,
  type Mitigation,
  type Mix,
} from "../lib/coupled";
import { exposedPowerMW, perRefineryRunRate } from "../lib/power";
import { runReasoning } from "../lib/reasoning";
import { COEFF } from "../lib/cascade";
import TrajChart from "./TrajChart";
import FanChart from "./FanChart";
import RefineryMap from "./RefineryMap";
// tanker viz removed from the mix panel; the colour scale is still the shared one
import { supplierColor } from "./FuelTanker";
import CardDeck, { type DeckCard } from "./CardDeck";
import PageIntro from "./PageIntro";
import ValidationPanel from "./ValidationPanel";
import HistoricalContext from "./HistoricalContext";

const BLUE = "#3987e5";
const RED = "#e66767";
const AQUA = "#199e70";
const YELLOW = "#c98500";

/* ---------- scenario cards ---------- */

type CardSpec = {
  key: "hormuz" | "redsea" | "opec";
  title: string;
  ask: string;
  character: string;
};

const CARDS: CardSpec[] = [
  {
    key: "hormuz",
    title: "Strait of Hormuz closure",
    ask: "How much of the Strait is blocked?",
    character: "India's main crude artery — supply physically cut",
  },
  {
    key: "redsea",
    title: "Red Sea suspension",
    ask: "How much Red Sea traffic is suspended?",
    character: "ships detour around Africa — slower and costlier, not lost",
  },
  {
    key: "opec",
    title: "OPEC+ emergency cut",
    ask: "How deep is the production cut?",
    character: "a price shock — no tanker is blocked",
  },
];

function ScenarioCard({
  spec,
  value,
  onChange,
}: {
  spec: CardSpec;
  value: number;
  onChange: (v: number) => void;
}) {
  const active = value > 0;
  return (
    <div
      // translucent so the panel's backdrop reads through; inactive cards
      // recede but stay legible (50% over a photo was too faint)
      className={`flex flex-col gap-2 rounded border bg-navy-deep/75 p-2 backdrop-blur-md transition-opacity ${
        active
          ? "border-secondary/50"
          : "border-white/15 opacity-75 hover:opacity-100 focus-within:opacity-100"
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="body-md text-ink">{spec.title}</span>
        <span className="micro-mono tabular-nums text-secondary">
          {Math.round(value * 100)}%
        </span>
      </div>
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={spec.ask}
      />
      <div className="micro-mono flex justify-between text-ink-3">
        <span>0%</span>
        <span>100%</span>
      </div>
      <p className="micro-mono text-ink-3">{spec.character}</p>
    </div>
  );
}

type ChartKey = "pump" | "gdp" | "run" | "grid";

/* ---------- run result ---------- */

type RunResult = {
  disruptions: Disruptions;
  ships: SimShip[];
  traj: ReturnType<typeof simulate>;
  fans: McResult | null;
  coupled?: ReturnType<typeof coupledShortfall>;
  mitigation?: Mitigation;
  reasoning?: string[];
};

function headline(res: RunResult): string {
  const f = res.fans;
  const gEnd = res.traj.gdp.reduce((a, b) => a + b, 0) / res.traj.gdp.length;
  if (f) {
    const lo = f.pump[89].p5 - BASE.pumpInrPerL;
    const hi = f.pump[89].p95 - BASE.pumpInrPerL;
    return `This raises petrol roughly ₹${Math.max(0, lo).toFixed(0)}–${hi.toFixed(0)}/L and cuts growth ~${Math.abs(gEnd).toFixed(1)} pp over 90 days.`;
  }
  const p = res.traj.fuel_price[89] - BASE.pumpInrPerL;
  return `This raises petrol ~₹${p.toFixed(0)}/L and cuts growth ~${Math.abs(gEnd).toFixed(1)} pp over 90 days.`;
}

async function exportPng(el: HTMLElement | null, name: string) {
  if (!el) return;
  const { toPng } = await import("html-to-image");
  const url = await toPng(el, { backgroundColor: "#0a0e17", pixelRatio: 2 });
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name}.png`;
  a.click();
}

/** `onReport` is the FinOcean sub-page hook: `mix` lives in this component's
 *  local state, so we hand the live {mix, disruptions, dirty} up to the parent
 *  which owns the sub-page header (Back / Load / discard guard). `dirty` = has
 *  anything changed since this sub-page opened. Absent prop = standalone. */
export default function SimDashboard({
  onReport,
  initialMix,
}: {
  onReport?: (s: {
    mix: Mix;
    disruptions: Disruptions;
    dirty: boolean;
  }) => void;
  /** reopening a loaded FinOcean card restores the committed mix instead of
   *  snapping back to the PPAC default */
  initialMix?: Record<string, number>;
} = {}) {
  const pi = useStore((s) => s.pi); // hormuz value (shared with map slider)
  const setPi = useStore((s) => s.setPi);
  const draft = useStore((s) => s.draft);
  const {
    setDraftDisruption, bumpPastSims,
  } = useStore.getState();

  const [result, setResult] = useState<RunResult | null>(null);
  // v7: the import-mix panel (right side of the coupled engine)
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [mix, setMix] = useState<Mix>({});
  const [mixCorrected, setMixCorrected] = useState(false);
  const [powerMW, setPowerMW] = useState<number | null>(null);
  useEffect(() => {
    fetch("/supplier_dependency.json")
      .then((r) => r.json())
      .then((dep) => {
        setSuppliers(dep.suppliers);
        setMix(initialMix ?? defaultMix(dep.suppliers));
      })
      .catch(() => {});
    exposedPowerMW().then(setPowerMW).catch(() => {});
  }, []);

  // FinOcean sub-page: report live state + dirtiness up to the parent header.
  // Snapshot the first populated state so "dirty" means "changed since opened".
  const snapRef = useRef<{ mix: string; disr: string } | null>(null);
  useEffect(() => {
    if (!onReport || Object.keys(mix).length === 0) return;
    const disr: Disruptions = { hormuz: pi, redsea: draft.redsea, opec: draft.opec };
    const mixKey = JSON.stringify(
      Object.entries(mix)
        .map(([k, v]) => [k, Math.round(v * 100)])
        .sort(),
    );
    const disrKey = JSON.stringify(disr);
    if (!snapRef.current) snapRef.current = { mix: mixKey, disr: disrKey };
    onReport({
      mix,
      disruptions: disr,
      dirty: snapRef.current.mix !== mixKey || snapRef.current.disr !== disrKey,
    });
  }, [mix, pi, draft.redsea, draft.opec, onReport]);

  // the hull is 100%: a supplier can only take what the others leave free.
  // Dragging past that clamps and says so, instead of silently overfilling.
  const [mixToast, setMixToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);
  const setShare = (id: string, v: number) => {
    const others = Object.entries(mix).reduce(
      (s, [k, val]) => (k === id ? s : s + val),
      0,
    );
    const headroom = Math.max(0, 1 - others);
    if (v > headroom + 1e-9) {
      setMixToast(
        `Import mix is capped at 100% — free up room by lowering another supplier first.`,
      );
      if (toastTimer.current) clearTimeout(toastTimer.current);
      toastTimer.current = setTimeout(() => setMixToast(null), 2800);
    }
    setMix((m) => ({ ...m, [id]: Math.min(v, headroom) }));
    setMixCorrected(false);
  };
  // ships + the RUN action moved to the FinOcean page; `running` is no longer
  // rendered here, but execute() still toggles it
  const [, setRunning] = useState(false);
  const [runName, setRunName] = useState("");
  const [saved, setSaved] = useState(false);
  const graphsRef = useRef<HTMLDivElement>(null);
  const workerRef = useRef<Worker | null>(null);
  // full-screen chart overlay (Esc closes)
  const [fullChart, setFullChart] = useState<ChartKey | null>(null);
  // M-DECK: stepped detail decks (modal — structurally one at a time)
  const [openDeck, setOpenDeck] = useState<"impact" | "mitigation" | null>(null);
  useEffect(() => {
    if (!fullChart) return;
    const onKey = (e: KeyboardEvent) =>
      e.key === "Escape" && setFullChart(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullChart]);

  const runIdRef = useRef(0);

  const toSavedRun = (res: RunResult, name: string): SavedRun => ({
    id: runIdRef.current,
    name,
    ts: new Date().toISOString(),
    disruptions: res.disruptions,
    ships: res.ships.map((s) => ({
      mmsi: s.props.mmsi,
      name: s.props.name,
      type: s.props.type,
      effect: s.effect,
    })),
    headline: headline(res),
    traj: {
      fuel: res.traj.fuel_price,
      gdp: res.traj.gdp,
      run: res.traj.run_rate,
      stress: res.traj.power_stress,
    },
    fanFuel: res.fans?.pump ?? [],
    fanGdp: res.fans?.gdp ?? [],
  });

  const autoName = (d: Disruptions) =>
    Object.entries(d)
      .filter(([, v]) => (v ?? 0) > 0)
      .map(([k, v]) => `${k} ${Math.round((v ?? 0) * 100)}%`)
      .join(" + ") || "baseline";

  const execute = (
    disruptions: Disruptions,
    shortfallBblPerDay: number[],
    ships: SimShip[],
    nameOverride?: string,
    physicalShortfallOverride?: number,
    extras?: (traj: ReturnType<typeof simulate>) => Partial<RunResult>,
    persist = true, // "Reset to actual (PPAC)" re-runs for the graphs but is
    // a baseline preview, not a scenario the user built — keep it out of Past Sims
  ) => {
    setRunning(true);
    setSaved(false);
    runIdRef.current = Date.now(); // one Past-Sims entry per run
    const input = { disruptions, shortfallBblPerDay, physicalShortfallOverride };
    const traj = simulate(input);
    const res: RunResult = {
      disruptions,
      ships,
      traj,
      fans: null,
      ...(extras ? extras(traj) : {}),
    };
    const name = () => nameOverride ?? (runName.trim() || autoName(disruptions));
    setResult(res);
    // every run is stored immediately; fans + custom name update it in place
    if (persist) {
      saveRun(toSavedRun(res, name()));
      bumpPastSims();
    }
    // MC fans off-thread; result + saved entry upgrade when they land
    workerRef.current?.terminate();
    const w = new Worker(new URL("../workers/mc.ts", import.meta.url), {
      type: "module",
    });
    w.onmessage = (e: MessageEvent<McResult>) => {
      setResult((r) => {
        const upgraded = r ? { ...r, fans: e.data } : r;
        if (upgraded && persist) {
          saveRun(toSavedRun(upgraded, name()));
          bumpPastSims();
        }
        return upgraded;
      });
      setRunning(false);
      w.terminate();
    };
    w.postMessage({ input, runs: 10_000 });
    workerRef.current = w;
  };

  // manual run (v7): shock panel × import-mix panel, COUPLED.
  // mixOverride lets "apply mitigation" re-run with the new mix at once
  // (setMix is async — state wouldn't be fresh yet).
  const run = (mixOverride?: Mix, persist = true) => {
    const disruptions = { hormuz: pi, redsea: draft.redsea, opec: draft.opec };
    if (suppliers.length === 0) {
      // mix data unavailable → legacy σ-share path still works
      execute(
        disruptions,
        aggregateShortfall(draft.ships),
        [...draft.ships],
        undefined,
        undefined,
        undefined,
        persist,
      );
      return;
    }
    const norm = normalizeMix(mixOverride ?? mix);
    if (norm.corrected) {
      setMix(norm.mix);
      setMixCorrected(true);
    }
    const coupled = coupledShortfall(suppliers, norm.mix, disruptions);
    const mitigation = optimizeMitigation(suppliers, norm.mix, disruptions);
    execute(
      disruptions,
      aggregateShortfall(draft.ships),
      [...draft.ships],
      undefined,
      coupled.shortfallBblPerDay,
      (traj) => ({
        coupled,
        mitigation,
        reasoning: runReasoning(disruptions, coupled, traj),
      }),
      persist,
    );
  };

  const save = () => {
    if (!result) return;
    saveRun(toSavedRun(result, runName.trim() || autoName(result.disruptions)));
    bumpPastSims();
    setSaved(true);
  };

  // the four result charts, one definition each — the grid panels and the
  // full-screen overlay render the SAME chart at different sizes
  const chartDefs = result
    ? [
        {
          key: "pump" as ChartKey,
          title: "PETROL PRICE (₹/L)",
          icon: "show_chart",
          iconColor: BLUE,
          hint: undefined as string | undefined,
          render: (w: number, h: number) =>
            result.fans ? (
              <FanChart
                title=""
                bands={result.fans.pump}
                color={BLUE}
                format={(v) => `₹${v.toFixed(1)}`}
                width={w}
                height={h}
              />
            ) : (
              <div className="flex h-full w-full animate-pulse items-center justify-center rounded bg-white/5"><span className="caption text-ink-3">running 10,000 futures…</span></div>
            ),
        },
        {
          key: "gdp" as ChartKey,
          title: "GDP GROWTH IMPULSE",
          icon: "trending_down",
          iconColor: RED,
          hint: undefined as string | undefined,
          render: (w: number, h: number) =>
            result.fans ? (
              <FanChart
                title=""
                bands={result.fans.gdp}
                color={RED}
                format={(v) => v.toFixed(2)}
                width={w}
                height={h}
              />
            ) : (
              <div className="flex h-full w-full animate-pulse items-center justify-center rounded bg-white/5"><span className="caption text-ink-3">running 10,000 futures…</span></div>
            ),
        },
        {
          key: "run" as ChartKey,
          title: "REFINERY UTILIZATION",
          icon: "factory",
          iconColor: AQUA,
          hint: undefined as string | undefined,
          render: (w: number, h: number) => (
            <TrajChart
              title=""
              series={[{ name: "run rate", color: AQUA, values: result.traj.run_rate.map((v) => v * 100) }]}
              format={(v) => `${v.toFixed(1)}%`}
              width={w}
              height={h}
            />
          ),
        },
        {
          key: "grid" as ChartKey,
          title: "GRID STRESS INDEX",
          icon: "bolt",
          iconColor: "#ffb956",
          hint: powerMW
            ? `MW of ${(powerMW / 1000).toFixed(1)} GW exposed`
            : undefined,
          render: (w: number, h: number) => (
            <TrajChart
              title=""
              series={[
                {
                  name: powerMW ? "MW at risk" : "power stress",
                  color: YELLOW,
                  values: result.traj.power_stress.map((v) =>
                    powerMW ? v * powerMW : v * 100,
                  ),
                },
              ]}
              format={(v) =>
                powerMW ? `${Math.round(v).toLocaleString()} MW` : `${v.toFixed(1)}%`
              }
              width={w}
              height={h}
            />
          ),
        },
      ]
    : [];

  // ---- M-DECK card builders: every number below is the run's own value,
  // broken into steps; no new math beyond descriptive stats of the traj ----
  const impactCards: DeckCard[] = result
    ? (() => {
        const settle = result.traj.fuel_price[89];
        const delta = settle - BASE.pumpInrPerL;
        const pct = (delta / BASE.pumpInrPerL) * 100;
        const diesel = 90.4 + delta;
        const dCrude = result.traj.crude[89] - 80;
        const bill = (dCrude * COEFF.india_imports_bbl_d.value * 90) / 1e9;
        const peak = Math.max(...result.traj.fuel_price);
        const peakDay = result.traj.fuel_price.indexOf(peak);
        const cliffDay = result.traj.run_rate.findIndex((v) => v < 0.98);
        return [
          {
            id: "headline",
            body: (
              <>
                <span className="label-caps text-ink-3">
                  1 · WHAT YOU'LL PAY
                </span>
                <span className="stat-lg tabular-nums text-ink">
                  ₹{settle.toFixed(1)}/L{" "}
                  <span className="headline-sm text-elevated">
                    ▲ {pct.toFixed(0)}%
                  </span>
                </span>
                <p className="body-md mt-auto text-ink-2">
                  A full tank costs about ₹{(delta * 35).toFixed(0)} more.
                </p>
              </>
            ),
          },
          {
            id: "fuels",
            body: (
              <>
                <span className="label-caps text-ink-3">
                  2 · PETROL VS DIESEL
                </span>
                <div className="flex gap-6">
                  <div>
                    <div className="micro-mono text-ink-3">PETROL</div>
                    <div className="data-lg text-ink">
                      ₹{BASE.pumpInrPerL} → ₹{settle.toFixed(1)}
                    </div>
                  </div>
                  <div>
                    <div className="micro-mono text-ink-3">DIESEL</div>
                    <div className="data-lg text-ink">
                      ₹90.4 → ₹{diesel.toFixed(1)}
                    </div>
                  </div>
                </div>
                <p className="body-md mt-auto text-ink-2">
                  Only about half the crude shock reaches the pump — the
                  government absorbs the rest.
                </p>
              </>
            ),
          },
          {
            id: "bill",
            body: (
              <>
                <span className="label-caps text-ink-3">
                  3 · THE EXTRA IMPORT BILL
                </span>
                <span className="stat-lg tabular-nums text-ink">
                  ≈ ${bill.toFixed(1)}bn{" "}
                  <span className="headline-sm text-critical-text">
                    over 90 days
                  </span>
                </span>
                <p className="body-md mt-auto text-ink-2">
                  Barrels × price rise × 90 days — a bill that pressures the
                  rupee and growth.
                </p>
              </>
            ),
          },
          {
            id: "path",
            body: (
              <>
                <span className="label-caps text-ink-3">4 · THE 90 DAYS</span>
                <span className="data-lg text-ink">
                  spike ₹{peak.toFixed(1)} (~day {peakDay}) → settle ₹
                  {settle.toFixed(1)}
                </span>
                <p className="body-md mt-auto text-ink-2">
                  Prices spike before barrels can reroute, then settle.{" "}
                  {cliffDay >= 0
                    ? `The reserve shields refiners until ~day ${cliffDay}.`
                    : "The reserve holds for all 90 days."}
                </p>
              </>
            ),
          },
        ];
      })()
    : [];

  const mitigationCards: DeckCard[] = result?.mitigation
    ? (() => {
        const m = result.mitigation;
        return [
          {
            id: "objective",
            body: (
              <>
                <span className="label-caps text-ink-3">1 · THE GOAL</span>
                <p className="headline-sm text-ink">
                  Re-route crude purchases to soften the 90-day hit.
                </p>
                <div className="flex flex-wrap gap-2">
                  {["capacity caps", "shares = 100%", "no sanctioned suppliers", "freight cost priced in"].map((c) => (
                    <span
                      key={c}
                      className="caption rounded-full border border-[#199e70]/40 bg-[#199e70]/10 px-2 py-0.5 text-[#a3e5c9]"
                    >
                      {c}
                    </span>
                  ))}
                </div>
                <p className="caption mt-auto text-ink-3">
                  {m.objective} · greedy search under cited caps — not a
                  global optimum
                </p>
              </>
            ),
          },
          {
            id: "shortfall",
            body: (
              <>
                <span className="label-caps text-ink-3">
                  2 · WHAT IT SAVES
                </span>
                <span className="stat-lg tabular-nums text-ink">
                  {(m.before / 1000).toFixed(0)}k →{" "}
                  <span className="text-[#199e70]">
                    {(m.after / 1000).toFixed(0)}k
                  </span>{" "}
                  <span className="headline-sm text-ink-2">bbl/day</span>
                </span>
                <p className="body-md mt-auto text-ink-2">
                  Re-sourcing recovers{" "}
                  {((m.before - m.after) / 1000).toFixed(0)}k bbl/day — the
                  rest is capped out.
                </p>
              </>
            ),
          },
          {
            id: "moves",
            body: (
              <>
                <span className="label-caps text-ink-3">
                  3 · THE MOVES, ONE BY ONE
                </span>
                {m.moves.length > 0 ? (
                  <ul className="body-md flex flex-col gap-2 text-ink-2">
                    {m.moves.map((mv, i) => (
                      <li
                        key={i}
                        title="receiver has spare capacity on an unaffected corridor"
                        className="flex items-center justify-between rounded border border-hairline bg-navy-deep px-3 py-2"
                      >
                        <span>
                          {mv.from.split(" (")[0]} →{" "}
                          <span className="text-[#199e70]">
                            {mv.to.split(" (")[0]}
                          </span>
                        </span>
                        <span className="micro-mono text-ink">
                          {(mv.share * 100).toFixed(1)}%
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="body-md text-ink-2">
                    No move helps — every alternative is capped or exposed to
                    the same corridors.
                  </p>
                )}
              </>
            ),
          },
          {
            id: "residual",
            body: (
              <>
                <span className="label-caps text-ink-3">
                  4 · WHAT REMAINS
                </span>
                <span className="data-lg text-ink">
                  {(m.after / 1000).toFixed(0)}k bbl/day
                </span>
                <p className="body-md text-ink-2">
                  The reserve and lower demand absorb this — it's already in
                  the charts.
                </p>
                {m.moves.length > 0 && (
                  <button
                    onClick={() => {
                      setMix(m.newMix);
                      setMixCorrected(false);
                      setOpenDeck(null);
                      run(m.newMix); // auto re-run with the applied mix
                    }}
                    className="label-caps mt-auto w-full rounded border border-[#199e70]/50 py-2 text-[#199e70] transition-colors hover:bg-[#199e70]/10"
                  >
                    APPLY TO SCENARIO → RE-RUN TO COMPARE
                  </button>
                )}
              </>
            ),
          },
        ];
      })()
    : [];

  return (
    // transparent: the FinOcean sub-page wrapper paints the chart backdrop
    <div className="h-full overflow-y-auto p-6">
      {/* import-mix cap warning (transient) */}
      {mixToast && (
        <div
          role="status"
          className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-lg border border-critical bg-error-deep px-4 py-2 shadow-2xl"
        >
          <span className="body-md flex items-center gap-2 text-ink">
            <span className="material-symbols-outlined text-[16px]">error</span>
            {mixToast}
          </span>
        </div>
      )}
      <div className="mx-auto flex max-w-[1200px] flex-col gap-4">
        <PageIntro
          page="dashboard"
          intro="Set the macro shock and India's import mix, then Load them into the run."
          hint="Open a scenario card and drag its slider (several can be active at once), set the supplier shares, then press Load. Ships are configured on the Ship Simulator card; Run lives on the FinOcean page."
        />

        {/* controls row: THE SHOCK (4) × INDIA'S SUPPLY MIX (8) */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-12">
          {/* THE SHOCK — satellite India as backdrop. This asset is already
              dark, so it takes a much lighter scrim than the flag; the glowing
              coastline stays visible behind the scenario cards. */}
          <section className="group relative flex flex-col overflow-hidden rounded-lg border border-hairline md:col-span-5 lg:col-span-4">
            <img
              src="/india-satellite.png"
              alt=""
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 h-full w-full object-cover brightness-[1.35] saturate-[1.3] transition-all duration-300 group-hover:scale-105 group-hover:blur-[4px] motion-reduce:transform-none motion-reduce:transition-none"
            />
            <div className="pointer-events-none absolute inset-0 bg-navy-deep/45 transition-colors duration-300 group-hover:bg-navy-deep/35" />
            <header className="relative flex items-center justify-between border-b border-hairline/60 bg-navy-deep/70 px-4 py-2 backdrop-blur-md">
              <h2 className="label-caps flex items-center gap-2 text-ink">
                <span className="h-2 w-2 rounded-full bg-elevated" />
                THE SHOCK
              </h2>
            </header>
            <div className="relative flex flex-1 flex-col gap-4 p-4">
              <ScenarioCard spec={CARDS[0]} value={pi} onChange={(v) => setPi(v)} />
              <ScenarioCard
                spec={CARDS[1]}
                value={draft.redsea}
                onChange={(v) => setDraftDisruption("redsea", v)}
              />
              <ScenarioCard
                spec={CARDS[2]}
                value={draft.opec}
                onChange={(v) => setDraftDisruption("opec", v)}
              />
            </div>
          </section>
          {/* India's supply mix — the flag is the panel's backdrop; supplier
              tiles float over it as translucent glass. `group` drives the
              hover blur on the image only (never on the copy above it). */}
          <section className="group relative flex flex-col overflow-hidden rounded-lg border border-hairline md:col-span-7 lg:col-span-8">
            <img
              src="/india-flag.jpg"
              alt=""
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 h-full w-full object-cover brightness-125 saturate-150 transition-all duration-300 group-hover:blur-[4px] group-hover:scale-105 motion-reduce:transform-none motion-reduce:transition-none"
            />
            {/* Light scrim only — the supplier tiles carry their own dark glass
                backing, so the flag can stay vivid without eating the copy. */}
            <div className="pointer-events-none absolute inset-0 bg-navy-deep/45 transition-colors duration-300 group-hover:bg-navy-deep/35" />
            <header className="relative flex items-center justify-between border-b border-hairline/60 bg-navy-deep/70 px-4 py-2 backdrop-blur-md">
              <h2 className="label-caps text-ink">
                INDIA'S SUPPLY MIX
              </h2>
            </header>
            <div className="relative grid grid-cols-1 gap-x-6 gap-y-3 p-4 md:grid-cols-2">
              {suppliers.map((s, i) => (
                <label
                  key={s.id}
                  className="flex items-center gap-3 rounded-lg border border-white/20 bg-navy-deep/80 p-2 backdrop-blur-md transition-colors hover:border-secondary/60 focus-within:border-secondary"
                >
                  <span
                    className="material-symbols-outlined shrink-0 text-[24px]"
                    style={{ color: supplierColor(i) }}
                    aria-hidden="true"
                  >
                    local_gas_station
                  </span>
                  <span className="body-md min-w-0 flex-1 truncate text-ink">
                    {s.name}
                  </span>
                  <span className="flex shrink-0 items-center gap-1">
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step={1}
                      value={Math.round((mix[s.id] ?? 0) * 100)}
                      onChange={(e) => setShare(s.id, Number(e.target.value) / 100)}
                      aria-label={`Import share from ${s.name}`}
                      className="data-lg w-16 rounded border border-white/20 bg-navy-deep/80 px-2 py-1 text-right text-ink focus:border-secondary focus:outline-none"
                    />
                    <span className="micro-mono text-ink-3">%</span>
                  </span>
                </label>
              ))}

              {/* allocation counter — reads to 100 with a fill bar */}
              {(() => {
                const total = Math.round(
                  Object.values(mix).reduce((a, b) => a + b, 0) * 100,
                );
                const exact = total === 100;
                const tone = exact
                  ? "text-good-text"
                  : total > 100
                    ? "text-critical"
                    : "text-elevated";
                return (
                  <div className="flex flex-col gap-1.5 rounded-lg border border-white/20 bg-navy-deep/80 p-3 backdrop-blur-md md:col-span-2">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="label-caps text-ink-2">
                        TOTAL ALLOCATED
                      </span>
                      <span className={`font-mono text-[28px] font-bold leading-none tabular-nums ${tone}`}>
                        {total}
                        <span className="text-[15px] font-medium text-ink-3">
                          /100%
                        </span>
                      </span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                      <div
                        className={`h-full rounded-full transition-all duration-300 ${
                          exact
                            ? "bg-good"
                            : total > 100
                              ? "bg-critical"
                              : "bg-secondary"
                        }`}
                        style={{ width: `${Math.min(100, total)}%` }}
                      />
                    </div>
                    {mixCorrected && (
                      <span className="caption text-ink-3">
                        auto-normalized to 100% on run
                      </span>
                    )}
                  </div>
                );
              })()}
            </div>
          </section>
        </div>

        {result && (
          <>
            {/* simulation results strip */}
            <section className="flex items-start gap-4 rounded-lg border border-[#ad7559]/30 bg-[#300f00] p-4">
              <span className="material-symbols-outlined mt-1 text-elevated">
                warning
              </span>
              <div>
                <h3 className="headline-lg mb-1 text-[#ffddb5]">
                  Projected impact — {autoName(result.disruptions)}
                </h3>
                <p className="body-md text-[#f9b898]">
                  {headline(result)}
                </p>
              </div>
            </section>

            {/* charts grid */}
            <div ref={graphsRef} className="flex flex-col gap-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {chartDefs.map((c) => (
                  <div
                    key={c.key}
                    className="flex h-80 flex-col rounded-lg border border-hairline bg-panel p-3"
                  >
                    <header className="mb-2 flex items-center justify-between">
                      <span className="headline-sm text-ink" title={c.hint}>
                        {c.title}
                      </span>
                      <span className="flex items-center gap-2">
                        <span
                          className="material-symbols-outlined text-[16px]"
                          style={{ color: c.iconColor }}
                        >
                          {c.icon}
                        </span>
                        <button
                          onClick={() => setFullChart(c.key)}
                          aria-label={`View ${c.title} full screen`}
                          title="Full screen"
                          className="material-symbols-outlined rounded text-[18px] text-ink-3 transition-colors hover:text-ink"
                        >
                          fullscreen
                        </button>
                      </span>
                    </header>
                    <div className="relative flex flex-1 items-center justify-center overflow-hidden rounded bg-navy-deep p-1">
                      {c.render(520, 240)}
                    </div>
                  </div>
                ))}
              </div>
              {result.fans && (
                <p className="body-md text-ink-2">
                  Shaded bands = the middle 50% and 90% of 10,000 simulated
                  futures; the line is the median.
                </p>
              )}

              {/* lower section grid: summary (4) · mitigation (4) · analogs (4) */}
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3 lg:grid-cols-12">
                <section className="flex flex-col justify-between gap-6 rounded-lg border border-hairline bg-panel p-4 lg:col-span-4">
                  <h2 className="label-caps flex items-center gap-2 text-ink-3">
                    <span className="material-symbols-outlined text-[18px] text-secondary">
                      payments
                    </span>
                    ECONOMIC IMPACT SUMMARY
                  </h2>
                  <button
                    onClick={() => setOpenDeck("impact")}
                    className="label-caps flex w-full items-center justify-center gap-1 rounded border border-secondary/50 py-2 text-secondary transition-colors hover:bg-gold-wash"
                  >
                    Click here
                    <span className="material-symbols-outlined text-[14px]">
                      arrow_forward
                    </span>
                  </button>
                </section>

                {/* v7: constrained optimal mitigation — detail lives in the deck */}
                {result.mitigation && (
                  <section className="flex flex-col lg:col-span-4">
                    <div className="flex flex-1 flex-col justify-between gap-6 rounded-lg border border-[#199e70]/30 bg-[#0f1f18] p-4">
                      <h2
                        className="label-caps flex items-center gap-2 text-[#199e70]"
                        title="greedy search under cited caps — not a global optimum"
                      >
                        <span className="material-symbols-outlined text-[18px] text-[#199e70]">
                          security
                        </span>
                        SUGGESTED MITIGATION
                      </h2>
                      <button
                        onClick={() => setOpenDeck("mitigation")}
                        className="label-caps flex w-full items-center justify-center gap-1 rounded border border-secondary/50 py-2 text-secondary transition-colors hover:bg-gold-wash"
                      >
                        Click here
                        <span className="material-symbols-outlined text-[14px]">
                          arrow_forward
                        </span>
                      </button>
                    </div>
                  </section>
                )}

                <section
                  className={`flex flex-col lg:col-span-4 ${result.mitigation ? "" : "lg:col-start-9"}`}
                >
                  <HistoricalContext
                    disruptions={result.disruptions}
                    traj={result.traj}
                  />
                </section>
              </div>

              {/* per-refinery: Gulf-fed cut harder — mapped, tags = run rate */}
              {result.coupled &&
                (() => {
                  const rows = perRefineryRunRate(
                    1 - Math.min(...result.traj.run_rate),
                  );
                  return (
                    <section className="rounded-lg border border-hairline bg-panel">
                      <h2 className="label-caps border-b border-hairline px-4 py-2 text-ink-3">
                        PER-REFINERY RUN RATE
                      </h2>
                      <div className="flex flex-col gap-4 p-4">
                        <RefineryMap rows={rows} />
                        <div className="grid gap-x-6 gap-y-1 md:grid-cols-2">
                          {rows.map((r) => (
                            <div
                              key={r.name}
                              className="body-md flex justify-between rounded border border-hairline bg-navy-deep px-2 py-1"
                            >
                              <span className="text-ink-2">
                                {r.name}{" "}
                                <span className="micro-mono text-ink-3">
                                  ({r.port})
                                </span>
                              </span>
                              <span
                                className={`micro-mono self-center tabular-nums ${r.runRate < 0.9 ? "text-elevated" : "text-ink"}`}
                              >
                                {(r.runRate * 100).toFixed(0)}%
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </section>
                  );
                })()}
            </div>

            {/* v7: plain-language reasoning — why these numbers */}
            {result.reasoning && (
              <section className="rounded-lg border border-hairline bg-panel">
                <h2 className="label-caps border-b border-hairline px-4 py-2 text-ink-3">
                  WHY THESE NUMBERS
                </h2>
                <ul className="flex flex-col gap-2 p-4">
                  {result.reasoning.map((line, i) => (
                    <li key={i} className="body-md leading-relaxed text-ink-2">
                      {line}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* footer actions */}
            <footer className="flex flex-col items-start justify-between gap-2 border-t border-hairline py-2 md:flex-row md:items-center">
              <div className="micro-mono text-ink-3">
                every run is saved to Past Simulations automatically | Ensembles: 10,000
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  value={runName}
                  onChange={(e) => setRunName(e.target.value)}
                  placeholder="Name this run…"
                  aria-label="Run name"
                  className="body-md h-8 rounded border border-hairline bg-navy-deep px-2 py-1 text-ink placeholder:text-ink-3 focus:border-secondary focus:outline-none"
                />
                <button
                  onClick={save}
                  className="label-caps flex items-center gap-1 rounded border border-hairline px-4 py-1.5 text-ink-3 transition-colors hover:border-secondary hover:text-ink"
                >
                  <span className="material-symbols-outlined text-[14px]">
                    save
                  </span>
                  {saved ? "✓ SAVED" : "SAVE NAME"}
                </button>
                <button
                  onClick={() => exportPng(graphsRef.current, runName.trim() || "mr-vessel-run")}
                  className="label-caps flex items-center gap-1 rounded border border-hairline px-4 py-1.5 text-ink-3 transition-colors hover:border-secondary hover:text-ink"
                >
                  <span className="material-symbols-outlined text-[14px]">
                    download
                  </span>
                  EXPORT PNG
                </button>
              </div>
            </footer>

            {/* full-screen chart overlay */}
            {fullChart &&
              (() => {
                const c = chartDefs.find((x) => x.key === fullChart);
                if (!c) return null;
                const fw = Math.min(1240, window.innerWidth - 120);
                const fh = Math.min(560, window.innerHeight - 240);
                return (
                  <div
                    role="dialog"
                    aria-modal="true"
                    aria-label={`${c.title} — full screen`}
                    onClick={() => setFullChart(null)}
                    className="fixed inset-0 z-50 flex items-center justify-center bg-navy-deep/80 p-8 backdrop-blur-sm"
                  >
                    <div
                      onClick={(e) => e.stopPropagation()}
                      className="flex max-h-full max-w-full flex-col gap-3 rounded-lg border border-hairline bg-panel p-4 shadow-2xl"
                    >
                      <header className="flex items-center justify-between gap-6">
                        <span className="headline-sm text-ink" title={c.hint}>
                          {c.title}
                        </span>
                        <button
                          onClick={() => setFullChart(null)}
                          aria-label="Close full screen"
                          title="Close (Esc)"
                          className="material-symbols-outlined rounded text-[22px] text-ink-3 transition-colors hover:text-ink"
                        >
                          close_fullscreen
                        </button>
                      </header>
                      <div className="overflow-auto rounded bg-navy-deep p-3">
                        {c.render(fw, fh)}
                      </div>
                      <p className="caption text-ink-3">
                        Esc or click outside to close
                      </p>
                    </div>
                  </div>
                );
              })()}

            {/* M-DECK: stepped detail decks */}
            {openDeck === "impact" && (
              <CardDeck
                title="Economic impact — step by step"
                cards={impactCards}
                onClose={() => setOpenDeck(null)}
              />
            )}
            {openDeck === "mitigation" && result.mitigation && (
              <CardDeck
                title="Suggested mitigation — step by step"
                cards={mitigationCards}
                onClose={() => setOpenDeck(null)}
              />
            )}
          </>
        )}

        <ValidationPanel />
      </div>
    </div>
  );
}
