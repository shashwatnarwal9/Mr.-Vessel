import { describe, expect, it } from "vitest";
import { cleanProse } from "./ministerProse";

const PROSE = "We should re-source from suppliers with spare capacity.";

describe("cleanProse — lever machinery never reaches the user", () => {
  it("strips a fenced levers block", () => {
    const out = cleanProse(
      `${PROSE}\n\n\`\`\`levers\n{"resource_reallocation": true, "spr_release": 0.6}\n\`\`\``,
    );
    expect(out).toBe(PROSE);
  });

  it("strips an UNFENCED levers marker + json (the shape that leaked)", () => {
    const out = cleanProse(
      `${PROSE}\n\nlevers\n{"resource_reallocation": 1, "opec_negotiation": 1, "deescalation": 1}`,
    );
    expect(out).toBe(PROSE);
    expect(out).not.toMatch(/levers|resource_reallocation|\{/);
  });

  it("strips a bare lever json with no marker at all", () => {
    const out = cleanProse(
      `${PROSE}\n{"spr_release": 0.4, "naval_escort": 0.5}`,
    );
    expect(out).toBe(PROSE);
  });

  it("handles the escalation array form", () => {
    const out = cleanProse(
      `${PROSE}\nlevers: \n{"escalation": [{"channel": "hormuz", "delta": 0.2}]}`,
    );
    expect(out).not.toMatch(/escalation|channel|\{/);
    expect(out).toContain("re-source");
  });

  it("leaves ordinary prose braces alone", () => {
    const keep = "Reserves cover {roughly} ten days of imports.";
    expect(cleanProse(keep)).toBe(keep);
  });

  it("strips markdown headers and bold the models prepend", () => {
    expect(cleanProse(`## Briefing\n**${PROSE}**`)).toBe(`Briefing\n${PROSE}`);
  });

  it("empty input stays empty (no crash)", () => {
    expect(cleanProse("")).toBe("");
  });

  it("drops a leading meta-label preamble", () => {
    expect(cleanProse(`Briefing-room reasoning: ${PROSE}`)).toBe(PROSE);
    expect(cleanProse(`**Reasoning:** ${PROSE}`)).toBe(PROSE);
    // but keeps a colon that is real content
    const real = "One risk: the strait stays shut.";
    expect(cleanProse(real)).toBe(real);
  });
});
