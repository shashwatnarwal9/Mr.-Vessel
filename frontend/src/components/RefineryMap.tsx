import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import { REFINERIES } from "../lib/power";

/** Per-refinery run-rate map: each refinery highlighted on a dark India
 *  map with a tag above it showing its current run rate. Presentation
 *  only — rows come straight from perRefineryRunRate(). */
type Row = { name: string; port: string; runRate: number };

// refinery sites — one source of truth (shared with the cascade walkthrough)
const COORDS: Record<string, [number, number]> = Object.fromEntries(
  REFINERIES.map((r) => [r.name, r.coords]),
);

const fc = (rows: Row[]) => ({
  type: "FeatureCollection" as const,
  features: rows
    .filter((r) => COORDS[r.name])
    .map((r) => ({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: COORDS[r.name] },
      properties: {
        name: r.name,
        tag: `${(r.runRate * 100).toFixed(0)}%\n${r.name}`,
        stressed: r.runRate < 0.9,
        // Vadinar sits ~35 km from Jamnagar — its tag goes BELOW the
        // marker so the two never collide
        below: r.name === "Nayara Vadinar",
      },
    })),
});

export default function RefineryMap({ rows }: { rows: Row[] }) {
  const div = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  useEffect(() => {
    if (!div.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: div.current,
      style: {
        version: 8,
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
      center: [78, 17],
      zoom: 3.6,
      attributionControl: false,
    });
    const ro = new ResizeObserver(() => map.resize());
    ro.observe(div.current);
    mapRef.current = map;

    map.on("load", () => {
      map.addSource("refineries", { type: "geojson", data: fc(rowsRef.current) });
      map.addLayer({
        id: "refineries",
        type: "circle",
        source: "refineries",
        paint: {
          "circle-radius": 6,
          "circle-color": [
            "case",
            ["get", "stressed"],
            "#e8871e", // warning: run rate below 90%
            "#0ca30c",
          ],
          "circle-stroke-color": "#0a0e17",
          "circle-stroke-width": 2,
        },
      });
      const label = (id: string, below: boolean) =>
        map.addLayer({
          id,
          type: "symbol",
          source: "refineries",
          filter: ["==", ["get", "below"], below],
          layout: {
            "text-field": ["get", "tag"],
            "text-font": ["Open Sans Bold"],
            "text-size": 12,
            "text-anchor": below ? "top" : "bottom",
            "text-offset": below ? [0, 0.9] : [0, -0.9],
            "text-allow-overlap": true,
          },
          paint: {
            "text-color": "#ffffff",
            "text-halo-color": "#0a0e17",
            "text-halo-width": 1.6,
          },
        });
      label("refinery-tags-above", false);
      label("refinery-tags-below", true);

      // frame all sites
      const pts = Object.values(COORDS);
      map.fitBounds(
        [
          [Math.min(...pts.map((p) => p[0])) - 2.5, Math.min(...pts.map((p) => p[1])) - 2],
          [Math.max(...pts.map((p) => p[0])) + 2.5, Math.max(...pts.map((p) => p[1])) + 2.5],
        ],
        { duration: 0 },
      );
    });

    return () => {
      ro.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // new run → update the tags in place
  useEffect(() => {
    const src = mapRef.current?.getSource("refineries") as
      | maplibregl.GeoJSONSource
      | undefined;
    src?.setData(fc(rows));
  }, [rows]);

  return (
    <div
      ref={div}
      style={{ height: "22rem" }}
      className="overflow-hidden rounded border border-hairline"
      aria-label="Map of refineries with current run-rate tags"
    />
  );
}
