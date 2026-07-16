import { useMemo } from "react";
import { useStore } from "../store";
import { simulate } from "../lib/simulate";
import Why from "./Why";

function Stat({
  label,
  value,
  tone,
  why,
}: {
  label: string;
  value: string;
  tone: "ok" | "warn" | "bad";
  why: React.ReactNode;
}) {
  const toneCls = {
    ok: "text-emerald-300",
    warn: "text-amber-300",
    bad: "text-red-400",
  }[tone];
  return (
    <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">
      <div className="text-[11px] uppercase tracking-wider text-slate-400">
        {label}
        {why}
      </div>
      <div className={`text-lg font-semibold tabular-nums ${toneCls}`}>
        {value}
      </div>
    </div>
  );
}

const tone = (frac: number): "ok" | "warn" | "bad" =>
  frac < 0.25 ? "ok" : frac < 0.6 ? "warn" : "bad";

const SCENARIO_TEXT = {
  hormuz: {
    plain: "If Hormuz is blocked…",
    expert: "Hormuz Disruption",
    ask: "disruption level",
  },
  redsea: {
    plain: "If the Red Sea is suspended…",
    expert: "Red Sea Disruption",
    ask: "suspension level",
  },
  opec: {
    plain: "If OPEC+ cuts output…",
    expert: "OPEC+ Cut",
    ask: "cut depth",
  },
} as const;

export default function CascadePanel() {
  const pi = useStore((s) => s.pi);
  const setPi = useStore((s) => s.setPi);
  const piMode = useStore((s) => s.piMode);
  const piFused = useStore((s) => s.piFused);
  const confidence = useStore((s) => s.confidence);
  const setPiMode = useStore((s) => s.setPiMode);
  const plain = useStore((s) => s.plainMode);
  const scenario = useStore((s) => s.activeScenario);
  const txt = SCENARIO_TEXT[scenario];

  // M0-validated engine drives the panel; σ feeds the active scenario's channel
  const t = useMemo(
    () => simulate({ disruptions: { [scenario]: pi }, mode: "sustained" }),
    [pi, scenario],
  );
  const runMin = Math.min(...t.run_rate);
  const pumpSettled = t.fuel_price[89];
  const stressPeak = Math.max(...t.power_stress);
  const gdpMean = t.gdp.reduce((a, b) => a + b, 0) / t.gdp.length;

  return (
    <aside className="absolute left-4 top-4 z-10 w-72 rounded-xl border border-white/15 bg-white/10 p-4 shadow-2xl backdrop-blur-md">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-white">
          {plain ? txt.plain : txt.expert}
        </h2>
        <div className="flex gap-1 text-[10px]">
          <button
            onClick={() => setPiMode("manual")}
            className={`rounded px-1.5 py-0.5 ${piMode === "manual" ? "bg-cyan-500/25 text-cyan-200" : "text-slate-400 hover:bg-white/10"}`}
          >
            what-if
          </button>
          <button
            onClick={() => setPiMode("fused")}
            disabled={piFused === null}
            title={piFused === null ? "backend offline" : "σ estimated live from news + market + ship signals"}
            className={`rounded px-1.5 py-0.5 disabled:opacity-40 ${piMode === "fused" ? "bg-cyan-500/25 text-cyan-200" : "text-slate-400 hover:bg-white/10"}`}
          >
            {plain ? "live estimate" : "fused"}
            {confidence !== null && piMode === "fused"
              ? ` ${(confidence * 100).toFixed(0)}%`
              : ""}
          </button>
        </div>
      </div>
      <label
        className="block text-xs text-slate-400"
        title={plain ? undefined : "σ: disruption severity 0–1, share of normal chokepoint flow blocked"}
      >
        {plain ? `${txt.ask} = ${Math.round(pi * 100)}%` : `σ = ${pi.toFixed(2)}`}
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={pi}
          onChange={(e) => setPi(Number(e.target.value))}
          className="mt-1 w-full accent-cyan-400"
          aria-label="Disruption severity"
        />
      </label>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Stat
          label={plain ? "Refineries running" : "Run rate (90d min)"}
          value={`${(runMin * 100).toFixed(1)}%`}
          tone={tone(1 - runMin)}
          why={
            <Why
              formula="1 − uncovered gap; gap = σ × Hormuz share × imports × (1−bypass), buffered by SPR draw (≤70% of gap) until stocks run out"
              sources={["hormuz_import_share", "india_imports_bbl_d", "mitigation_hormuz", "spr_days_cover", "draw_cap_share"]}
            />
          }
        />
        <Stat
          label={plain ? "Petrol price (Delhi)" : "Pump price (settled)"}
          value={`₹${pumpSettled.toFixed(1)}/L`}
          tone={tone(pi)}
          why={
            <Why
              formula="base ₹105 + Δcrude × pass-through × policy damping × freight + domestic scarcity premium"
              sources={["pump_baseline_inr_l", "pass_through_inr_per_usd_bbl", "policy_pass_through", "scarcity_inr_per_run_loss"]}
            />
          }
        />
        <Stat
          label={plain ? "Electricity at risk" : "Power stress (peak)"}
          value={`${(stressPeak * 100).toFixed(1)}%`}
          tone={tone(stressPeak * 4)}
          why={
            <Why
              formula="σ × vulnerable generation share + refinery run-loss spillover"
              sources={["vulnerable_power_share"]}
            />
          }
        />
        <Stat
          label={plain ? "Growth hit" : "GDP drag (90d mean)"}
          value={`${gdpMean.toFixed(2)} pp`}
          tone={tone(-gdpMean / 2)}
          why={
            <Why
              formula="−Δcrude/10 × RBI coefficient − run-loss × activity channel, averaged over 90 days"
              sources={["gdp_pp_per_10usd", "gdp_pp_per_run_loss"]}
            />
          }
        />
      </div>
    </aside>
  );
}
