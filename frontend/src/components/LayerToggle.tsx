import { useStore } from "../store";

export default function LayerToggle() {
  const layers = useStore((s) => s.contextLayers);
  const toggle = useStore((s) => s.toggleContextLayer);
  const screening = useStore((s) => s.screening);

  return (
    // just below the CascadePanel stack
    <div className="flex shrink-0 flex-wrap items-center gap-1 rounded-lg border border-hairline bg-panel/90 p-1 backdrop-blur-md">
      <span className="label-caps px-1.5 py-0.5 text-ink-3">
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
          className="micro-mono ml-1 flex items-center gap-1 rounded-full border border-hairline bg-navy-deep px-2 py-0.5 text-ink-2"
          title="vessels checked against OpenSanctions (sanctioned = red, shadow fleet = red halo)"
        >
          ⛔{" "}
          <span className="font-bold text-critical-text">
            {screening.matched}
          </span>{" "}
          of {screening.screened} screened
        </span>
      )}
    </div>
  );
}
