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
  { tab: "War Cabinet", hash: "#cabinet" },
  { tab: "Simulation Dashboard", hash: "#dashboard" },
  { tab: "Ship Simulator", hash: "#ship" },
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
        className={`fixed inset-x-0 top-0 z-50 flex h-16 items-center justify-between border-b border-hairline px-6 transition-colors ${
          inCommand ? "bg-panel" : "bg-panel/80 backdrop-blur-md"
        }`}
      >
        <div className="flex items-center gap-8">
          {/* the live/baked disclosure lives on the ship panel's chip
              (Council C2: ship positions declare real vs simulated there) */}
          <button onClick={goHome} className="flex items-center gap-4">
            <span className="headline-sm font-black uppercase tracking-tight text-secondary">
              MR. VESSEL
            </span>
          </button>
          <div className="hidden items-center gap-4 md:flex">
            {TABS.map(({ tab: t }) => (
              <button
                key={t}
                onClick={() => enterCommand(t)}
                aria-current={inCommand && tab === t ? "page" : undefined}
                className={`label-caps transition-colors duration-150 ${
                  inCommand && tab === t
                    ? "border-b-2 border-secondary pb-1 text-secondary"
                    : "text-ink-3 opacity-80 hover:text-gold-hover"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-4">
          {inCommand && <SearchBar />}
          <button
            onClick={() => setHc((v) => !v)}
            aria-pressed={hc}
            title="High-contrast mode"
            aria-label="Toggle high-contrast mode"
            className={`material-symbols-outlined rounded border border-hairline p-1 text-[18px] transition-colors ${hc ? "text-secondary" : "text-ink-3 hover:text-ink"}`}
          >
            contrast
          </button>
          <PresetMenu />
        </div>
      </nav>

      {/* ⌘K / Ctrl-K: keyboard-driven terminal navigation */}
      <CommandPalette enterCommand={enterCommand} />

      {inCommand ? (
        /* state 2: the instrument — owns the whole viewport, no hero above */
        <section id="command" className="h-full pt-16">
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
