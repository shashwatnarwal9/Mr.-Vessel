// RA3: per-supplier delivery risk + probabilistic expected shortfall.
// P_supplier(k) = 1 − (1−σ_k) · Π_c (1 − D[k][c] · P_c)
// E[shortfall]  = Σ_k import_share_k · imports · P_supplier(k)
// Corridor P_c comes from the computed-risk snapshot (risk.ts). All
// inputs cited/reasoned in supplier_dependency.json + corridors.json.

import { COEFF } from "./cascade";

export type Supplier = {
  id: string;
  name: string;
  coords: [number, number];
  import_share: number;
  sigma_k: number;
  d: Record<string, number>;
  // v7 coupled engine (cited in supplier_dependency.json)
  reroutable: number; // share of interdicted flow that can detour
  spare_capacity_bbl_d: number; // re-sourcing headroom
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
