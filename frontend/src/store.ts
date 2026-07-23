import { create } from "zustand";

// The dashboard, ship simulator and war cabinet are no longer top-level
// pages — they live inside FinOcean Maximus as cards / sub-pages.
export type Tab = "Command Map" | "FinOcean Maximus" | "Past Simulations";

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

// FinOcean Maximus — "Load = commit": a card's values only enter the shared
// world state when the user presses LOAD on its sub-page. Editing a sub-page
// WITHOUT loading must never mutate what a run reads; that separation is the
// whole point of the pattern.
export type CommittedDashboard = {
  mix: Record<string, number>; // supplier id → share (already normalized on load)
  disruptions: { hormuz: number; redsea: number; opec: number };
};

export type WorldState = {
  dashboard: CommittedDashboard | null;
  ships: SimShip[] | null;
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
  // the report that set π (a headline explicitly stating a closure)
  fusedDriver: {
    kind: string;
    pi: number;
    headline?: string;
    source?: string;
    ts?: string;
  } | null;
  setFused: (
    pi: number,
    confidence: number,
    driver?: State["fusedDriver"],
  ) => void;
  setPiMode: (m: "manual" | "fused") => void;
  ships: ShipsFC | null;
  shipsMode: "live" | "baked";
  setShips: (fc: ShipsFC, mode: "live" | "baked") => void;
  screening: { screened: number; matched: number } | null; // coverage honesty
  setScreening: (s: { screened: number; matched: number }) => void;
  // live headline feed, lifted here so corridor risk can derive its news
  // signal from the same items the Signals rail shows
  newsItems: { tag: string; severity: number }[];
  setNewsItems: (n: { tag: string; severity: number }[]) => void;
  // live Brent print — feeds the corridor-risk market signal
  brentUsd: number | null;
  setBrentUsd: (v: number | null) => void;
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
  highlightMmsi: number | null; // flash the ship green briefly (set by setSelectedShip)
  setHighlightMmsi: (m: number | null) => void;
  // cascade walkthrough: the stage the KG carousel is on — the map
  // highlights and frames these points (empty = nationwide stage)
  cascadeFocus: {
    layer: string;
    points: { name: string; lonlat: [number, number] }[];
  } | null;
  setCascadeFocus: (
    f: {
      layer: string;
      points: { name: string; lonlat: [number, number] }[];
    } | null,
  ) => void;
  // FinOcean world state (committed via LOAD; a run reads ONLY this)
  world: WorldState;
  commitDashboard: (d: CommittedDashboard) => void;
  commitShips: (ships: SimShip[]) => void;
  clearWorldCard: (which: "dashboard" | "ships") => void;
  /** Past Sims: re-commit a whole saved world and sync the draft/sliders so
   * the loaded scenario is ready to RUN and to edit. */
  loadRunWorld: (w: WorldState) => void;
  narrative: string | null; // preset scenario blurb
  setNarrative: (n: string | null) => void;
};

const FLASH_MS = 5000;
let flashTimer: ReturnType<typeof setTimeout> | null = null;

export const useStore = create<State>((set, get) => ({
  selectedPlant: null,
  setSelectedPlant: (p) =>
    set({ selectedPlant: p, ...(p ? { selectedShip: null } : {}) }),
  selectedShip: null,
  // selecting a ship flashes it green for 5s, from any path (map click,
  // alert card, search/⌘K) — the flash lives here so no caller can skip it
  setSelectedShip: (s) => {
    if (flashTimer) clearTimeout(flashTimer);
    if (s)
      flashTimer = setTimeout(() => set({ highlightMmsi: null }), FLASH_MS);
    set({
      selectedShip: s,
      highlightMmsi: s ? s.mmsi : null,
      ...(s ? { selectedPlant: null } : {}),
    });
  },
  pi: 0,
  setPi: (pi) => set({ pi, piMode: "manual" }),
  // default to the LIVE EST. (fused) reading — the panel should open on what
  // the feeds actually say; dragging the slider hands control back to WHAT-IF.
  // Until the first fused value lands, the LIVE EST. button stays disabled
  // ("backend offline"), so this never dresses up an absent estimate.
  piMode: "fused",
  piFused: null,
  confidence: null,
  fusedDriver: null,
  setFused: (piFused, confidence, fusedDriver = null) =>
    set((s) => ({
      piFused,
      confidence,
      fusedDriver,
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
  newsItems: [],
  setNewsItems: (newsItems) => set({ newsItems }),
  brentUsd: null,
  setBrentUsd: (brentUsd) => set({ brentUsd }),
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
    set({ tab: "FinOcean Maximus" });
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
  cascadeFocus: null,
  setCascadeFocus: (cascadeFocus) => set({ cascadeFocus }),
  world: { dashboard: null, ships: null },
  // each card commits INDEPENDENTLY — loading one must never wipe the other
  commitDashboard: (dashboard) =>
    set((s) => ({ world: { ...s.world, dashboard } })),
  commitShips: (ships) => set((s) => ({ world: { ...s.world, ships } })),
  clearWorldCard: (which) =>
    set((s) => ({ world: { ...s.world, [which]: null } })),
  loadRunWorld: (w) =>
    set(() => ({
      world: { dashboard: w.dashboard ?? null, ships: w.ships ?? null },
      // mirror into the draft so the sub-pages open on the loaded config
      draft: {
        redsea: w.dashboard?.disruptions.redsea ?? 0,
        opec: w.dashboard?.disruptions.opec ?? 0,
        ships: w.ships ?? [],
      },
      // reflect the loaded Hormuz value on the map slider (manual = not
      // overridden by live fusion)
      ...(w.dashboard
        ? { pi: w.dashboard.disruptions.hormuz, piMode: "manual" as const }
        : {}),
    })),
  narrative: null,
  setNarrative: (narrative) => set({ narrative }),
}));
