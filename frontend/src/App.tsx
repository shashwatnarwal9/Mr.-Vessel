// M0.9 shell: LANDING hero → COMMAND WINDOW on one scroll, persistent
// nav above both. The heavy instrument (maplibre + panels) is lazily
// imported so the landing paints without it.
import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { useStore, type Tab } from "./store";
import Hero from "./components/Hero";
import SearchBar from "./components/SearchBar";
import PresetMenu from "./components/PresetMenu";

const CommandApp = lazy(() => import("./CommandApp"));

const TABS: { tab: Tab; hash: string }[] = [
  { tab: "Command Map", hash: "#command" },
  { tab: "Simulation Dashboard", hash: "#dashboard" },
  { tab: "Past Simulations", hash: "#past" },
];

const HASH_TO_TAB = Object.fromEntries(TABS.map((t) => [t.hash, t.tab]));

const prefersReducedMotion = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export default function App() {
  const tab = useStore((s) => s.tab);
  const setTab = useStore((s) => s.setTab);
  const shipsMode = useStore((s) => s.shipsMode);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const commandRef = useRef<HTMLElement>(null);
  // arm = mount the heavy bundle; entered = past the hero (nav styling)
  const [armed, setArmed] = useState(() => location.hash in HASH_TO_TAB);
  const [entered, setEntered] = useState(false);

  // deep link: land straight in the instrument, no hero detour
  useEffect(() => {
    const target = HASH_TO_TAB[location.hash];
    if (target) {
      setTab(target);
      commandRef.current?.scrollIntoView({ behavior: "auto" });
    }
  }, [setTab]);

  // two observers, two jobs: PREFETCH the heavy bundle early (inflated
  // margin), but only flip nav chrome when genuinely in the window
  useEffect(() => {
    const el = commandRef.current;
    if (!el) return;
    const prefetch = new IntersectionObserver(
      ([e]) => e.isIntersecting && setArmed(true),
      { root: scrollerRef.current, rootMargin: "50% 0px" },
    );
    const presence = new IntersectionObserver(
      ([e]) => setEntered(e.intersectionRatio > 0.4),
      { root: scrollerRef.current, threshold: [0.4] },
    );
    prefetch.observe(el);
    presence.observe(el);
    return () => {
      prefetch.disconnect();
      presence.disconnect();
    };
  }, []);

  const enterCommand = (t?: Tab) => {
    setArmed(true);
    if (t) {
      setTab(t);
      history.replaceState(null, "", TABS.find((x) => x.tab === t)?.hash ?? "#command");
    }
    commandRef.current?.scrollIntoView({
      behavior: prefersReducedMotion() ? "auto" : "smooth",
    });
  };

  return (
    <div ref={scrollerRef} className="h-full overflow-y-auto">
      {/* persistent nav: transparent over the hero, chrome over the map */}
      <nav
        className={`fixed inset-x-0 top-0 z-50 flex h-14 items-center gap-1 px-4 transition-colors ${
          entered
            ? "border-b border-white/10 bg-black/40 backdrop-blur"
            : "border-b border-transparent bg-transparent"
        }`}
      >
        <button
          onClick={() =>
            scrollerRef.current?.scrollTo({
              top: 0,
              behavior: prefersReducedMotion() ? "auto" : "smooth",
            })
          }
          className="mr-4 flex flex-col text-left leading-tight"
        >
          <span className="text-sm font-bold tracking-widest text-cyan-300">
            MR. VESSEL
          </span>
          <span className="hidden text-[10px] text-slate-400 sm:block">
            See how a Gulf shock hits India's pump price and GDP
          </span>
        </button>
        {TABS.map(({ tab: t }) => (
          <button
            key={t}
            onClick={() => enterCommand(t)}
            aria-current={entered && tab === t ? "page" : undefined}
            className={`rounded px-3 py-1.5 text-sm transition-colors ${
              entered && tab === t
                ? "bg-cyan-500/20 text-cyan-200"
                : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
            }`}
          >
            {t}
          </button>
        ))}
        {entered ? (
          <>
            <SearchBar />
            <PresetMenu />
          </>
        ) : (
          <span className="ml-auto" />
        )}
        <span
          className={`ml-3 rounded-full border px-2.5 py-1 font-mono text-[10px] tracking-widest ${
            shipsMode === "live"
              ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-300"
              : "border-white/15 bg-white/5 text-slate-400"
          }`}
          title={
            shipsMode === "live"
              ? "live AIS + market feeds connected"
              : "running on baked demo data"
          }
        >
          ● {shipsMode === "live" ? "LIVE" : "DEMO"}
        </span>
      </nav>

      {/* state 1: the mission */}
      <Hero onEnter={() => enterCommand()} />

      {/* state 2: the instrument */}
      <section ref={commandRef} id="command" className="h-screen pt-14">
        {armed ? (
          <Suspense
            fallback={
              <div className="grid h-full place-items-center font-mono text-xs uppercase tracking-[0.3em] text-slate-500">
                ● powering on…
              </div>
            }
          >
            <CommandApp />
          </Suspense>
        ) : (
          <div className="h-full" />
        )}
      </section>
    </div>
  );
}
