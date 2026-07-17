import { useEffect, useState } from "react";
import { useStore } from "../store";
import { ALERT_PI_THRESHOLD } from "../lib/zones";
import { cascadePoints } from "../lib/cascadeGeo";

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

/** Cascade carousel: the Supplier → … → Sector chain one stage at a time.
 *  Stepping it walks the MAP too — each stage highlights and frames the
 *  real places it names (GlobeMap reads store.cascadeFocus). */
export default function KGPanel() {
  const pi = useStore((s) => s.pi);
  const scenario = useStore((s) => s.activeScenario);
  const setCascadeFocus = useStore((s) => s.setCascadeFocus);
  const chokepoint = CHOKEPOINT[scenario];
  const [kg, setKg] = useState<KG | null>(null);
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    setKg(null); // scenario changed → drop the stale cascade before refetching
    setIdx(0);
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

  const stages = LAYERS.map((layer) => ({
    layer,
    items: (kg?.nodes ?? []).filter((n) => n.layer === layer),
  })).filter((s) => s.items.length > 0);
  const n = stages.length;
  const i = Math.min(idx, Math.max(0, n - 1));
  const stage = stages[i];

  // walk the map with the carousel: resolve this stage's places and hand
  // them to GlobeMap (which highlights + frames them)
  useEffect(() => {
    if (!stage) {
      setCascadeFocus(null);
      return;
    }
    let alive = true;
    cascadePoints(
      stage.layer,
      stage.items.map((x) => x.name),
    )
      .then((points) => alive && setCascadeFocus({ layer: stage.layer, points }))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [stage?.layer, kg, setCascadeFocus]); // eslint-disable-line react-hooks/exhaustive-deps

  // leaving the cascade (σ drops, scenario change, tab switch) clears the map
  useEffect(() => () => setCascadeFocus(null), [setCascadeFocus]);

  if (pi < ALERT_PI_THRESHOLD || !chokepoint || !kg || n === 0 || !stage)
    return null;

  const hit = stage.layer === "Chokepoint";

  return (
    <aside
      aria-label="Supply-chain cascade, one stage at a time"
      className="absolute bottom-4 left-1/2 z-10 flex w-[30rem] max-w-[calc(100vw-42rem)] -translate-x-1/2 items-center gap-3 rounded-lg border border-hairline bg-panel/90 p-2 shadow-2xl backdrop-blur-md"
    >
      <button
        onClick={() => setIdx((i - 1 + n) % n)}
        aria-label="Previous stage"
        className="material-symbols-outlined shrink-0 rounded-full border border-hairline p-0.5 text-[18px] text-ink-2 transition-colors hover:border-secondary hover:text-ink"
      >
        chevron_left
      </button>

      <div
        className={`flex min-w-0 flex-1 items-center gap-3 rounded border bg-navy-deep px-3 py-1.5 ${
          hit
            ? "border-critical shadow-[0_0_8px_rgba(208,59,59,0.2)]"
            : "border-hairline"
        }`}
        style={{ opacity: 0.5 + 0.5 * pi }}
      >
        <span
          className={`material-symbols-outlined shrink-0 text-[20px] ${hit ? "text-critical" : "text-ink-3"}`}
        >
          {LAYER_ICON[stage.layer]}
        </span>
        <div className="min-w-0">
          <div
            className={`caption uppercase tracking-[0.08em] ${hit ? "text-critical/80" : "text-ink-3"}`}
          >
            {stage.layer}
            {i < n - 1 && ` → ${stages[i + 1].layer.toLowerCase()}`}
          </div>
          <div
            className={`micro-mono truncate ${hit ? "text-critical" : "text-ink-2"}`}
            title={stage.items.map((x) => x.name).join(", ")}
          >
            {stage.items.map((x) => x.name).join(", ")}
          </div>
        </div>
      </div>

      <span className="micro-mono shrink-0 tabular-nums text-ink-3" aria-live="polite">
        {i + 1}/{n}
      </span>
      <button
        onClick={() => setIdx((i + 1) % n)}
        aria-label="Next stage"
        className="material-symbols-outlined shrink-0 rounded-full border border-hairline p-0.5 text-[18px] text-ink-2 transition-colors hover:border-secondary hover:text-ink"
      >
        chevron_right
      </button>
      <span className="micro-mono shrink-0 pr-1 text-ink-3">({kg.mode})</span>
    </aside>
  );
}
