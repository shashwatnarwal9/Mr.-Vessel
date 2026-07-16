import { useEffect, useMemo, useRef, useState } from "react";
import { useStore, type ShipEffect, type SimShip } from "../store";
import { aggregateShortfall, shipShortfall } from "../lib/impact";
import { simulate, type Disruptions } from "../lib/simulate";
import type { McResult } from "../lib/montecarlo";
import { BASE } from "../lib/cascade";
import { classifyShip, estimateCargoBbl } from "../lib/ships";
import { saveRun, type SavedRun } from "../lib/pastSims";
import { loadSupplierRisks } from "../lib/supplier";
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
  const [open, setOpen] = useState(value > 0);
  const active = value > 0;
  return (
    <div
      className={`rounded-xl border backdrop-blur-md ${active ? "border-amber-400/40 bg-amber-500/10" : "border-white/15 bg-white/10"}`}
    >
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between px-4 py-2.5 text-left"
      >
        <span className="text-sm font-medium text-white">
          {spec.title}
          {active && (
            <span className="ml-2 rounded bg-amber-500/20 px-1.5 py-0.5 text-[11px] text-amber-200">
              {Math.round(value * 100)}%
            </span>
          )}
        </span>
        <span className="text-slate-400">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="px-4 pb-3">
          <label className="block text-xs text-slate-300">
            {spec.ask}{" "}
            <span className="font-semibold text-white">
              {Math.round(value * 100)}%
            </span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={value}
              onChange={(e) => onChange(Number(e.target.value))}
              className="mt-1 w-full accent-amber-400"
              aria-label={spec.ask}
            />
          </label>
          <p className="mt-1 text-[11px] text-slate-400">{spec.character}</p>
        </div>
      )}
    </div>
  );
}

/* ---------- run result ---------- */

