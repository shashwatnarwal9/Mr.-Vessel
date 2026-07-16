import { useStore } from "../store";
import { FUEL_COLORS } from "./GlobeMap";

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 py-1 text-sm">
      <dt className="text-slate-400">{label}</dt>
      <dd className="text-right text-slate-100">{value}</dd>
    </div>
  );
}

export default function PlantPanel() {
  const plant = useStore((s) => s.selectedPlant);
  const setPlant = useStore((s) => s.setSelectedPlant);
  if (!plant) return null;

  return (
    <aside className="absolute bottom-4 left-4 z-10 w-72 rounded-xl border border-white/15 bg-white/10 p-4 shadow-2xl backdrop-blur-md">
      <div className="mb-2 flex items-start justify-between gap-2">
        <h2 className="text-sm font-semibold leading-snug text-white">
          {plant.name}
        </h2>
        <button
          onClick={() => setPlant(null)}
          aria-label="Close plant panel"
          className="rounded px-1.5 text-slate-400 hover:bg-white/10 hover:text-white"
        >
          ×
        </button>
      </div>
      <dl>
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
