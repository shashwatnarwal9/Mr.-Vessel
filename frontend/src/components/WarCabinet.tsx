import { useEffect, useRef, useState } from "react";
import { simulate, type Disruptions, type Trajectory } from "../lib/simulate";
import { runPlans, type Plan, type PolicyLevers } from "../lib/runPlans";
import { defaultMix, type Mix } from "../lib/coupled";
import type { Supplier } from "../lib/supplier";
import type { McResult } from "../lib/montecarlo";
import {
  buildFacts,
  mcFan,
  parseCrisis,
  streamMinister,
  streamPM,
  type Advice,
  type Parsed,
} from "../lib/warCabinet";
import TrajChart from "./TrajChart";
import FanChart from "./FanChart";

const RED = "#e66767"; // baseline (no action)
const BLUE = "#3987e5"; // Foreign Minister
const AQUA = "#199e70"; // Defence Minister
const GOLD = "#c98500"; // Prime Minister (the decision)

type Phase = "idle" | "parsing" | "ministers" | "pm" | "done" | "error";

const REF = simulate({ disruptions: {} }); // σ=0 reference for Δ vs peacetime

/** Strip light markdown (bold/headers) + leading whitespace — some models
 *  (nemotron) prepend "**Briefing-room reasoning:**" and blank lines. */
