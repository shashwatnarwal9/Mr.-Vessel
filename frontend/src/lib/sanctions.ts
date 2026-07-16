// RA1: vessel sanctions screening against baked OpenSanctions data.
// Match priority imo → mmsi → exact name/alias. Coverage is reported
// honestly: a "clean" verdict only means no match on the keys we hold.

export type SanctionedVessel = {
  imo: string;
  mmsi: string;
  name: string;
  tier: "sanctioned" | "shadow_fleet";
  risk: string;
  datasets: string;
  flag: string;
  url: string;
  aliases: string;
};

export type SanctionsFile = {
  meta: { source: string; url: string; as_of: string; total_vessels_in_source: number; baked: number };
  vessels: SanctionedVessel[];
};

export type ScreenResult =
  | { status: "match"; vessel: SanctionedVessel; matchedOn: "imo" | "mmsi" | "name"; labels: string[]; focFlag: boolean }
  | { status: "clean"; screenedOn: string[] };

// flags of convenience commonly used to obscure ownership
const FOC = new Set(["pa", "lr", "mh", "km", "cm", "bz", "vc", "tg", "gm", "pw", "tz", "cw", "sl", "vu", "ga", "bb", "hn"]);

const DATASET_LABEL: Record<string, string> = {
  us_ofac_sdn: "OFAC SDN (US)",
  us_trade_csl: "US Trade CSL",
  eu_sanctions_map: "EU Sanctions Map",
  eu_journal_sanctions: "EU Official Journal",
  gb_fcdo_sanctions: "UK FCDO",
  ua_war_sanctions: "Ukraine War Sanctions",
  un_1718_vessels: "UN SC 1718 (DPRK)",
  ch_seco_sanctions: "Swiss SECO",
  ca_dfatd_sema_sanctions: "Canada SEMA",
  fr_tresor_gels_avoir: "France Trésor",
  kp_rusi_reports: "RUSI DPRK Reports",
  abuja_mou_detention: "Abuja MoU detention",
  tokyo_mou_detention: "Tokyo MoU detention",
  black_sea_mou_detention: "Black Sea MoU detention",
  paris_mou_banned: "Paris MoU banned",
};

export function listingLabels(v: SanctionedVessel): string[] {
  const out: string[] = [];
  if (v.tier === "shadow_fleet") out.push("Shadow fleet");
  for (const d of v.datasets.split(";").filter(Boolean)) {
    const label = DATASET_LABEL[d];
    if (label && v.tier === "sanctioned") out.push(`Sanctioned — ${label}`);
    else if (label) out.push(label);
  }
  if (out.length === 0) out.push(v.tier === "sanctioned" ? "Sanctioned" : "Watchlisted");
  return [...new Set(out)].slice(0, 4);
}

/** Build lookup indices once per loaded file. */
export function buildIndex(file: SanctionsFile) {
  const byImo = new Map<string, SanctionedVessel>();
  const byMmsi = new Map<string, SanctionedVessel>();
  const byName = new Map<string, SanctionedVessel>();
  // duplicate keys exist across source datasets: keep the more severe
  // record (sanctioned > shadow_fleet), never downgrade
  const put = (m: Map<string, SanctionedVessel>, k: string, v: SanctionedVessel) => {
    const cur = m.get(k);
    if (!cur || (cur.tier !== "sanctioned" && v.tier === "sanctioned")) m.set(k, v);
  };
  for (const v of file.vessels) {
    if (v.imo) put(byImo, v.imo, v);
    if (v.mmsi) put(byMmsi, v.mmsi, v);
    put(byName, v.name.toUpperCase(), v);
    for (const a of v.aliases.split(";").filter(Boolean)) put(byName, a.toUpperCase(), v);
  }
  return { byImo, byMmsi, byName };
}

// browser-side lazy loader (1.2MB file: fetched once, never bundled)
let _idx: ReturnType<typeof buildIndex> | null = null;
let _meta: SanctionsFile["meta"] | null = null;
export async function loadSanctionsIndex() {
  if (!_idx) {
    const file = (await fetch("/sanctions_vessels.json").then((r) =>
      r.json(),
    )) as SanctionsFile;
    _idx = buildIndex(file);
    _meta = file.meta;
  }
  return { idx: _idx, meta: _meta! };
}

export function screenVessel(
  idx: ReturnType<typeof buildIndex>,
  ship: { mmsi?: number | string; name?: string; imo?: string },
): ScreenResult {
  const keys: string[] = [];
  if (ship.imo) {
    keys.push("IMO");
    const hit = idx.byImo.get(String(ship.imo).replace(/^IMO/i, ""));
    if (hit) return result(hit, "imo");
  }
  if (ship.mmsi) {
    keys.push("MMSI");
    const hit = idx.byMmsi.get(String(ship.mmsi));
    if (hit) return result(hit, "mmsi");
  }
  if (ship.name) {
    keys.push("name");
    // strip common prefixes for the name join (MT/MV/SS)
    const norm = ship.name.toUpperCase().replace(/^(MT|MV|SS)\s+/, "");
    const hit = idx.byName.get(ship.name.toUpperCase()) ?? idx.byName.get(norm);
    if (hit) return result(hit, "name");
  }
  return { status: "clean", screenedOn: keys };

  function result(vessel: SanctionedVessel, matchedOn: "imo" | "mmsi" | "name"): ScreenResult {
    return {
      status: "match",
      vessel,
      matchedOn,
      labels: listingLabels(vessel),
      focFlag: FOC.has(vessel.flag),
    };
  }
}
