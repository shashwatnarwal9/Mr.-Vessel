import { useState } from "react";

/** New-user lens: every page opens with a plain one-liner, plus a
 *  dismissible first-visit "how to use" hint (persisted per page). */
export default function PageIntro({
  page,
  intro,
  hint,
}: {
  page: string;
  intro: string;
  hint: string;
}) {
  const key = `mrvessel.hint.${page}`;
  const [showHint, setShowHint] = useState(
    () => !localStorage.getItem(key),
  );

  return (
    <div className="mb-3">
      <p className="text-sm text-slate-300">{intro}</p>
      {showHint && (
        <div className="mt-2 flex items-start justify-between gap-3 rounded-lg border border-cyan-400/25 bg-cyan-500/10 px-3 py-2">
          <p className="text-xs leading-snug text-cyan-100">💡 {hint}</p>
          <button
            onClick={() => {
              localStorage.setItem(key, "seen");
              setShowHint(false);
            }}
            className="shrink-0 rounded px-1.5 text-cyan-300 hover:bg-white/10"
            aria-label="Dismiss hint"
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}
