/** First-load skeletons for the Command Map rails.
 *
 *  Bones mirror the real rows (paddings, dot size, dividers) so the swap to
 *  real data does not shift layout. RiskPanel returns null while loading so its
 *  skeleton supplies the panel shell; NewsRail renders its own header, so its
 *  skeleton replaces only the list. `animate-pulse` is already zeroed under
 *  prefers-reduced-motion in index.css. */

// bone fill: reads on --color-panel #0a0e17 without competing with real content
const BONE = "rounded bg-white/[0.07]";

/** Widths track the real corridor names so the swap is not a visible jump. */
const RISK_ROWS = [96, 74, 104, 108, 116];

export function RiskSkeleton() {
  return (
    <aside
      role="status"
      aria-label="Loading corridor risk"
      className="flex w-full shrink-0 flex-col rounded-xl border border-hairline bg-panel/90 shadow-2xl backdrop-blur-md"
    >
      {/* header is static text — render it for real, it needs no data */}
      <div className="flex w-full items-center justify-between px-4 py-3">
        <span className="label-caps text-ink">Corridor Risk</span>
        <span className="micro-mono text-ink-3">next 30 days</span>
      </div>
      <ul className="flex animate-pulse flex-col px-2 pb-2" aria-hidden="true">
        {RISK_ROWS.map((w, i) => (
          <li
            key={w}
            className={i < RISK_ROWS.length - 1 ? "border-b border-hairline/50" : undefined}
          >
            <div className="flex items-center justify-between p-2">
              <span className="flex items-center gap-2">
                <span className={`h-2 w-2 shrink-0 rounded-full bg-white/[0.07]`} />
                <span className={`h-3 ${BONE}`} style={{ width: w }} />
              </span>
              <span className={`h-4 w-11 ${BONE}`} />
            </div>
          </li>
        ))}
      </ul>
    </aside>
  );
}

/** Signals cards. Alternating second-line widths stop the block reading as a
 *  grid of identical rectangles. */
export function SignalsSkeleton() {
  return (
    <ul
      role="status"
      aria-label="Loading signals feed"
      className="flex animate-pulse flex-col gap-2"
    >
      {[0, 1, 2, 3, 4].map((i) => (
        <li key={i}>
          <div className="flex flex-col gap-1 rounded-lg border border-hairline bg-navy-deep p-2">
            <div className="flex items-center justify-between">
              <span className={`h-3 w-14 ${BONE}`} />
              <span className="h-2 w-2 shrink-0 rounded-full bg-white/[0.07]" />
            </div>
            <span className={`h-3.5 w-full ${BONE}`} />
            <span className={`h-3.5 ${BONE}`} style={{ width: i % 2 ? "62%" : "84%" }} />
            <span className={`mt-1 h-3 w-2/5 ${BONE}`} />
          </div>
        </li>
      ))}
    </ul>
  );
}
