import { useMemo, useState } from "react";
import { topDriver, type CorridorRisk } from "../lib/risk";
import { useLiveCorridorRisks } from "../hooks/useCorridorRisks";
import {
  addedDays,
  routeFromPosition,
  type Chokepoint,
} from "../lib/routeGraph";
import { mapHandle } from "../lib/mapHandle";
import { useStore, type ShipFeature } from "../store";

// status ramp (matches the map corridor coloring; no yellow — never
// collides with brand gold)
const riskColor = (p: number) =>
  p >= 0.35 ? "#d03b3b" : p >= 0.15 ? "#e8871e" : "#0ca30c";

const CORRIDOR_BLOCK: Record<string, Chokepoint[]> = {
  hormuz: ["hormuz"],
  suez: ["suez"],
  babmandeb: ["babmandeb"],
  malacca: [],
  cape: [],
};

function CorridorShips({
  risk,
  fleet,
}: {
  risk: CorridorRisk;
  fleet: ShipFeature[];
}) {
  const pi = useStore((s) => s.pi);
  const activeScenario = useStore((s) => s.activeScenario);
  const ships = useMemo(() => {
    const [minLon, minLat] = risk.corridor.polygon.reduce(
      (m, p) => [Math.min(m[0], p[0]), Math.min(m[1], p[1])],
      [Infinity, Infinity],
    );
    const [maxLon, maxLat] = risk.corridor.polygon.reduce(
      (m, p) => [Math.max(m[0], p[0]), Math.max(m[1], p[1])],
      [-Infinity, -Infinity],
    );
    const pad = 2;
    return fleet
      .filter(({ geometry: { coordinates: [lon, lat] } }) =>
        lon >= minLon - pad && lon <= maxLon + pad && lat >= minLat - pad && lat <= maxLat + pad,
      )
      .slice(0, 6);
  }, [risk, fleet]);

  const disruptionActive =
    pi >= 0.3 &&
    ((activeScenario === "hormuz" && risk.corridor.id === "hormuz") ||
      (activeScenario === "redsea" &&
        (risk.corridor.id === "babmandeb" || risk.corridor.id === "suez")));

  if (ships.length === 0)
    return (
      <p className="micro-mono px-2 py-1 text-ink-3">
        no tracked vessels in this corridor right now
      </p>
    );

  return (
    <ul className="flex flex-col gap-1 px-1 py-1">
      {ships.map((f) => {
        const blocked = new Set(CORRIDOR_BLOCK[risk.corridor.id] ?? []);
        const normal = routeFromPosition(f.geometry.coordinates, "SIKKA");
        const alt =
          blocked.size > 0
            ? routeFromPosition(f.geometry.coordinates, "SIKKA", blocked)
            : null;
        const extra =
          normal && alt
            ? addedDays(normal.nm, alt.nm, f.properties.speed || 12)
            : null;
        const impact = !disruptionActive
          ? "monitoring"
          : blocked.size === 0
            ? "delayed (congestion)"
            : alt
              ? `rerouted +${extra?.toFixed(1)}d`
              : "blocked — no sea alternative";
        return (
          <li
            key={f.properties.mmsi}
            className="micro-mono flex items-center justify-between rounded border border-hairline bg-navy-deep px-2 py-1"
          >
            <span
              className={
                f.properties.sanction ? "text-critical-text" : "text-ink-2"
              }
            >
              {f.properties.sanction === "shadow_fleet" && "🕳 "}
              {f.properties.sanction === "sanctioned" && "⛔ "}
              {f.properties.name}
            </span>
            <span
              className={
                impact.startsWith("blocked")
                  ? "text-critical-text"
                  : impact.startsWith("rerouted")
                    ? "text-elevated"
                    : "text-ink-3"
              }
            >
              {impact}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** RA2 + M6e: corridor risk with full per-signal provenance and
 *  click-through to the ships transiting each corridor. */
export default function RiskPanel() {
  const { risks: liveRisks, fleet } = useLiveCorridorRisks();
  const [open, setOpen] = useState(true);
  const selectedCorridor = useStore((s) => s.selectedCorridor);
  const setSelectedCorridor = useStore((s) => s.setSelectedCorridor);

  if (liveRisks.length === 0) return null;

  return (
    <aside className="flex w-full shrink-0 flex-col rounded-xl border border-hairline bg-panel/90 shadow-2xl backdrop-blur-md">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <span className="label-caps flex items-center gap-1 text-ink">
          Corridor Risk
        </span>
        <span className="flex items-center gap-2">
          <span className="micro-mono text-ink-3">next 30 days</span>
          <span className="text-ink-3">{open ? "▾" : "▸"}</span>
        </span>
      </button>
      {open && (
        <ul className="flex max-h-[22rem] flex-col overflow-y-auto px-2 pb-2">
          {liveRisks.map((r, i) => (
            <li key={r.corridor.id}>
              <div
                className={
                  i < liveRisks.length - 1
                    ? "border-b border-hairline/50"
                    : undefined
                }
              >
                <button
                  onClick={() => {
                    setSelectedCorridor(
                      selectedCorridor === r.corridor.id ? null : r.corridor.id,
                    );
                    mapHandle.current?.flyTo({
                      center: r.corridor.centroid,
                      zoom: 5,
                      duration: 1800,
                    });
                  }}
                  className="group w-full cursor-pointer rounded p-2 text-left transition-colors hover:bg-gold-wash"
                >
                  <span className="flex items-center justify-between">
                    <span className="body-md flex items-center gap-2 text-ink">
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ background: riskColor(r.p) }}
                      />
                      {r.corridor.name}
                    </span>
                    <span
                      className="data-lg shrink-0"
                      style={{ color: riskColor(r.p) }}
                    >
                      {(r.p * 100).toFixed(0)}%{" "}
                      <span className="micro-mono font-normal text-ink-3">
                        ± {(r.band * 100).toFixed(0)}
                      </span>
                    </span>
                  </span>
                  <span
                    className={`micro-mono pl-5 text-ink-2 ${
                      selectedCorridor === r.corridor.id
                        ? "block"
                        : "hidden group-hover:block"
                    }`}
                  >
                    driven by {topDriver(r)} · click for transiting ships
                  </span>
                </button>
                {selectedCorridor === r.corridor.id && (
                  <CorridorShips risk={r} fleet={fleet} />
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
