import { useEffect } from "react";

// Walkthrough video (opens in a new tab). One place owns the URL so the
// once-per-session card and the persistent "See demo" pill can't drift apart.
const DEMO_URL =
  "https://drive.google.com/drive/u/1/folders/1wadAHzQ94Y5Sdn7upIV6HMKLWRTKAFJ5";

// shared orange→yellow gradient for both demo affordances
export const DEMO_GRADIENT =
  "bg-gradient-to-br from-orange-500 via-amber-400 to-yellow-300";

export function openDemo() {
  window.open(DEMO_URL, "_blank", "noopener,noreferrer");
}

/** Glassy modal shown once per session on the first landing → command trip. */
export default function DemoCard({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[60] grid place-items-center bg-black/40 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="See demo video"
    >
      <div
        className="relative w-[min(92vw,27rem)] overflow-hidden rounded-2xl border border-white/15 bg-white/10 p-6 shadow-2xl backdrop-blur-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* glass sheen + a warm glow bleeding from the corner */}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/15 to-transparent" />
        <div className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full bg-amber-400/20 blur-3xl" />

        <button
          onClick={onClose}
          aria-label="Close"
          className="material-symbols-outlined absolute right-3 top-3 z-10 text-[20px] text-white/60 transition-colors hover:text-white"
        >
          close
        </button>

        <div className="relative">
          <div
            className={`mb-4 inline-flex h-12 w-12 items-center justify-center rounded-full text-navy-deep shadow-lg shadow-orange-500/40 ${DEMO_GRADIENT}`}
          >
            <span className="text-lg leading-none">▶</span>
          </div>
          <h2 className="headline-sm text-white">See demo video</h2>
          <p className="body-md mt-2 text-white/70">
            A quick walkthrough of Mr. Vessel.
          </p>
          <div className="mt-6 flex gap-3">
            <button
              onClick={() => {
                openDemo();
                onClose();
              }}
              className={`label-caps rounded-lg px-4 py-2 text-navy-deep shadow-lg shadow-orange-500/30 transition-transform hover:scale-[1.03] ${DEMO_GRADIENT}`}
            >
              Open ↗
            </button>
            <button
              onClick={onClose}
              className="label-caps rounded-lg border border-white/20 bg-white/5 px-4 py-2 text-white/80 transition-colors hover:bg-white/10 hover:text-white"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
