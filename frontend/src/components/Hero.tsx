import { useEffect, useState } from "react";
import { loadCorridorRisks } from "../lib/risk";

/** M0.9 hero: mission in one line, then the instrument. One ambient
 *  motion (wireframe globe, CSS-only), honest credibility chips, a live
 *  micro-readout from the baked corridor snapshot (offline-safe). */
export default function Hero({ onEnter }: { onEnter: () => void }) {
  const [readout, setReadout] = useState<string | null>(null);

  useEffect(() => {
    loadCorridorRisks()
      .then((risks) => {
        const top = risks[0];
        const hormuz = risks.find((r) => r.corridor.id === "hormuz");
        setReadout(
          `Corridor risk now: ${top.corridor.name} ${(top.p * 100).toFixed(0)}%` +
            (hormuz && hormuz !== top
              ? ` · Hormuz ${(hormuz.p * 100).toFixed(0)}%`
              : ""),
        );
      })
      .catch(() => setReadout(null)); // static hero still stands alone
  }, []);

  return (
    <section
      className="relative flex h-screen flex-col items-center justify-center overflow-hidden px-6 text-center"
      aria-label="Mr. Vessel — mission"
    >
      {/* the one ambient motion: faint wireframe globe, slow spin */}
      <svg
        viewBox="0 0 400 400"
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-1/2 h-[52rem] w-[52rem] -translate-x-1/2 -translate-y-1/2 animate-[spin_180s_linear_infinite] opacity-[0.08] motion-reduce:animate-none"
      >
        <g fill="none" stroke="#94a3b8" strokeWidth="0.6">
          <circle cx="200" cy="200" r="180" />
          <ellipse cx="200" cy="200" rx="180" ry="70" />
          <ellipse cx="200" cy="200" rx="180" ry="130" />
          <ellipse cx="200" cy="200" rx="70" ry="180" />
          <ellipse cx="200" cy="200" rx="130" ry="180" />
          <line x1="20" y1="200" x2="380" y2="200" />
        </g>
      </svg>

      <p className="mb-4 font-mono text-[11px] uppercase tracking-[0.3em] text-slate-500">
        Geopolitical energy-disruption instrument
      </p>
      <h1 className="max-w-3xl text-4xl font-semibold leading-tight tracking-tight text-white sm:text-6xl">
        See how a shock in the Gulf reaches India's pump price.
      </h1>
      <p className="mt-5 max-w-xl text-base leading-relaxed text-slate-300">
        Simulate oil-supply disruptions — a blocked strait, a sanctioned
        tanker, a production cut — and trace the cascade to India's fuel,
        power, and economy over 90 days.
      </p>

      <div className="mt-7 flex flex-wrap items-center justify-center gap-2">
        {[
          "1,589 real Indian power plants",
          "5,388 vessels screened · OpenSanctions",
          "calibrated on the 2022 oil shock",
        ].map((chip) => (
          <span
            key={chip}
            className="rounded border border-white/15 bg-white/5 px-2.5 py-1 font-mono text-[11px] text-slate-300"
          >
            {chip}
          </span>
        ))}
      </div>

      {readout && (
        <p className="mt-4 font-mono text-xs text-amber-300/90" aria-live="polite">
          ● {readout}
        </p>
      )}

      <button
        onClick={onEnter}
        className="mt-9 rounded-lg border border-amber-400/40 bg-amber-500/10 px-6 py-3 text-sm font-medium text-amber-200 transition-colors hover:bg-amber-500/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
      >
        Enter the Command Window ↓
      </button>

      <p className="mt-8 font-mono text-[10px] uppercase tracking-widest text-slate-600">
        As of 2026-07-16 · sources: AIS · OpenSanctions · GDELT · market
      </p>

      <div
        aria-hidden="true"
        className="absolute bottom-6 left-1/2 -translate-x-1/2 animate-bounce text-slate-600 motion-reduce:animate-none"
      >
        ↓
      </div>
    </section>
  );
}
