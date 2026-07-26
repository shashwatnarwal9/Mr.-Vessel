import { describe, expect, it } from "vitest";
import { isCabinetQuestion } from "./cabinetRelevance";

describe("cabinet relevance gate", () => {
  it("rejects the prompts that produced a confident Hormuz policy for nothing", () => {
    for (const t of [
      "i am hungry", // the reported case
      "hello",
      "tell me a joke",
      "what's the weather like",
      "asdfgh",
      "",
      "   ",
    ]) {
      expect(isCabinetQuestion(t), t).toBe(false);
    }
  });

  it("admits real cabinet questions, including terse follow-ups", () => {
    for (const t of [
      "what if Hormuz closes fully?",
      "should we escort tankers through the Red Sea?",
      "release the SPR",
      "negotiate with OPEC+",
      "how bad is the GDP hit",
      "can we reroute via the Cape?",
      "what's the plan?", // no chokepoint word — must still pass
      "is escalation worth it",
      "which supplier do we lean on",
      "petrol price impact",
      "recommend an alternative",
    ]) {
      expect(isCabinetQuestion(t), t).toBe(true);
    }
  });

  it("is case- and punctuation-insensitive", () => {
    expect(isCabinetQuestion("HORMUZ?!")).toBe(true);
    expect(isCabinetQuestion("Should We Escalate.")).toBe(true);
  });

  // The gate is deliberately biased to ALLOW: blocking a real question is worse
  // than letting a borderline one reach ministers who can handle it.
  it("lets a borderline prompt through rather than bouncing it", () => {
    expect(isCabinetQuestion("what are our options")).toBe(true);
    expect(isCabinetQuestion("any risk to the economy")).toBe(true);
  });
});
