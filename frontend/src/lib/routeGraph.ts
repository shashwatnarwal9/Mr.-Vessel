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
  ["NOVOROSSIYSK", "MED_EAST"],
  ["GIB", "MIDATL"], ["MIDATL", "CAPE"], ["MIDATL", "HOUSTON"],
  ["CAPE", "ARABIAN_SEA"], ["CAPE", "BONNY"], ["BONNY", "MIDATL"],
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

/** Snap an off-graph position (a live ship) onto the network via a
 *  temporary node joined to its two nearest waypoints. */
export function routeFromPosition(
  lonlat: [number, number],
  to: string,
  blocked: Set<Chokepoint> = new Set(),
): RouteResult | null {
  const nearest = Object.entries(NODES)
    .map(([id, c]) => ({ id, nm: haversineNm(lonlat, c) }))
    .sort((a, b) => a.nm - b.nm)
    .slice(0, 2);
  let best: RouteResult | null = null;
  for (const n of nearest) {
    const r = seaRoute(n.id, to, blocked);
    if (!r) continue;
    const total = r.nm + n.nm;
    if (!best || total < best.nm) {
      best = { nodes: [n.id, ...r.nodes.slice(1)], path: [lonlat, ...r.path], nm: total };
    }
  }
  return best;
}

export const addedDays = (normalNm: number, altNm: number, sogKn: number) =>
  Math.max(0, (altNm - normalNm) / (Math.max(4, sogKn) * 24));

export const freightDeltaUsd = (days: number, cargoBbl: number) =>
  days * COEFF.freight_usd_per_bbl_day.value * cargoBbl;
