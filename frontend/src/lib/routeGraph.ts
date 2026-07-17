// M6d: maritime waypoint network + Dijkstra with blockable chokepoints.
// Small graph of real sea legs — the same geometry family reroute.ts uses,
// now as a navigable graph that returns the PATH (for the red-line map),
// not just a delta. cuOpt (backend, key-gated) verifies the cost over the
// same matrix; this local solver is the offline truth.

import { haversineNm, PORTS } from "./reroute";
import { COEFF } from "./cascade";

export const NODES: Record<string, [number, number]> = {
  // chokepoints / waypoints
  HORMUZ: [56.5, 26.4],
  GULF_OMAN: [59.5, 24.5],
  BAB: [43.4, 12.6],
  SUEZ: [32.55, 30.0],
  MED_EAST: [31.0, 33.5],
  GIB: [-5.6, 35.95],
  MIDATL: [-30.0, -5.0],
  CAPE: [18.47, -34.83],
  ARABIAN_SEA: [65.0, 18.0],
  // rounding the subcontinent: ships never cross the peninsula or Sri Lanka
  CAPE_COMORIN: [77.1, 7.4], // south of Kanyakumari
  DONDRA_HEAD: [80.6, 5.4], // south of Sri Lanka
  SL_EAST: [83.0, 7.0], // east of Sri Lanka, into the Bay of Bengal
  // rounding AFRICA: the Cape reroute sails around the continent, it does
  // not cut through it (a straight Cape→Arabian Sea leg crossed Mozambique)
  AGULHAS: [27.0, -35.5], // south of South Africa
  MOZ_S: [47.0, -28.0], // south of Madagascar
  MADAGASCAR_E: [53.0, -18.0], // east of Madagascar
  SOMALIA_E: [54.0, 0.0], // Indian Ocean, east of the Horn
  ATL_SW: [8.0, -22.0], // Atlantic off Namibia (west-coast leg)
  // the TURKISH STRAITS: Black Sea → Med runs through the Bosphorus and
  // Dardanelles, not overland across Anatolia
  BOSPHORUS: [29.0, 41.0],
  DARDANELLES: [26.2, 40.2],
  AEGEAN_S: [25.0, 34.5], // south of Crete
  // load ports
  RAS_TANURA: [50.16, 26.64],
  BASRA: [48.2, 29.7],
  KUWAIT: [48.15, 29.07],
  JEBEL_DHANNA: [52.6, 24.2],
  KHARG: [50.32, 29.23],
  NOVOROSSIYSK: [37.8, 44.7],
  BONNY: [7.15, 4.42],
  HOUSTON: [-95.0, 29.0],
  MINA_AL_FAHAL: [58.52, 23.63],
  // india ports (from reroute PORTS)
  SIKKA: PORTS.Sikka,
  VADINAR: PORTS.Vadinar,
  MUMBAI: PORTS.Mumbai,
  KOCHI: PORTS.Kochi,
  CHENNAI: PORTS.Chennai,
};

// undirected sea legs (each side of every chokepoint is explicit)
const EDGES: [string, string][] = [
  ["RAS_TANURA", "HORMUZ"], ["BASRA", "HORMUZ"], ["KUWAIT", "HORMUZ"],
  ["JEBEL_DHANNA", "HORMUZ"], ["KHARG", "HORMUZ"],
  ["HORMUZ", "GULF_OMAN"], ["MINA_AL_FAHAL", "GULF_OMAN"],
  ["GULF_OMAN", "ARABIAN_SEA"],
  ["ARABIAN_SEA", "SIKKA"], ["ARABIAN_SEA", "VADINAR"],
  ["ARABIAN_SEA", "MUMBAI"], ["ARABIAN_SEA", "KOCHI"],
  // east coast is reached by SEA: around Cape Comorin and Sri Lanka
  ["ARABIAN_SEA", "CAPE_COMORIN"], ["KOCHI", "CAPE_COMORIN"],
  ["CAPE_COMORIN", "DONDRA_HEAD"], ["DONDRA_HEAD", "SL_EAST"],
  ["SL_EAST", "CHENNAI"],
  ["ARABIAN_SEA", "BAB"],
  ["BAB", "SUEZ"],
  ["SUEZ", "MED_EAST"], ["MED_EAST", "GIB"],
  // Black Sea → Med via the straits (never across Anatolia)
  ["NOVOROSSIYSK", "BOSPHORUS"], ["BOSPHORUS", "DARDANELLES"],
  ["DARDANELLES", "AEGEAN_S"], ["AEGEAN_S", "MED_EAST"],
  ["GIB", "MIDATL"], ["MIDATL", "CAPE"], ["MIDATL", "HOUSTON"],
  // around Africa, not through it
  ["CAPE", "AGULHAS"], ["AGULHAS", "MOZ_S"], ["MOZ_S", "MADAGASCAR_E"],
  ["MADAGASCAR_E", "SOMALIA_E"], ["SOMALIA_E", "ARABIAN_SEA"],
  ["CAPE", "ATL_SW"], ["ATL_SW", "BONNY"], ["BONNY", "MIDATL"],
  ["GIB", "HOUSTON"],
];

