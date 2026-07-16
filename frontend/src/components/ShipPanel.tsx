import { useEffect, useState } from "react";
import { useStore } from "../store";
import { etaDays, rerouteDelta } from "../lib/reroute";
import { classifyShip, estimateCargoBbl } from "../lib/ships";
import {
  loadSanctionsIndex,
  screenVessel,
  type SanctionsFile,
  type ScreenResult,
} from "../lib/sanctions";
import { ALERT_PI_THRESHOLD, HORMUZ_ZONE, inZone } from "../lib/zones";

const CLASS_STYLE: Record<string, string> = {
  inbound: "bg-cyan-500/20 text-cyan-200",
  outbound: "bg-amber-500/20 text-amber-200",
  transit: "bg-white/10 text-slate-300",
};

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 py-1 text-sm">
      <dt className="text-slate-400">{label}</dt>
      <dd className="text-right text-slate-100">{value}</dd>
    </div>
  );
}

export default function ShipPanel() {
  const ship = useStore((s) => s.selectedShip);
  const setShip = useStore((s) => s.setSelectedShip);
  const startSimulationWith = useStore((s) => s.startSimulationWith);
  const shipsMode = useStore((s) => s.shipsMode);
  const pi = useStore((s) => s.pi);
  // hooks stay unconditional — the no-ship guard lives inside/below them
  const [screen, setScreen] = useState<ScreenResult | null>(null);
  const [meta, setMeta] = useState<SanctionsFile["meta"] | null>(null);
  useEffect(() => {
    if (!ship) return;
    let alive = true;
    setScreen(null);
    loadSanctionsIndex()
      .then(({ idx, meta }) => {
        if (!alive) return;
        setMeta(meta);
        setScreen(screenVessel(idx, { mmsi: ship.mmsi, name: ship.name }));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [ship?.mmsi, ship?.name]);

  if (!ship) return null;

  const classification = classifyShip(ship, [ship.lon, ship.lat]);
  const cargo = estimateCargoBbl(ship.type);
  const eta = etaDays([ship.lon, ship.lat], ship.speed, ship.dest);
  // π-scaled reroute penalty applies to vessels inside the disrupted zone
  const rerouted =
    pi >= ALERT_PI_THRESHOLD && inZone(ship.lon, ship.lat, HORMUZ_ZONE);
  const added = rerouted ? pi * rerouteDelta("hormuz").addedDays : 0;

  return (
    <aside className="absolute bottom-4 left-4 z-10 w-72 rounded-xl border border-white/15 bg-white/10 p-4 shadow-2xl backdrop-blur-md">
      <div className="mb-2 flex items-start justify-between gap-2">
        <h2 className="text-sm font-semibold leading-snug text-white">
          {ship.name}
          <span
            className={`ml-2 rounded px-1.5 py-0.5 align-middle text-[10px] font-normal ${
              shipsMode === "live"
                ? "bg-emerald-500/20 text-emerald-200"
                : "bg-white/10 text-slate-400"
            }`}
          >
            {shipsMode === "live" ? "live AIS" : "demo fleet — simulated position"}
          </span>
        </h2>
        <button
          onClick={() => setShip(null)}
          aria-label="Close ship panel"
          className="rounded px-1.5 text-slate-400 hover:bg-white/10 hover:text-white"
        >
          ×
        </button>
      </div>
      <dl>
        <Row label="MMSI" value={ship.mmsi} />
        <Row label="Type" value={ship.type} />
        <Row label="Course" value={`${ship.course}°`} />
        <Row label="Speed" value={`${ship.speed} kn`} />
        <Row label="Destination" value={ship.dest} />
        <Row
          label="vs India"
          value={
            <span
              className={`rounded px-1.5 py-0.5 text-[11px] ${CLASS_STYLE[classification]}`}
            >
              {classification}
            </span>
          }
        />
        <Row
          label="Est. cargo"
          value={cargo > 0 ? `${(cargo / 1e6).toFixed(1)}M bbl` : "—"}
        />
        {eta !== null && (
          <Row
            label="ETA"
            value={
              added > 0 ? (
                <span className="text-amber-300">
                  {(eta + added).toFixed(1)} d (+{added.toFixed(1)} reroute)
                </span>
              ) : (
                `${eta.toFixed(1)} d`
              )
            }
          />
        )}
      </dl>
      {/* RA1: sanctions status from baked OpenSanctions data */}
      <div className="mt-3 border-t border-white/10 pt-2">
        <div className="mb-1 text-[11px] uppercase tracking-wider text-slate-400">
          Sanctions status
        </div>
        {screen === null && (
          <div className="text-xs text-slate-500">screening…</div>
        )}
        {screen?.status === "match" && (
          <div className="flex flex-col gap-1">
            <div className="flex flex-wrap gap-1">
              <span
                className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${
                  screen.vessel.tier === "sanctioned"
                    ? "bg-red-500/25 text-red-200"
                    : "bg-amber-500/25 text-amber-200"
                }`}
              >
                {screen.vessel.tier === "sanctioned" ? "⛔ Sanctioned" : "🕳 Shadow fleet"}
              </span>
              {screen.focFlag && (
                <span className="rounded bg-white/10 px-1.5 py-0.5 text-[11px] text-slate-300">
                  🏴 flag of convenience ({screen.vessel.flag.toUpperCase()})
                </span>
              )}
            </div>
            <ul className="text-[11px] text-slate-300">
              {screen.labels.map((l) => (
                <li key={l}>• {l}</li>
              ))}
            </ul>
            <a
              href={screen.vessel.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] text-cyan-300 underline decoration-cyan-300/40 hover:text-cyan-200"
            >
              source: OpenSanctions (matched on {screen.matchedOn.toUpperCase()})
            </a>
          </div>
        )}
        {screen?.status === "clean" && (
          <div className="text-xs text-slate-400">
            Not on sanctions watchlist (screened by{" "}
            {screen.screenedOn.join("/")})
          </div>
        )}
        {meta && (
          <div className="mt-1 text-[10px] text-slate-500">
            vs {meta.baked.toLocaleString()} listed vessels · OpenSanctions ·{" "}
            {meta.as_of}
          </div>
        )}
      </div>
      {classification !== "transit" && cargo > 0 && (
        <button
          onClick={() => startSimulationWith(ship)}
          className="mt-3 w-full rounded-lg border border-cyan-400/30 bg-cyan-500/15 px-3 py-1.5 text-sm font-medium text-cyan-200 hover:bg-cyan-500/25"
        >
          ▶ Start Simulation
        </button>
      )}
    </aside>
  );
}
