import { describe, expect, it } from "vitest";
import SHIPS from "../../public/ships.json";
import { haversineNm } from "./reroute";
import { NODES, seaRoute } from "./routeGraph";

describe("east-coast routing rounds Sri Lanka (never crosses land)", () => {
  it("Kochi → Chennai goes via Cape Comorin and south of Sri Lanka", () => {
    const r = seaRoute("KOCHI", "CHENNAI")!;
    expect(r.nodes).toContain("CAPE_COMORIN");
    expect(r.nodes).toContain("DONDRA_HEAD");
    expect(r.nodes).toContain("SL_EAST");
    // the sea detour is much longer than the overland straight line
    expect(r.nm).toBeGreaterThan(
      haversineNm(NODES.KOCHI, NODES.CHENNAI) * 1.5,
    );
  });

  it("Gulf loader → Chennai transits Hormuz then rounds the island", () => {
    const r = seaRoute("RAS_TANURA", "CHENNAI")!;
    expect(r.nodes).toContain("HORMUZ");
    expect(r.nodes).toContain("DONDRA_HEAD");
  });
});

/** Routing around the island is worthless if a hull is PARKED on it — the demo
 *  map centres on this water, so a ship in the hill country is the first thing
 *  a viewer sees. MT CRIMSON STAR shipped at [80.578, 6.489] (~60km inland,
 *  right latitude drift off the DONDRA_HEAD lane at [80.6, 5.4]).
 *
 *  The outline is INSET ~0.2° from the true coast, so it only ever flags
 *  clearly-inland points — a legitimate harbour or near-shore fix stays green.
 *  Ray casting, the standard even-odd rule. */
const SRI_LANKA_INLAND: [number, number][] = [
  [80.15, 9.45],
  [80.85, 9.05],
  [81.35, 8.15],
  [81.45, 7.2],
  [80.95, 6.25],
  [80.45, 6.05],
  [80.15, 6.45],
  [79.95, 7.35],
  [79.95, 8.35],
  [80.05, 9.05],
];

function onLand(lon: number, lat: number): boolean {
  let hit = false;
  for (let i = 0, j = SRI_LANKA_INLAND.length - 1; i < SRI_LANKA_INLAND.length; j = i++) {
    const [xi, yi] = SRI_LANKA_INLAND[i];
    const [xj, yj] = SRI_LANKA_INLAND[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      hit = !hit;
    }
  }
  return hit;
}

describe("baked fleet floats (no hull parked on Sri Lanka)", () => {
  const fleet = (
    SHIPS as unknown as {
      features: {
        geometry: { coordinates: [number, number] };
        properties: { name: string; mmsi: number };
      }[];
    }
  ).features;

  it("the land test catches inland points and clears coastal water", () => {
    expect(onLand(80.578, 6.489)).toBe(true); // the shipped bug
    expect(onLand(80.63, 7.29)).toBe(true); // Kandy, unambiguously inland
    expect(onLand(80.578, 5.42)).toBe(false); // DONDRA_HEAD lane, open sea
    expect(onLand(79.84, 6.95)).toBe(false); // Colombo harbour — never a false hit
  });

  it("no baked ship sits on the island", () => {
    const aground = fleet
      .filter((f) => onLand(...f.geometry.coordinates))
      .map((f) => `${f.properties.name} (${f.properties.mmsi}) @ ${f.geometry.coordinates}`);
    expect(aground).toEqual([]);
  });
});
