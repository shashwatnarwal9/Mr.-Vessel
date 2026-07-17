// Lever→outcome sanity: mitigation must lower petrol vs baseline, escalation
// must raise it. Run: npx vitest run src/lib/runPlans.test.ts
import { expect, test } from "vitest";
import { runPlans } from "./runPlans";
import type { Disruptions } from "./simulate";

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
