import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import { useStore } from "../store";
import {
  addedDays,
  freightDeltaUsd,
  isRoutable,
  routeFromPosition,
  NODES,
  type Chokepoint,
  type RouteResult,
} from "../lib/routeGraph";
import { estimateCargoBbl } from "../lib/ships";
import PageIntro from "./PageIntro";

const API = import.meta.env.VITE_API_HTTP ?? "http://localhost:8000";
const SPEED_NM_PER_DAY_BASE = 24;

// the simulated vessel's own marker — canvas-drawn, no asset
function shipIcon(): ImageData {
  const c = document.createElement("canvas");
  c.width = c.height = 28;
  const g = c.getContext("2d")!;
  g.beginPath();
  g.arc(14, 14, 12, 0, Math.PI * 2);
  g.strokeStyle = "rgba(251,176,64,0.5)";
  g.lineWidth = 2;
  g.stroke();
  g.beginPath();
  g.moveTo(14, 4);
  g.lineTo(22, 24);
  g.lineTo(14, 19);
  g.lineTo(6, 24);
  g.closePath();
  g.fillStyle = "#fbb040";
  g.fill();
  g.strokeStyle = "#0a0e17";
  g.lineWidth = 1.5;
  g.stroke();
  return g.getImageData(0, 0, 28, 28);
}

const SCENARIOS: { id: string; label: string; blocked: Chokepoint[] }[] = [
  { id: "hormuz", label: "Strait of Hormuz blocked", blocked: ["hormuz"] },
  { id: "redsea", label: "Red Sea closed (Suez + Bab el-Mandeb)", blocked: ["suez", "babmandeb"] },
  { id: "suez", label: "Suez Canal blocked", blocked: ["suez"] },
  { id: "dark", label: "Sanction diversion (avoid Suez, go the long way)", blocked: ["suez"] },
];

const DEST_OPTIONS = ["SIKKA", "VADINAR", "MUMBAI", "KOCHI", "CHENNAI"];

type SimOutput = {
  normal: RouteResult;
  alt: RouteResult | null;
  days: number;
  freight: number;
  cuopt: { cost: number; matches: boolean } | null;
};

