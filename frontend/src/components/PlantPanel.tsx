import { useEffect, useRef } from "react";
import { useStore } from "../store";
import { FUEL_COLORS } from "./GlobeMap";

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col">
      <dt className="label-caps text-ink-3">{label}</dt>
      <dd className="micro-mono text-ink">{value}</dd>
    </div>
  );
}

export default function PlantPanel() {
  const plant = useStore((s) => s.selectedPlant);
  const setPlant = useStore((s) => s.setSelectedPlant);
  const panelRef = useRef<HTMLElement>(null);
  // the left column stacks panels — scroll the plant card into view on select
  useEffect(() => {
    if (plant)
      panelRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [plant?.name]);
  if (!plant) return null;

  return (
    <aside
      ref={panelRef}
      className="flex w-full shrink-0 flex-col gap-3 rounded-xl border border-hairline bg-panel/90 p-4 shadow-2xl backdrop-blur-md"
    >
      <div className="flex items-start justify-between gap-2">
        <h2 className="headline-sm font-bold leading-snug text-ink">
          {plant.name}
        </h2>
        <button
          onClick={() => setPlant(null)}
          aria-label="Close plant panel"
          className="rounded px-1.5 text-ink-3 hover:text-ink"
        >
          ×
        </button>
      </div>
      <dl className="grid grid-cols-2 gap-2 border-t border-hairline pt-2">
        <Row
          label="Capacity"
          value={`${plant.capacity_mw.toLocaleString()} MW`}
        />
        <Row
          label="Fuel"
          value={
            <span className="inline-flex items-center gap-1.5">
              <span
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{
                  background: FUEL_COLORS[plant.primary_fuel] ?? "#94a3b8",
                }}
              />
              {plant.primary_fuel}
            </span>
          }
        />
        <Row label="Owner" value={plant.owner ?? "—"} />
        <Row label="Commissioned" value={plant.commissioning_year ?? "—"} />
      </dl>
    </aside>
  );
}
