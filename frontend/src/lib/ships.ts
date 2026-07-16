// Ship → India-impact model (M8): classification + cargo estimates.
// Pure; used by the ship panel, search, and the Simulation Dashboard.

import { PORTS, haversineNm } from "./reroute";
import type { ShipProps } from "../store";

export const INDIAN_PORTS = [
  "Jamnagar", "Sikka", "Vadinar", "Mundra", "Mumbai", "JNPT",
  "New Mangalore", "Kochi", "Chennai", "Ennore", "Paradip",
] as const;

const INDIA_CENTROID: [number, number] = [77.0, 20.0];
const NEAR_INDIA_NM = 400; // "at/leaving an Indian port" proximity
const BEARING_TOLERANCE_DEG = 50;

export type Classification = "inbound" | "outbound" | "transit";

function bearingDeg(a: [number, number], b: [number, number]): number {
  const dLon = (b[0] - a[0]) * Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180);
  const dLat = b[1] - a[1];
  return ((Math.atan2(dLon, dLat) * 180) / Math.PI + 360) % 360;
}

const angleDiff = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

export function isIndianDest(dest: string): boolean {
  const d = dest.toLowerCase();
  return INDIAN_PORTS.some((p) => d.includes(p.toLowerCase()));
}

export function classifyShip(
  props: Pick<ShipProps, "dest" | "course">,
  lonlat: [number, number],
): Classification {
  if (isIndianDest(props.dest ?? "")) return "inbound";
  const hasDest = !!props.dest && props.dest !== "—";
  if (hasDest) {
    // known non-Indian destination: leaving India = outbound, else transit
    const nearIndia = haversineNm(lonlat, INDIA_CENTROID) < NEAR_INDIA_NM * 2;
    return nearIndia ? "outbound" : "transit";
  }
  // no usable destination: fall back to heading — pointed at India = inbound
  const toIndia = bearingDeg(lonlat, INDIA_CENTROID);
  if (angleDiff(props.course, toIndia) < BEARING_TOLERANCE_DEG) return "inbound";
  return "transit";
}

/** Estimated crude cargo (bbl) by vessel type/class. Non-crude → 0. */
export function estimateCargoBbl(type: string): number {
  const t = type.toLowerCase();
  if (t.includes("vlcc")) return 2_000_000;
  if (t.includes("suezmax")) return 1_000_000;
  if (t.includes("aframax")) return 700_000;
  if (t.includes("crude")) return 1_000_000; // unclassed crude tanker
  if (t.includes("product")) return 500_000;
  if (t.includes("lng") || t.includes("lpg")) return 0; // not crude
  if (t.includes("tanker")) return 1_000_000; // bare AIS "Tanker"
  return 0; // cargo/container/other
}

/** Nearest Indian port (for ETA-style displays). */
export function nearestIndianPort(lonlat: [number, number]): string {
  let best = INDIAN_PORTS[0] as string;
  let bestD = Infinity;
  for (const p of INDIAN_PORTS) {
    const c = PORTS[p];
    if (!c) continue;
    const d = haversineNm(lonlat, c);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}
