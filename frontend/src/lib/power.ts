// Electricity-at-risk (v7 M6): exposed MW = real Gas + Oil capacity from
// the WRI plant data (measured), scaled by the run's power-stress path.

type PlantFeature = { properties: { primary_fuel: string; capacity_mw: number } };

let _exposed: number | null = null;

export async function exposedPowerMW(): Promise<number> {
  if (_exposed !== null) return _exposed;
  const fc = await fetch("/india_powerplants.geojson").then((r) => r.json());
  _exposed = (fc.features as PlantFeature[])
    .filter((f) => f.properties.primary_fuel === "Gas" || f.properties.primary_fuel === "Oil")
    .reduce((s, f) => s + f.properties.capacity_mw, 0);
  return _exposed;
}

/** Gulf-fed refineries take a closure harder than east-coast ones. Feed
 *  weights are derived from port linkage (KG), not asserted. `coords` is
 *  the refinery site [lon, lat] — presentation only (map markers + the
 *  cascade walkthrough); it never enters the run-rate math. */
export const REFINERIES: {
  name: string;
  feedWeight: number;
  port: string;
  coords: [number, number];
}[] = [
  { name: "RIL Jamnagar", feedWeight: 1.15, port: "Sikka (Gulf-fed)", coords: [70.05, 22.35] },
  { name: "Nayara Vadinar", feedWeight: 1.15, port: "Vadinar (Gulf-fed)", coords: [69.7, 22.47] },
  { name: "BPCL Mumbai", feedWeight: 1.0, port: "Mumbai (Gulf-fed)", coords: [72.85, 19.03] },
  { name: "MRPL Mangalore", feedWeight: 0.95, port: "New Mangalore (Gulf-fed)", coords: [74.8, 12.99] },
  { name: "BPCL Kochi", feedWeight: 0.7, port: "Kochi (Red Sea / mixed feed)", coords: [76.24, 9.97] },
  { name: "IOC Paradip", feedWeight: 0.6, port: "Paradip (east coast, mixed)", coords: [86.61, 20.27] },
];

export function perRefineryRunRate(aggregateGapShare: number) {
  return REFINERIES.map((r) => ({
    ...r,
    runRate: Math.max(0, Math.min(1, 1 - aggregateGapShare * r.feedWeight)),
  }));
}
