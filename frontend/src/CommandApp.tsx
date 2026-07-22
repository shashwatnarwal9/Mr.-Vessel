// The command window (state 2): the full instrument. Lazily imported so
// the landing hero paints without the maplibre bundle (M0.9).
import { useEffect, useState } from "react";
import GlobeMap from "./components/GlobeMap";
import { useStore } from "./store";
import NarrativeCard from "./components/NarrativeCard";
import FinOcean from "./components/FinOcean";
import StoryBanner from "./components/StoryBanner";
import PastSims from "./components/PastSims";
import PlantPanel from "./components/PlantPanel";
import CascadePanel from "./components/CascadePanel";
import ShipPanel from "./components/ShipPanel";
import AlertStack from "./components/AlertStack";
import NewsRail from "./components/NewsRail";
import { useShipsFeed } from "./hooks/useShipsFeed";
import KGPanel from "./components/KGPanel";
import { useFusionFeed } from "./hooks/useFusionFeed";
import LayerToggle from "./components/LayerToggle";
import RiskPanel from "./components/RiskPanel";
import { listRuns, saveRun } from "./lib/pastSims";
import { simulate } from "./lib/simulate";
import { BASE } from "./lib/cascade";
import { coupledShortfall, defaultMix } from "./lib/coupled";
import type { Supplier } from "./lib/supplier";

// First visit gets TWO seeded examples so Past Simulations opens on a
// ready-made comparison. Both are computed by the real engine on the real
// import mix (nothing is hand-written), and both carry the full committed
// `world`, so "Load again" restores the exact scenario and it can be re-run.
const DEMO_RUNS: {
  id: number;
  name: string;
  d: { hormuz: number; redsea: number; opec: number };
}[] = [
  { id: 1, name: "Example — Hormuz 50% closure", d: { hormuz: 0.5, redsea: 0, opec: 0 } },
  {
    id: 2,
    name: "Example — Hormuz 50% + Red Sea 100%",
    d: { hormuz: 0.5, redsea: 1, opec: 0 },
  },
];

async function seedDemoRuns() {
  if (listRuns().length > 0) return;
  // the real supplier matrix — the seeds must read the same inputs a user's
  // own run would, or the comparison would be against a fiction
  const suppliers: Supplier[] = await fetch("/supplier_dependency.json")
    .then((r) => r.json())
    .then((f) => f.suppliers)
    .catch(() => []);
  const mix = suppliers.length ? defaultMix(suppliers) : {};

  // save oldest-first so the newest ends up on top of the list
  for (const run of [...DEMO_RUNS].reverse()) {
    const physical = suppliers.length
      ? coupledShortfall(suppliers, mix, run.d).shortfallBblPerDay
      : undefined;
    const t = simulate({ disruptions: run.d, physicalShortfallOverride: physical });
    const dPump = t.fuel_price[t.fuel_price.length - 1] - BASE.pumpInrPerL;
    saveRun({
      id: run.id,
      name: run.name,
      ts: new Date().toISOString(),
      disruptions: run.d,
      ships: [],
      headline: `Petrol ${dPump >= 0 ? "+" : ""}₹${dPump.toFixed(1)}/L at day 90; run-rate trough ${(Math.min(...t.run_rate) * 100).toFixed(0)}%.`,
      traj: {
        fuel: t.fuel_price,
        gdp: t.gdp,
        run: t.run_rate,
        stress: t.power_stress,
      },
      fanFuel: [],
      fanGdp: [],
      // full committed world → "Load again" puts it straight back on the page
      world: { dashboard: { mix, disruptions: run.d }, ships: [] },
    });
  }
}