type RunResult = {
  disruptions: Disruptions;
  ships: SimShip[];
  traj: ReturnType<typeof simulate>;
  fans: McResult | null;
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
  const [agent, setAgent] = useState<Awaited<
    ReturnType<typeof loadSupplierRisks>
  > | null>(null);
  useEffect(() => {
    loadSupplierRisks().then(setAgent).catch(() => {});
  }, []);
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
  ) => {
    setRunning(true);
    setSaved(false);
    runIdRef.current = Date.now(); // one Past-Sims entry per run
    const input = { disruptions, shortfallBblPerDay };
    const traj = simulate(input);
    const res: RunResult = { disruptions, ships, traj, fans: null };
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

  // manual run: sliders + selected ships
  const run = () =>
    execute(
      { hormuz: pi, redsea: draft.redsea, opec: draft.opec },
      aggregateShortfall(draft.ships),
      [...draft.ships],
    );

  // RA3 agent mode: probability-weighted expected shortfall drives the
  // engine — no sliders, no assumed closure (world price stays honest)
  const runAgent = () => {
    if (!agent) return;
    execute(
      {},
      Array(90).fill(agent.shortfall),
      [],
      `Agent — computed risk (${agent.asOf})`,
    );
  };

  const save = () => {
    if (!result) return;
    saveRun(toSavedRun(result, runName.trim() || autoName(result.disruptions)));
    bumpPastSims();
    setSaved(true);
  };

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mx-auto flex max-w-4xl flex-col gap-4">
        <PageIntro
          page="dashboard"
          intro="Build a what-if: choose disruptions, pick ships to affect, and see what happens to India's petrol price and economy over 90 days."
          hint="Open a scenario card and drag its slider (several can be active at once), optionally add ships below, then press Run simulation. Save keeps the run in Past Simulations."
        />

        {/* RA3: the agent's own opinion — computed, snapshot-dated, honest */}
        {agent && (
          <div className="rounded-xl border border-cyan-400/25 bg-cyan-500/10 p-4 backdrop-blur-md">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-white">
                🛰 Agent mode — computed risk
                <span className="ml-2 text-[11px] font-normal text-slate-400">
                  snapshot {agent.asOf} · not live
                </span>
                <Why
                  tag="derived"
                  formula="P(supplier) = 1 − (1−σ_k) × Π over corridors (1 − exposure × corridor P); expected shortfall = Σ import_share × imports × P(supplier). Corridor P from the log-odds fusion; every input cited in supplier_dependency.json / corridors.json."
                  sources={["india_imports_bbl_d"]}
                />
              </h2>
              <button
                onClick={runAgent}
                disabled={running}
                className="rounded border border-cyan-400/40 bg-cyan-500/20 px-3 py-1.5 text-xs font-medium text-cyan-100 hover:bg-cyan-500/30 disabled:opacity-50"
              >
                ▶ Run from computed risk
              </button>
            </div>
            <div className="grid gap-1 md:grid-cols-2">
              {agent.ranked.slice(0, 6).map((r) => (
                <div
                  key={r.supplier.id}
                  className="flex items-center justify-between rounded bg-white/5 px-2 py-1 text-[11px]"
                >
                  <span className="text-slate-200">{r.supplier.name}</span>
                  <span className="tabular-nums text-slate-300">
                    {(r.supplier.import_share * 100).toFixed(0)}% of imports ·{" "}
                    <span
                      className={
                        r.p > 0.4
                          ? "text-red-300"
                          : r.p > 0.15
                            ? "text-amber-300"
                            : "text-emerald-300"
                      }
                    >
                      {(r.p * 100).toFixed(0)}% route risk
                    </span>
                  </span>
                </div>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-slate-400">
              Expected supply at risk right now:{" "}
              <span className="font-semibold text-white">
                ~{(agent.shortfall / 1000).toFixed(0)}k bbl/day
              </span>{" "}
              — press run and the engine simulates 90 days from this number,
              no sliders.
            </p>
          </div>
        )}

        <div className="grid gap-3 md:grid-cols-3">
          <ScenarioCard
            spec={CARDS[0]}
            value={pi}
            onChange={(v) => setPi(v)}
          />
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

        {/* ships */}
        <div className="rounded-xl border border-white/15 bg-white/10 p-4 backdrop-blur-md">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white">
              Affected ships{" "}
              <span className="font-normal text-slate-400">
                (only India-bound crude changes India's numbers)
              </span>
            </h2>
            <div className="relative">
              <button
                onClick={() => setPickerOpen((o) => !o)}
                className="rounded border border-white/15 bg-white/5 px-2 py-1 text-xs text-slate-300 hover:bg-white/10"
              >
                + Add ship
              </button>
              {pickerOpen && (
                <ul className="absolute right-0 top-full z-30 mt-1 max-h-64 w-72 overflow-y-auto rounded-lg border border-white/15 bg-[#101624]/95 shadow-2xl backdrop-blur-md">
                  {candidates.length === 0 && (
                    <li className="px-3 py-2 text-xs text-slate-500">
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
                        className="flex w-full flex-col px-3 py-1.5 text-left hover:bg-white/10"
                      >
                        <span className="text-xs text-slate-100">
                          {f.properties.name}
                        </span>
                        <span className="text-[10px] text-slate-400">
                          {f.properties.type} → {f.properties.dest}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          {draft.ships.length === 0 ? (
            <p className="py-1 text-xs text-slate-400">
              None yet — click a tanker on the Command Map and press ▶ Start
              Simulation, or add one here.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {draft.ships.map((sh) => (
                <li
                  key={sh.props.mmsi}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2"
                >
                  <span className="flex min-w-44 flex-col">
                    <span className="text-xs text-slate-100">{sh.props.name}</span>
                    <span className="text-[10px] text-slate-400">
                      {sh.props.type} → {sh.props.dest} ·{" "}
                      {(() => {
                        const t = shipShortfall(sh).reduce((a, b) => a + b, 0);
                        return t > 0
                          ? `−${(t / 1e6).toFixed(2)}M bbl to India`
                          : "no India impact";
                      })()}
                    </span>
                  </span>
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
                      className="rounded border border-white/15 bg-[#101624] px-1.5 py-0.5 text-[11px] text-slate-200"
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
                        className="rounded border border-white/15 bg-[#101624] px-1.5 py-0.5 text-[11px] text-slate-200"
                      >
                        <option value="hormuz">Hormuz</option>
                        <option value="redsea">Red Sea</option>
                      </select>
                    )}
                    {sh.effect.kind === "delay" && (
                      <label className="text-[11px] text-slate-400">
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
                          className="w-12 rounded border border-white/15 bg-[#101624] px-1 py-0.5 text-[11px] text-slate-200"
                        />{" "}
                        d
                      </label>
                    )}
                  </span>
                  <button
                    onClick={() => removeDraftShip(sh.props.mmsi)}
                    aria-label={`Remove ${sh.props.name}`}
                    className="px-1 text-slate-500 hover:text-white"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* run */}
        <button
          onClick={run}
          disabled={running}
          className="rounded-xl border border-cyan-400/40 bg-cyan-500/20 px-4 py-3 text-sm font-semibold text-cyan-100 hover:bg-cyan-500/30 disabled:opacity-50"
        >
          {running ? "Running 10,000 futures…" : "▶ Run simulation"}
        </button>

        {result && (
          <>
            <div className="rounded-xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 backdrop-blur-md">
              <p className="text-sm font-medium text-amber-100">
                {headline(result)}
                <Why
                  formula="range = 5th–95th percentile of 10,000 Monte Carlo futures at day 90; growth = 90-day mean drag"
                  sources={["pass_through_inr_per_usd_bbl", "policy_pass_through", "gdp_pp_per_10usd"]}
                />
              </p>
            </div>

            <HistoricalContext
              disruptions={result.disruptions}
              traj={result.traj}
            />

            <div ref={graphsRef} className="flex flex-col gap-4 rounded-xl border border-white/15 bg-white/10 p-4 backdrop-blur-md">
              {result.fans ? (
                <div className="grid gap-4 md:grid-cols-2">
                  <FanChart
                    title="Petrol price (₹/L) · median + 50/90% bands"
                    bands={result.fans.pump}
                    color={BLUE}
                    format={(v) => `₹${v.toFixed(1)}`}
                    width={340}
                    height={150}
                  />
                  <FanChart
                    title="Growth impact (pp) · median + 50/90% bands"
                    bands={result.fans.gdp}
                    color={RED}
                    format={(v) => v.toFixed(2)}
                    width={340}
                    height={150}
                  />
                </div>
              ) : (
                <div className="h-36 animate-pulse rounded bg-white/5" />
              )}
              {result.fans && (
                <p className="text-[11px] text-slate-500">
                  Shaded bands = the middle 50% and 90% of 10,000 simulated
                  futures; the line is the median.
                </p>
              )}
              <div className="grid gap-4 md:grid-cols-2">
                <TrajChart
                  title="Refineries running (%)"
                  series={[{ name: "run rate", color: AQUA, values: result.traj.run_rate.map((v) => v * 100) }]}
                  format={(v) => `${v.toFixed(1)}%`}
                  width={340}
                  height={140}
                />
                <TrajChart
                  title="Electricity at risk (%)"
                  series={[{ name: "power stress", color: YELLOW, values: result.traj.power_stress.map((v) => v * 100) }]}
                  format={(v) => `${v.toFixed(1)}%`}
                  width={340}
                  height={140}
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => exportPng(graphsRef.current, runName.trim() || "mr-vessel-run")}
                className="rounded border border-white/15 bg-white/5 px-3 py-1.5 text-xs text-slate-200 hover:bg-white/10"
              >
                ⬇ Export graphs as PNG
              </button>
              <input
                value={runName}
                onChange={(e) => setRunName(e.target.value)}
                placeholder="Name this run…"
                aria-label="Run name"
                className="rounded border border-white/15 bg-white/5 px-2 py-1.5 text-xs text-slate-100 placeholder:text-slate-500"
              />
              <button
                onClick={save}
                className="rounded border border-emerald-400/30 bg-emerald-500/15 px-3 py-1.5 text-xs text-emerald-200 hover:bg-emerald-500/25"
              >
                {saved ? "✓ Saved" : "💾 Save name"}
              </button>
              <span className="text-[11px] text-slate-500">
                every run is saved to Past Simulations automatically
              </span>
            </div>
          </>
        )}

        <ValidationPanel />
      </div>
    </div>
  );
}
