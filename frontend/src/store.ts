import { create } from "zustand";

export type Tab =
  | "Command Map"
  | "Simulation Dashboard"
  | "Ship Simulator"
  | "Past Simulations";

export type EffectKind = "closure" | "sanction" | "reroute" | "delay";
export type ShipEffect = {
  kind: EffectKind;
  chokepoint?: "hormuz" | "redsea"; // closure / reroute
  delayDays?: number; // manual ETA increase
};

export type SimShip = {
  props: ShipProps & { lon: number; lat: number };
  effect: ShipEffect;
};

// v4: one draft config on the dashboard; Past Simulations holds history
export type Draft = {
  redsea: number; // hormuz value lives in `pi` (shared with the map slider)
  opec: number;
  ships: SimShip[];
};

export type PlantProps = {
  name: string;
  capacity_mw: number;
  primary_fuel: string;
  owner: string | null;
  commissioning_year: number | null;
};

export type ShipProps = {
  mmsi: number;
  name: string;
  type: string;
  course: number;
  speed: number;
  dest: string;
  imo?: number; // live AIS static data (sanctions join key)
  sanction?: "sanctioned" | "shadow_fleet"; // annotated client-side
};

export type ShipFeature = {
  type: "Feature";
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: ShipProps;
};

export type ShipsFC = { type: "FeatureCollection"; features: ShipFeature[] };

type State = {
  selectedPlant: PlantProps | null;
  setSelectedPlant: (p: PlantProps | null) => void;
  selectedShip: (ShipProps & { lon: number; lat: number }) | null;
  setSelectedShip: (
    s: (ShipProps & { lon: number; lat: number }) | null,
  ) => void;
  pi: number; // Hormuz disruption probability/severity 0..1
  setPi: (pi: number) => void; // manual slider — switches to what-if mode
  piMode: "manual" | "fused";
  piFused: number | null;
  confidence: number | null;
  setFused: (pi: number, confidence: number) => void;
  setPiMode: (m: "manual" | "fused") => void;
  ships: ShipsFC | null;
  shipsMode: "live" | "baked";
  setShips: (fc: ShipsFC, mode: "live" | "baked") => void;
  screening: { screened: number; matched: number } | null; // coverage honesty
  setScreening: (s: { screened: number; matched: number }) => void;
  contextLayers: { israel: boolean; egypt: boolean };
  toggleContextLayer: (c: "israel" | "egypt") => void;
  tab: Tab;
  setTab: (t: Tab) => void;
  draft: Draft;
  setDraftDisruption: (k: "redsea" | "opec", v: number) => void;
  addDraftShip: (ship: SimShip["props"], effect?: ShipEffect) => void;
  removeDraftShip: (mmsi: number) => void;
  setDraftShipEffect: (mmsi: number, effect: ShipEffect) => void;
  clearDraft: () => void;
  /** ship-panel CTA: preload a ship into the draft and open the dashboard */
  startSimulationWith: (ship: SimShip["props"]) => void;
  pastSimsVersion: number; // bump to re-read localStorage
  bumpPastSims: () => void;
  activeZone: "hormuz" | "redsea" | null; // which chokepoint alerts fire for
  setActiveZone: (z: "hormuz" | "redsea" | null) => void;
  activeScenario: "hormuz" | "redsea" | "opec"; // what the map σ slider drives
  setActiveScenario: (s: "hormuz" | "redsea" | "opec") => void;
  selectedCorridor: string | null; // M6e click-through (panel row or map)
  setSelectedCorridor: (id: string | null) => void;
  highlightMmsi: number | null; // search hit: flash the ship green briefly
  setHighlightMmsi: (m: number | null) => void;
  narrative: string | null; // preset scenario blurb
  setNarrative: (n: string | null) => void;
  plainMode: boolean; // M7 story layer: plain-English labels
  setPlainMode: (v: boolean) => void;
};

export const useStore = create<State>((set, get) => ({
  selectedPlant: null,
  setSelectedPlant: (p) =>
    set({ selectedPlant: p, ...(p ? { selectedShip: null } : {}) }),
  selectedShip: null,
  setSelectedShip: (s) =>
    set({ selectedShip: s, ...(s ? { selectedPlant: null } : {}) }),
  pi: 0,
  setPi: (pi) => set({ pi, piMode: "manual" }),
  piMode: "manual",
  piFused: null,
  confidence: null,
  setFused: (piFused, confidence) =>
    set((s) => ({
      piFused,
      confidence,
      // news/market/ship fusion auto-drives the panel until the user takes
      // manual control of the slider (any drag switches to what-if mode)
      ...(s.piMode === "fused" || (s.piMode === "manual" && s.pi === 0)
        ? { pi: piFused, piMode: "fused" as const }
        : {}),
    })),
  setPiMode: (piMode) =>
    set((s) => ({
      piMode,
      ...(piMode === "fused" && s.piFused !== null ? { pi: s.piFused } : {}),
    })),
  ships: null,
  shipsMode: "baked",
  setShips: (fc, mode) => set({ ships: fc, shipsMode: mode }),
  screening: null,
  setScreening: (screening) => set({ screening }),
  contextLayers: { israel: true, egypt: true },
  toggleContextLayer: (c) =>
    set((s) => ({
      contextLayers: { ...s.contextLayers, [c]: !s.contextLayers[c] },
    })),
  tab: "Command Map",
  setTab: (tab) => set({ tab }),
  draft: { redsea: 0, opec: 0, ships: [] },
  setDraftDisruption: (k, v) =>
    set((s) => ({ draft: { ...s.draft, [k]: Math.min(1, Math.max(0, v)) } })),
  addDraftShip: (ship, effect = { kind: "sanction" }) =>
    set((s) =>
      s.draft.ships.some((x) => x.props.mmsi === ship.mmsi)
        ? s
        : { draft: { ...s.draft, ships: [...s.draft.ships, { props: ship, effect }] } },
    ),
  removeDraftShip: (mmsi) =>
    set((s) => ({
      draft: {
        ...s.draft,
        ships: s.draft.ships.filter((x) => x.props.mmsi !== mmsi),
      },
    })),
  setDraftShipEffect: (mmsi, effect) =>
    set((s) => ({
      draft: {
        ...s.draft,
        ships: s.draft.ships.map((x) =>
          x.props.mmsi === mmsi ? { ...x, effect } : x,
        ),
      },
    })),
  clearDraft: () => set({ draft: { redsea: 0, opec: 0, ships: [] } }),
  startSimulationWith: (ship) => {
    get().addDraftShip(ship);
    set({ tab: "Simulation Dashboard" });
  },
  pastSimsVersion: 0,
  bumpPastSims: () => set((s) => ({ pastSimsVersion: s.pastSimsVersion + 1 })),
  activeZone: "hormuz",
  setActiveZone: (activeZone) => set({ activeZone }),
  activeScenario: "hormuz",
  setActiveScenario: (activeScenario) => set({ activeScenario }),
  selectedCorridor: null,
  setSelectedCorridor: (selectedCorridor) => set({ selectedCorridor }),
  highlightMmsi: null,
  setHighlightMmsi: (highlightMmsi) => set({ highlightMmsi }),
  narrative: null,
  setNarrative: (narrative) => set({ narrative }),
  plainMode: true, // judges first: plain by default, expert opt-in
  setPlainMode: (plainMode) => set({ plainMode }),
}));
