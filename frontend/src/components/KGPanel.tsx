import { useEffect, useState } from "react";
import { useStore } from "../store";
import { ALERT_PI_THRESHOLD } from "../lib/zones";

type KGNode = { id: string; name: string; layer: string };
type KG = { nodes: KGNode[]; links: unknown[]; mode: "live" | "baked" };

const API = import.meta.env.VITE_API_HTTP ?? "http://localhost:8000";
const LAYERS = ["Supplier", "Chokepoint", "Port", "Refinery", "Product", "Sector"];

// Stitch s1 cascade-chain icons, one per layer
const LAYER_ICON: Record<string, string> = {
  Supplier: "factory",
  Chokepoint: "explore",
  Port: "directions_boat",
  Refinery: "oil_barrel",
  Product: "local_gas_station",
  Sector: "domain",
};

// OPEC is a price shock, not a chokepoint — it has no supply-chain cascade
const CHOKEPOINT: Record<string, string | null> = {
  hormuz: "Hormuz",
  redsea: "Red Sea",
  opec: null,
};

export default function KGPanel() {
  const pi = useStore((s) => s.pi);
  const scenario = useStore((s) => s.activeScenario);
  const chokepoint = CHOKEPOINT[scenario];
  const [kg, setKg] = useState<KG | null>(null);

  useEffect(() => {
    setKg(null); // scenario changed → drop the stale cascade before refetching
    if (pi < ALERT_PI_THRESHOLD || !chokepoint) return;
    let alive = true;
    // debounce: a preset σ-ramp changes pi every tick — fetch once it settles
    const t = setTimeout(() => {
      fetch(`${API}/kg/cascade?chokepoint=${encodeURIComponent(chokepoint)}`)
        .then((r) => r.json())
        .then((data) => alive && setKg(data))
        .catch(() => {}); // backend absent → enrichment simply stays hidden
    }, 300);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [pi, chokepoint]);

  if (pi < ALERT_PI_THRESHOLD || !chokepoint || !kg) return null;

  return (
    <aside className="absolute bottom-4 left-1/2 z-10 flex max-w-[min(72rem,calc(100vw-40rem))] -translate-x-1/2 items-center gap-2 overflow-x-auto rounded-lg border border-hairline bg-panel/90 p-2 shadow-2xl backdrop-blur-md">
      {LAYERS.map((layer, i) => {
        const items = kg.nodes.filter((n) => n.layer === layer);
        if (items.length === 0) return null;
        const hit = layer === "Chokepoint";
        return (
          <div key={layer} className="flex shrink-0 items-center gap-2">
            {i > 0 && (
              <span className="material-symbols-outlined text-[16px] text-ink-3">
                arrow_right_alt
              </span>
            )}
            <div
              className={`flex items-center gap-2 whitespace-nowrap rounded border bg-navy-deep px-3 py-1.5 ${
                hit
                  ? "border-critical shadow-[0_0_8px_rgba(208,59,59,0.2)]"
                  : "border-hairline"
              }`}
              style={{ opacity: 0.5 + 0.5 * pi }}
            >
              <span
                className={`material-symbols-outlined text-[14px] ${hit ? "text-critical" : "text-ink-3"}`}
              >
                {LAYER_ICON[layer]}
              </span>
              <span className="flex flex-col">
                <span
                  className={`label-caps text-[8px] ${hit ? "text-critical/80" : "text-ink-3"}`}
                >
                  {layer}
                </span>
                <span
                  className={`micro-mono ${hit ? "text-critical" : "text-ink-2"}`}
                >
                  {items.map((n) => n.name).join(", ")}
                </span>
              </span>
            </div>
          </div>
        );
      })}
      <span className="micro-mono shrink-0 pl-1 text-ink-3">({kg.mode})</span>
    </aside>
  );
}
