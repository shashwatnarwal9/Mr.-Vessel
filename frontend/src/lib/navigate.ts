// Shared entity navigation: SearchBar and the ⌘K command palette both
// route through here (presentation-layer only — store + camera moves).
import { mapHandle } from "./mapHandle";
import { useStore, type PlantProps, type ShipProps } from "../store";

export type PlantFeature = {
  geometry: { coordinates: [number, number] };
  properties: PlantProps;
};

// module-level plant cache: all three countries, fetched once
let PLANTS: PlantFeature[] | null = null;
export async function loadPlants(): Promise<PlantFeature[]> {
  if (PLANTS) return PLANTS;
  const files = [
    "/india_powerplants.geojson",
    "/israel_powerplants.geojson",
    "/egypt_powerplants.geojson",
  ];
  const all = await Promise.all(
    files.map((f) =>
      fetch(f)
        .then((r) => r.json())
        .then((fc) => fc.features as PlantFeature[])
        .catch(() => []),
    ),
  );
  PLANTS = all.flat();
  return PLANTS;
}

let flashTimer: ReturnType<typeof setTimeout> | null = null;

/** Jump to a ship: map tab, select, green flash (5s), fly the camera. */
export function gotoShip(ship: ShipProps, lonlat: [number, number]) {
  const st = useStore.getState();
  st.setTab("Command Map");
  st.setSelectedShip({ ...ship, lon: lonlat[0], lat: lonlat[1] });
  st.setHighlightMmsi(ship.mmsi);
  if (flashTimer) clearTimeout(flashTimer);
  flashTimer = setTimeout(
    () => useStore.getState().setHighlightMmsi(null),
    5000,
  );
  mapHandle.current?.flyTo({ center: lonlat, zoom: 8, duration: 1800 });
}

/** Jump to a plant: map tab, select, fly the camera. */
export function gotoPlant(plant: PlantProps, lonlat: [number, number]) {
  const st = useStore.getState();
  st.setTab("Command Map");
  st.setSelectedPlant(plant);
  mapHandle.current?.flyTo({ center: lonlat, zoom: 8, duration: 1800 });
}

/** Jump to a corridor: map tab, select, frame it. */
export function gotoCorridor(id: string, centroid: [number, number]) {
  const st = useStore.getState();
  st.setTab("Command Map");
  st.setSelectedCorridor(id);
  mapHandle.current?.flyTo({ center: centroid, zoom: 5, duration: 1800 });
}