export default function CommandApp() {
  const tab = useStore((s) => s.tab);
  // M-COHESION focal hierarchy: the MAP is the hero. Rails are quiet
  // instruments (recede when idle, full on hover); selecting an entity
  // SPOTLIGHTS it by dimming everything that isn't about it.
  const spotlight = useStore(
    (s) => !!(s.selectedShip || s.selectedPlant || s.selectedCorridor),
  );
  // responsive density: the signals rail collapses on smaller screens
  const [signalsOpen, setSignalsOpen] = useState(
    () => window.innerWidth >= 1024,
  );
  useShipsFeed();
  useFusionFeed();
  useEffect(() => {
    void seedDemoRuns();
  }, []);

  const recede = "transition-opacity duration-300 hover:opacity-100";
  const dim = spotlight ? "opacity-50" : "opacity-[.92]";

  return (
    // overflow-CLIP, not hidden: `hidden` still makes this a scroll container,
    // so the browser could programmatically scroll it (it was landing 410px
    // down / 544px right, dragging FinOcean's content off-screen). `clip`
    // creates no scroll container at all, so it can never be scrolled.
    <main className="relative h-full overflow-clip">
      {/* the globe lives OUTSIDE the transition wrapper — remounting it on
          every tab switch would rebuild the whole WebGL map */}
      <GlobeMap visible={tab === "Command Map"} />
      {/* FinOcean is kept MOUNTED (hidden when off-tab) so switching pages
          never loses in-progress work: a loaded shock, a run result, a
          streaming cabinet deliberation all survive a trip to another tab. */}
      {/* re-adding the class as it becomes visible replays the arrival
          animation without remounting (which would lose in-progress work).
          It keys on `tab` only, so opening a SUB-PAGE never re-animates. */}
      <div
        className={
          tab === "FinOcean Maximus" ? "view-enter-rise h-full" : "hidden"
        }
      >
        <FinOcean />
      </div>
      {/* key={tab} → each view arrives when you switch pages. The Command Map
          gets fade-only (its rails are absolutely positioned, so a containing
          block here would collapse them); Past Sims gets the full rise.

          NOT rendered on the FinOcean tab: an empty `h-full` sibling still
          claims a full viewport, which made <main> 2x its own height and let
          it scroll 410px — FinOcean's content slid out of sight. */}
      {tab !== "FinOcean Maximus" && (
      <div
        key={tab}
        className={`h-full ${tab === "Command Map" ? "view-enter" : "view-enter-rise"}`}
      >
      {tab === "Command Map" && (
        <>
          <div className={`${recede} ${spotlight ? "opacity-60" : ""}`}>
            <StoryBanner />
          </div>
          {/* left column: panels stack and scroll — they can never overlap.
              Holds the detail panels, so it stays FULL when spotlighting. */}
          <div
            className={`absolute bottom-4 left-4 top-4 z-10 flex w-80 flex-col gap-2 overflow-y-auto pr-1 ${recede} ${spotlight ? "" : "opacity-[.92]"}`}
          >
            <CascadePanel />
            <LayerToggle />
            <RiskPanel />
            <PlantPanel />
            <ShipPanel />
          </div>
          {/* right column: alerts carousel above Signals; collapsible for density */}
          {signalsOpen ? (
            <div
              className={`absolute bottom-4 right-4 top-4 z-10 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2 ${recede} ${dim}`}
            >
              <button
                onClick={() => setSignalsOpen(false)}
                className="label-caps self-end rounded px-1 text-ink-3 transition-colors hover:text-ink lg:hidden"
              >
                hide signals ▸
              </button>
              <AlertStack />
              <NewsRail />
            </div>
          ) : (
            <button
              onClick={() => setSignalsOpen(true)}
              className="label-caps absolute right-4 top-4 z-10 rounded-lg border border-hairline bg-panel/90 px-3 py-2 text-ink-2 backdrop-blur-md transition-colors hover:border-secondary hover:text-ink"
            >
              ◂ signals
            </button>
          )}
          <div className={`${recede} ${dim}`}>
            <KGPanel />
          </div>
          <NarrativeCard />
        </>
      )}
      {tab === "Past Simulations" && <PastSims />}
      </div>
      )}
    </main>
  );
}
