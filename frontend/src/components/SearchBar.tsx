import { useEffect, useRef, useState } from "react";
import { gotoPlant, gotoShip, loadPlants } from "../lib/navigate";
import { useStore, type PlantProps, type ShipProps } from "../store";

type Hit =
  | { kind: "ship"; label: string; sub: string; lonlat: [number, number]; ship: ShipProps }
  | { kind: "plant"; label: string; sub: string; lonlat: [number, number]; plant: PlantProps };

export default function SearchBar() {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const ships = useStore((s) => s.ships);

  useEffect(() => {
    const term = q.trim().toLowerCase();
    if (term.length < 2) {
      setHits([]);
      return;
    }
    let alive = true;
    (async () => {
      const plants = await loadPlants();
      const out: Hit[] = [];
      for (const f of ships?.features ?? []) {
        const p = f.properties;
        if (
          p.name.toLowerCase().includes(term) ||
          String(p.mmsi).includes(term)
        ) {
          out.push({
            kind: "ship",
            label: p.name,
            sub: `${p.type} · MMSI ${p.mmsi}`,
            lonlat: f.geometry.coordinates,
            ship: p,
          });
        }
        if (out.length >= 8) break;
      }
      for (const f of plants) {
        if (out.length >= 8) break;
        if (f.properties.name.toLowerCase().includes(term)) {
          out.push({
            kind: "plant",
            label: f.properties.name,
            sub: `${f.properties.primary_fuel} · ${f.properties.capacity_mw} MW`,
            lonlat: f.geometry.coordinates,
            plant: f.properties,
          });
        }
      }
      if (alive) setHits(out);
    })();
    return () => {
      alive = false;
    };
  }, [q, ships]);

  const select = (h: Hit) => {
    setOpen(false);
    setQ("");
    if (h.kind === "ship") gotoShip(h.ship, h.lonlat);
    else gotoPlant(h.plant, h.lonlat);
  };

  return (
    <div ref={boxRef} className="relative hidden lg:block">
      <span className="material-symbols-outlined pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[18px] text-ink-3">
        search
      </span>
      <input
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Search ships / plants…"
        aria-label="Search ships and plants"
        className="body-md h-8 w-64 rounded border border-hairline bg-navy-deep py-1 pl-8 pr-2 text-ink transition-colors placeholder:text-ink-3 focus:border-secondary focus:outline-none focus:ring-1 focus:ring-secondary"
      />
      {open && hits.length > 0 && (
        <ul className="absolute left-0 right-0 top-full z-30 mt-1 max-h-72 overflow-y-auto rounded border border-hairline bg-navy-deep shadow-2xl">
          {hits.map((h, i) => (
            <li key={i}>
              <button
                onMouseDown={() => select(h)}
                className="flex w-full flex-col px-3 py-1.5 text-left transition-colors hover:bg-gold-wash"
              >
                <span className="body-md flex items-center gap-2 text-ink">
                  <span className="material-symbols-outlined text-[14px] text-ink-3">
                    {h.kind === "ship" ? "directions_boat" : "bolt"}
                  </span>
                  {h.label}
                </span>
                <span className="micro-mono text-ink-3">{h.sub}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
