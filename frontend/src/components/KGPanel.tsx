import { useEffect, useRef, useState } from "react";
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

// Session-scoped memory (module-level → survives component unmount/remount, so
// navigating away and back never re-fires autoplay or un-dismisses the strip;
// resets only on a full page reload, which is the "render session" boundary).
let cascadeDismissed = false; // ✕ stays dismissed for the whole session
let cascadeHintShown = false; // the ✕ nudge appears once, not on every visit

/** Cascade carousel: the Supplier → … → Sector chain one stage at a time.
 *  Stepping it walks the MAP too — each stage highlights and frames the
 *  real places it names (GlobeMap reads store.cascadeFocus).
 *
 *  It never advances on its own: the user steps it with next/prev, or presses
 *  ▶ to walk 1→N on demand (halts on the last stage, no wrap). */
export default function KGPanel() {
  const pi = useStore((s) => s.pi);
  const scenario = useStore((s) => s.activeScenario);
  const setCascadeFocus = useStore((s) => s.setCascadeFocus);
  const setPi = useStore((s) => s.setPi);
  const setNarrative = useStore((s) => s.setNarrative);
  const chokepoint = CHOKEPOINT[scenario];
  const [kg, setKg] = useState<KG | null>(null);
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  // dismiss is session-global — once closed it stays closed (module flag), so
  // it never reappears on re-render or navigation back to this view
  const [dismissed, setDismissed] = useState(() => cascadeDismissed);
  // a manual step during autoplay hands control to the user for good
  const userSteppedRef = useRef(false);
  // ✕ nudge: visible 5s, then fades out over 700ms and unmounts. Once per
  // session, like the dismiss itself — it should never nag on every visit.
  const [hint, setHint] = useState<"show" | "fading" | "gone">(
    cascadeHintShown ? "gone" : "show",
  );
  const hintStartedRef = useRef(false);

  // scenario change → drop the stale cascade and rewind to stage 1 (but do NOT
  // un-dismiss: a session dismiss is sticky)
  useEffect(() => {
    setKg(null);
    setIdx(0);
    setPlaying(false);
    userSteppedRef.current = false;
  }, [chokepoint]);

  // Fetch keyed on a BOOLEAN gate, not pi itself: a preset σ-ramp changes pi
  // every 350ms, and keying on pi re-ran this each tick (blank→stage-1 flicker,
  // the "keeps playing again" bug). The gate flips once when σ crosses the
  // threshold, so the cascade fetches once and then holds.
  const active = pi >= ALERT_PI_THRESHOLD && !!chokepoint;
  useEffect(() => {
    if (!active || !chokepoint) return;
    let alive = true;
    fetch(`${API}/kg/cascade?chokepoint=${encodeURIComponent(chokepoint)}`)
      .then((r) => r.json())
      .then((data) => alive && setKg(data))
      .catch(() => {}); // backend absent → enrichment simply stays hidden
    return () => {
      alive = false;
    };
  }, [active, chokepoint]);

  const stages = LAYERS.map((layer) => ({
    layer,
    items: (kg?.nodes ?? []).filter((n) => n.layer === layer),
  })).filter((s) => s.items.length > 0);
  const n = stages.length;
  const i = Math.min(idx, Math.max(0, n - 1));
  const stage = stages[i];

  // NO autoplay: the cascade advances only when the user steps it (▶ / next).

  // play: advance one stage every 2.5s, then STOP at the last stage (Sector)
  // — deliberately no wraparound, so it never loops forever
  useEffect(() => {
    if (!playing) return;
    if (i >= n - 1) {
      setPlaying(false);
      return;
    }
    const t = setTimeout(() => setIdx(i + 1), 2500);
    return () => clearTimeout(t);
  }, [playing, i, n]);

  // a manual step (arrow) cancels autoplay and hands control to the user
  const step = (to: number) => {
    userSteppedRef.current = true;
    setPlaying(false);
    setIdx(((to % n) + n) % n);
  };
  // ▶ replays once on demand: from the last stage it rewinds first
  const togglePlay = () => {
    if (playing) {
      setPlaying(false);
      return;
    }
    userSteppedRef.current = true; // user-initiated, so autoplay won't re-fire
    if (i >= n - 1) setIdx(0);
    setPlaying(true);
  };

  // walk the map with the carousel: resolve this stage's places and hand
  // them to GlobeMap (which highlights + frames them)
  useEffect(() => {
    // dismissed → drop the map focus so the dimming/highlight clears too
    if (dismissed || !stage) {
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
  }, [stage?.layer, kg, setCascadeFocus, dismissed]); // eslint-disable-line react-hooks/exhaustive-deps

  // leaving the cascade (σ drops, scenario change, tab switch) clears the map
  useEffect(() => () => setCascadeFocus(null), [setCascadeFocus]);

  // the strip is only on screen once σ crosses AND the cascade has loaded
  const visible =
    !dismissed && pi >= ALERT_PI_THRESHOLD && !!chokepoint && !!kg && n > 0 && !!stage;

  // start the nudge's clock when the strip actually APPEARS, not when this
  // component mounts — it mounts on page load, long before σ crosses, so a
  // mount-time timer had already expired by the time anyone could see it.
  // deps are [visible] ONLY. Depending on `hint` meant the fade at 5s re-ran
  // this effect, and its cleanup cancelled the still-pending unmount timer —
  // the nudge then sat invisible-but-mounted forever.
  useEffect(() => {
    if (!visible || hintStartedRef.current || cascadeHintShown) return;
    hintStartedRef.current = true;
    cascadeHintShown = true;
    const fade = setTimeout(() => setHint("fading"), 5000);
    const drop = setTimeout(() => setHint("gone"), 5700);
    return () => {
      clearTimeout(fade);
      clearTimeout(drop);
    };
  }, [visible]);

  if (!visible) return null;

  const hit = stage.layer === "Chokepoint";

  return (
    <aside
      aria-label="Supply-chain cascade, one stage at a time"
      className="absolute bottom-4 left-1/2 z-10 flex w-[30rem] max-w-[calc(100vw-42rem)] -translate-x-1/2 items-center gap-3 rounded-lg border border-hairline bg-panel/90 p-2 shadow-2xl backdrop-blur-md"
    >
      <button
        onClick={() => step(i - 1)}
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
        onClick={togglePlay}
        aria-label={playing ? "Pause auto-play" : "Play through stages"}
        title={playing ? "Pause" : "Play"}
        className={`material-symbols-outlined shrink-0 rounded-full border p-0.5 text-[18px] transition-colors ${
          playing
            ? "border-secondary text-secondary"
            : "border-hairline text-ink-2 hover:border-secondary hover:text-ink"
        }`}
      >
        {playing ? "pause" : "play_arrow"}
      </button>
      <button
        onClick={() => step(i + 1)}
        aria-label="Next stage"
        className="material-symbols-outlined shrink-0 rounded-full border border-hairline p-0.5 text-[18px] text-ink-2 transition-colors hover:border-secondary hover:text-ink"
      >
        chevron_right
      </button>
      <span className="micro-mono shrink-0 text-ink-3">({kg.mode})</span>
      <button
        onClick={() => {
          // full reset: end the scenario, drop σ, clear the map focus/narrative
          cascadeDismissed = true; // sticky for the session
          setPlaying(false);
          setDismissed(true);
          setCascadeFocus(null);
          setNarrative(null);
          setPi(0);
        }}
        aria-label="Close simulation"
        title="Close"
        className="material-symbols-outlined shrink-0 rounded-full border border-hairline p-0.5 text-[18px] text-ink-2 transition-colors hover:border-critical hover:text-critical"
      >
        close
      </button>

      {/* one-time nudge pointing at ✕. Shows for 5s then fades itself out;
          aria-hidden + pointer-events-none so it never traps a click or
          gets announced twice (the button already has its own label). */}
      {hint !== "gone" && (
        <div
          aria-hidden="true"
          className={`pointer-events-none absolute bottom-full right-1 mb-2 flex flex-col items-center transition-opacity duration-700 ${
            hint === "fading" ? "opacity-0" : "opacity-100"
          } motion-reduce:transition-none`}
        >
          <span className="caption whitespace-nowrap rounded-md border border-secondary/60 bg-navy-deep/95 px-2.5 py-1 text-secondary shadow-lg backdrop-blur-sm">
            To stop the animation, click here
          </span>
          {/* stem + arrowhead pointing down at the ✕ */}
          <span className="h-2 w-px bg-secondary/60" />
          <span className="material-symbols-outlined -mt-1 text-[16px] leading-none text-secondary">
            arrow_drop_down
          </span>
        </div>
      )}
    </aside>
  );
}
