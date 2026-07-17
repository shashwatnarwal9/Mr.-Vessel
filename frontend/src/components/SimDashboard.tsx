import { useEffect, useMemo, useRef, useState } from "react";
import { useStore, type ShipEffect, type SimShip } from "../store";
import { aggregateShortfall, shipShortfall } from "../lib/impact";
import { simulate, type Disruptions } from "../lib/simulate";
import type { McResult } from "../lib/montecarlo";
import { BASE } from "../lib/cascade";
import { classifyShip, estimateCargoBbl } from "../lib/ships";
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
import PageIntro from "./PageIntro";
import ValidationPanel from "./ValidationPanel";
import HistoricalContext from "./HistoricalContext";
import Why from "./Why";

const BLUE = "#3987e5";
const RED = "#e66767";
const AQUA = "#199e70";
const YELLOW = "#c98500";

const EFFECT_LABEL: Record<string, string> = {
  sanction: "sanction — cargo never arrives",
  closure: "chokepoint closed on its route",
  reroute: "reroute the long way",
  delay: "hold it up by N days",
};

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
      className={`flex flex-col gap-2 rounded border bg-navy-deep p-2 transition-opacity ${
        active
          ? "border-secondary/40"
          : "border-hairline opacity-50 hover:opacity-100 focus-within:opacity-100"
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

export default function SimDashboard() {
  const pi = useStore((s) => s.pi); // hormuz value (shared with map slider)
  const setPi = useStore((s) => s.setPi);
  const draft = useStore((s) => s.draft);
  const ships = useStore((s) => s.ships);
  const {
    setDraftDisruption, addDraftShip, removeDraftShip,
    setDraftShipEffect, bumpPastSims,
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
        setMix(defaultMix(dep.suppliers));
      })
      .catch(() => {});
    exposedPowerMW().then(setPowerMW).catch(() => {});
  }, []);

  const setShare = (id: string, v: number) => {
    setMix((m) => ({ ...m, [id]: v }));
    setMixCorrected(false);
  };
  const [running, setRunning] = useState(false);
  const [runName, setRunName] = useState("");
  const [saved, setSaved] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const graphsRef = useRef<HTMLDivElement>(null);
  const workerRef = useRef<Worker | null>(null);

  const candidates = useMemo(
    () =>
      (ships?.features ?? [])
        .filter((f) => {
          const cls = classifyShip(f.properties, f.geometry.coordinates);
          return cls !== "transit" && estimateCargoBbl(f.properties.type) > 0;
        })
        .filter((f) => !draft.ships.some((s) => s.props.mmsi === f.properties.mmsi))
        .slice(0, 20),
    [ships, draft.ships],
  );

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
    saveRun(toSavedRun(res, name()));
    bumpPastSims();
    // MC fans off-thread; result + saved entry upgrade when they land
    workerRef.current?.terminate();
    const w = new Worker(new URL("../workers/mc.ts", import.meta.url), {
      type: "module",
    });
    w.onmessage = (e: MessageEvent<McResult>) => {
      setResult((r) => {
        const upgraded = r ? { ...r, fans: e.data } : r;
        if (upgraded) {
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

  // manual run (v7): shock panel × import-mix panel, COUPLED
  const run = () => {
    const disruptions = { hormuz: pi, redsea: draft.redsea, opec: draft.opec };
    if (suppliers.length === 0) {
      // mix data unavailable → legacy σ-share path still works
      execute(disruptions, aggregateShortfall(draft.ships), [...draft.ships]);
      return;
    }
    const norm = normalizeMix(mix);
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
    );
  };

  const save = () => {
    if (!result) return;
    saveRun(toSavedRun(result, runName.trim() || autoName(result.disruptions)));
    bumpPastSims();
    setSaved(true);
  };

  return (
    <div className="h-full overflow-y-auto bg-dim p-6">
      <div className="mx-auto flex max-w-[1200px] flex-col gap-4">
        <PageIntro
          page="dashboard"
          intro="Build a what-if: choose disruptions, pick ships to affect, and see what happens to India's petrol price and economy over 90 days."
          hint="Open a scenario card and drag its slider (several can be active at once), optionally add ships below, then press Run simulation. Save keeps the run in Past Simulations."
        />

        {/* controls row: THE SHOCK (4) × INDIA'S SUPPLY MIX (8) */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          <section className="flex flex-col rounded-lg border border-hairline bg-panel lg:col-span-4">
            <header className="flex items-center justify-between border-b border-hairline px-4 py-2">
              <h2 className="label-caps flex items-center gap-2 text-ink-3">
                <span className="h-2 w-2 rounded-full bg-elevated" />
                THE SHOCK
              </h2>
            </header>
            <div className="flex flex-1 flex-col gap-4 p-4">
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
          <section className="flex flex-col rounded-lg border border-hairline bg-panel lg:col-span-8">
            <header className="flex items-center justify-between border-b border-hairline px-4 py-2">
              <h2 className="label-caps text-ink-3">
                INDIA'S SUPPLY MIX
                <Why
                  formula="shortfall is computed JOINTLY: at_risk = share × Σ corridor-exposure × disruption; lost = at_risk × (1 − reroutable). The mix decides how much a closure actually bites."
                  sources={["india_imports_bbl_d"]}
                />
              </h2>
              <button
                onClick={() => setMix(defaultMix(suppliers))}
                className="label-caps flex items-center gap-1 text-secondary transition-colors hover:text-gold-hover"
              >
                <span className="material-symbols-outlined text-[14px]">
                  restart_alt
                </span>
                RESET TO ACTUAL (PPAC)
              </button>
            </header>
            <div className="grid grid-cols-1 gap-x-6 gap-y-4 p-4 md:grid-cols-2">
              {suppliers.map((s) => (
                <label key={s.id} className="flex flex-col gap-1">
                  <span className="flex items-end justify-between">
                    <span className="body-md text-ink">{s.name}</span>
                    <span className="micro-mono tabular-nums text-ink">
                      {Math.round((mix[s.id] ?? 0) * 100)}%
                    </span>
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={0.6}
                    step={0.01}
                    value={mix[s.id] ?? 0}
                    onChange={(e) => setShare(s.id, Number(e.target.value))}
                    aria-label={`Import share from ${s.name}`}
                  />
                </label>
              ))}
              <div className="flex items-center justify-between md:col-span-2">
                <span
                  className={`micro-mono ${
                    Math.abs(
                      Object.values(mix).reduce((a, b) => a + b, 0) - 1,
                    ) > 0.01
                      ? "text-elevated"
                      : "text-ink-3"
                  }`}
                >
                  total {Math.round(Object.values(mix).reduce((a, b) => a + b, 0) * 100)}%
                  {mixCorrected && " · auto-normalized to 100% on run"}
                </span>
              </div>
            </div>
          </section>
        </div>

        {/* affected ships (8) × run action (4) */}
        <div className="grid grid-cols-1 items-center gap-4 lg:grid-cols-12">
          <section className="rounded-lg border border-hairline bg-panel lg:col-span-8">
            <div className="flex items-center justify-between border-b border-hairline px-4 py-2">
              <h2
                className="label-caps text-ink-3"
                title="only India-bound crude changes India's numbers"
              >
                AFFECTED SHIPS IN TRANSIT
              </h2>
              <div className="flex items-center gap-2">
                {draft.ships.length > 0 && (
                  <span className="micro-mono rounded bg-elevated/20 px-2 py-0.5 tabular-nums text-elevated">
                    {draft.ships.length} ACTIVE
                  </span>
                )}
                <div className="relative">
                  <button
                    onClick={() => setPickerOpen((o) => !o)}
                    className="label-caps flex items-center gap-1 rounded border border-hairline px-2 py-1 text-ink-3 transition-colors hover:border-secondary hover:text-ink"
                  >
                    <span className="material-symbols-outlined text-[14px]">
                      add
                    </span>
                    Add ship
                  </button>
                  {pickerOpen && (
                    <ul className="absolute right-0 top-full z-30 mt-1 max-h-64 w-72 overflow-y-auto rounded border border-hairline bg-navy-deep shadow-2xl">
                      {candidates.length === 0 && (
                        <li className="micro-mono px-3 py-2 text-ink-3">
                          no eligible tankers
                        </li>
                      )}
                      {candidates.map((f) => (
                        <li key={f.properties.mmsi}>
                          <button
                            onClick={() => {
                              addDraftShip({
                                ...f.properties,
                                lon: f.geometry.coordinates[0],
                                lat: f.geometry.coordinates[1],
                              });
                              setPickerOpen(false);
                            }}
                            className="flex w-full flex-col px-3 py-1.5 text-left transition-colors hover:bg-gold-wash"
                          >
                            <span className="body-md text-ink">
                              {f.properties.name}
                            </span>
                            <span className="micro-mono text-ink-3">
                              {f.properties.type} → {f.properties.dest}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </div>
            {draft.ships.length === 0 ? (
              <p className="body-md p-4 text-ink-3">
                None yet — click a tanker on the Command Map and press ▶ Start
                Simulation, or add one here.
              </p>
            ) : (
              <table className="w-full text-left">
                <thead className="micro-mono border-b border-hairline bg-navy-deep text-ink-3">
                  <tr>
                    <th className="px-4 py-1 font-normal">VESSEL</th>
                    <th className="px-4 py-1 font-normal">EFFECT</th>
                    <th className="px-4 py-1 text-right font-normal">IMPACT</th>
                    <th className="w-8 px-2 py-1" />
                  </tr>
                </thead>
                <tbody className="body-md">
                  {draft.ships.map((sh) => (
                    <tr
                      key={sh.props.mmsi}
                      className="border-b border-hairline transition-colors last:border-b-0 hover:bg-gold-wash"
                    >
                      <td className="px-4 py-2">
                        <span className="flex items-center gap-2">
                          <span className="material-symbols-outlined text-[16px] text-ink-3">
                            directions_boat
                          </span>
                          <span className="flex flex-col">
                            <span className="text-ink">{sh.props.name}</span>
                            <span className="micro-mono text-ink-3">
                              {sh.props.type} → {sh.props.dest}
                            </span>
                          </span>
                        </span>
                      </td>
                      <td className="px-4 py-2">
                        <span className="flex flex-wrap items-center gap-1">
                          <select
                            value={sh.effect.kind}
                            onChange={(e) =>
                              setDraftShipEffect(sh.props.mmsi, {
                                kind: e.target.value as ShipEffect["kind"],
                                chokepoint: sh.effect.chokepoint ?? "hormuz",
                                delayDays: sh.effect.delayDays ?? 7,
                              })
                            }
                            aria-label="Effect type"
                            className="micro-mono rounded border border-hairline bg-navy-deep px-1.5 py-0.5 text-ink-2 focus:border-secondary focus:outline-none"
                          >
                            {Object.entries(EFFECT_LABEL).map(([k, v]) => (
                              <option key={k} value={k}>
                                {v}
                              </option>
                            ))}
                          </select>
                          {(sh.effect.kind === "closure" ||
                            sh.effect.kind === "reroute") && (
                            <select
                              value={sh.effect.chokepoint ?? "hormuz"}
                              onChange={(e) =>
                                setDraftShipEffect(sh.props.mmsi, {
                                  ...sh.effect,
                                  chokepoint: e.target.value as "hormuz" | "redsea",
                                })
                              }
                              aria-label="Chokepoint"
                              className="micro-mono rounded border border-hairline bg-navy-deep px-1.5 py-0.5 text-ink-2 focus:border-secondary focus:outline-none"
                            >
                              <option value="hormuz">Hormuz</option>
                              <option value="redsea">Red Sea</option>
                            </select>
                          )}
                          {sh.effect.kind === "delay" && (
                            <label className="micro-mono text-ink-3">
                              <input
                                type="number"
                                min={1}
                                max={60}
                                value={sh.effect.delayDays ?? 7}
                                onChange={(e) =>
                                  setDraftShipEffect(sh.props.mmsi, {
                                    ...sh.effect,
                                    delayDays: Number(e.target.value),
                                  })
                                }
                                className="micro-mono w-12 rounded border border-hairline bg-navy-deep px-1 py-0.5 text-ink-2 focus:border-secondary focus:outline-none"
                              />{" "}
                              d
                            </label>
                          )}
                        </span>
                      </td>
                      <td className="micro-mono px-4 py-2 text-right tabular-nums">
                        {(() => {
                          const t = shipShortfall(sh).reduce((a, b) => a + b, 0);
                          return t > 0 ? (
                            <span className="text-elevated">
                              −{(t / 1e6).toFixed(2)}M bbl
                            </span>
                          ) : (
                            <span className="text-ink-3">no India impact</span>
                          );
                        })()}
                      </td>
                      <td className="px-2 py-2 text-right">
                        <button
                          onClick={() => removeDraftShip(sh.props.mmsi)}
                          aria-label={`Remove ${sh.props.name}`}
                          className="px-1 text-ink-3 hover:text-ink"
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
          <div className="flex h-full flex-col justify-end lg:col-span-4">
            <button
              onClick={run}
              disabled={running}
              className="headline-sm flex h-16 w-full items-center justify-center gap-2 rounded-lg bg-secondary text-navy shadow-[0_0_15px_rgba(255,185,86,0.3)] transition-all hover:bg-gold-hover focus:ring-2 focus:ring-secondary focus:ring-offset-2 focus:ring-offset-dim disabled:opacity-50"
            >
              <span className="material-symbols-outlined">play_arrow</span>
              {running ? "Running 10,000 futures…" : "Run Simulation"}
            </button>
          </div>
        </div>

        {result && (
          <>
            {/* simulation results strip */}
            <section className="flex items-start gap-4 rounded-lg border border-[#ad7559]/30 bg-[#300f00] p-4">
              <span className="material-symbols-outlined mt-1 text-elevated">
                warning
              </span>
              <div>
                <h3 className="headline-sm mb-1 text-[#ffddb5]">
                  Projected impact — {autoName(result.disruptions)}
                </h3>
                <p className="body-md text-[#f9b898]">
                  {headline(result)}
                  <Why
                    formula="range = 5th–95th percentile of 10,000 Monte Carlo futures at day 90; growth = 90-day mean drag"
                    sources={["pass_through_inr_per_usd_bbl", "policy_pass_through", "gdp_pp_per_10usd"]}
                  />
                </p>
              </div>
            </section>

            {/* charts grid */}
            <div ref={graphsRef} className="flex flex-col gap-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
                <div className="flex h-48 flex-col rounded-lg border border-hairline bg-panel p-2">
                  <header className="mb-2 flex items-center justify-between">
                    <span className="label-caps text-ink-3">
                      PETROL PRICE (₹/L)
                    </span>
                    <span
                      className="material-symbols-outlined text-[14px]"
                      style={{ color: BLUE }}
                    >
                      show_chart
                    </span>
                  </header>
                  <div className="relative flex flex-1 items-center justify-center overflow-hidden rounded bg-navy-deep p-1">
                    {result.fans ? (
                      <FanChart
                        title=""
                        bands={result.fans.pump}
                        color={BLUE}
                        format={(v) => `₹${v.toFixed(1)}`}
                        width={250}
                        height={140}
                      />
                    ) : (
                      <div className="h-full w-full animate-pulse rounded bg-white/5" />
                    )}
                  </div>
                </div>
                <div className="flex h-48 flex-col rounded-lg border border-hairline bg-panel p-2">
                  <header className="mb-2 flex items-center justify-between">
                    <span className="label-caps text-ink-3">
                      GDP GROWTH IMPULSE
                    </span>
                    <span
                      className="material-symbols-outlined text-[14px]"
                      style={{ color: RED }}
                    >
                      trending_down
                    </span>
                  </header>
                  <div className="relative flex flex-1 items-center justify-center overflow-hidden rounded bg-navy-deep p-1">
                    {result.fans ? (
                      <FanChart
                        title=""
                        bands={result.fans.gdp}
                        color={RED}
                        format={(v) => v.toFixed(2)}
                        width={250}
                        height={140}
                      />
                    ) : (
                      <div className="h-full w-full animate-pulse rounded bg-white/5" />
                    )}
                  </div>
                </div>
                <div className="flex h-48 flex-col rounded-lg border border-hairline bg-panel p-2">
                  <header className="mb-2 flex items-center justify-between">
                    <span className="label-caps text-ink-3">
                      REFINERY UTILIZATION
                    </span>
                    <span
                      className="material-symbols-outlined text-[14px]"
                      style={{ color: AQUA }}
                    >
                      factory
                    </span>
                  </header>
                  <div className="relative flex flex-1 items-center justify-center overflow-hidden rounded bg-navy-deep p-1">
                    <TrajChart
                      title=""
                      series={[{ name: "run rate", color: AQUA, values: result.traj.run_rate.map((v) => v * 100) }]}
                      format={(v) => `${v.toFixed(1)}%`}
                      width={250}
                      height={140}
                    />
                  </div>
                </div>
                <div className="flex h-48 flex-col rounded-lg border border-hairline bg-panel p-2">
                  <header className="mb-2 flex items-center justify-between">
                    <span
                      className="label-caps text-ink-3"
                      title={
                        powerMW
                          ? `MW of ${(powerMW / 1000).toFixed(1)} GW exposed`
                          : undefined
                      }
                    >
                      GRID STRESS INDEX
                    </span>
                    <span className="material-symbols-outlined text-[14px] text-secondary">
                      bolt
                    </span>
                  </header>
                  <div className="relative flex flex-1 items-center justify-center overflow-hidden rounded bg-navy-deep p-1">
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
                      width={250}
                      height={140}
                    />
                  </div>
                </div>
              </div>
              {result.fans && (
                <p className="micro-mono text-ink-3">
                  Shaded bands = the middle 50% and 90% of 10,000 simulated
                  futures; the line is the median.
                </p>
              )}

              {/* lower section grid: summary (4) · mitigation (4) · analogs (4) */}
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
                <section className="flex flex-col rounded-lg border border-hairline bg-panel p-4 lg:col-span-4">
                  <h2 className="label-caps mb-4 text-ink-3">
                    ECONOMIC IMPACT SUMMARY
                  </h2>
                  <div className="flex flex-col gap-4">
                    <div>
                      <div className="micro-mono mb-1 text-ink-3">
                        PROJECTED RETAIL SETTLEMENT
                      </div>
                      <div className="stat-lg tabular-nums text-ink">
                        ₹{result.traj.fuel_price[89].toFixed(1)}/L{" "}
                        <span className="body-md ml-2 text-elevated">
                          ▲{" "}
                          {(
                            ((result.traj.fuel_price[89] - BASE.pumpInrPerL) /
                              BASE.pumpInrPerL) *
                            100
                          ).toFixed(0)}
                          %
                        </span>
                      </div>
                    </div>
                    <div className="h-px w-full bg-hairline" />
                    <div>
                      <div className="micro-mono mb-1 text-ink-3">
                        EXTRA IMPORT BILL (90D)
                      </div>
                      <div className="stat-lg tabular-nums text-ink">
                        ≈ $
                        {(
                          ((result.traj.crude[89] - 80) *
                            COEFF.india_imports_bbl_d.value *
                            90) /
                          1e9
                        ).toFixed(1)}
                        bn{" "}
                        <span className="body-md ml-2 text-critical-text">▲</span>
                      </div>
                    </div>
                    <div className="h-px w-full bg-hairline" />
                    <p className="micro-mono text-ink-3">
                      diesel ~₹
                      {(90.4 + (result.traj.fuel_price[89] - 105)).toFixed(1)}
                      /L (same damped pass-through from a ₹90.4 Delhi base)
                      <Why
                        formula="diesel: same pass-through × policy damping from the diesel base; import bill: Δcrude × imports × 90 days"
                        sources={["pass_through_inr_per_usd_bbl", "policy_pass_through", "india_imports_bbl_d"]}
                      />
                    </p>
                  </div>
                </section>

                {/* v7: constrained optimal mitigation — never a bare optimum */}
                {result.mitigation && (
                  <section className="flex flex-col lg:col-span-4">
                    <div className="flex flex-1 flex-col rounded-lg border border-[#199e70]/30 bg-[#0f1f18] p-4">
                      <header className="mb-4 flex items-center gap-1">
                        <span className="material-symbols-outlined text-[18px] text-[#199e70]">
                          security
                        </span>
                        <h2
                          className="label-caps text-[#199e70]"
                          title="greedy search under cited caps — not a global optimum"
                        >
                          SUGGESTED MITIGATION
                        </h2>
                      </header>
                      <p className="micro-mono text-ink-3">
                        objective: {result.mitigation.objective}
                      </p>
                      <ul className="micro-mono mt-1 text-ink-3">
                        {result.mitigation.constraints.map((c) => (
                          <li key={c}>· {c}</li>
                        ))}
                      </ul>
                      {result.mitigation.moves.length > 0 ? (
                        <>
                          <ul className="body-md mt-2 flex-1 space-y-2 text-[#a3e5c9]">
                            {result.mitigation.moves.map((mv, i) => (
                              <li key={i} className="flex items-start gap-2">
                                <span className="mt-1 text-[10px] text-[#199e70]">
                                  ▶
                                </span>
                                <span>
                                  move {(mv.share * 100).toFixed(1)}% of
                                  imports: {mv.from.split(" (")[0]} →{" "}
                                  {mv.to.split(" (")[0]}
                                </span>
                              </li>
                            ))}
                          </ul>
                          <p className="body-md mt-2 text-ink-2">
                            shortfall{" "}
                            {(result.mitigation.before / 1000).toFixed(0)}k →{" "}
                            <span className="font-semibold text-[#199e70]">
                              {(result.mitigation.after / 1000).toFixed(0)}k
                              bbl/day
                            </span>{" "}
                            · {result.mitigation.residualNote}
                          </p>
                          <button
                            onClick={() => {
                              setMix(result.mitigation!.newMix);
                              setMixCorrected(false);
                            }}
                            className="label-caps mt-4 w-full rounded border border-[#199e70]/50 py-1 text-[#199e70] transition-colors hover:bg-[#199e70]/10"
                          >
                            APPLY TO SCENARIO → RE-RUN TO COMPARE
                          </button>
                        </>
                      ) : (
                        <p className="body-md mt-2 flex-1 text-ink-2">
                          No re-sourcing move improves this run (
                          {result.mitigation.residualNote}).
                        </p>
                      )}
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

              {/* per-refinery: Gulf-fed cut harder */}
              {result.coupled && (
                <section className="rounded-lg border border-hairline bg-panel">
                  <h2 className="label-caps border-b border-hairline px-4 py-2 text-ink-3">
                    PER-REFINERY RUN RATE
                  </h2>
                  <div className="grid gap-x-6 gap-y-1 p-4 md:grid-cols-2">
                    {perRefineryRunRate(
                      1 - Math.min(...result.traj.run_rate),
                    ).map((r) => (
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
                </section>
              )}
            </div>

            {/* v7: plain-language reasoning — why these numbers */}
            {result.reasoning && (
              <section className="rounded-lg border border-hairline bg-panel">
                <h2 className="label-caps border-b border-hairline px-4 py-2 text-ink-3">
                  WHY THESE NUMBERS
                  <Why
                    formula="each sentence is generated from this run's own engine state — the same shortfall, buffer, pass-through and drag values the graphs plot"
                    sources={["policy_pass_through", "spr_days_cover", "draw_cap_share"]}
                  />
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
          </>
        )}

        <ValidationPanel />
      </div>
    </div>
  );
}
