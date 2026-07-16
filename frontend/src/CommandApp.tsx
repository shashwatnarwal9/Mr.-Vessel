// The command window (state 2): the full instrument. Lazily imported so
// the landing hero paints without the maplibre bundle (M0.9).
import { useEffect } from "react";
import GlobeMap from "./components/GlobeMap";
import { useStore } from "./store";
import NarrativeCard from "./components/NarrativeCard";
import SimDashboard from "./components/SimDashboard";
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
  useShipsFeed();
  useFusionFeed();
  useEffect(() => seedDemoRun(), []);

  return (
    <main className="relative h-full overflow-hidden">
      <GlobeMap visible={tab === "Command Map"} />
      {tab === "Command Map" && (
        <>
          <StoryBanner />
          <CascadePanel />
          <LayerToggle />
          <RiskPanel />
          <PlantPanel />
          <ShipPanel />
          <AlertStack />
          <NewsRail />
          <KGPanel />
          <NarrativeCard />
        </>
      )}
      {tab === "Simulation Dashboard" && <SimDashboard />}
      {tab === "Past Simulations" && <PastSims />}
    </main>
  );
}
