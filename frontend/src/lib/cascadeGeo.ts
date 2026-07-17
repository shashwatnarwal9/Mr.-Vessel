// Cascade walkthrough geography: turn a KG stage (layer + node names) into
// map coordinates so stepping the Supplier → … → Sector carousel can
// highlight and frame the real places. Presentation only — every coord
// comes from data that already exists (reroute PORTS, corridors.json,
// supplier_dependency.json, power REFINERIES).
import { PORTS } from "./reroute";
import { REFINERIES } from "./power";

export type FocusPoint = { name: string; lonlat: [number, number] };

// KG chokepoint node name → corridors.json id
const CHOKE_ID: Record<string, string> = {
  Hormuz: "hormuz",
  Suez: "suez",
  "Red Sea": "babmandeb",
};

// Qatar feeds Hormuz in the KG but has no import-mix entry (India buys LNG,
// not crude, from it) — Ras Laffan terminal.
const SUPPLIER_EXTRA: Record<string, [number, number]> = {
  Qatar: [51.6, 25.9],
};

let CORRIDORS: Record<string, [number, number]> | null = null;
let SUPPLIERS: Record<string, [number, number]> | null = null;

async function corridorCentroids(): Promise<Record<string, [number, number]>> {
  if (CORRIDORS) return CORRIDORS;
  const f = await fetch("/corridors.json").then((r) => r.json());
  CORRIDORS = Object.fromEntries(
    (f.corridors as { id: string; centroid: [number, number] }[]).map((c) => [
      c.id,
      c.centroid,
    ]),
  );
  return CORRIDORS;
}

async function supplierCoords(): Promise<Record<string, [number, number]>> {
  if (SUPPLIERS) return SUPPLIERS;
  const d = await fetch("/supplier_dependency.json").then((r) => r.json());
  // "Saudi Arabia (Ras Tanura)" → "Saudi Arabia" (the KG's node name)
  SUPPLIERS = Object.fromEntries(
    (d.suppliers as { name: string; coords: [number, number] }[]).map((s) => [
      s.name.split(" (")[0],
      s.coords,
    ]),
  );
  return SUPPLIERS;
}

/** Resolve one cascade stage to map points. Product/Sector are nationwide —
 *  they return [] and the caller frames India instead. */
export async function cascadePoints(
  layer: string,
  names: string[],
): Promise<FocusPoint[]> {
  const pick = (
    lookup: (n: string) => [number, number] | undefined,
  ): FocusPoint[] =>
    names.flatMap((n) => {
      const c = lookup(n);
      return c ? [{ name: n, lonlat: c }] : [];
    });

  if (layer === "Supplier") {
    const sc = await supplierCoords();
    return pick((n) => sc[n] ?? SUPPLIER_EXTRA[n]);
  }
  if (layer === "Chokepoint") {
    const cc = await corridorCentroids();
    return pick((n) => cc[CHOKE_ID[n]]);
  }
  if (layer === "Port") return pick((n) => PORTS[n]);
  if (layer === "Refinery")
    return pick((n) => REFINERIES.find((r) => r.name === n)?.coords);
  return []; // Product / Sector: no single place — the whole country
}
