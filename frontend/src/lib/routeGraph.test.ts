import { describe, expect, it } from "vitest";
import {
  addedDays,
  freightDeltaUsd,
  routeFromPosition,
  seaRoute,
} from "./routeGraph";

describe("maritime route graph (M6d) — IMMUTABLE", () => {
  it("normal route Ras Tanura → Sikka goes through Hormuz", () => {
    const r = seaRoute("RAS_TANURA", "SIKKA")!;
    expect(r.nodes).toContain("HORMUZ");
    expect(r.nm).toBeGreaterThan(1000);
    expect(r.nm).toBeLessThan(2500);
    expect(r.path.length).toBe(r.nodes.length);
  });

  it("Hormuz blocked: Gulf loaders are honestly stranded (null)", () => {
    expect(seaRoute("RAS_TANURA", "SIKKA", new Set(["hormuz"]))).toBeNull();
  });

  it("Suez blocked: Novorossiysk → Sikka detours via the Cape, longer", () => {
    const normal = seaRoute("NOVOROSSIYSK", "SIKKA")!;
    const alt = seaRoute("NOVOROSSIYSK", "SIKKA", new Set(["suez"]))!;
    expect(normal.nodes).toContain("SUEZ");
    expect(alt.nodes).toContain("CAPE");
    expect(alt.nm).toBeGreaterThan(normal.nm * 1.5);
  });

  it("a mid-ocean ship snaps onto the network", () => {
    const r = routeFromPosition([61, 24], "SIKKA")!; // Gulf of Oman
    expect(r.nm).toBeGreaterThan(0);
    expect(r.path[0]).toEqual([61, 24]);
  });

  it("added days + freight delta are computed, not hardcoded", () => {
    const d = addedDays(4600, 12800, 12);
    expect(d).toBeCloseTo((12800 - 4600) / (12 * 24), 5);
    expect(freightDeltaUsd(d, 2_000_000)).toBeGreaterThan(1_000_000); // VLCC-scale
  });
});
