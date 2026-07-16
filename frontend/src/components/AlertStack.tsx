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

export default function AlertStack() {
  const pi = useStore((s) => s.pi);
  const ships = useStore((s) => s.ships);
  const zoneName = useStore((s) => s.activeZone);
  const setShip = useStore((s) => s.setSelectedShip);
  const [dismissed, setDismissed] = useState<Set<number>>(new Set());

  if (pi < ALERT_PI_THRESHOLD || !ships || !zoneName) return null;
  const zone = ZONES[zoneName];
  const alerts = ships.features.filter(
    (f) =>
      inZone(f.geometry.coordinates[0], f.geometry.coordinates[1], zone) &&
      !dismissed.has(f.properties.mmsi),
  );
  if (alerts.length === 0) return null;

  return (
    <div
      className="absolute left-1/2 top-16 z-20 flex max-h-72 w-96 -translate-x-1/2 flex-col gap-2 overflow-y-auto"
      role="alert"
      aria-label="Vessels in disrupted zone"
    >
      {alerts.map((f) => (
        <div
          key={f.properties.mmsi}
          className="rounded-lg border border-red-400/30 bg-red-950/50 px-3 py-2 shadow-xl backdrop-blur-md"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-red-200">
              ⚠ {f.properties.name} in {ZONE_LABEL[zoneName]} disruption zone
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
                className="rounded bg-white/10 px-2 py-0.5 text-[11px] text-slate-200 hover:bg-white/20"
              >
                view
              </button>
              <button
                onClick={() =>
                  setDismissed((d) => new Set(d).add(f.properties.mmsi))
                }
                aria-label={`Dismiss alert for ${f.properties.name}`}
                className="rounded bg-white/10 px-2 py-0.5 text-[11px] text-slate-300 hover:bg-white/20"
              >
                close
              </button>
            </span>
          </div>
          <div className="mt-0.5 text-[11px] text-red-300/70">
            {f.properties.type} · {f.properties.speed} kn → {f.properties.dest}
          </div>
        </div>
      ))}
    </div>
  );
}
