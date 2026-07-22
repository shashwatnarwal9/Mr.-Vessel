import { useEffect, useRef, useState } from "react";
import { useTween } from "../lib/tween";
import { HISTORICAL_SHOCKS } from "../lib/history"; // count only, corpus stays unbundled

/** Landing: the film plays once through, the copy and counters arrive over it,
 *  then it hands off to the instrument on its own. */
const REVEAL_DELAY_MS = 2000; // beat before the copy starts arriving
// the copy leads; the cards follow it in and count for 1s (2.6s → 3.6s)
const STATS_DELAY_MS = 2600;
const COUNT_MS = 1000;
// tied to the FILM, not the clock: on a 10.0s cut that is the CTA at ~5.0s and
// the hand-off starting at ~8.5s, landing in the instrument before it ends.
const CTA_BEFORE_END_S = 5;
const HANDOFF_BEFORE_END_S = 1.5;
const EXIT_MS = 700; // the hero's slide-away before the instrument takes over
const REPO_URL = "https://github.com/shashwatnarwal9/Mr.-Vessel";
const DRIVE_URL =
  "https://drive.google.com/drive/folders/1wadAHzQ94Y5Sdn7upIV6HMKLWRTKAFJ5";
const TEAM = ["Shashwat Narwal", "Aashna", "Dhruv Bansal", "Ridhi Garg"];

// Counted from the shipped data, not marketing figures:
//   ships.json → 54 vessels in the tracked fleet (live AIS overlays this by MMSI)
//   corridors.json → 5 chokepoints
//   history_corpus.json → 28 episodes the analog retrieval searches (1956–2024),
//     asserted against the corpus in history.test.ts so it can't drift
// (the 5,388 figure elsewhere is the SCREENING index, a different claim)
const STATS: { label: string; value: number; icon: string }[] = [
  { label: "vessels tracked", value: 54, icon: "directions_boat" },
  { label: "corridors watched", value: 5, icon: "conversion_path" },
  { label: "historical shocks", value: HISTORICAL_SHOCKS, icon: "history" },
];

/** fade + rise + un-blur, staggered by `step` (ms) once `on` flips */
const revealCls = (on: boolean, step: number) => ({
  className: `transition-[opacity,transform,filter] duration-[1100ms] ease-out motion-reduce:transition-none ${
    on ? "translate-y-0 opacity-100 blur-0" : "translate-y-6 opacity-0 blur-[6px]"
  }`,
  style: { transitionDelay: on ? `${step}ms` : "0ms" },
});

/** One counter card. The number tweens 0 → value over COUNT_MS as it lands
 *  (useTween is the app's existing easeOutCubic tween; reduced motion sets
 *  it instantly). */
function StatCard({
  label, value, icon, on, step,
}: {
  label: string;
  value: number;
  icon: string;
  on: boolean;
  step: number;
}) {
  const n = useTween(on ? value : 0, COUNT_MS);
  const r = revealCls(on, step);
  return (
    <div
      style={r.style}
      // no card: the figures sit straight on the film, so they carry their own
      // shadow to stay legible over moving footage
      className={`flex min-w-[9.5rem] flex-col items-center gap-1 px-4 py-2 [text-shadow:0_1px_6px_rgba(0,0,0,.95)] ${r.className}`}
    >
      <span className="material-symbols-outlined text-[18px] text-secondary">
        {icon}
      </span>
      <span className="stat-lg tabular-nums text-ink">{Math.round(n)}</span>
      <span className="label-caps text-center text-ink-2">{label}</span>
    </div>
  );
}

