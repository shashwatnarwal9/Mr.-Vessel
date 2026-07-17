import { describe, expect, it } from "vitest";
import { haversineNm } from "./reroute";
import { NODES, seaRoute } from "./routeGraph";

describe("east-coast routing rounds Sri Lanka (never crosses land)", () => {
  it("Kochi → Chennai goes via Cape Comorin and south of Sri Lanka", () => {
    const r = seaRoute("KOCHI", "CHENNAI")!;
    expect(r.nodes).toContain("CAPE_COMORIN");
    expect(r.nodes).toContain("DONDRA_HEAD");
    expect(r.nodes).toContain("SL_EAST");
    // the sea detour is much longer than the overland straight line
    expect(r.nm).toBeGreaterThan(
      haversineNm(NODES.KOCHI, NODES.CHENNAI) * 1.5,
    );
  });

  it("Gulf loader → Chennai transits Hormuz then rounds the island", () => {
    const r = seaRoute("RAS_TANURA", "CHENNAI")!;
    expect(r.nodes).toContain("HORMUZ");
    expect(r.nodes).toContain("DONDRA_HEAD");
  });
});
