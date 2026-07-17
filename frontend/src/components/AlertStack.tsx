import { useState } from "react";
import { useStore } from "../store";
import {
  ALERT_PI_THRESHOLD,
  HORMUZ_ZONE,
  REDSEA_ZONE,
  inZone,
} from "../lib/zones";
import { mapHandle } from "../lib/mapHandle";

const ZONES = { hormuz: HORMUZ_ZONE, redsea: REDSEA_ZONE } as const;
const ZONE_LABEL = { hormuz: "Hormuz", redsea: "Red Sea" } as const;

/** Disruption-zone alerts as a one-at-a-time carousel above the Signals
 *  rail — prev/next steps through the affected vessels. */
export default function AlertStack() {
  const pi = useStore((s) => s.pi);
  const ships = useStore((s) => s.ships);
  const zoneName = useStore((s) => s.activeZone);
  const setShip = useStore((s) => s.setSelectedShip);
  const [dismissed, setDismissed] = useState<Set<number>>(new Set());
  const [idx, setIdx] = useState(0);

  if (pi < ALERT_PI_THRESHOLD || !ships || !zoneName) return null;
  const zone = ZONES[zoneName];
  const alerts = ships.features.filter(
    (f) =>
      inZone(f.geometry.coordinates[0], f.geometry.coordinates[1], zone) &&
      !dismissed.has(f.properties.mmsi),
  );
  if (alerts.length === 0) return null;

  const i = Math.min(idx, alerts.length - 1);
  const f = alerts[i];

  return (
    <div
      className="shrink-0 rounded-lg border border-critical bg-error-deep px-4 py-2 shadow-[0_0_16px_rgba(208,59,59,0.3)]"
      role="alert"
      aria-label="Vessels in disrupted zone"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="label-caps flex items-center gap-2 tracking-wide text-ink">
          <span className="material-symbols-outlined animate-pulse text-[16px]">
            warning
          </span>
          {f.properties.name} in {ZONE_LABEL[zoneName]} disruption zone
        </span>
        <span className="flex shrink-0 gap-1">
          <button
            onClick={() => {
              setShip({
                ...f.properties,
                lon: f.geometry.coordinates[0],
                lat: f.geometry.coordinates[1],
              });
              mapHandle.current?.flyTo({
                center: f.geometry.coordinates,
                zoom: 6.5,
                duration: 1800,
              });
            }}
            className="label-caps rounded border border-hairline px-2 py-0.5 text-ink-2 transition-colors hover:text-ink"
          >
            view
          </button>
          <button
            onClick={() => {
              setDismissed((d) => new Set(d).add(f.properties.mmsi));
              setIdx(0);
            }}
            aria-label={`Dismiss alert for ${f.properties.name}`}
            className="label-caps rounded border border-hairline px-2 py-0.5 text-ink-2 transition-colors hover:text-ink"
          >
            close
          </button>
        </span>
      </div>
      <div className="mt-1 flex items-center justify-between">
        <span className="micro-mono pl-6 text-ink-2">
          {f.properties.type} · {f.properties.speed} kn → {f.properties.dest}
        </span>
        {alerts.length > 1 && (
          <span className="flex items-center gap-1">
            <button
              onClick={() => setIdx((i - 1 + alerts.length) % alerts.length)}
              aria-label="Previous alert"
              className="material-symbols-outlined rounded text-[16px] text-ink-2 transition-colors hover:text-ink"
            >
              chevron_left
            </button>
            <span className="micro-mono tabular-nums text-ink-2">
              {i + 1}/{alerts.length}
            </span>
            <button
              onClick={() => setIdx((i + 1) % alerts.length)}
              aria-label="Next alert"
              className="material-symbols-outlined rounded text-[16px] text-ink-2 transition-colors hover:text-ink"
            >
              chevron_right
            </button>
          </span>
        )}
      </div>
    </div>
  );
}
