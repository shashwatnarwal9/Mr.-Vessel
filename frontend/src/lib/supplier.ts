// RA3: per-supplier delivery risk + probabilistic expected shortfall.
// P_supplier(k) = 1 − (1−σ_k) · Π_c (1 − D[k][c] · P_c)
// E[shortfall]  = Σ_k import_share_k · imports · P_supplier(k)
// Corridor P_c comes from the computed-risk snapshot (risk.ts). All
// inputs cited/reasoned in supplier_dependency.json + corridors.json.

import { loadCorridorRisks } from "./risk";
import { COEFF } from "./cascade";

export type Supplier = {
  id: string;
  name: string;
  coords: [number, number];
  import_share: number;
  sigma_k: number;
  d: Record<string, number>;
};

export type SupplierRisk = {
  supplier: Supplier;
  p: number; // probability of delivery disruption
  viaCorridors: { id: string; exposure: number }[];
};

export function supplierRisk(
  s: Supplier,
  corridorP: Record<string, number>,
): number {
  let survive = 1 - s.sigma_k;
  for (const [cid, share] of Object.entries(s.d)) {
    survive *= 1 - share * (corridorP[cid] ?? 0);
  }
  return 1 - survive;
}

export function expectedShortfallBblPerDay(
  suppliers: Supplier[],
  corridorP: Record<string, number>,
  importsBblPerDay = COEFF.india_imports_bbl_d.value,
): number {
  return suppliers.reduce(
    (sum, s) =>
      sum + s.import_share * importsBblPerDay * supplierRisk(s, corridorP),
    0,
  );
}

// browser loader: joins supplier matrix with the corridor snapshot
let _cache: {
  ranked: SupplierRisk[];
  shortfall: number;
  asOf: string;
} | null = null;

export async function loadSupplierRisks() {
  if (_cache) return _cache;
  const [dep, corridorRisks] = await Promise.all([
    fetch("/supplier_dependency.json").then((r) => r.json()),
    loadCorridorRisks(),
  ]);
  const corridorP = Object.fromEntries(
    corridorRisks.map((r) => [r.corridor.id, r.p]),
  );
  const suppliers = dep.suppliers as Supplier[];
  const ranked = suppliers
    .map((s) => ({
      supplier: s,
      p: supplierRisk(s, corridorP),
      viaCorridors: Object.entries(s.d).map(([id, share]) => ({
        id,
        exposure: share * (corridorP[id] ?? 0),
      })),
    }))
    .sort((a, b) => b.p * b.supplier.import_share - a.p * a.supplier.import_share);
  _cache = {
    ranked,
    shortfall: expectedShortfallBblPerDay(suppliers, corridorP),
    asOf: dep.meta.as_of as string,
  };
  return _cache;
}