export default function Hero({ onEnter }: { onEnter: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  // Reduced motion holds a still frame instead of looping video. (Playback is
  // left at the native 1.0x — no rate override.)
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) v.pause();
  }, []);

  // ---- film-driven hand-off ------------------------------------------------
  // The invitation surfaces 5s before the cut ends; 1.5s before the end the
  // hero slides away and the instrument takes over on its own.
  const [ctaIn, setCtaIn] = useState(false);
  const [exiting, setExiting] = useState(false);
  const firedRef = useRef(false); // per-mount, so it can't double-fire
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    // a paused (reduced-motion) video never advances, so surface the CTA at
    // once and never auto-navigate — motion-sensitive users stay in control
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setCtaIn(true);
      return;
    }
    // rAF, not `timeupdate`: that event only fires ~4x/second, which landed the
    // hand-off ~0.1s late. A frame loop hits the 1.5s mark on the nose.
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const d = v.duration;
      if (!isFinite(d) || d <= 0) return;
      const left = d - v.currentTime;
      if (left <= CTA_BEFORE_END_S) setCtaIn(true);
      if (left <= HANDOFF_BEFORE_END_S && !firedRef.current) {
        firedRef.current = true;
        setExiting(true);
        setTimeout(onEnter, EXIT_MS);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [onEnter]);

  /** manual entry: same slide-away, and it cancels the automatic one */
  const enterNow = () => {
    firedRef.current = true;
    setExiting(true);
    setTimeout(onEnter, EXIT_MS);
  };

  // the copy holds back 1.5s so the film establishes first, then each line
  // fades up in sequence. Reduced motion skips straight to the end state.
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setRevealed(true);
      return;
    }
    const t = setTimeout(() => setRevealed(true), REVEAL_DELAY_MS);
    return () => clearTimeout(t);
  }, []);

  // the stat cards land earlier than the copy and count up as they arrive
  const [statsIn, setStatsIn] = useState(false);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setStatsIn(true);
      return;
    }
    const t = setTimeout(() => setStatsIn(true), STATS_DELAY_MS);
    return () => clearTimeout(t);
  }, []);

  const reveal = (step: number) => revealCls(revealed, step);

  return (
    <section
      className={`relative flex h-screen flex-col overflow-hidden transition-[opacity,transform] duration-[700ms] ease-in-out motion-reduce:transition-none ${
        exiting ? "-translate-y-10 opacity-0" : "translate-y-0 opacity-100"
      }`}
      aria-label="Mr. Vessel — mission"
    >
      {/* CSS globe stays as the fallback layer if the video can't paint */}
      <div className="globe-bg" aria-hidden="true" />

      {/* ambient motion: the landing film, at native speed */}
      <video
        ref={videoRef}
        src="/landing.mp4"
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
        aria-hidden="true"
        // saturate down + a touch warmer: the footage is a blue dusk ocean and
        // read heavily blue once the navy scrim stacked on top of it
        className="absolute inset-0 h-full w-full object-cover saturate-[.55] brightness-[1.06] contrast-[1.02] sepia-[.12]"
      />
      {/* scrim: NEUTRAL black, not navy — a navy scrim added blue to an already
          blue frame. Still dark enough for the copy to sit on it. */}
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-gradient-to-b from-black/70 via-black/45 to-black/80"
      />

      <main className="relative z-10 mx-auto flex w-full max-w-[1200px] flex-grow flex-col items-center justify-center px-4 pb-16 pt-24 text-center">
        {/* Eyebrow */}
        {(() => {
          const r = reveal(0);
          return (
            <div
              style={r.style}
              className={`label-caps mb-2 flex items-center gap-2 tracking-[0.2em] text-ink-3 ${r.className}`}
            >
              <span className="h-px w-4 bg-hairline" />
              INDIA'S ENERGY SHOCK SIMULATOR
              <span className="h-px w-4 bg-hairline" />
            </div>
          );
        })()}

        {/* Headline */}
        {(() => {
          const r = reveal(180);
          return (
            <h1
              style={r.style}
              className={`headline-hero mb-6 max-w-4xl text-ink ${r.className}`}
            >
              The oil crisis, simulated before it's real.
            </h1>
          );
        })()}

        {/* counters — land at 1.5s and count up over the next second */}
        <div className="mt-8 flex flex-wrap items-stretch justify-center gap-x-12 gap-y-4">
          {STATS.map((s, i) => (
            <StatCard
              key={s.label}
              label={s.label}
              value={s.value}
              icon={s.icon}
              on={statsIn}
              step={i * 120}
            />
          ))}
        </div>

        {/* CTA — text only, under the cards. Surfaces 5s before the film ends
            with the same reveal; the underline wipes in on hover like the nav */}
        {(() => {
          const r = revealCls(ctaIn, 0);
          return (
            <button
              onClick={enterNow}
              style={r.style}
              aria-hidden={!ctaIn}
              className={`label-caps group relative mt-10 flex items-center gap-2 px-1 pb-1 text-secondary hover:-translate-y-0.5 hover:text-gold-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-secondary ${r.className} ${
                ctaIn ? "" : "pointer-events-none"
              }`}
            >
              Enter the Command Window
              <span
                aria-hidden="true"
                className="absolute inset-x-0 bottom-0 h-0.5 origin-left scale-x-0 bg-secondary transition-transform duration-200 ease-out group-hover:scale-x-100 motion-reduce:transition-none"
              />
            </button>
          );
        })()}
      </main>

      {/* Project drive — sits where the film's diamond glints, lower right */}
      <a
        href={DRIVE_URL}
        target="_blank"
        rel="noreferrer noopener"
        title="Project files on Google Drive"
        aria-label="Project files on Google Drive"
        // right/bottom position the box EDGES, not its centre
        className="group absolute bottom-[12.6%] right-[7.5%] z-20 flex items-center justify-center rounded-full p-2 transition-transform duration-200 hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-secondary motion-reduce:transform-none motion-reduce:transition-none"
      >
        <img
          src="/google-drive.png"
          alt=""
          aria-hidden="true"
          className="h-[2.73rem] w-auto drop-shadow-[0_2px_8px_rgba(0,0,0,.9)]"
        />
      </a>

      {/* Credits footer: repo link left, the team on the right */}
      {/* transparent like the topbar — the film runs edge-to-edge; the scrim's
          dark bottom stop keeps the credits legible, drop-shadow for safety */}
      <footer className="relative z-10 mt-auto w-full bg-transparent px-6 py-4">
        <div className="micro-mono mx-auto flex max-w-[1200px] flex-col items-center justify-between gap-3 text-ink-3 [text-shadow:0_1px_3px_rgba(0,0,0,.85)] md:flex-row">
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer noopener"
            aria-label="View this project on GitHub"
            className="group flex items-center gap-2 rounded text-ink-3 transition-colors hover:text-secondary focus:outline-none focus-visible:ring-2 focus-visible:ring-secondary"
          >
            {/* GitHub mark — inline so no external asset is fetched */}
            <svg
              viewBox="0 0 16 16"
              width="18"
              height="18"
              aria-hidden="true"
              fill="currentColor"
              className="transition-transform duration-200 group-hover:scale-110 motion-reduce:transform-none"
            >
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
            </svg>
            GITHUB
          </a>
          <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
            <span className="text-ink-3">BUILT BY</span>
            {TEAM.map((name, i) => (
              <span key={name} className="flex items-center gap-2">
                <span className="text-ink-2">{name}</span>
                {i < TEAM.length - 1 && (
                  <span aria-hidden="true" className="text-ink-3">
                    ·
                  </span>
                )}
              </span>
            ))}
          </div>
        </div>
      </footer>
    </section>
  );
}
