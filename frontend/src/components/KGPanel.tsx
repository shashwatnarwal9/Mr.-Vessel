import { useEffect, useState } from "react";
import { useStore } from "../store";
import { ALERT_PI_THRESHOLD } from "../lib/zones";

type KGNode = { id: string; name: string; layer: string };
type KG = { nodes: KGNode[]; links: unknown[]; mode: "live" | "baked" };

const API = import.meta.env.VITE_API_HTTP ?? "http://localhost:8000";
const LAYERS = ["Supplier", "Chokepoint", "Port", "Refinery", "Product", "Sector"];

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
    fetch(`${API}/kg/cascade?chokepoint=${encodeURIComponent(chokepoint)}`)
      .then((r) => r.json())
      .then((data) => alive && setKg(data))
      .catch(() => {}); // backend absent → enrichment simply stays hidden
    return () => {
      alive = false;
    };
  }, [pi, chokepoint]);

  if (pi < ALERT_PI_THRESHOLD || !chokepoint || !kg) return null;

  return (
    <aside className="absolute bottom-4 left-1/2 z-10 max-w-3xl -translate-x-1/2 rounded-xl border border-amber-400/25 bg-white/10 px-4 py-3 shadow-2xl backdrop-blur-md">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-amber-200">
        Cascade · {chokepoint} → India supply chain ({kg.mode})
      </h2>
      <div className="flex items-start gap-3 overflow-x-auto">
        {LAYERS.map((layer, i) => {
          const items = kg.nodes.filter((n) => n.layer === layer);
          if (items.length === 0) return null;
          return (
            <div key={layer} className="flex items-center gap-3">
              {i > 0 && <span className="text-amber-400/60">→</span>}
              <div>
                <div className="mb-1 text-[10px] uppercase tracking-wider text-slate-400">
                  {layer}
                </div>
                <div className="flex max-w-40 flex-wrap gap-1">
                  {items.map((n) => (
                    <span
                      key={n.id}
                      className="rounded border border-amber-400/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-100"
                      style={{ opacity: 0.5 + 0.5 * pi }}
                    >
                      {n.name}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
