import { useEffect, useState } from "react";
import { loadCorridorRisks, type CorridorRisk } from "../lib/risk";

/** M0.9 hero, Stitch s0 skin: mission in one line, then the instrument.
 *  One ambient motion (wireframe globe, CSS-only), honest credibility
 *  chips, a live micro-readout from the baked corridor snapshot
 *  (offline-safe). */
const CHIPS: { icon: string; text: string }[] = [
  { icon: "factory", text: "1,589 real Indian power plants" },
  { icon: "directions_boat", text: "5,388 vessels screened" },
  { icon: "tune", text: "calibrated on the 2022 oil shock" },
];

export default function Hero({ onEnter }: { onEnter: () => void }) {
  const [risks, setRisks] = useState<CorridorRisk[] | null>(null);

  useEffect(() => {
    loadCorridorRisks()
      .then(setRisks)
      .catch(() => setRisks(null)); // static hero still stands alone
  }, []);

  const top = risks?.[0] ?? null;
  const hormuz = risks?.find((r) => r.corridor.id === "hormuz") ?? null;

  return (
    <section
      className="relative flex h-screen flex-col overflow-hidden"
      aria-label="Mr. Vessel — mission"
    >
      {/* the one ambient motion: abstract wireframe globe, slow spin */}
      <div className="globe-bg" aria-hidden="true" />

      <main className="relative z-10 mx-auto flex w-full max-w-[1200px] flex-grow flex-col items-center justify-center px-4 pb-16 pt-24 text-center">
        {/* Eyebrow */}
        <div className="label-caps mb-2 flex items-center gap-2 tracking-[0.2em] text-ink-3">
          <span className="h-px w-4 bg-hairline" />
          GEOPOLITICAL ENERGY-DISRUPTION INSTRUMENT
          <span className="h-px w-4 bg-hairline" />
        </div>

        {/* Headline */}
        <h1 className="headline-hero mb-6 max-w-4xl text-ink">
          See how a shock in the Gulf reaches India's pump price.
        </h1>

        {/* Subline */}
        <p className="body-md mb-12 max-w-2xl text-ink-2">
          Simulate oil-supply disruptions — a blocked strait, a sanctioned
          tanker, a production cut — and trace the cascade to India's fuel,
          power, and economy over 90 days.
        </p>

        {/* Factual chips */}
        <div className="mb-16 flex flex-wrap justify-center gap-4">
          {CHIPS.map((c) => (
            <div
              key={c.text}
              className="micro-mono flex items-center gap-2 rounded border border-hairline bg-navy-deep px-3 py-1.5 text-ink-3"
            >
              <span className="material-symbols-outlined text-[14px]">
                {c.icon}
              </span>
              {c.text}
            </div>
          ))}
        </div>

        {/* Live micro-readout */}
        {top && (
          <div
            className="mb-8 flex items-center gap-3 rounded border border-hairline bg-panel px-4 py-2"
            aria-live="polite"
          >
            <span className="h-2 w-2 rounded-full bg-elevated" />
            <span className="micro-mono text-ink">
              <span className="mr-2 text-ink-3">CORRIDOR RISK NOW:</span>
              {top.corridor.name}{" "}
              <span className="ml-1 mr-3 font-bold text-elevated">
                {(top.p * 100).toFixed(0)}%
              </span>
              {hormuz && hormuz !== top && (
                <>
                  <span className="mx-2 text-ink-3">|</span>
                  Hormuz{" "}
                  <span className="ml-1 font-bold text-secondary">
                    {(hormuz.p * 100).toFixed(0)}%
                  </span>
                </>
              )}
            </span>
          </div>
        )}

        {/* Primary CTA */}
        <button
          onClick={onEnter}
          className="label-caps flex items-center gap-2 rounded bg-gold px-6 py-3 text-navy transition-colors hover:bg-gold-hover focus:outline-none focus:ring-2 focus:ring-gold focus:ring-offset-2 focus:ring-offset-navy"
        >
          Enter the Command Window
          <span className="material-symbols-outlined text-[16px]">
            arrow_downward
          </span>
        </button>
      </main>

      {/* Dateline footer */}
      <footer className="relative z-10 mt-auto w-full border-t border-hairline bg-navy-deep/80 px-6 py-4 backdrop-blur-sm">
        <div className="micro-mono mx-auto flex max-w-[1200px] flex-col items-center justify-between gap-2 text-ink-3 md:flex-row">
          <div>AS OF 2026-07-16</div>
          <div className="flex items-center gap-2">
            SOURCES: <span className="text-ink-2">AIS</span>
            <span className="text-ink-3">·</span>{" "}
            <span className="text-ink-2">OPENSANCTIONS</span>
            <span className="text-ink-3">·</span>{" "}
            <span className="text-ink-2">GDELT</span>
            <span className="text-ink-3">·</span>{" "}
            <span className="text-ink-2">MARKET</span>
          </div>
        </div>
      </footer>
    </section>
  );
}
