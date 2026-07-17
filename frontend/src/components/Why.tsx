import { useState } from "react";
import { COEFF } from "../lib/cascade";

type CoeffKey = keyof typeof COEFF;

/** Provenance popover (god-prompt rule): every shown number traces to
 *  live / derived / cited. Hover or focus the ⓘ to see the formula and
 *  the cited coefficients behind it. */
export default function Why({
  formula,
  sources,
  tag = "derived",
}: {
  formula: string;
  sources: CoeffKey[];
  tag?: "live" | "derived" | "cited" | "measured";
}) {
  const [open, setOpen] = useState(false);

  return (
    <span
      className="relative inline-block"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        aria-label={`Why? ${formula}`}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className="ml-1 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border border-hairline text-[9px] leading-none text-ink-3 hover:border-secondary hover:text-secondary"
      >
        i
      </button>
      {open && (
        <span className="absolute left-1/2 top-full z-40 mt-1 block w-72 -translate-x-1/2 rounded border border-hairline bg-navy-deep p-2.5 text-left shadow-2xl">
          <span className="label-caps mb-1 block text-[9px] text-secondary">
            {tag}
          </span>
          <span className="micro-mono block leading-snug text-ink-2">
            {formula}
          </span>
          {sources.length > 0 && (
            <span className="mt-1.5 block border-t border-hairline pt-1.5">
              {sources.map((k) => {
                const c = COEFF[k];
                return (
                  <span key={k} className="micro-mono mb-1 block leading-snug text-ink-3">
                    <span className="text-ink-2">
                      {k} = {c.value}
                    </span>{" "}
                    — {c.source} ({c.as_of})
                  </span>
                );
              })}
            </span>
          )}
        </span>
      )}
    </span>
  );
}
