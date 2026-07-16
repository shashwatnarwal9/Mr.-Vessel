import { useMemo } from "react";
import { useStore } from "../store";
import { BASE } from "../lib/cascade";
import { simulate } from "../lib/simulate";
import Why from "./Why";

/** M7 story layer: the headline result in plain language, always derived
 *  from the same day-stepped engine the panels use. */
const SCENARIO_PHRASE = {
  hormuz: "Hormuz closure",
  redsea: "Red Sea suspension",
  opec: "OPEC+ output cut",
} as const;

export default function StoryBanner() {
  const sigma = useStore((s) => s.pi);
  const scenario = useStore((s) => s.activeScenario);
  const plainMode = useStore((s) => s.plainMode);
  const setPlainMode = useStore((s) => s.setPlainMode);

  const { pump, gdp } = useMemo(() => {
    if (sigma <= 0.01) return { pump: 0, gdp: 0 };
    const t = simulate({ disruptions: { [scenario]: sigma }, mode: "sustained" });
    return {
      pump: t.fuel_price[89] - BASE.pumpInrPerL,
      gdp: t.gdp.reduce((a, b) => a + b, 0) / t.gdp.length,
    };
  }, [sigma, scenario]);

  return (
    <div className="absolute left-1/2 top-3 z-10 flex w-[42rem] -translate-x-1/2 items-center justify-between gap-3 rounded-xl border border-white/15 bg-black/60 px-4 py-2 shadow-2xl backdrop-blur-md">
      <p className="text-sm leading-snug text-slate-100">
        {sigma <= 0.01 ? (
          <>
            <span className="text-slate-300">
              Live map of India's energy system — power plants, tankers,
              chokepoints. Drag the slider or run a{" "}
              <span className="text-amber-300">▶ scenario</span> to see what a
              disruption does.
            </span>
          </>
        ) : (
          <>
            A <span className="font-semibold text-amber-300">{Math.round(sigma * 100)}%</span>{" "}
            {SCENARIO_PHRASE[scenario]} →{" "}
            <span className="font-semibold text-white">
              +₹{pump.toFixed(1)}/L
            </span>{" "}
            at the pump,{" "}
            <span className="font-semibold text-white">
              {gdp.toFixed(1)} pp
            </span>{" "}
            {plainMode ? "off India's growth" : "GDP drag"} over 90 days
            <Why
              tag="derived"
              formula="pump: Δcrude × pass-through × policy damping + scarcity; GDP: −Δcrude/10 × RBI coeff − run-loss × activity channel (90-day mean from the day-stepped engine)"
              sources={[
                "pass_through_inr_per_usd_bbl",
                "policy_pass_through",
                "gdp_pp_per_10usd",
                "price_elasticity_pct_per_pct",
              ]}
            />
          </>
        )}
      </p>
      <button
        onClick={() => setPlainMode(!plainMode)}
        className="shrink-0 rounded border border-white/15 bg-white/5 px-2 py-1 text-[11px] text-slate-300 hover:bg-white/10"
        aria-pressed={!plainMode}
      >
        {plainMode ? "expert mode" : "plain English"}
      </button>
    </div>
  );
}
