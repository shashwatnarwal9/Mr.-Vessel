import { useStore } from "../store";

export default function LayerToggle() {
  const layers = useStore((s) => s.contextLayers);
  const toggle = useStore((s) => s.toggleContextLayer);

  return (
    // top-80 = just below the fixed-height CascadePanel
    <div className="absolute left-4 top-80 z-10 flex gap-1 rounded-lg border border-white/15 bg-white/10 p-1 backdrop-blur-md">
      <span className="px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-slate-400">
        Context
      </span>
      {(["israel", "egypt"] as const).map((c) => (
        <button
          key={c}
          onClick={() => toggle(c)}
          aria-pressed={layers[c]}
          className={`rounded px-2 py-0.5 text-[11px] capitalize ${
            layers[c]
              ? "bg-white/15 text-slate-100"
              : "text-slate-500 hover:bg-white/5"
          }`}
        >
          {c}
        </button>
      ))}
    </div>
  );
}
