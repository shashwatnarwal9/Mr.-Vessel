// The command window (state 2): the full instrument. Lazily imported so
// the landing hero paints without the maplibre bundle (M0.9).
import { useEffect, useState } from "react";
import GlobeMap from "./components/GlobeMap";
import { useStore } from "./store";
import NarrativeCard from "./components/NarrativeCard";
import SimDashboard from "./components/SimDashboard";
import WarCabinet from "./components/WarCabinet";
import StoryBanner from "./components/StoryBanner";
import PastSims from "./components/PastSims";
import ShipSimulator from "./components/ShipSimulator";
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

// first visit gets one seeded example in Past Simulations
function seedDemoRun() {
  if (listRuns().length > 0) return;
  const disruptions = { hormuz: 0.5, redsea: 0, opec: 0 };
  const t = simulate({ disruptions });
  saveRun({
    id: 1,
    name: "Example — Hormuz 50% closure",
    ts: new Date().toISOString(),
    disruptions,
    ships: [],
    headline: `This raises petrol ~₹${(t.fuel_price[89] - BASE.pumpInrPerL).toFixed(0)}/L and cuts growth ~${Math.abs(t.gdp.reduce((a, b) => a + b, 0) / t.gdp.length).toFixed(1)} pp over 90 days.`,
    traj: {
      fuel: t.fuel_price,
      gdp: t.gdp,
      run: t.run_rate,
      stress: t.power_stress,
    },
    fanFuel: [],
    fanGdp: [],
  });
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
  useEffect(() => seedDemoRun(), []);

  const recede = "transition-opacity duration-300 hover:opacity-100";
  const dim = spotlight ? "opacity-50" : "opacity-[.92]";

  return (
    <main className="relative h-full overflow-hidden">
      {/* the globe lives OUTSIDE the transition wrapper — remounting it on
          every tab switch would rebuild the whole WebGL map */}
      <GlobeMap visible={tab === "Command Map"} />
      {/* key={tab} → each view cross-fades in when you switch pages */}
      <div key={tab} className="view-enter h-full">
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
      {tab === "War Cabinet" && <WarCabinet />}
      {tab === "Simulation Dashboard" && <SimDashboard />}
      {tab === "Ship Simulator" && <ShipSimulator />}
      {tab === "Past Simulations" && <PastSims />}
      </div>
    </main>
  );
}
