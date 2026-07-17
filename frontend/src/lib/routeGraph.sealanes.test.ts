import { describe, expect, it } from "vitest";
import {
  isRoutable,
  nearestNodeNm,
  NODES,
  routeFromPosition,
  seaRoute,
} from "./routeGraph";

/** Ships sail on water. Every leg of the network must stay at sea — these
 *  pin the lanes that used to be drawn straight through a continent. */

// Boxes that are UNAMBIGUOUSLY interior land — deliberately tight so the
// assertion has no false positives (a bigger rectangle would swallow the
// Persian Gulf, the Sea of Marmara and the Mozambique Channel, which are
// sea). Sound, not complete: a leg inside one of these is definitely
// overland, which is exactly what we want to catch.
const LAND: Record<string, [number, number, number, number]> = {
  // [minLon, maxLon, minLat, maxLat]
  southernAfrica: [20, 30, -25, -15], // Botswana / Zimbabwe / Zambia
  congoBasin: [15, 28, -5, 5],
  anatolia: [31, 40, 38, 40], // central Turkey — the straits sit outside
  rubAlKhali: [45, 52, 19, 23], // Empty Quarter (Gulf + Red Sea excluded)
  deccan: [75, 82, 15, 23], // peninsular India
  madagascar: [45, 48, -22, -16],
};

const crossesLand = (a: [number, number], b: [number, number]) => {
  const hits = new Set<string>();
  for (let i = 1; i < 40; i++) {
    const t = i / 40;
    const lon = a[0] + (b[0] - a[0]) * t;
    const lat = a[1] + (b[1] - a[1]) * t;
    for (const [name, [x0, x1, y0, y1]] of Object.entries(LAND))
      if (lon >= x0 && lon <= x1 && lat >= y0 && lat <= y1) hits.add(name);
  }
  return [...hits];
};

const legsOf = (nodes: string[]): [string, string][] =>
  nodes.slice(0, -1).map((n, i) => [n, nodes[i + 1]]);

describe("sea lanes — IMMUTABLE: no route leg crosses a continent", () => {
  const routes: [string, string, string[]][] = [
    ["Cape reroute to India", "CAPE", ["ARABIAN_SEA"]],
    ["Russia → India (normal, via Suez)", "NOVOROSSIYSK", ["SIKKA"]],
    ["Gulf → India", "RAS_TANURA", ["SIKKA"]],
    ["Gulf → east coast", "RAS_TANURA", ["CHENNAI"]],
    ["Nigeria → India", "BONNY", ["SIKKA"]],
  ];

  for (const [label, from, [to]] of routes) {
    it(`${label} stays at sea`, () => {
      const r = seaRoute(from, to)!;
      expect(r).not.toBeNull();
      for (const [u, v] of legsOf(r.nodes)) {
        const hits = crossesLand(NODES[u], NODES[v]);
        expect(hits, `${u}→${v} crosses ${hits.join(",")}`).toEqual([]);
      }
    });
  }

  it("Russia → India with Suez blocked rounds Africa, never through it", () => {
    const alt = seaRoute("NOVOROSSIYSK", "SIKKA", new Set(["suez"] as const))!;
    expect(alt.nodes).toContain("CAPE");
    expect(alt.nodes).toContain("AGULHAS"); // south of South Africa
    expect(alt.nodes).toContain("MADAGASCAR_E"); // east of Madagascar
    for (const [u, v] of legsOf(alt.nodes))
      expect(crossesLand(NODES[u], NODES[v])).toEqual([]);
  });

  it("Black Sea exits through the Turkish straits, not across Anatolia", () => {
    const r = seaRoute("NOVOROSSIYSK", "SIKKA")!;
    expect(r.nodes).toContain("BOSPHORUS");
    expect(r.nodes).toContain("DARDANELLES");
  });

  it("a closure cannot be teleported across: the entry waypoint is geographic", () => {
    const inGulfOfSuez: [number, number] = [33.1, 29.3]; // south of the canal
    const normal = routeFromPosition(inGulfOfSuez, "SIKKA")!;
    expect(normal.nodes).toContain("SUEZ"); // it sails down the Red Sea

    // Red Sea shut at BOTH ends: this ship is trapped, not free to re-enter
    // the network north of the closed canal and sail around Africa
    const alt = routeFromPosition(
      inGulfOfSuez,
      "SIKKA",
      new Set(["suez", "babmandeb"] as const),
    );
    expect(alt).toBeNull();
  });

  it("a ship already past the closure is unaffected by it", () => {
    const arabianSea: [number, number] = [64, 19];
    const alt = routeFromPosition(
      arabianSea,
      "SIKKA",
      new Set(["suez", "babmandeb"] as const),
    )!;
    expect(alt).not.toBeNull();
    expect(alt.nodes).not.toContain("CAPE"); // no pointless detour
  });

  it("vessels far from every lane are not offered as routable", () => {
    expect(isRoutable([65, 18])).toBe(true); // Arabian Sea
    expect(isRoutable([72.5, 19.5])).toBe(true); // off Mumbai
    expect(isRoutable([18.9, 59.3])).toBe(false); // Stockholm, Baltic
    expect(isRoutable([139.7, 35.6])).toBe(false); // Tokyo Bay
    expect(nearestNodeNm([65, 18])).toBeLessThan(1);
  });
});
