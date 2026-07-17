import { useMemo } from "react";
import { useTween } from "../lib/tween";
import { useStore } from "../store";
import { BASE } from "../lib/cascade";
import { simulate } from "../lib/simulate";

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
  const pumpT = useTween(pump);
  const gdpT = useTween(gdp);

  return (
    <div className="absolute left-1/2 top-3 z-10 flex w-[48rem] -translate-x-1/2 items-center gap-4 rounded-lg border border-hairline bg-navy-raised px-6 py-3 shadow-[0_4px_24px_rgba(0,0,0,0.5)] backdrop-blur-md">
      <span className="material-symbols-outlined shrink-0 text-secondary">
        {sigma <= 0.01 ? "public" : "trending_down"}
      </span>
      <p className="headline-sm flex-1 font-semibold leading-snug text-ink">
        {sigma <= 0.01 ? (
          <>
            <span className="body-md font-normal text-ink-2">
              Live map of India's energy system — power plants, tankers,
              chokepoints. Drag the slider or run a{" "}
              <span className="text-secondary">▶ scenario</span> to see what a
              disruption does.
            </span>
          </>
        ) : (
          <>
            <span className="font-bold">
              A {Math.round(sigma * 100)}% {SCENARIO_PHRASE[scenario]}
            </span>{" "}
            → <span className="text-critical-text">+₹{pumpT.toFixed(1)}/L</span>{" "}
            at the pump,{" "}
            <span className="text-critical-text">{gdpT.toFixed(1)} pp</span>{" "}
            {plainMode ? "off India's growth" : "GDP drag"} over 90 days
          </>
        )}
      </p>
      <button
        onClick={() => setPlainMode(!plainMode)}
        className="label-caps shrink-0 rounded border border-hairline px-2 py-1 text-ink-3 transition-colors hover:text-ink"
        aria-pressed={!plainMode}
      >
        {plainMode ? "expert mode" : "plain english"}
      </button>
    </div>
  );
}
