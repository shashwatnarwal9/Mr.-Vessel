import { describe, expect, it } from "vitest";
import FILE from "../../public/sanctions_vessels.json";
import {
  buildIndex,
  listingLabels,
  screenVessel,
  type SanctionsFile,
} from "./sanctions";

const file = FILE as SanctionsFile;
const idx = buildIndex(file);

describe("sanctions data (RA1, real OpenSanctions bake)", () => {
  it("carries meta + both tiers, all entries sourced", () => {
    expect(file.meta.as_of).toBe("2026-07-15");
    expect(file.vessels.length).toBeGreaterThan(4000);
    const tiers = new Set(file.vessels.map((v) => v.tier));
    expect(tiers).toEqual(new Set(["sanctioned", "shadow_fleet"]));
    for (const v of file.vessels.slice(0, 200)) {
      expect(v.url).toMatch(/^https:\/\/www\.opensanctions\.org\//);
    }
  });
});

describe("screening (imo → mmsi → name)", () => {
  const withImo = file.vessels.find((v) => v.imo && v.tier === "sanctioned")!;
  const withMmsi = file.vessels.find((v) => v.mmsi)!;

  it("matches by IMO first", () => {
    const r = screenVessel(idx, { imo: withImo.imo, name: "WRONG NAME" });
    expect(r.status).toBe("match");
    if (r.status === "match") {
      expect(r.matchedOn).toBe("imo");
      expect(r.vessel.imo).toBe(withImo.imo);
      expect(r.labels.length).toBeGreaterThan(0);
    }
  });

  it("falls back to MMSI, then name (with MT/MV prefix stripping)", () => {
    const r = screenVessel(idx, { mmsi: withMmsi.mmsi });
    expect(r.status).toBe("match");
    const named = screenVessel(idx, { name: `MT ${withImo.name}` });
    expect(named.status).toBe("match");
  });

  it("unmatched vessels come back clean, listing what was screened", () => {
    const r = screenVessel(idx, { mmsi: 419000101, name: "MT DESH GLORY" });
    expect(r.status).toBe("clean");
    if (r.status === "clean") {
      expect(r.screenedOn).toEqual(["MMSI", "name"]);
    }
  });

  it("shadow fleet tier labels correctly", () => {
    const shadow = file.vessels.find((v) => v.tier === "shadow_fleet")!;
    expect(listingLabels(shadow)).toContain("Shadow fleet");
  });

  it("FoC flags marked; severity dedupe never downgrades (fixture)", () => {
    const fixture = {
      meta: file.meta,
      vessels: [
        { imo: "1111111", mmsi: "", name: "GHOST", tier: "shadow_fleet", risk: "mare.shadow", datasets: "kp_rusi_reports", flag: "pa", url: "https://www.opensanctions.org/x", aliases: "" },
        { imo: "1111111", mmsi: "", name: "GHOST", tier: "sanctioned", risk: "sanction", datasets: "us_ofac_sdn", flag: "pa", url: "https://www.opensanctions.org/x", aliases: "" },
      ],
    } as SanctionsFile;
    const fidx = buildIndex(fixture);
    const r = screenVessel(fidx, { imo: "1111111" });
    expect(r.status).toBe("match");
    if (r.status === "match") {
      expect(r.focFlag).toBe(true); // Panama = flag of convenience
      expect(r.vessel.tier).toBe("sanctioned"); // severity wins the dedupe
      expect(r.labels).toContain("Sanctioned — OFAC SDN (US)");
    }
  });
});
