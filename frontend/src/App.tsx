// M0.9 shell, v2 routing: LANDING and COMMAND WINDOW are two exclusive
// states (no shared scroll — scrolling inside the instrument can never
// reveal the hero). The heavy instrument (maplibre + panels) is lazily
// imported so the landing paints without it.
import { Suspense, lazy, useEffect, useState } from "react";
import { useStore, type Tab } from "./store";
import Hero from "./components/Hero";
import CommandPalette from "./components/CommandPalette";
import SearchBar from "./components/SearchBar";
import PresetMenu from "./components/PresetMenu";

const CommandApp = lazy(() => import("./CommandApp"));

const TABS: { tab: Tab; hash: string }[] = [
  { tab: "Command Map", hash: "#command" },
  { tab: "FinOcean Maximus", hash: "#finocean" },
  { tab: "Past Simulations", hash: "#past" },
];

const HASH_TO_TAB = Object.fromEntries(TABS.map((t) => [t.hash, t.tab]));

export default function App() {
  const tab = useStore((s) => s.tab);
  // a11y: high-contrast mode (persisted; brightens secondary inks)
  const [hc, setHc] = useState(() => localStorage.getItem("mrvessel.hc") === "1");
  useEffect(() => {
    document.documentElement.classList.toggle("hc", hc);
    localStorage.setItem("mrvessel.hc", hc ? "1" : "0");
  }, [hc]);
  const setTab = useStore((s) => s.setTab);
  // armed = heavy bundle mounted; inCommand = instrument replaces the hero
  const [armed, setArmed] = useState(() => location.hash in HASH_TO_TAB);
  const [inCommand, setInCommand] = useState(() => location.hash in HASH_TO_TAB);

  // deep link: land straight in the instrument, no hero detour
  useEffect(() => {
    const target = HASH_TO_TAB[location.hash];
    if (target) setTab(target);
  }, [setTab]);

  // prefetch the heavy bundle once the hero has painted and gone idle
  useEffect(() => {
    if (armed) return;
    const id = setTimeout(() => {
      import("./CommandApp"); // warm the chunk; lazy() resolves instantly later
      setArmed(true);
    }, 2500);
    return () => clearTimeout(id);
  }, [armed]);

  const enterCommand = (t?: Tab) => {
    setArmed(true);
    setInCommand(true);
    const next = t ?? useStore.getState().tab;
    setTab(next);
    history.replaceState(
      null,
      "",
      TABS.find((x) => x.tab === next)?.hash ?? "#command",
    );
  };

  // brand click: back to the landing (the ONLY way to reach it)
  const goHome = () => {
    setInCommand(false);
    history.replaceState(null, "", location.pathname);
  };

  return (
    <div className="h-full overflow-hidden">
      {/* persistent nav: Stitch TopNavBar (s0 shows it translucent, s1–s4 solid) */}
      <nav
        // no bar in either state: no background, no divider. A text-shadow
        // keeps the chrome legible over whatever sits behind it.
        className="fixed inset-x-0 top-0 z-50 flex h-16 items-center justify-between bg-transparent px-6 [text-shadow:0_1px_4px_rgba(0,0,0,.9)]"
      >
        {/* the live/baked disclosure lives on the ship panel's chip
            (Council C2: ship positions declare real vs simulated there) */}
        <button
          onClick={goHome}
          aria-label="Mr. Vessel — back to the landing page"
          className="flex shrink-0 items-center transition-opacity hover:opacity-80"
        >
          {/* the wordmark carries the name, so no text beside it */}
          <img
            src="/logo.png"
            alt="Mr. Vessel"
            className="h-[2.52rem] w-auto object-contain"
          />
        </button>

        {/* tabs centred on the VIEWPORT, not on the leftover space — so the
            brand and the right-hand tools can change width without shifting
            them. Absolute keeps it independent of both flanks. */}
        <div className="pointer-events-none absolute inset-x-0 hidden justify-center md:flex">
          <div className="pointer-events-auto flex items-center gap-6">
            {TABS.map(({ tab: t }) => {
              const active = inCommand && tab === t;
              return (
                <button
                  key={t}
                  onClick={() => enterCommand(t)}
                  aria-current={active ? "page" : undefined}
                  // no focus BOX — keyboard focus shows the same underline the
                  // hover uses, so the indicator stays but the outline goes
                  className={`label-caps group relative px-1 pb-1 transition-all duration-200 ease-out hover:-translate-y-0.5 focus:outline-none motion-reduce:transform-none motion-reduce:transition-none ${
                    active
                      ? "text-secondary"
                      : "text-ink-3 opacity-80 hover:text-gold-hover hover:opacity-100 focus-visible:text-gold-hover"
                  }`}
                >
                  {t}
                  {/* underline wipes in from the left on hover / keyboard focus,
                      and stays put on the active tab */}
                  <span
                    aria-hidden="true"
                    className={`absolute inset-x-0 bottom-0 h-0.5 origin-left bg-secondary transition-transform duration-200 ease-out motion-reduce:transition-none ${
                      active
                        ? "scale-x-100"
                        : "scale-x-0 group-hover:scale-x-100 group-focus-visible:scale-x-100"
                    }`}
                  />
                </button>
              );
            })}
          </div>
        </div>
        {/* instrument tools — the landing stays clean, so search, the contrast
            toggle and Scenarios all appear only inside the command window.
            The hackathon badge is the inverse: landing only. */}
        <div className="flex shrink-0 items-center gap-4">
          {!inCommand && (
            <img
              src="/hackathon-badge.png"
              alt="ET AI Hackathon 2.0 — Think AI, Build with GenAI"
              className="h-9 w-auto object-contain"
            />
          )}
          {inCommand && (
            <>
              <SearchBar />
              <button
                onClick={() => setHc((v) => !v)}
                aria-pressed={hc}
                title="High-contrast mode"
                aria-label="Toggle high-contrast mode"
                className={`material-symbols-outlined rounded border border-hairline p-1 text-[18px] transition-colors ${hc ? "text-secondary" : "text-ink-3 hover:text-ink"}`}
              >
                contrast
              </button>
              {/* Scenarios drive the MAP's σ presets — only meaningful there */}
              {tab === "Command Map" && <PresetMenu />}
            </>
          )}
        </div>
      </nav>

      {/* ⌘K / Ctrl-K: keyboard-driven terminal navigation */}
      <CommandPalette enterCommand={enterCommand} />

      {inCommand ? (
        /* state 2: the instrument — owns the whole viewport, no hero above.
           The chart backdrop lives HERE, not on the inner page: the nav is
           transparent, so painting it below `pt-16` left the body's navy
           showing as a bar behind the chrome. */
        <section id="command" className="chart-bg h-full pt-16">
          <Suspense
            fallback={
              <div className="micro-mono grid h-full place-items-center uppercase tracking-[0.3em] text-ink-3">
                ● powering on…
              </div>
            }
          >
            <CommandApp />
          </Suspense>
        </section>
      ) : (
        /* state 1: the mission (instrument chunk prefetches in the background) */
        <Hero onEnter={() => enterCommand()} />
      )}
    </div>
  );
}
