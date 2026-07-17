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
    ok: "text-good",
    warn: "text-elevated",
    bad: "text-critical",
  }[tone];
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-hairline bg-navy-deep p-2">
      <div className="label-caps text-ink-3">
        {label}
        {why}
      </div>
      <div className={`data-lg ${toneCls}`}>
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
    <aside className="flex w-full shrink-0 flex-col gap-4 rounded-xl border border-hairline bg-panel/90 p-4 shadow-2xl backdrop-blur-md">
      <div className="flex items-center justify-between">
        <h2 className="label-caps flex items-center gap-1 text-ink">
          <span className="mr-1 h-2 w-2 rounded-full bg-elevated" />
          {plain ? txt.plain : txt.expert}
        </h2>
      </div>
      <div className="flex rounded-full border border-hairline bg-navy-deep p-1">
        <button
          onClick={() => setPiMode("manual")}
          className={`label-caps flex-1 rounded-full py-1 text-center ${piMode === "manual" ? "bg-raised text-ink" : "text-ink-3 hover:text-ink"}`}
        >
          WHAT-IF
        </button>
        <button
          onClick={() => setPiMode("fused")}
          disabled={piFused === null}
          title={piFused === null ? "backend offline" : "σ estimated live from news + market + ship signals"}
          className={`label-caps flex-1 rounded-full py-1 text-center disabled:opacity-40 ${piMode === "fused" ? "bg-raised text-ink" : "text-ink-3 hover:text-ink"}`}
        >
          {plain ? "LIVE EST." : "FUSED"}
          {confidence !== null && piMode === "fused"
            ? ` ${(confidence * 100).toFixed(0)}%`
            : ""}
        </button>
      </div>
      <label
        className="flex flex-col gap-2"
        title={plain ? undefined : "σ: disruption severity 0–1, share of normal chokepoint flow blocked"}
      >
        <span className="micro-mono flex justify-between text-ink-2">
          <span>{plain ? txt.ask : "σ"}</span>
          <span className="font-bold text-secondary">
            {plain ? `${Math.round(pi * 100)}%` : pi.toFixed(2)}
          </span>
        </span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={pi}
          onChange={(e) => setPi(Number(e.target.value))}
          className="w-full"
          aria-label="Disruption severity"
        />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <Stat
          label={plain ? "Refineries" : "Run rate (90d min)"}
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
          label={plain ? "Petrol (Delhi)" : "Pump price (settled)"}
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
          label={plain ? "Elec. at risk" : "Power stress (peak)"}
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
