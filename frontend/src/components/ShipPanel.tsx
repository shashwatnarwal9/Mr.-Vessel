import { useEffect, useRef, useState } from "react";
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
  outbound: "bg-violet-500/20 text-violet-200",
  transit: "bg-white/10 text-slate-300",
};

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col">
      <dt className="label-caps text-[9px] text-ink-3">{label}</dt>
      <dd className="micro-mono text-ink">{value}</dd>
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
  const panelRef = useRef<HTMLElement>(null);
  // the left column stacks panels — scroll the ship card into view on select
  useEffect(() => {
    if (ship)
      panelRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [ship?.mmsi]);
  useEffect(() => {
    if (!ship) return;
    let alive = true;
    setScreen(null);
    loadSanctionsIndex()
      .then(({ idx, meta }) => {
        if (!alive) return;
        setMeta(meta);
        setScreen(
          screenVessel(idx, {
            imo: ship.imo ? String(ship.imo) : undefined,
            mmsi: ship.mmsi,
            name: ship.name,
          }),
        );
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
    <aside
      ref={panelRef}
      className="flex w-full shrink-0 flex-col gap-3 rounded-xl border border-hairline bg-panel/90 p-4 shadow-2xl backdrop-blur-md"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col">
          <h2 className="headline-sm font-bold leading-snug text-ink">
            {ship.name}
          </h2>
          <span className="micro-mono text-ink-3">
            MMSI {ship.mmsi} | {ship.type.toUpperCase()}
          </span>
          <span
            className={`micro-mono mt-1 ${
              shipsMode === "live" ? "text-good-text" : "text-ink-3"
            }`}
          >
            {shipsMode === "live" ? "● live AIS" : "● demo fleet — simulated position"}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {screen?.status === "match" && (
            <span
              className={`material-symbols-outlined text-[16px] ${
                screen.vessel.tier === "sanctioned"
                  ? "text-critical"
                  : "text-ink-2"
              }`}
              title={
                screen.vessel.tier === "sanctioned" ? "Sanctioned" : "Shadow fleet"
              }
            >
              {screen.vessel.tier === "sanctioned"
                ? "do_not_disturb_on"
                : "blur_circular"}
            </span>
          )}
          <button
            onClick={() => setShip(null)}
            aria-label="Close ship panel"
            className="rounded px-1.5 text-ink-3 hover:text-ink"
          >
            ×
          </button>
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-2 border-b border-t border-hairline py-2">
        {ship.imo && <Row label="IMO" value={ship.imo} />}
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
                <span className="text-elevated">
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
      <div>
        <div className="label-caps mb-1 text-[9px] text-ink-3">
          Sanctions status
        </div>
        {screen === null && (
          <div className="micro-mono text-ink-3">screening…</div>
        )}
        {screen?.status === "match" && (
          <div className="flex flex-col gap-1">
            <div className="flex flex-wrap gap-1">
              <span
                className={`label-caps rounded px-1.5 py-0.5 ${
                  screen.vessel.tier === "sanctioned"
                    ? "bg-critical/25 text-critical-text"
                    : "bg-elevated/25 text-elevated"
                }`}
              >
                {screen.vessel.tier === "sanctioned" ? "⛔ Sanctioned" : "🕳 Shadow fleet"}
              </span>
              {screen.focFlag && (
                <span className="label-caps rounded border border-hairline bg-navy-deep px-1.5 py-0.5 text-ink-2">
                  🏴 FoC ({screen.vessel.flag.toUpperCase()})
                </span>
              )}
            </div>
            <ul className="micro-mono text-ink-2">
              {screen.labels.map((l) => (
                <li key={l}>• {l}</li>
              ))}
            </ul>
            <a
              href={screen.vessel.url}
              target="_blank"
              rel="noopener noreferrer"
              className="micro-mono text-secondary underline decoration-secondary/40 hover:text-gold-hover"
            >
              source: OpenSanctions (matched on {screen.matchedOn.toUpperCase()})
            </a>
          </div>
        )}
        {screen?.status === "clean" && (
          <div className="micro-mono text-ink-2">
            Not on sanctions watchlist (screened by{" "}
            {screen.screenedOn.join("/")})
          </div>
        )}
        {meta && (
          <div className="micro-mono mt-1 text-ink-3">
            vs {meta.baked.toLocaleString()} listed vessels · OpenSanctions ·{" "}
            {meta.as_of}
          </div>
        )}
      </div>
      {classification !== "transit" && cargo > 0 && (
        <button
          onClick={() => startSimulationWith(ship)}
          className="label-caps flex w-full items-center justify-center gap-2 rounded bg-secondary py-2 font-bold text-navy transition-colors hover:bg-gold-hover"
        >
          <span className="material-symbols-outlined text-[16px]">
            play_arrow
          </span>{" "}
          Start Simulation
        </button>
      )}
    </aside>
  );
}
