import { useEffect, useRef, useState } from "react";

/** M-DECK: stacked-card carousel modal. One card in front, 2–3 peeking
 *  behind (offset + scale + fading opacity) so the stack reads as physical
 *  depth. Advancing is transform+opacity only (~300ms, eased); with
 *  prefers-reduced-motion it becomes a plain cross-fade. Keyboard (←/→,
 *  Esc), swipe, and click-to-advance all work; focus is trapped.
 *  Purely presentational — cards carry the caller's existing values. */
export type DeckCard = { id: string; body: React.ReactNode };

export default function CardDeck({
  title,
  cards,
  onClose,
}: {
  title: string;
  cards: DeckCard[];
  onClose: () => void;
}) {
  const [cur, setCur] = useState(0);
  const n = cards.length;
  // advancing past the LAST card closes the deck (back to the view)
  const next = () => (cur >= n - 1 ? onClose() : setCur((c) => c + 1));
  const prev = () => setCur((c) => Math.max(0, c - 1));
  const dialogRef = useRef<HTMLDivElement>(null);
  const touchX = useRef<number | null>(null);
  const reduced =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") onClose();
    else if (e.key === "ArrowRight") next();
    else if (e.key === "ArrowLeft") prev();
    else if (e.key === "Tab") {
      // trap: cycle through the dialog's VISIBLE focusables only
      const els = [
        ...(dialogRef.current?.querySelectorAll<HTMLElement>(
          "button, a[href], input, select",
        ) ?? []),
      ].filter((el) => !el.closest("[aria-hidden='true']"));
      if (els.length === 0) return;
      const first = els[0];
      const last = els[els.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  const slot = (i: number) => (i - cur + n) % n; // 0 = front of the deck

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-navy-deep/80 p-8 backdrop-blur-sm focus:outline-none"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex w-[36rem] max-w-full flex-col gap-3"
      >
        <header className="flex items-center justify-between">
          <span className="headline-sm text-ink">{title}</span>
          <span className="flex items-center gap-3">
            <span aria-live="polite" className="micro-mono text-ink-2">
              {cur + 1} / {n}
            </span>
            <button
              onClick={onClose}
              aria-label="Close deck"
              title="Close (Esc)"
              className="material-symbols-outlined rounded text-[20px] text-ink-3 transition-colors hover:text-ink"
            >
              close
            </button>
          </span>
        </header>

        {/* the deck: all cards absolutely stacked; slot() decides depth */}
        <div
          className="relative h-[26rem]"
          onTouchStart={(e) => {
            touchX.current = e.touches[0].clientX;
          }}
          onTouchEnd={(e) => {
            if (touchX.current === null) return;
            const dx = e.changedTouches[0].clientX - touchX.current;
            if (dx < -40) next();
            else if (dx > 40) prev();
            touchX.current = null;
          }}
        >
          {cards.map((card, i) => {
            const s = slot(i);
            const style: React.CSSProperties = reduced
              ? {
                  opacity: s === 0 ? 1 : 0,
                  zIndex: n - s,
                  transition: "opacity 300ms ease",
                }
              : {
                  transform: `translateY(${Math.min(s, 3) * 10}px) scale(${1 - Math.min(s, 3) * 0.04})`,
                  opacity: s === 0 ? 1 : s === 1 ? 0.6 : s === 2 ? 0.35 : 0,
                  zIndex: n - s,
                  transition:
                    "transform 300ms cubic-bezier(0.22, 0.9, 0.35, 1), opacity 300ms ease",
                };
            return (
              <article
                key={card.id}
                aria-hidden={s !== 0}
                style={style}
                onClick={(e) => {
                  // click advances — unless the click was on a control
                  if (
                    s === 0 &&
                    n > 1 &&
                    !(e.target as HTMLElement).closest("button, a, input, select")
                  )
                    next();
                }}
                className={`absolute inset-0 flex flex-col gap-3 overflow-y-auto rounded-xl border border-hairline bg-panel p-6 shadow-2xl ${
                  s === 0 ? (n > 1 ? "cursor-pointer" : "") : "pointer-events-none"
                }`}
              >
                {card.body}
              </article>
            );
          })}
        </div>

        <footer className="flex items-center justify-center gap-4">
          <button
            onClick={prev}
            aria-label="Previous card"
            className="material-symbols-outlined rounded-full border border-hairline p-1 text-[20px] text-ink-2 transition-colors hover:border-secondary hover:text-ink"
          >
            chevron_left
          </button>
          <span className="caption text-ink-3">
            {cur >= n - 1
              ? "next closes the deck"
              : "click card, swipe, or ←/→"}
          </span>
          <button
            onClick={next}
            aria-label="Next card"
            className="material-symbols-outlined rounded-full border border-hairline p-1 text-[20px] text-ink-2 transition-colors hover:border-secondary hover:text-ink"
          >
            chevron_right
          </button>
        </footer>
      </div>
    </div>
  );
}
