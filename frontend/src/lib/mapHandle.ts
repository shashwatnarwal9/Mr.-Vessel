// Live map handle for flyTo from nav-level components. Lives outside
// GlobeMap so importing it never drags maplibre into the landing bundle
// (the import below is type-only and erases at runtime).
import type maplibregl from "maplibre-gl";

export const mapHandle: { current: maplibregl.Map | null } = { current: null };
