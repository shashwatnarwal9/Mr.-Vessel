// FinOcean Strategy Brief (the 4th card's page). Read-only: it re-presents
// values the SAME engine already computed — suggested mitigation, per-refinery
// run-rate, the affected ships we loaded, and a plain-English "how to do
// better" derived from those numbers. No new math, no engine changes.
import { useMemo } from "react";
import type { Trajectory } from "../lib/simulate";
import type { WorldState } from "../store";
import type { Supplier } from "../lib/supplier";
import {
  coupledShortfall,
  normalizeMix,
  optimizeMitigation,
} from "../lib/coupled";
import { perRefineryRunRate } from "../lib/power";
import { BASE } from "../lib/cascade";
import TrajChart from "./TrajChart";
import RefineryMap from "./RefineryMap";

/** Shared sub-page header link: plain text that lifts and draws a gold
 *  underline on hover (same gesture as the nav tabs and the landing CTA). */
export const HDR_LINK =
  "label-caps group relative flex items-center gap-1 px-1 pb-1 transition-all duration-200 ease-out hover:-translate-y-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-secondary motion-reduce:transform-none motion-reduce:transition-none";

export function Underline() {
  return (
    <span
      aria-hidden="true"
      className="absolute inset-x-0 bottom-0 h-0.5 origin-left scale-x-0 bg-secondary transition-transform duration-200 ease-out group-hover:scale-x-100 motion-reduce:transition-none"
    />
  );
}

const GOLD = "#c98500";

const EFFECT_LABEL: Record<string, string> = {
  closure: "chokepoint closed on its route",
  sanction: "sanctioned — cargo never arrives",
  reroute: "rerouted the long way",
  delay: "held up",
};

const kbd = (bblPerDay: number) => `${Math.round(bblPerDay / 1000).toLocaleString("en-IN")}k bbl/d`;

