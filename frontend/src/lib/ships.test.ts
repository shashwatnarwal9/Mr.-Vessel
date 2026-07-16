import { describe, expect, it } from "vitest";
import { classifyShip, estimateCargoBbl, isIndianDest, nearestIndianPort } from "./ships";

describe("ship → India classification", () => {
  it("Indian destination → inbound, wherever it is", () => {
    expect(classifyShip({ dest: "Jamnagar", course: 270 }, [56.5, 26.5])).toBe("inbound");
    expect(classifyShip({ dest: "IN JNPT", course: 0 }, [43.4, 12.6])).toBe("inbound");
  });

  it("non-Indian destination near India → outbound", () => {
    expect(classifyShip({ dest: "Ras Tanura", course: 300 }, [72.6, 18.9])).toBe("outbound");
  });

  it("no destination, heading toward India → inbound (bearing test)", () => {
    // in the Gulf of Oman, steering ~ESE toward the Indian coast
    expect(classifyShip({ dest: "—", course: 100 }, [61, 24])).toBe("inbound");
  });

  it("far away, heading elsewhere → transit", () => {
    // Red Sea northbound toward Suez
    expect(classifyShip({ dest: "Rotterdam", course: 330 }, [38.5, 20.5])).toBe("transit");
  });

  it("cargo estimates follow class then AIS type", () => {
    expect(estimateCargoBbl("VLCC Crude Carrier")).toBe(2_000_000);
    expect(estimateCargoBbl("Suezmax Tanker")).toBe(1_000_000);
    expect(estimateCargoBbl("Aframax")).toBe(700_000);
    expect(estimateCargoBbl("Crude Oil Tanker")).toBe(1_000_000);
    expect(estimateCargoBbl("Product Tanker")).toBe(500_000);
    expect(estimateCargoBbl("LNG Carrier")).toBe(0);
    expect(estimateCargoBbl("Container Ship")).toBe(0);
    expect(estimateCargoBbl("Tanker")).toBe(1_000_000);
  });

  it("helpers: dest matching and nearest port", () => {
    expect(isIndianDest("sikka")).toBe(true);
    expect(isIndianDest("Suez")).toBe(false);
    expect(nearestIndianPort([70.0, 22.0])).toBe("Vadinar");
  });
});
