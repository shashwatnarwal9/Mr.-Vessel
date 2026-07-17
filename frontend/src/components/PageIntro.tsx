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
      <p className="body-md text-ink-3">{intro}</p>
      {showHint && (
        <div className="mt-2 flex items-center justify-between gap-3 rounded border border-secondary bg-gold-wash p-2">
          <p className="body-md flex items-center gap-2 leading-snug text-secondary"><span className="material-symbols-outlined text-[16px]">info</span>{hint}</p>
          <button
            onClick={() => {
              localStorage.setItem(key, "seen");
              setShowHint(false);
            }}
            className="shrink-0 rounded px-1.5 text-secondary hover:text-gold-hover"
            aria-label="Dismiss hint"
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}
