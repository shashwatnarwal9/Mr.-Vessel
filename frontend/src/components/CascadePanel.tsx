import { useMemo } from "react";
import { useTween } from "../lib/tween";
import { useStore } from "../store";
import { simulate } from "../lib/simulate";

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "ok" | "warn" | "bad";
}) {
  const toneCls = {
    ok: "text-good",
    warn: "text-elevated",
    bad: "text-critical",
  }[tone];
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-hairline bg-navy-deep p-2">
      <div className="label-caps text-ink-3">{label}</div>
      <div className={`data-lg ${toneCls}`}>{value}</div>
    </div>
  );
}

const tone = (frac: number): "ok" | "warn" | "bad" =>
  frac < 0.25 ? "ok" : frac < 0.6 ? "warn" : "bad";

const SCENARIO_TEXT = {
  hormuz: { title: "If Hormuz is blocked…", ask: "disruption level" },
  redsea: { title: "If the Red Sea is suspended…", ask: "suspension level" },
  opec: { title: "If OPEC+ cuts output…", ask: "cut depth" },
} as const;

export default function CascadePanel() {
  const pi = useStore((s) => s.pi);
  const setPi = useStore((s) => s.setPi);
  const piMode = useStore((s) => s.piMode);
  const piFused = useStore((s) => s.piFused);
  const confidence = useStore((s) => s.confidence);
  const fusedDriver = useStore((s) => s.fusedDriver);
  const setPiMode = useStore((s) => s.setPiMode);
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
  // M-COHESION: recomputed numbers TWEEN to their new value
  const runMinT = useTween(runMin * 100);
  const pumpT = useTween(pumpSettled);
  const stressT = useTween(stressPeak * 100);
  const gdpT = useTween(gdpMean);

  return (
    <aside className="flex w-full shrink-0 flex-col gap-4 rounded-xl border border-hairline bg-panel/90 p-4 shadow-2xl backdrop-blur-md">
      <div className="flex items-center justify-between">
        <h2 className="label-caps flex items-center gap-1 text-ink">
          <span className="mr-1 h-2 w-2 rounded-full bg-elevated" />
          {txt.title}
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
          LIVE EST.
          {confidence !== null && piMode === "fused"
            ? ` ${(confidence * 100).toFixed(0)}%`
            : ""}
        </button>
      </div>
      <label
        className="flex flex-col gap-2"
      >
        <span className="micro-mono flex justify-between text-ink-2">
          <span>{txt.ask}</span>
          <span className="font-bold text-secondary">
            {`${Math.round(pi * 100)}%`}
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
      {/* when a report — not the signal blend — set this number, say so */}
      {piMode === "fused" && fusedDriver?.headline && (
        <div className="flex flex-col gap-1 rounded border border-critical/40 bg-critical/10 p-2">
          <span className="label-caps flex items-center gap-1 text-critical-text">
            <span className="material-symbols-outlined text-[14px]">
              campaign
            </span>
            set by reported closure · {Math.round(fusedDriver.pi * 100)}%
          </span>
          <span className="micro-mono leading-snug text-ink-2">
            “{fusedDriver.headline}”
          </span>
          <span className="micro-mono text-ink-3">
            {fusedDriver.source}
            {fusedDriver.ts
              ? ` · ${new Date(fusedDriver.ts).toLocaleString("en-IN", {
                  day: "numeric",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                })}`
              : ""}
          </span>
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <Stat
          label="Refineries"
          value={`${runMinT.toFixed(1)}%`}
          tone={tone(1 - runMin)}
        />
        <Stat
          label="Petrol (Delhi)"
          value={`₹${pumpT.toFixed(1)}/L`}
          tone={tone(pi)}
        />
        <Stat
          label="Elec. at risk"
          value={`${stressT.toFixed(1)}%`}
          tone={tone(stressPeak * 4)}
        />
        <Stat
          label="Growth hit"
          value={`${gdpT.toFixed(2)} pp`}
          tone={tone(-gdpMean / 2)}
        />
      </div>
    </aside>
  );
}
