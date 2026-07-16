// Scenario preset demos (M11): each seeds σ, the disrupted zone, camera,
// affected-ship highlighting, and a short narrative. The cascade runs
// end-to-end off σ exactly as if the analyst had set it by hand.

import { HORMUZ_ZONE, REDSEA_ZONE, type Bbox } from "./zones";
import type { SigmaMode } from "./simulate";

export type Preset = {
  id: string;
  name: string;
  scenario: "hormuz" | "redsea" | "opec"; // which engine channel σ drives
  sigma: number;
  mode: SigmaMode;
  zone: Bbox | null; // ships inside get alert highlighting
  zoneName: "hormuz" | "redsea" | null;
  camera: { center: [number, number]; zoom: number };
  narrative: string;
};

export const PRESETS: Preset[] = [
  {
    id: "hormuz-partial",
    name: "Hormuz Partial Closure",
    scenario: "hormuz",
    sigma: 0.6,
    mode: "sustained",
    zone: HORMUZ_ZONE,
    zoneName: "hormuz",
    camera: { center: [56.5, 26.5], zoom: 5.2 },
    narrative:
      "Escorted-convoy regime in the Strait: 60% of normal transits blocked. " +
      "45% of India's crude rides this water — SPR draw shields refiners for " +
      "days, not weeks, while replacement barrels must round the Cape.",
  },
  {
    id: "opec-cut",
    name: "OPEC+ Emergency Cut",
    scenario: "opec",
    sigma: 0.35,
    mode: "sustained",
    zone: null, // supply decision, not a blockade — no zone alerts
    zoneName: null,
    camera: { center: [50.0, 26.0], zoom: 4.2 },
    narrative:
      "A surprise 3 Mbbl/d quota cut. No tankers are blocked — the shock is " +
      "purely price-side: import bill and pump pass-through move first, " +
      "refinery runs hold.",
  },
  {
    id: "redsea-suspension",
    name: "Red Sea Suspension",
    scenario: "redsea",
    sigma: 0.45,
    mode: "decay",
    zone: REDSEA_ZONE,
    zoneName: "redsea",
    camera: { center: [40.0, 18.0], zoom: 4.6 },
    narrative:
      "Transits through Bab el-Mandeb suspended after strikes; insurers pull " +
      "cover. Urals and Suez-routed barrels detour via the Cape (+26 days). " +
      "Pressure decays as convoys resume over the month.",
  },
];

export const RAMP_STEPS = 12;
export const RAMP_INTERVAL_MS = 350;
