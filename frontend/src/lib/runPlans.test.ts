// Lever→outcome sanity: mitigation must lower petrol vs baseline, escalation
// must raise it. Run: npx vitest run src/lib/runPlans.test.ts
import { expect, test } from "vitest";
import { runPlans } from "./runPlans";
import { simulate, type Disruptions } from "./simulate";

const last = (a: number[]) => a[a.length - 1];

test("mitigation lowers petrol, escalation raises it", () => {
  const base: Disruptions = { hormuz: 0.6, redsea: 0.4, opec: 0.5 };
  const [baseline, mitigated, escalated] = runPlans(
    base,
    "sustained",
    [
      { name: "baseline", color: "", levers: {} },
      { name: "mitigated", color: "", levers: { opec_negotiation: 1, deescalation: 1, naval_escort: 1 } },
      { name: "escalated", color: "", levers: { escalation: [{ channel: "hormuz", delta: 0.4 }] } },
    ],
    [], // no supplier data → legacy σ-share path (levers still act via σ/mode)
    {},
  );
  const bp = last(baseline.traj.fuel_price);
  const mp = last(mitigated.traj.fuel_price);
  const ep = last(escalated.traj.fuel_price);
  expect(mp).toBeLessThan(bp); // mitigation helps
  expect(ep).toBeGreaterThan(bp); // escalation hurts
});

test("full diplomatic mitigation reduces but does NOT zero a physical shock", () => {
  // regression: de-escalation once flipped the scenario to decay, collapsing
  // the day-90 petrol impact to ~₹0 and flattening the graphs.
  const base: Disruptions = { hormuz: 1.0, redsea: 0.4, opec: 0.75 };
  const refPump = last(
    runPlans(base, "sustained", [{ name: "ref", color: "", levers: {} }], [], {})[0]
      .traj.fuel_price,
  );
  const [maxed] = runPlans(
    base, "sustained",
    [{ name: "maxed", color: "", levers: { opec_negotiation: 1, deescalation: 1, naval_escort: 1, spr_release: 1 } }],
    [], {},
  );
  const delta = last(maxed.traj.fuel_price) - last(simulate({ disruptions: {} }).fuel_price);
  expect(delta).toBeLessThan(refPump - last(simulate({ disruptions: {} }).fuel_price)); // helps
  expect(delta).toBeGreaterThan(10); // but a mined strait still hurts — not ~₹0
});
