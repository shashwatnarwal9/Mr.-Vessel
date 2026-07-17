import { useEffect, useRef } from "react";
import maplibregl, { type StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useStore, type PlantProps, type ShipProps } from "../store";
import { loadCorridorRisks } from "../lib/risk";

// supplier terminal marker — small amber diamond, canvas-drawn
function supplierDiamond(): ImageData {
  const c = document.createElement("canvas");
  c.width = c.height = 14;
  const g = c.getContext("2d")!;
  g.beginPath();
  g.moveTo(7, 1);
  g.lineTo(13, 7);
  g.lineTo(7, 13);
  g.lineTo(1, 7);
  g.closePath();
  g.fillStyle = "#c98500";
  g.fill();
  g.strokeStyle = "#0a0e17";
  g.lineWidth = 1.5;
  g.stroke();
  return g.getImageData(0, 0, 14, 14);
}

import { mapHandle } from "../lib/mapHandle";
import { annotateFleet, loadSanctionsIndex } from "../lib/sanctions";

// arrow icons drawn on a canvas — no asset files. Sanctioned vessels
// render red; shadow-fleet hotter (halo ring) per M6c.
function shipArrow(fill = "#7dd3fc", halo = false): ImageData {
  const c = document.createElement("canvas");
  c.width = c.height = 28;
  const g = c.getContext("2d")!;
  if (halo) {
    g.beginPath();
    g.arc(14, 14, 12, 0, Math.PI * 2);
    g.strokeStyle = "rgba(255,68,68,0.7)";
    g.lineWidth = 2;
    g.stroke();
  }
  g.beginPath();
  g.moveTo(14, 4);
  g.lineTo(22, 24);
  g.lineTo(14, 19);
  g.lineTo(6, 24);
  g.closePath();
  g.fillStyle = fill;
  g.fill();
  g.strokeStyle = "#0a0e17";
  g.lineWidth = 1.5;
  g.stroke();
  return g.getImageData(0, 0, 28, 28);
}

const DARK_GLOBE_STYLE: StyleSpecification = {
  version: 8,
  projection: { type: "globe" },
  // required for symbol text (corridor labels); free OpenMapTiles glyphs
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
    // background = fallback if tiles unreachable; globe still renders dark
    { id: "bg", type: "background", paint: { "background-color": "#0a0e17" } },
    { id: "carto", type: "raster", source: "carto" },
  ],
};

// exported for the legend later
export const FUEL_COLORS: Record<string, string> = {
  Coal: "#b45309",
  Gas: "#f97316",
  Oil: "#ef4444",
  Hydro: "#3b82f6",
  Nuclear: "#a855f7",
  Solar: "#facc15",
  Wind: "#22d3ee",
  Biomass: "#4ade80",
};

