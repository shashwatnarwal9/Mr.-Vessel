import { useStore } from "../store";

export default function LayerToggle() {
  const layers = useStore((s) => s.contextLayers);
  const toggle = useStore((s) => s.toggleContextLayer);
  const screening = useStore((s) => s.screening);

  return (
    // just below the CascadePanel stack
    <div className="flex shrink-0 items-center gap-1 rounded-lg border border-hairline bg-panel/90 p-1 backdrop-blur-md">
      <span className="label-caps px-1.5 py-0.5 text-[9px] text-ink-3">
        Context
      </span>
      {(["israel", "egypt"] as const).map((c) => (
        <button
          key={c}
          onClick={() => toggle(c)}
          aria-pressed={layers[c]}
          className={`label-caps rounded px-2 py-0.5 ${
            layers[c] ? "bg-raised text-ink" : "text-ink-3 hover:text-ink"
          }`}
        >
          {c}
        </button>
      ))}
      {screening && (
        <span
          className="micro-mono border-l border-hairline pl-2 pr-1 text-ink-3"
          title="vessels checked against OpenSanctions (sanctioned = red, shadow fleet = red halo)"
        >
          ⛔ {screening.matched} of {screening.screened} screened
        </span>
      )}
    </div>
  );
}
