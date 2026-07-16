// Haversine + waypoint tables → reroute economics. Pure; cuOpt (backend,
// Red Sea branch, key-gated) can override added_days via the same shape.

export const PORTS: Record<string, [number, number]> = {
  "Ras Tanura": [50.16, 26.64],
  Fujairah: [56.35, 25.12],
  Suez: [32.55, 29.97],
  Jamnagar: [70.07, 22.47],
  Sikka: [69.83, 22.43],
  Vadinar: [69.7, 22.33],
  Mundra: [69.72, 22.84],
  Mumbai: [72.85, 18.95],
  JNPT: [72.95, 18.95],
  "New Mangalore": [74.8, 12.92],
  Kochi: [76.24, 9.97],
  Chennai: [80.3, 13.1],
  Ennore: [80.32, 13.25],
  Rotterdam: [4.05, 51.95],
  Augusta: [15.22, 37.2],
};

export function haversineNm(a: [number, number], b: [number, number]): number {
  const R_NM = 3440.065;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * R_NM * Math.asin(Math.sqrt(h));
}

const legNm = (pts: [number, number][]) =>
  pts.slice(1).reduce((s, p, i) => s + haversineNm(pts[i], p), 0);

const CAPE: [number, number] = [18.47, -34.83];
const MID_ATLANTIC: [number, number] = [-30, -5];
const GIBRALTAR: [number, number] = [-5.6, 35.95];
const HOUSTON: [number, number] = [-95.0, 29.0];
const NOVOROSSIYSK: [number, number] = [37.8, 44.7];
const BAB_EL_MANDEB: [number, number] = [43.4, 12.6];

// full-closure alternatives, transit at 13.5 kn
const SPEED_NM_PER_DAY = 13.5 * 24;

export const ROUTES = {
  // Hormuz closed: Gulf barrels unreachable → replacement barrels from
  // US Gulf via Cape of Good Hope
  hormuz: {
    normal: [PORTS["Ras Tanura"], [56.5, 26.5], PORTS.Sikka] as [number, number][],
    alt: [HOUSTON, MID_ATLANTIC, CAPE, PORTS.Sikka] as [number, number][],
  },
  // Red Sea / Suez closed: Urals to India round the Cape instead. The canal
  // and the corridor sever the same route — identical detour economics.
  redsea: {
    normal: [NOVOROSSIYSK, PORTS.Suez, BAB_EL_MANDEB, PORTS.Sikka] as [number, number][],
    alt: [NOVOROSSIYSK, GIBRALTAR, MID_ATLANTIC, CAPE, PORTS.Sikka] as [number, number][],
  },
  suez: {
    normal: [NOVOROSSIYSK, PORTS.Suez, BAB_EL_MANDEB, PORTS.Sikka] as [number, number][],
    alt: [NOVOROSSIYSK, GIBRALTAR, MID_ATLANTIC, CAPE, PORTS.Sikka] as [number, number][],
  },
};

export type RerouteDelta = { addedDays: number; freightMultiplier: number };

const FREIGHT_PER_ADDED_DAY = 0.04; // charter time + war-risk premium

export function rerouteDelta(chokepoint: keyof typeof ROUTES): RerouteDelta {
  const r = ROUTES[chokepoint];
  const addedDays = Math.max(0, (legNm(r.alt) - legNm(r.normal)) / SPEED_NM_PER_DAY);
  return { addedDays, freightMultiplier: 1 + FREIGHT_PER_ADDED_DAY * addedDays };
}

/** Base ETA in days from a position to a named port; null if port unknown. */
export function etaDays(
  lonlat: [number, number],
  speedKn: number,
  dest: string,
): number | null {
  const port = PORTS[dest];
  if (!port || speedKn <= 0) return null;
  return haversineNm(lonlat, port) / (speedKn * 24);
}