export default function GlobeMap({ visible }: { visible: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: DARK_GLOBE_STYLE,
      center: [72, 18], // Arabian Sea / India
      zoom: 3,
    });
    const FUEL_MATCH = [
      "match",
      ["get", "primary_fuel"],
      "Coal", FUEL_COLORS.Coal,
      "Gas", FUEL_COLORS.Gas,
      "Oil", FUEL_COLORS.Oil,
      "Hydro", FUEL_COLORS.Hydro,
      "Nuclear", FUEL_COLORS.Nuclear,
      "Solar", FUEL_COLORS.Solar,
      "Wind", FUEL_COLORS.Wind,
      "Biomass", FUEL_COLORS.Biomass,
      "#94a3b8",
    ] as maplibregl.ExpressionSpecification;
    const RADIUS = [
      "interpolate",
      ["linear"],
      ["sqrt", ["get", "capacity_mw"]],
      0, 1.5,
      70, 12,
    ] as maplibregl.ExpressionSpecification;

    map.on("load", () => {
      map.addSource("plants", {
        type: "geojson",
        data: "/india_powerplants.geojson",
      });
      map.addLayer({
        id: "plants",
        type: "circle",
        source: "plants",
        paint: {
          "circle-color": FUEL_MATCH,
          "circle-radius": RADIUS,
          "circle-opacity": 0.85,
          "circle-stroke-width": 0.5,
          "circle-stroke-color": "#0a0e17",
        },
      });

      // RA2: corridors colored by fused disruption probability + labels
      loadCorridorRisks()
        .then((risks) => {
          if (!map.getStyle()) return; // map torn down
          map.addSource("corridors", {
            type: "geojson",
            data: {
              type: "FeatureCollection",
              features: risks.map((r) => ({
                type: "Feature",
                geometry: {
                  type: "Polygon",
                  coordinates: [[...r.corridor.polygon, r.corridor.polygon[0]]],
                },
                properties: {
                  id: r.corridor.id,
                  p: r.p,
                  label: `${r.corridor.name}\n${(r.p * 100).toFixed(0)}%`,
                },
              })),
            },
          });
          map.addLayer({
            id: "corridors-fill",
            type: "fill",
            source: "corridors",
            paint: {
              // status ramp: green→amber→red by probability
              "fill-color": [
                "interpolate", ["linear"], ["get", "p"],
                0, "#0ca30c",
                0.15, "#e8871e",
                0.35, "#e2603b",
                0.6, "#d03b3b",
              ],
              "fill-opacity": 0.28,
            },
          });
          map.on("click", "corridors-fill", (e) => {
            const p = e.features?.[0]?.properties as { id?: string } | undefined;
            if (p?.id) useStore.getState().setSelectedCorridor(p.id);
          });
          map.addLayer({
            id: "corridors-line",
            type: "line",
            source: "corridors",
            paint: {
              "line-color": [
                "interpolate", ["linear"], ["get", "p"],
                0, "#0ca30c",
                0.15, "#e8871e",
                0.35, "#e2603b",
                0.6, "#d03b3b",
              ],
              "line-width": 1.5,
            },
          });
          // labels on centroid POINTS (polygon labels repeat per tile)
          map.addSource("corridor-labels", {
            type: "geojson",
            data: {
              type: "FeatureCollection",
              features: risks.map((r) => ({
                type: "Feature",
                geometry: { type: "Point", coordinates: r.corridor.centroid },
                properties: {
                  label: `${r.corridor.name}\n${(r.p * 100).toFixed(0)}%`,
                },
              })),
            },
          });
          map.addLayer({
            id: "corridors-label",
            type: "symbol",
            source: "corridor-labels",
            layout: {
              "text-field": ["get", "label"],
              "text-size": 11,
              "text-font": ["Open Sans Regular"],
            },
            paint: {
              "text-color": "#ffffff",
              "text-halo-color": "#0a0e17",
              "text-halo-width": 1.5,
            },
          });
        })
        .catch(() => {}); // corridors are enrichment — never break the map

      // supplier source terminals (risk-agent geography): diamond markers
      fetch("/supplier_dependency.json")
        .then((r) => r.json())
        .then((dep) => {
          if (!map.getStyle()) return;
          map.addImage("supplier-icon", supplierDiamond());
          map.addSource("suppliers", {
            type: "geojson",
            data: {
              type: "FeatureCollection",
              features: dep.suppliers.map(
                (s: { coords: [number, number]; name: string }) => ({
                  type: "Feature",
                  geometry: { type: "Point", coordinates: s.coords },
                  properties: { name: s.name },
                }),
              ),
            },
          });
          map.addLayer({
            id: "suppliers",
            type: "symbol",
            source: "suppliers",
            layout: {
              "icon-image": "supplier-icon",
              "icon-size": 1,
              "icon-allow-overlap": true,
            },
          });
        })
        .catch(() => {});

      // Israel/Egypt: context only (M4) — outlined/muted, no economics
      for (const id of ["israel", "egypt"] as const) {
        map.addSource(`${id}-plants`, {
          type: "geojson",
          data: `/${id}_powerplants.geojson`,
        });
        map.addLayer({
          id: `${id}-plants`,
          type: "circle",
          source: `${id}-plants`,
          paint: {
            "circle-color": "transparent",
            "circle-radius": RADIUS,
            "circle-stroke-width": 1.2,
            "circle-stroke-color": FUEL_MATCH,
            "circle-stroke-opacity": 0.55,
          },
        });
      }
    });

    map.on("load", () => {
      map.addImage("ship-arrow", shipArrow());
      map.addImage("ship-arrow-sanctioned", shipArrow("#d03b3b"));
      map.addImage("ship-arrow-shadow", shipArrow("#ff4444", true));
      map.addImage("ship-arrow-highlight", shipArrow("#0ca30c"));
      map.addSource("ships", {
        type: "geojson",
        data: useStore.getState().ships ?? {
          type: "FeatureCollection",
          features: [],
        },
      });
      map.addLayer({
        id: "ships",
        type: "symbol",
        source: "ships",
        layout: {
          "icon-image": [
            "match",
            ["get", "sanction"],
            "shadow_fleet", "ship-arrow-shadow",
            "sanctioned", "ship-arrow-sanctioned",
            "ship-arrow",
          ],
          "icon-size": 0.8,
          "icon-rotate": ["get", "course"],
          "icon-rotation-alignment": "map",
          "icon-allow-overlap": true,
        },
      });
      // search-hit flash: same source, green arrow, filtered to one MMSI
      map.addLayer({
        id: "ships-highlight",
        type: "symbol",
        source: "ships",
        filter: ["==", ["get", "mmsi"], -1],
        layout: {
          "icon-image": "ship-arrow-highlight",
          "icon-size": 1.1,
          "icon-rotate": ["get", "course"],
          "icon-rotation-alignment": "map",
          "icon-allow-overlap": true,
        },
      });
    });

    map.on("click", "ships", (e) => {
      const f = e.features?.[0];
      if (f) {
        const [lon, lat] = (
          f.geometry as { coordinates: [number, number] }
        ).coordinates;
        useStore
          .getState()
          .setSelectedShip({ ...(f.properties as ShipProps), lon, lat });
      }
    });
    map.on("mouseenter", "ships", () => {
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", "ships", () => {
      map.getCanvas().style.cursor = "";
    });

    for (const layer of ["plants", "israel-plants", "egypt-plants"]) {
      map.on("click", layer, (e) => {
        const f = e.features?.[0];
        if (f) useStore.getState().setSelectedPlant(f.properties as PlantProps);
      });
      map.on("mouseenter", layer, () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", layer, () => {
        map.getCanvas().style.cursor = "";
      });
    }

    mapRef.current = map;
    mapHandle.current = map;

    // maplibre only tracks window resizes; the container can gain its real
    // height after construction (dev-mode CSS injection race) — observe it
    const ro = new ResizeObserver(() => map.resize());
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      map.remove();
      mapRef.current = null;
      mapHandle.current = null;
    };
  }, []);

  const ships = useStore((s) => s.ships);
  useEffect(() => {
    const src = mapRef.current?.getSource("ships") as
      | maplibregl.GeoJSONSource
      | undefined;
    if (!src || !ships) return;
    src.setData(ships); // paint immediately, annotate when the index lands
    let alive = true;
    loadSanctionsIndex()
      .then(({ idx }) => {
        if (!alive) return;
        const { features, screened, matched } = annotateFleet(
          ships.features,
          idx,
        );
        useStore.getState().setScreening({ screened, matched });
        (mapRef.current?.getSource("ships") as maplibregl.GeoJSONSource | undefined)?.setData({
          type: "FeatureCollection",
          features,
        });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [ships]);

  // search-hit flash: point the highlight layer at the found ship
  const highlightMmsi = useStore((s) => s.highlightMmsi);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getLayer("ships-highlight")) return;
    map.setFilter("ships-highlight", ["==", ["get", "mmsi"], highlightMmsi ?? -1]);
  }, [highlightMmsi]);

  const contextLayers = useStore((s) => s.contextLayers);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    for (const id of ["israel", "egypt"] as const) {
      if (map.getLayer(`${id}-plants`)) {
        map.setLayoutProperty(
          `${id}-plants`,
          "visibility",
          contextLayers[id] ? "visible" : "none",
        );
      }
    }
  }, [contextLayers]);

  return (
    // inline position/inset: maplibre's own .maplibregl-map class sets
    // position:relative and outranks Tailwind utilities by load order
    <div
      ref={containerRef}
      style={{
        position: "absolute",
        inset: 0,
        visibility: visible ? "visible" : "hidden",
      }}
    />
  );
}
