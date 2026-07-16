// Disruption zones as lon/lat bboxes. Kept as data so M12 (live news → π)
// and M15 (reroute) reuse them.

export type Bbox = { minLon: number; maxLon: number; minLat: number; maxLat: number };

export const HORMUZ_ZONE: Bbox = {
  minLon: 55.5,
  maxLon: 58.0,
  minLat: 25.5,
  maxLat: 27.2,
};

export const REDSEA_ZONE: Bbox = {
  minLon: 32.5,
  maxLon: 44.0,
  minLat: 12.0,
  maxLat: 30.0,
};

export const ALERT_PI_THRESHOLD = 0.3;

export function inZone(lon: number, lat: number, z: Bbox): boolean {
  return lon >= z.minLon && lon <= z.maxLon && lat >= z.minLat && lat <= z.maxLat;
}
