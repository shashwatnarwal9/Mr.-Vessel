import { useEffect, useState } from "react";
import { loadCorridorRisks, topDriver, type CorridorRisk } from "../lib/risk";
import { mapHandle } from "../lib/mapHandle";
import Why from "./Why";

// status ramp (matches the map corridor coloring)
const riskColor = (p: number) =>
  p >= 0.35 ? "#ec835a" : p >= 0.15 ? "#fab219" : "#0ca30c";

/** RA2: corridor risk list — "How likely is a disruption here?" */
export default function RiskPanel() {
  const [risks, setRisks] = useState<CorridorRisk[]>([]);
  const [open, setOpen] = useState(true);

  useEffect(() => {
    loadCorridorRisks().then(setRisks).catch(() => {});
  }, []);

  if (risks.length === 0) return null;

  return (
    <aside className="absolute left-4 top-[24rem] z-10 w-72 rounded-xl border border-white/15 bg-white/10 shadow-2xl backdrop-blur-md">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between px-4 py-2 text-left"
      >
        <span className="text-sm font-semibold text-white">
          Corridor risk{" "}
          <span className="text-[11px] font-normal text-slate-400">
            · chance of disruption, next 30 days
          </span>
          <Why
            tag="derived"
            formula="P = sigmoid(logit(base rate) + Σ weight × signal) over four signals: news, ship behaviour, sanctions density, market pricing. Baked snapshot (2026-07); live signals in Tier 2. Band shrinks as signals corroborate."
            sources={[]}
          />
        </span>
        <span className="text-slate-400">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <ul className="flex flex-col gap-1 px-3 pb-3">
          {risks.map((r) => (
            <li key={r.corridor.id}>
              <button
                onClick={() =>
                  mapHandle.current?.flyTo({
                    center: r.corridor.centroid,
                    zoom: 5,
                    duration: 1800,
                  })
                }
                className="w-full rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-left hover:bg-white/10"
              >
                <span className="flex items-center justify-between">
                  <span className="text-xs text-slate-100">
                    {r.corridor.name}
                  </span>
                  <span
                    className="text-xs font-semibold tabular-nums"
                    style={{ color: riskColor(r.p) }}
                  >
                    {(r.p * 100).toFixed(0)}% ± {(r.band * 100).toFixed(0)}
                  </span>
                </span>
                <span className="mt-1 flex h-1 w-full gap-0.5 overflow-hidden rounded">
                  {r.contributions.map((c) => (
                    <span
                      key={c.signal}
                      title={`${c.signal}: ${c.value}`}
                      className="h-full bg-cyan-400/70"
                      style={{
                        width: `${Math.max(2, c.logOdds * 38)}px`,
                        opacity: 0.35 + 0.65 * c.value,
                      }}
                    />
                  ))}
                </span>
                <span className="text-[10px] text-slate-500">
                  driven by {topDriver(r)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
