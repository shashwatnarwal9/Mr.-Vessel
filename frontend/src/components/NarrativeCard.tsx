import { useStore } from "../store";

export default function NarrativeCard() {
  const narrative = useStore((s) => s.narrative);
  const setNarrative = useStore((s) => s.setNarrative);
  if (!narrative) return null;

  return (
    <div className="absolute bottom-24 left-1/2 z-20 w-[34rem] -translate-x-1/2 rounded-xl border border-amber-400/25 bg-black/60 px-4 py-3 shadow-2xl backdrop-blur-md">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs leading-relaxed text-amber-100/90">{narrative}</p>
        <button
          onClick={() => setNarrative(null)}
          aria-label="Dismiss scenario narrative"
          className="rounded px-1.5 text-slate-400 hover:bg-white/10 hover:text-white"
        >
          ×
        </button>
      </div>
    </div>
  );
}
