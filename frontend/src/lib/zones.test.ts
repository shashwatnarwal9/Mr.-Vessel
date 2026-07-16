import { expect, it } from "vitest";
import { HORMUZ_ZONE, inZone } from "./zones";

it("classifies Hormuz zone membership", () => {
  expect(inZone(56.5, 26.5, HORMUZ_ZONE)).toBe(true); // mid-strait
  expect(inZone(72.6, 18.9, HORMUZ_ZONE)).toBe(false); // Mumbai anchorage
  expect(inZone(55.5, 25.5, HORMUZ_ZONE)).toBe(true); // inclusive edge
});
