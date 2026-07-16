// Ship → India-impact aggregation (M12 core): selected ships + effects
// → per-day crude supply shortfall (bbl/day) → time-stepped cascade.
// Only India-INBOUND ships translate to impact (spec). Pure & tested.

import { etaDays, rerouteDelta } from "./reroute";
import { classifyShip, estimateCargoBbl } from "./ships";
import type { SimShip } from "../store";

export const DELIVERY_SPREAD_DAYS = 15; // one delivery feeds ~2 weeks of runs

/** Days of delay an effect causes (Infinity = cargo never arrives). */
export function effectDelayDays(e: SimShip["effect"]): number {
  switch (e.kind) {
    case "sanction":
      return Infinity;
    case "closure":
    case "reroute":
      return rerouteDelta(e.chokepoint ?? "hormuz").addedDays;
    case "delay":
      return Math.max(0, e.delayDays ?? 0);
  }
}

/** Per-day shortfall contributed by one ship (empty if not India-inbound). */
export function shipShortfall(ship: SimShip, days = 90): number[] {
  const out = new Array<number>(days).fill(0);
  const lonlat: [number, number] = [ship.props.lon, ship.props.lat];
  if (classifyShip(ship.props, lonlat) !== "inbound") return out;
  const cargo = estimateCargoBbl(ship.props.type);
  if (cargo <= 0) return out;

  const eta = Math.max(
    0,
    Math.round(etaDays(lonlat, ship.props.speed, ship.props.dest) ?? 3),
  );
  const delay = effectDelayDays(ship.effect);
  if (delay <= 0) return out;

  // the delivery is missing from its expected window for `delay` days
  const rate = cargo / DELIVERY_SPREAD_DAYS;
  const end = Math.min(days, eta + Math.min(delay, days));
  for (let t = eta; t < end; t++) out[t] += rate;
  return out;
}

/** Aggregate a whole simulation into one shortfall trajectory. */
export function aggregateShortfall(ships: SimShip[], days = 90): number[] {
  const total = new Array<number>(days).fill(0);
  for (const s of ships) {
    const one = shipShortfall(s, days);
    for (let t = 0; t < days; t++) total[t] += one[t];
  }
  return total;
}
