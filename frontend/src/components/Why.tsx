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
        className="ml-1 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border border-white/25 text-[9px] leading-none text-slate-400 hover:border-cyan-400/50 hover:text-cyan-300"
      >
        i
      </button>
      {open && (
        <span className="absolute left-1/2 top-full z-40 mt-1 block w-72 -translate-x-1/2 rounded-lg border border-white/15 bg-[#101624]/95 p-2.5 text-left shadow-2xl backdrop-blur-md">
          <span className="mb-1 block text-[10px] uppercase tracking-wider text-cyan-300">
            {tag}
          </span>
          <span className="block text-[11px] leading-snug text-slate-200">
            {formula}
          </span>
          {sources.length > 0 && (
            <span className="mt-1.5 block border-t border-white/10 pt-1.5">
              {sources.map((k) => {
                const c = COEFF[k];
                return (
                  <span key={k} className="mb-1 block text-[10px] leading-snug text-slate-400">
                    <span className="text-slate-300">
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
