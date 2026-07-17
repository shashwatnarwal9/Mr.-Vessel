import { useStore } from "../store";

export default function NarrativeCard() {
  const narrative = useStore((s) => s.narrative);
  const setNarrative = useStore((s) => s.setNarrative);
  if (!narrative) return null;

  return (
    <div className="absolute bottom-24 left-1/2 z-20 w-[34rem] -translate-x-1/2 rounded-lg border border-hairline bg-panel/90 px-4 py-3 shadow-2xl backdrop-blur-md">
      <div className="flex items-start justify-between gap-3">
        <p className="body-md leading-relaxed text-ink-2">{narrative}</p>
        <button
          onClick={() => setNarrative(null)}
          aria-label="Dismiss scenario narrative"
          className="rounded px-1.5 text-ink-3 hover:text-ink"
        >
          ×
        </button>
      </div>
    </div>
  );
}