export default function StrategyBrief({
  result,
  world,
  suppliers,
  onBack,
}: {
  result: Trajectory | null;
  world: WorldState;
  suppliers: Supplier[];
  onBack: () => void;
}) {
  const d = world.dashboard?.disruptions ?? null;

  const { coupled, mitigation } = useMemo(() => {
    if (!world.dashboard || !suppliers.length || !d)
      return { coupled: null, mitigation: null };
    const mix = normalizeMix(world.dashboard.mix).mix;
    return {
      coupled: coupledShortfall(suppliers, mix, d),
      mitigation: optimizeMitigation(suppliers, mix, d),
    };
  }, [world.dashboard, suppliers, d]);

  const refineries = useMemo(
    () => (result ? perRefineryRunRate(1 - Math.min(...result.run_rate)) : []),
    [result],
  );

  const ships = world.ships ?? [];

  // headline numbers (day-90 extrema of this run)
  const last = (a: number[]) => a[a.length - 1];
  const dPump = result ? last(result.fuel_price) - BASE.pumpInrPerL : 0;
  const gdpMean = result
    ? result.gdp.reduce((a, b) => a + b, 0) / result.gdp.length
    : 0;
  const runTrough = result ? Math.min(...result.run_rate) * 100 : 100;

  // "how to do better" — composed from the same numbers, not the model
  const betterment: string[] = [];
  if (mitigation) {
    const cut = mitigation.before - mitigation.after;
    if (cut > 1000)
      betterment.push(
        `Re-source crude from suppliers with spare capacity: this alone cuts the daily gap from ${kbd(mitigation.before)} to ${kbd(mitigation.after)} — the single biggest lever.`,
      );
    if (mitigation.after > 1000)
      betterment.push(
        `The residual ${kbd(mitigation.after)} cannot be re-sourced within cited spare-capacity caps; the strategic reserve draw (≤70% of the daily gap) and price-elastic demand absorb it over the horizon.`,
      );
  }
  if (d?.hormuz)
    betterment.push(
      "Hormuz is India's crude artery — diplomacy to cap the closure's duration keeps the shortfall inside the ~10-day SPR cover.",
    );
  if (d?.redsea)
    betterment.push(
      "Red Sea losses are freight-led: naval escort of convoys converts loss into delay and cost, not a physical shortfall.",
    );
  if (d?.opec)
    betterment.push(
      "The OPEC+ cut is a price shock with no access cut — negotiating output back up is the direct counter.",
    );
  if (!betterment.length)
    betterment.push(
      "Impact is modest — normal buffer management covers it; no structural mitigation is required.",
    );

  return (
    <div className="flex h-full flex-col">
      <div className="sticky top-0 z-40 flex items-center gap-3 bg-transparent px-4 py-3 [text-shadow:0_1px_4px_rgba(0,0,0,.9)]">
        <button
          onClick={onBack}
          title="Back to FinOcean Maximus"
          className={`${HDR_LINK} text-ink-2 hover:text-ink`}
        >
          <span className="material-symbols-outlined text-[16px]">arrow_back</span>
          Back
          <Underline />
        </button>
        <h1 className="headline-sm ml-1 text-ink">Strategy Brief</h1>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        <div className="mx-auto flex max-w-[1100px] flex-col gap-6">
          {!result ? (
            <p className="body-md text-ink-3">
              Run a simulation first — the brief reads from that result.
            </p>
          ) : (
            <>
              {/* headline strip */}
              <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
                {[
                  { label: "PETROL · DAY 90", value: `₹${dPump >= 0 ? "+" : ""}${dPump.toFixed(1)}/L`, bad: dPump > 0 },
                  { label: "RUN-RATE TROUGH", value: `${runTrough.toFixed(0)}%`, bad: runTrough < 95 },
                  { label: "GDP IMPULSE", value: `${gdpMean.toFixed(1)} pp`, bad: gdpMean < 0 },
                  { label: "AFFECTED SHIPS", value: `${ships.length}`, bad: ships.length > 0 },
                ].map((k) => (
                  <div key={k.label} className="rounded-lg border border-hairline bg-panel p-4">
                    <span className="label-caps text-ink-3">{k.label}</span>
                    <p className={`data-lg mt-1 ${k.bad ? "text-critical" : "text-good-text"}`}>
                      {k.value}
                    </p>
                  </div>
                ))}
              </section>

              {/* all result graphs */}
              <section className="rounded-lg border border-hairline bg-panel p-5">
                <h2 className="headline-sm mb-3 text-ink">Projected trajectories</h2>
                <div className="grid gap-4 md:grid-cols-2">
                  <TrajChart
                    title="PETROL PRICE (₹/L)"
                    series={[{ name: "run", color: GOLD, values: result.fuel_price }]}
                    format={(v) => `₹${v.toFixed(1)}`}
                  />
                  <TrajChart
                    title="GDP GROWTH IMPULSE (pp)"
                    series={[{ name: "run", color: GOLD, values: result.gdp }]}
                    format={(v) => v.toFixed(2)}
                  />
                  <TrajChart
                    title="REFINERY UTILIZATION (%)"
                    series={[{ name: "run", color: GOLD, values: result.run_rate.map((x) => x * 100) }]}
                    format={(v) => `${v.toFixed(1)}%`}
                  />
                  <TrajChart
                    title="GRID STRESS INDEX (%)"
                    series={[{ name: "run", color: GOLD, values: result.power_stress.map((x) => x * 100) }]}
                    format={(v) => `${v.toFixed(1)}%`}
                  />
                </div>
              </section>

              {/* suggested mitigation */}
              <section className="rounded-lg border border-hairline bg-panel p-5">
                <h2 className="headline-sm mb-1 text-ink">Suggested mitigation</h2>
                {mitigation ? (
                  <>
                    <p className="body-md text-ink-2">{mitigation.objective}</p>
                    <div className="mt-3 flex flex-wrap items-center gap-3">
                      <span className="rounded-lg border border-critical/40 bg-navy-deep px-3 py-2">
                        <span className="label-caps block text-ink-3">SHORTFALL</span>
                        <span className="data-lg text-critical">{kbd(mitigation.before)}</span>
                      </span>
                      <span className="material-symbols-outlined text-secondary">arrow_forward</span>
                      <span className="rounded-lg border border-good/40 bg-navy-deep px-3 py-2">
                        <span className="label-caps block text-ink-3">AFTER RE-SOURCING</span>
                        <span className="data-lg text-good-text">{kbd(mitigation.after)}</span>
                      </span>
                    </div>
                    {mitigation.moves.length > 0 && (
                      <table className="mt-4 w-full text-left">
                        <thead className="micro-mono border-b border-hairline text-ink-3">
                          <tr>
                            <th className="py-1 pr-4 font-normal">MOVE INTERDICTED SHARE FROM</th>
                            <th className="py-1 pr-4 font-normal">TO</th>
                            <th className="py-1 text-right font-normal">SHARE</th>
                          </tr>
                        </thead>
                        <tbody className="body-md">
                          {mitigation.moves.map((m, i) => (
                            <tr key={i} className="border-b border-hairline/60">
                              <td className="py-1.5 pr-4 text-ink">{m.from}</td>
                              <td className="py-1.5 pr-4 text-ink">{m.to}</td>
                              <td className="py-1.5 text-right tabular-nums text-ink-2">
                                {(m.share * 100).toFixed(1)}%
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                    <p className="caption mt-3 text-ink-3">{mitigation.residualNote}</p>
                    {mitigation.constraints.length > 0 && (
                      <p className="caption mt-1 text-ink-3">
                        Constraints: {mitigation.constraints.join("; ")}
                      </p>
                    )}
                  </>
                ) : (
                  <p className="body-md text-ink-3">
                    Load the Simulation Dashboard (import mix + shock) to compute a
                    mitigation plan — a ship-only run has no supplier mix to re-source.
                  </p>
                )}
                {coupled && (
                  <p className="caption mt-2 text-ink-3">
                    Physical shortfall (before mitigation): {kbd(coupled.shortfallBblPerDay)}.
                  </p>
                )}
              </section>

              {/* per-refinery run rate — India map with each refinery tagged */}
              <section className="rounded-lg border border-hairline bg-panel p-5">
                <h2 className="headline-sm mb-3 text-ink">Per-refinery run rate</h2>
                <RefineryMap rows={refineries} />
                <div className="mt-3 grid gap-x-6 gap-y-1 md:grid-cols-2">
                  {refineries.map((r) => (
                    <div key={r.name} className="flex items-center justify-between gap-2">
                      <span className="body-md truncate text-ink-2" title={r.name}>
                        {r.name}
                      </span>
                      <span
                        className={`micro-mono shrink-0 tabular-nums ${
                          r.runRate * 100 < 85
                            ? "text-critical"
                            : r.runRate * 100 < 95
                              ? "text-elevated"
                              : "text-good-text"
                        }`}
                      >
                        {(r.runRate * 100).toFixed(0)}%
                      </span>
                    </div>
                  ))}
                </div>
                <p className="caption mt-3 text-ink-3">
                  Run-rate = 1 − (aggregate supply gap × port-fed weight); weights from
                  the chokepoint→port→refinery chain.
                </p>
              </section>

              {/* affected ships we loaded */}
              {ships.length > 0 && (
                <section className="rounded-lg border border-hairline bg-panel p-5">
                  <h2 className="headline-sm mb-3 text-ink">Affected ships loaded</h2>
                  <table className="w-full text-left">
                    <thead className="micro-mono border-b border-hairline text-ink-3">
                      <tr>
                        <th className="py-1 pr-4 font-normal">VESSEL</th>
                        <th className="py-1 pr-4 font-normal">EFFECT</th>
                        <th className="py-1 text-right font-normal">ADDED DAYS</th>
                      </tr>
                    </thead>
                    <tbody className="body-md">
                      {ships.map((s) => (
                        <tr key={s.props.mmsi} className="border-b border-hairline/60">
                          <td className="py-1.5 pr-4">
                            <span className="flex items-center gap-2 text-ink">
                              <span className="material-symbols-outlined text-[16px] text-ink-3">
                                directions_boat
                              </span>
                              {s.props.name}
                              {s.props.sanction && (
                                <span className="caption rounded-full border border-critical/50 px-1.5 text-critical">
                                  ⚠ SANCTIONED
                                </span>
                              )}
                            </span>
                          </td>
                          <td className="py-1.5 pr-4 text-ink-2">
                            {EFFECT_LABEL[s.effect.kind] ?? s.effect.kind}
                          </td>
                          <td className="py-1.5 text-right tabular-nums text-ink-2">
                            {s.effect.delayDays != null ? `+${s.effect.delayDays}d` : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
              )}

              {/* how to do better */}
              <section className="rounded-lg border border-secondary bg-gold-wash p-5">
                <h2 className="headline-sm mb-2 text-ink">How to do better</h2>
                <ul className="flex flex-col gap-2">
                  {betterment.map((b, i) => (
                    <li key={i} className="body-md flex gap-2 text-ink">
                      <span className="material-symbols-outlined text-[18px] text-secondary">
                        check_circle
                      </span>
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
                <p className="caption mt-3 text-ink-3">
                  Derived from this run's engine state — coefficients cited in
                  coefficients.json; the 2022 backtest is calibration, not validation.
                </p>
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