const clean = (s: string) =>
  s.replace(/\*\*|__|`/g, "").replace(/^\s*#+\s*/gm, "").replace(/^\s+/, "");

/** Render a lever set as short human chips. */
function leverChips(l: PolicyLevers): string[] {
  const c: string[] = [];
  if (l.resource_reallocation) c.push("re-source imports");
  if (l.opec_negotiation) c.push(`OPEC talks ${Math.round(l.opec_negotiation * 100)}%`);
  if (l.deescalation) c.push(`de-escalate ${Math.round(l.deescalation * 100)}%`);
  if (l.spr_release) c.push(`SPR release ${Math.round(l.spr_release * 100)}%`);
  if (l.naval_escort) c.push(`naval escort ${Math.round(l.naval_escort * 100)}%`);
  for (const e of l.escalation ?? [])
    c.push(`⚠ strike ${e.channel} +${Math.round(e.delta * 100)}%`);
  return c.length ? c : ["no action"];
}

function Panel({
  title, model, color, prose, advice, streaming,
}: {
  title: string; model: string; color: string; prose: string;
  advice: Advice | null; streaming: boolean;
}) {
  return (
    <div className="flex flex-col gap-2 rounded border border-hairline bg-navy-deep p-3">
      <div className="flex items-center justify-between">
        <span className="label-caps" style={{ color }}>{title}</span>
        {model !== "?" && (
          <span className="micro-mono text-ink-3">{model.split("/").pop()}</span>
        )}
      </div>
      <p className="body-md min-h-[3rem] text-ink-2 whitespace-pre-wrap">
        {clean(prose) || (streaming ? "…deliberating" : advice?.error ? `⚠ ${advice.error}` : "")}
        {streaming && <span className="animate-pulse">▋</span>}
      </p>
      {advice && (
        <div className="flex flex-wrap gap-1">
          {leverChips(advice.levers).map((chip) => (
            <span
              key={chip}
              className="micro-mono rounded px-1.5 py-0.5"
              style={{ background: `${color}22`, color }}
            >
              {chip}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export default function WarCabinet() {
  const [prompt, setPrompt] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [fmProse, setFmProse] = useState("");
  const [dmProse, setDmProse] = useState("");
  const [pmProse, setPmProse] = useState("");
  const [fm, setFm] = useState<Advice | null>(null);
  const [dm, setDm] = useState<Advice | null>(null);
  const [pm, setPm] = useState<Advice | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [pmBands, setPmBands] = useState<McResult | null>(null);
  const [err, setErr] = useState("");

  const supRef = useRef<{ suppliers: Supplier[]; mix: Mix } | null>(null);
  useEffect(() => {
    fetch("/supplier_dependency.json")
      .then((r) => r.json())
      .then((d) => (supRef.current = { suppliers: d.suppliers, mix: defaultMix(d.suppliers) }))
      .catch(() => (supRef.current = { suppliers: [], mix: {} }));
  }, []);

  const running = phase === "parsing" || phase === "ministers" || phase === "pm";

  async function convene() {
    if (!prompt.trim() || running) return;
    setErr(""); setParsed(null); setFm(null); setDm(null); setPm(null); setPlans([]);
    setPmBands(null); setFmProse(""); setDmProse(""); setPmProse("");
    try {
      setPhase("parsing");
      const p = await parseCrisis(prompt);
      const d: Disruptions = p.disruptions;
      // no shock to simulate → don't spin up the cabinet on a peacetime baseline
      const maxSigma = Math.max(d.hormuz ?? 0, d.redsea ?? 0, d.opec ?? 0);
      if (maxSigma === 0) {
        setErr(
          'No disruption detected. Describe a chokepoint closure, strike, or supply cut — e.g. "Iran closes the Strait of Hormuz" or "OPEC+ cuts 3 Mb/d".',
        );
        setPhase("idle");
        return;
      }
      setParsed(p);
      const { suppliers, mix } = supRef.current ?? { suppliers: [], mix: {} };
      const baseline = runPlans(d, p.mode, [{ name: "Baseline", color: RED, levers: {} }], suppliers, mix)[0];
      const facts = buildFacts(d, baseline.traj, REF);

      setPhase("ministers");
      const [fmA, dmA] = await Promise.all([
        streamMinister("fm", prompt, facts, (t) => setFmProse((s) => s + t)),
        streamMinister("dm", prompt, facts, (t) => setDmProse((s) => s + t)),
      ]);
      setFm(fmA); setDm(dmA);

      setPhase("pm");
      const pmA = await streamPM(prompt, facts, fmA, dmA, (t) => setPmProse((s) => s + t));
      setPm(pmA);

      const all = runPlans(
        d, p.mode,
        [
          { name: "Baseline", color: RED, levers: {} },
          { name: "Foreign Min", color: BLUE, levers: fmA.levers },
          { name: "Defence Min", color: AQUA, levers: dmA.levers },
          { name: "PM final", color: GOLD, levers: pmA.levers },
        ],
        suppliers, mix,
      );
      setPlans(all);
      setPhase("done");
      mcFan(all[3].input).then(setPmBands).catch(() => {});
    } catch (e) {
      setErr(String(e)); setPhase("error");
    }
  }

  const last = <T,>(a: T[]) => a[a.length - 1];
  const refPump = last(REF.fuel_price);
  const series = (pick: (t: Trajectory) => number[]) =>
    plans.map((p) => ({ name: p.name, color: p.color, values: pick(p.traj) }));
  const pmRange =
    pmBands && `+₹${(last(pmBands.pump).p25 - refPump).toFixed(1)}–${(last(pmBands.pump).p75 - refPump).toFixed(1)}/L`;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 p-4">
      <div>
        <h1 className="headline-lg text-ink">War Cabinet</h1>
        <p className="body-md text-ink-3">
          Describe a crisis. The Foreign &amp; Defence Ministers advise; the Prime Minister
          decides. Each plan is scored by the engine — outcomes over a 90-day horizon.
        </p>
      </div>

      <div className="flex gap-2">
        <textarea
          className="flex-1 rounded border border-hairline bg-navy-deep p-2 body-md text-ink"
          rows={2}
          placeholder="Iran mines the Strait of Hormuz and the US strikes Houthi sites near Bab-el-Mandeb…"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (e.metaKey || e.ctrlKey) && convene()}
          disabled={running}
        />
        <button
          className="rounded bg-secondary px-4 py-2 label-caps text-navy-deep disabled:opacity-50"
          onClick={convene}
          disabled={running || !prompt.trim()}
        >
          {running ? phase : "Convene"}
        </button>
      </div>

      {parsed && (
        <div className="flex flex-wrap items-center gap-2 rounded border border-hairline bg-navy-deep p-3">
          <span className="micro-mono rounded px-1.5 py-0.5 text-ink-3" style={{ background: "#ffffff11" }}>
            source: {parsed.source}
          </span>
          {parsed.events.map((ev, i) => (
            <span
              key={i}
              className={`micro-mono rounded px-1.5 py-0.5 ${ev.speculative ? "line-through opacity-50" : ""}`}
              style={{ background: "#ffffff11", color: ev.speculative ? "#8792b8" : "#e9edf7" }}
              title={ev.speculative ? "threat only — not priced (speculation gate)" : ev.action}
            >
              {ev.channel} {Math.round(ev.severity * 100)}%
            </span>
          ))}
          {parsed.unmapped.map((u, i) => (
            <span key={`u${i}`} className="micro-mono rounded px-1.5 py-0.5 text-ink-3" style={{ background: "#ffffff11" }}>
              ⓘ no crude-flow channel: {u}
            </span>
          ))}
        </div>
      )}

      {err && <p className="body-md text-red-400">⚠ {err}</p>}

      {parsed && (
        <>
          <div className="grid gap-3 md:grid-cols-2">
            <Panel title="Foreign Minister" model={fm?.model ?? "?"} color={BLUE}
              prose={fmProse} advice={fm} streaming={phase === "ministers" && !fm} />
            <Panel title="Defence Minister" model={dm?.model ?? "?"} color={AQUA}
              prose={dmProse} advice={dm} streaming={phase === "ministers" && !dm} />
          </div>
          <Panel title="Prime Minister — final call" model={pm?.model ?? "?"} color={GOLD}
            prose={pmProse} advice={pm} streaming={phase === "pm" && !pm} />
        </>
      )}

      {plans.length === 4 && (
        <>
          <div className="rounded border border-hairline bg-navy-deep p-3">
            <span className="label-caps text-ink-3">PM final — petrol impact</span>
            <div className="stat-lg" style={{ color: GOLD }}>
              {pmRange ?? "computing range…"}
            </div>
            <span className="caption text-ink-3">
              vs peacetime · 10 000-run Monte-Carlo p25–p75 · 90-day horizon
            </span>
          </div>

          {/* plan legend — the four overlaid lines (identity never colour-alone) */}
          <div className="flex flex-wrap gap-4 px-1">
            {plans.map((p) => (
              <span key={p.name} className="micro-mono flex items-center gap-1.5 text-ink-2">
                <span className="inline-block h-2 w-2 rounded-full" style={{ background: p.color }} />
                {p.name}
              </span>
            ))}
          </div>

          {/* the project's four predictive metrics — same simulate() engine,
              one line per plan so the decision's effect is visible per metric */}
          <div className="grid gap-4 md:grid-cols-2">
            <TrajChart title="PETROL PRICE (₹/L)" series={series((t) => t.fuel_price)} format={(v) => `₹${v.toFixed(1)}`} />
            <TrajChart title="GDP GROWTH IMPULSE" series={series((t) => t.gdp)} format={(v) => v.toFixed(2)} />
            <TrajChart title="REFINERY UTILIZATION" series={series((t) => t.run_rate.map((x) => x * 100))} format={(v) => `${v.toFixed(1)}%`} />
            <TrajChart title="GRID STRESS INDEX" series={series((t) => t.power_stress.map((x) => x * 100))} format={(v) => `${v.toFixed(1)}%`} />
          </div>

          {/* PM-final uncertainty: 10,000-run Monte-Carlo fans (same engine) */}
          {pmBands && (
            <div className="grid gap-4 md:grid-cols-2">
              <FanChart title="PM FINAL — PETROL, 10k FUTURES (₹/L)" bands={pmBands.pump} color={GOLD}
                format={(v) => `₹${v.toFixed(1)}`} width={560} height={200} />
              <FanChart title="PM FINAL — GDP IMPULSE, 10k FUTURES" bands={pmBands.gdp} color={GOLD}
                format={(v) => v.toFixed(2)} width={560} height={200} />
            </div>
          )}

          <div className="overflow-x-auto rounded border border-hairline bg-navy-deep p-3">
            <span className="label-caps text-ink-3">Decision scorecard — why the PM chose (engine-scored)</span>
            <table className="mt-2 w-full micro-mono text-ink-2">
              <thead className="text-ink-3">
                <tr className="text-left">
                  <th className="py-1 pr-4">Plan</th>
                  <th className="py-1 pr-4">petrol Δ ₹/L</th>
                  <th className="py-1 pr-4">GDP pp</th>
                  <th className="py-1 pr-4">run-rate trough</th>
                  <th className="py-1 pr-4">freight days</th>
                </tr>
              </thead>
              <tbody>
                {plans.map((p) => {
                  const d = p.input.disruptions ?? {};
                  const freight = (d.hormuz ?? 0) * 20 + (d.redsea ?? 0) * 26;
                  return (
                    <tr key={p.name} className="border-t border-hairline/50">
                      <td className="py-1 pr-4" style={{ color: p.color }}>{p.name}</td>
                      <td className="py-1 pr-4 tabular-nums">+{(last(p.traj.fuel_price) - refPump).toFixed(1)}</td>
                      <td className="py-1 pr-4 tabular-nums">{last(p.traj.gdp).toFixed(1)}</td>
                      <td className="py-1 pr-4 tabular-nums">{(Math.min(...p.traj.run_rate) * 100).toFixed(0)}%</td>
                      <td className="py-1 pr-4 tabular-nums">{freight.toFixed(0)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="caption mt-2 text-ink-3">
              Escalation is modelled first-order (a strike raises a channel's severity); no
              dynamic retaliation spiral is claimed. Physical relief is logistics friction +
              SPR buffer, not starvation — India is a solvent price-taker.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