export type Chokepoint = "hormuz" | "suez" | "babmandeb";
const CHOKE_NODE: Record<Chokepoint, string> = {
  hormuz: "HORMUZ",
  suez: "SUEZ",
  babmandeb: "BAB",
};

export type RouteResult = {
  path: [number, number][];
  nodes: string[];
  nm: number;
};

function adjacency(blocked: Set<Chokepoint>) {
  const dead = new Set([...blocked].map((b) => CHOKE_NODE[b]));
  const adj: Record<string, { to: string; nm: number }[]> = {};
  for (const [a, b] of EDGES) {
    if (dead.has(a) || dead.has(b)) continue;
    const nm = haversineNm(NODES[a], NODES[b]);
    (adj[a] ??= []).push({ to: b, nm });
    (adj[b] ??= []).push({ to: a, nm });
  }
  return adj;
}

export function seaRoute(
  from: string,
  to: string,
  blocked: Set<Chokepoint> = new Set(),
): RouteResult | null {
  const adj = adjacency(blocked);
  const dist: Record<string, number> = { [from]: 0 };
  const prev: Record<string, string> = {};
  const open = new Set(Object.keys(NODES));
  while (open.size) {
    let u: string | null = null;
    for (const n of open) if (dist[n] !== undefined && (u === null || dist[n] < dist[u])) u = n;
    if (u === null) break;
    open.delete(u);
    if (u === to) break;
    for (const { to: v, nm } of adj[u] ?? []) {
      const d = dist[u] + nm;
      if (dist[v] === undefined || d < dist[v]) {
        dist[v] = d;
        prev[v] = u;
      }
    }
  }
  if (dist[to] === undefined) return null; // stranded — no honest sea route
  const nodes: string[] = [to];
  while (nodes[0] !== from) nodes.unshift(prev[nodes[0]]);
  return { nodes, path: nodes.map((n) => NODES[n]), nm: dist[to] };
}

/** Snap an off-graph position (a live ship) onto the network at its nearest
 *  usable waypoint, then sail.
 *
 *  The entry waypoint is chosen on the OPEN network and then reused for the
 *  blocked run. Picking it per-scenario let a vessel "teleport" across the
 *  closure it was supposed to be trapped behind: a tanker sitting in the
 *  Gulf of Suez would lose the SUEZ node, re-enter at MED_EAST on the far
 *  side of the shut canal, and cheerfully sail around Africa. A ship that
 *  cannot reach open water now returns null — stranded, which IS the result. */
export function routeFromPosition(
  lonlat: [number, number],
  to: string,
  blocked: Set<Chokepoint> = new Set(),
): RouteResult | null {
  const nearest = Object.entries(NODES)
    .map(([id, c]) => ({ id, nm: haversineNm(lonlat, c) }))
    .sort((a, b) => a.nm - b.nm)
    .slice(0, 2);

  // where geography says this ship joins the network (blockage-independent)
  let entry: { id: string; nm: number } | null = null;
  let bestOpenNm = Infinity;
  for (const n of nearest) {
    const open = seaRoute(n.id, to);
    if (open && open.nm + n.nm < bestOpenNm) {
      bestOpenNm = open.nm + n.nm;
      entry = n;
    }
  }
  if (!entry) return null;

  const r = seaRoute(entry.id, to, blocked);
  if (!r) return null; // the closure traps it — no honest sea route
  return { nodes: r.nodes, path: [lonlat, ...r.path], nm: r.nm + entry.nm };
}

/** Great-circle distance from a position to the closest waypoint. */
export function nearestNodeNm(lonlat: [number, number]): number {
  return Math.min(
    ...Object.values(NODES).map((c) => haversineNm(lonlat, c)),
  );
}

/** A ship is only routable if it sits near a modelled waypoint: the snap
 *  leg is drawn as a straight line, so a vessel far from every lane (the
 *  Baltic, the Pacific, a river berth) could only be joined to the network
 *  by cutting across land. Those are excluded rather than routed wrongly. */
export const SNAP_LIMIT_NM = 800;
export const isRoutable = (lonlat: [number, number]) =>
  nearestNodeNm(lonlat) <= SNAP_LIMIT_NM;

export const addedDays = (normalNm: number, altNm: number, sogKn: number) =>
  Math.max(0, (altNm - normalNm) / (Math.max(4, sogKn) * 24));

export const freightDeltaUsd = (days: number, cargoBbl: number) =>
  days * COEFF.freight_usd_per_bbl_day.value * cargoBbl;