export default function ShipSimulator() {
  const ships = useStore((s) => s.ships);
  const shipsMode = useStore((s) => s.shipsMode);
  const { addDraftShip, setTab } = useStore.getState();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<number | null>(null);
  const [scenario, setScenario] = useState(SCENARIOS[0]);
  const [dest, setDest] = useState("SIKKA");
  const [speed, setSpeed] = useState<number | null>(null);
  const [out, setOut] = useState<SimOutput | null>(null);
  const mapDiv = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);

  // the whole fleet is selectable (the list scrolls) — but only vessels the
  // route graph can honestly join to a sea lane. Anything further than the
  // snap limit from every waypoint would have to be drawn across land.
  const candidates = useMemo(() => {
    const all = ships?.features ?? [];
    const q = query.trim().toLowerCase();
    return all
      .filter((f) => isRoutable(f.geometry.coordinates))
      .filter(
        (f) =>
          !q ||
          f.properties.name.toLowerCase().includes(q) ||
          String(f.properties.mmsi).includes(q) ||
          String(f.properties.imo ?? "").includes(q),
      );
  }, [ships, query]);

  const ship = ships?.features.find((f) => f.properties.mmsi === selected) ?? null;

  // route map (independent maplibre instance, plain dark)
  useEffect(() => {
    if (!mapDiv.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: mapDiv.current,
      style: {
        version: 8,
        // required for the ship/destination labels
        glyphs: "https://fonts.openmaptiles.org/{fontstack}/{range}.pbf",
        sources: {
          carto: {
            type: "raster",
            tiles: ["a", "b", "c", "d"].map(
              (s) => `https://${s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png`,
            ),
            tileSize: 256,
            attribution: "© OpenStreetMap contributors © CARTO",
          },
        },
        layers: [
          { id: "bg", type: "background", paint: { "background-color": "#0a0e17" } },
          { id: "carto", type: "raster", source: "carto" },
        ],
      },
      center: [55, 18],
      zoom: 2.4,
    });
    const ro = new ResizeObserver(() => map.resize());
    ro.observe(mapDiv.current);
    mapRef.current = map;
    return () => {
      ro.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  const run = async () => {
    if (!ship) return;
    const pos = ship.geometry.coordinates;
    const sog = speed ?? ship.properties.speed;
    const normal = routeFromPosition(pos, dest, new Set());
    if (!normal) return;
    const alt = routeFromPosition(pos, dest, new Set(scenario.blocked));
    const days = alt ? addedDays(normal.nm, alt.nm, sog) : Infinity;
    const cargo = estimateCargoBbl(ship.properties.type) || 1_000_000;
    const freight = alt ? freightDeltaUsd(days, cargo) : 0;
    const result: SimOutput = { normal, alt, days, freight, cuopt: null };
    setOut(result);
    drawRoutes(normal, alt);

    // cuOpt verification (key-gated, honest fallback): send an all-pairs
    // day-matrix over the same nodes so the managed solver prices the
    // identical problem
    try {
      const ids = Object.keys(NODES);
      const matrix = ids.map((a) =>
        ids.map((b) => {
          const r =
            a === b
              ? { nm: 0 }
              : routeFromPosition(NODES[a], b, new Set(scenario.blocked));
          return r ? r.nm / (sog * SPEED_NM_PER_DAY_BASE) : 10_000;
        }),
      );
      const src = ids.indexOf(alt?.nodes[0] ?? "ARABIAN_SEA");
      const dst = ids.indexOf(dest);
      const res = await fetch(`${API}/route/solve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matrix, src, dst }),
      }).then((r) => r.json());
      if (typeof res.cost === "number" && alt) {
        const localDays = alt.nm / (sog * SPEED_NM_PER_DAY_BASE);
        setOut((o) =>
          o
            ? {
                ...o,
                cuopt: {
                  cost: res.cost,
                  matches: Math.abs(res.cost - localDays) / Math.max(localDays, 1e-9) < 0.15,
                },
              }
            : o,
        );
      }
    } catch {
      /* offline: local Haversine result stands alone */
    }
  };

  /** run cb once the style can accept sources/layers */
  const whenReady = (cb: (m: maplibregl.Map) => void) => {
    const map = mapRef.current;
    if (!map) return;
    if (map.isStyleLoaded()) cb(map);
    else map.once("load", () => cb(map));
  };

  // the selected vessel is on the map immediately — before any simulation
  useEffect(() => {
    whenReady((map) => {
      const data = {
        type: "FeatureCollection" as const,
        features: ship
          ? [
              {
                type: "Feature" as const,
                geometry: {
                  type: "Point" as const,
                  coordinates: ship.geometry.coordinates,
                },
                properties: {
                  name: ship.properties.name,
                  course: ship.properties.course,
                },
              },
            ]
          : [],
      };
      const src = map.getSource("sim-ship") as maplibregl.GeoJSONSource | undefined;
      if (src) {
        src.setData(data);
      } else {
        if (!map.hasImage("sim-ship-icon")) map.addImage("sim-ship-icon", shipIcon());
        map.addSource("sim-ship", { type: "geojson", data });
        map.addLayer({
          id: "sim-ship",
          type: "symbol",
          source: "sim-ship",
          layout: {
            "icon-image": "sim-ship-icon",
            "icon-rotate": ["get", "course"],
            "icon-rotation-alignment": "map",
            "icon-allow-overlap": true,
            "text-field": ["get", "name"],
            "text-font": ["Open Sans Regular"],
            "text-size": 12,
            "text-offset": [0, 1.4],
            "text-anchor": "top",
            "text-allow-overlap": true,
          },
          paint: {
            "text-color": "#e5e9f0",
            "text-halo-color": "#0a0e17",
            "text-halo-width": 1.5,
          },
        });
      }
      // no route drawn yet → centre on the vessel so it's visible at once
      if (ship && !map.getLayer("route-new")) {
        map.flyTo({ center: ship.geometry.coordinates, zoom: 4, duration: 900 });
      }
    });
  }, [ship]);

  const drawRoutes = (normal: RouteResult, alt: RouteResult | null) => {
    const map = mapRef.current;
    if (!map) return;
    const line = (id: string, coords: [number, number][], paint: object) => {
      const data = {
        type: "Feature" as const,
        geometry: { type: "LineString" as const, coordinates: coords },
        properties: {},
      };
      const src = map.getSource(id) as maplibregl.GeoJSONSource | undefined;
      if (src) src.setData(data);
      else {
        map.addSource(id, { type: "geojson", data });
        // keep the vessel marker on top of its own routes
        map.addLayer(
          { id, type: "line", source: id, paint: paint as never },
          map.getLayer("sim-ship") ? "sim-ship" : undefined,
        );
      }
    };
    line("route-normal", normal.path, {
      "line-color": "#64748b",
      "line-width": 2,
      "line-dasharray": [2, 2],
    });
    line("route-new", alt?.path ?? [], {
      "line-color": "#ef4444",
      "line-width": 3,
    });

    // destination marker
    const destData = {
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: NODES[dest] },
      properties: { name: dest },
    };
    const dsrc = map.getSource("sim-dest") as maplibregl.GeoJSONSource | undefined;
    if (dsrc) dsrc.setData(destData);
    else {
      map.addSource("sim-dest", { type: "geojson", data: destData });
      map.addLayer(
        {
          id: "sim-dest",
          type: "circle",
          source: "sim-dest",
          paint: {
            "circle-radius": 5,
            "circle-color": "#fbb040",
            "circle-stroke-color": "#0a0e17",
            "circle-stroke-width": 2,
          },
        },
        map.getLayer("sim-ship") ? "sim-ship" : undefined,
      );
    }

    const all = [...normal.path, ...(alt?.path ?? [])];
    const lons = all.map((p) => p[0]);
    const lats = all.map((p) => p[1]);
    map.fitBounds(
      [
        [Math.min(...lons) - 3, Math.min(...lats) - 3],
        [Math.max(...lons) + 3, Math.max(...lats) + 3],
      ],
      { duration: 800 },
    );
  };

  const sog = speed ?? ship?.properties.speed ?? 12;

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mx-auto flex max-w-[1600px] flex-col gap-4">
        <PageIntro
          page="shipsim"
          intro="Take one ship, block its route, and see the detour: the red line is its new path, with the added days and cost computed from its own speed."
          hint="Pick a ship, choose what happens to it, press Simulate. Push the result into the Simulation Dashboard to see what it does to India."
        />

        {/* top 3 cards row */}
        <div className="grid shrink-0 grid-cols-1 gap-4 md:grid-cols-3">
          {/* card 1: ship picker */}
          <div className="flex flex-col gap-4 rounded-lg border border-hairline bg-panel p-4">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-[16px] text-secondary">
                directions_boat
              </span>
              <h2 className="label-caps text-ink-3">Select Vessel</h2>
              <span className="micro-mono ml-auto text-ink-3">
                {candidates.length}
              </span>
            </div>
            <div className="relative">
              <span className="material-symbols-outlined pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[16px] text-ink-3">
                search
              </span>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search name / MMSI / IMO…"
                aria-label="Search ships"
                className="body-md w-full rounded border border-hairline bg-navy-deep py-2 pl-8 pr-2 text-ink outline-none placeholder:text-ink-3 focus:border-secondary"
              />
            </div>
            <ul className="flex max-h-60 flex-col gap-1 overflow-y-auto pr-1">
              {candidates.map((f) => (
                <li key={f.properties.mmsi}>
                  <button
                    onClick={() => setSelected(f.properties.mmsi)}
                    className={`flex w-full items-center justify-between border-l-[3px] p-2 text-left transition-colors ${
                      selected === f.properties.mmsi
                        ? "border-secondary bg-gold-wash"
                        : "border-transparent hover:bg-raised"
                    }`}
                  >
                    <span>
                      <span
                        className={`body-md block ${
                          selected === f.properties.mmsi
                            ? "font-semibold text-ink"
                            : "text-ink-2"
                        }`}
                      >
                        {f.properties.name}
                      </span>
                      <span className="micro-mono text-ink-3">
                        {f.properties.type} · {f.properties.speed} kn ·{" "}
                        {shipsMode === "live" ? "live AIS" : "demo fleet"}
                      </span>
                    </span>
                    {selected === f.properties.mmsi && (
                      <span className="material-symbols-outlined text-[16px] text-secondary">
                        my_location
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </div>

          {/* card 2: scenario parameters */}
          <div className="flex flex-col justify-between gap-4 rounded-lg border border-hairline bg-panel p-4">
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[16px] text-secondary">
                  crisis_alert
                </span>
                <h2 className="label-caps text-ink-3">Scenario Parameters</h2>
              </div>
              <div className="flex flex-col gap-1">
                {SCENARIOS.map((s) => (
                  <label
                    key={s.id}
                    className={`flex cursor-pointer items-center gap-2 py-0.5 ${
                      scenario.id === s.id ? "" : "opacity-50"
                    }`}
                  >
                    <input
                      type="radio"
                      name="scenario"
                      checked={scenario.id === s.id}
                      onChange={() => setScenario(s)}
                      className="h-3 w-3 accent-[#ffb956]"
                    />
                    <span className="body-md text-ink-2">{s.label}</span>
                  </label>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-1">
                  <span className="label-caps text-ink-3">DESTINATION</span>
                  <select
                    value={dest}
                    onChange={(e) => setDest(e.target.value)}
                    aria-label="New destination"
                    className="micro-mono w-full rounded border border-hairline bg-navy-deep px-2 py-2 text-ink outline-none focus:border-secondary"
                  >
                    {DEST_OPTIONS.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <div className="flex items-center justify-between">
                    <span className="label-caps text-ink-3">SPEED</span>
                    <span className="micro-mono text-secondary">
                      {sog} kt
                    </span>
                  </div>
                  <div className="flex h-[34px] items-center">
                    <input
                      type="range"
                      min={6}
                      max={20}
                      step={0.5}
                      value={sog}
                      onChange={(e) => setSpeed(Number(e.target.value))}
                      className="w-full"
                      aria-label="Speed override"
                    />
                  </div>
                </div>
              </div>
            </div>
            <button
              onClick={run}
              disabled={!ship}
              className="label-caps flex w-full items-center justify-center gap-1 rounded bg-secondary py-2 text-navy transition-colors hover:bg-gold-hover disabled:opacity-40"
            >
              <span className="material-symbols-outlined text-[16px]">
                play_arrow
              </span>
              Simulate this ship
            </button>
          </div>

          {/* card 3: result */}
          <div className="flex flex-col gap-4 rounded-lg border border-hairline bg-panel p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[16px] text-secondary">
                  route
                </span>
                <h2 className="label-caps text-ink-3">
                  Simulation Result
                </h2>
              </div>
              <div className="flex items-center gap-1">
                <span
                  className={`h-2 w-2 rounded-full ${
                    out?.cuopt ? "bg-good" : "bg-bright"
                  }`}
                />
                <span className="micro-mono text-ink">
                  {out?.cuopt ? "cuOpt Active" : "cuOpt offline"}
                </span>
              </div>
            </div>
            {!out && <p className="micro-mono text-ink-3">run a simulation…</p>}
            {out && (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <div className="flex flex-col gap-1 rounded border border-hairline bg-navy-deep p-2">
                    <span className="label-caps text-ink-3">NORMAL ROUTE</span>
                    <span className="micro-mono text-ink-2">
                      {Math.round(out.normal.nm).toLocaleString()} nm
                    </span>
                    <span className="micro-mono text-ink-2">
                      {(out.normal.nm / (sog * SPEED_NM_PER_DAY_BASE)).toFixed(1)} days
                    </span>
                  </div>
                  {out.alt ? (
                    <div className="relative flex flex-col gap-1 overflow-hidden rounded border border-critical/30 bg-navy-deep p-2">
                      <div className="absolute right-0 top-0 h-8 w-8 rounded-bl-full bg-critical opacity-10" />
                      <span className="label-caps text-critical">NEW ROUTE</span>
                      <span className="micro-mono font-bold text-critical-text">
                        +{Math.round(out.alt.nm - out.normal.nm).toLocaleString()} nm
                      </span>
                      <span className="micro-mono font-bold text-critical-text">
                        +{out.days.toFixed(1)} days
                      </span>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-1 rounded border border-critical/30 bg-navy-deep p-2">
                      <span className="label-caps text-critical">NEW ROUTE</span>
                      <span className="micro-mono text-critical-text">
                        no sea route — cargo stranded (that IS the result)
                      </span>
                    </div>
                  )}
                </div>
                {out.alt && (
                  <div className="mt-auto flex flex-col gap-2">
                    <div className="h-px w-full bg-hairline" />
                    <div className="flex items-center justify-between">
                      <span className="label-caps text-ink-3">
                        EST. FREIGHT IMPACT
                      </span>
                      <span className="micro-mono text-critical-text">
                        +${(out.freight / 1e6).toFixed(2)}M
                      </span>
                    </div>
                    {out.cuopt && (
                      <p
                        className={`micro-mono ${
                          out.cuopt.matches ? "text-good-text" : "text-elevated"
                        }`}
                      >
                        cuOpt: {out.cuopt.cost.toFixed(1)} d voyage{" "}
                        {out.cuopt.matches
                          ? "✓ matches local solver"
                          : "(differs — showing local)"}
                      </p>
                    )}
                    <button
                      onClick={() => {
                        if (!ship) return;
                        addDraftShip(
                          {
                            ...ship.properties,
                            lon: ship.geometry.coordinates[0],
                            lat: ship.geometry.coordinates[1],
                          },
                          { kind: "delay", delayDays: Math.max(1, Math.round(out.days)) },
                        );
                        setTab("Simulation Dashboard");
                      }}
                      className="label-caps w-full rounded border border-secondary/50 py-1 text-secondary transition-colors hover:bg-gold-wash"
                    >
                      → PUSH INTO SIMULATION DASHBOARD (
                      {Math.max(1, Math.round(out.days))}D DELAY)
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* map hero: live maplibre canvas with Stitch chrome */}
        <div className="relative flex-grow overflow-hidden rounded-lg border border-hairline bg-navy-deep">
          <div
            ref={mapDiv}
            style={{ height: "26rem" }}
            aria-label="Route map: muted line = normal route, red line = new route"
          />
          {/* zoom control */}
          <div className="absolute left-4 top-4 flex flex-col gap-1 rounded border border-hairline bg-panel/80 p-1 backdrop-blur-md">
            <button
              onClick={() => mapRef.current?.zoomIn()}
              aria-label="Zoom in"
              className="flex h-8 w-8 items-center justify-center rounded text-ink-2 transition-colors hover:bg-raised"
            >
              <span className="material-symbols-outlined text-[18px]">add</span>
            </button>
            <div className="h-px w-full bg-hairline" />
            <button
              onClick={() => mapRef.current?.zoomOut()}
              aria-label="Zoom out"
              className="flex h-8 w-8 items-center justify-center rounded text-ink-2 transition-colors hover:bg-raised"
            >
              <span className="material-symbols-outlined text-[18px]">remove</span>
            </button>
          </div>
          {/* legend */}
          <div className="absolute bottom-4 right-4 flex flex-col gap-2 rounded border border-hairline bg-panel/90 p-2 shadow-lg backdrop-blur-md">
            <div className="flex items-center gap-2">
              <div className="h-[2px] w-6 bg-[#ef4444]" />
              <span className="micro-mono text-ink">Simulated route (detour)</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-6 border-t border-dashed border-ink-3" />
              <span className="micro-mono text-ink-3">Standard route</span>
            </div>
            {ship && (
              <div className="mt-1 flex items-center gap-2 border-t border-hairline pt-1">
                <div className="flex w-6 items-center justify-center">
                  <div className="h-2 w-2 rounded-full bg-gold shadow-[0_0_8px_#fbb040]" />
                </div>
                <span className="micro-mono text-ink">{ship.properties.name}</span>
              </div>
            )}
          </div>
          {/* coordinates readout */}
          {ship && (
            <div className="absolute bottom-2 left-4">
              <span className="micro-mono text-ink-3 opacity-60">
                {ship.geometry.coordinates[1].toFixed(4)}° N,{" "}
                {ship.geometry.coordinates[0].toFixed(4)}° E
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
