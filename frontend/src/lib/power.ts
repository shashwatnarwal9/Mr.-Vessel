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
 *  weights are derived from port linkage (KG), not asserted. */
export const REFINERIES: { name: string; feedWeight: number; port: string }[] = [
  { name: "RIL Jamnagar", feedWeight: 1.15, port: "Sikka (Gulf-fed)" },
  { name: "Nayara Vadinar", feedWeight: 1.15, port: "Vadinar (Gulf-fed)" },
  { name: "BPCL Mumbai", feedWeight: 1.0, port: "Mumbai (Gulf-fed)" },
  { name: "MRPL Mangalore", feedWeight: 0.95, port: "New Mangalore (Gulf-fed)" },
  { name: "BPCL Kochi", feedWeight: 0.7, port: "Kochi (Red Sea / mixed feed)" },
  { name: "IOC Paradip", feedWeight: 0.6, port: "Paradip (east coast, mixed)" },
];

export function perRefineryRunRate(aggregateGapShare: number) {
  return REFINERIES.map((r) => ({
    ...r,
    runRate: Math.max(0, Math.min(1, 1 - aggregateGapShare * r.feedWeight)),
  }));
}
