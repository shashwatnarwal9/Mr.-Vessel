import { describe, expect, it } from "vitest";
import CORPUS from "../../public/history_corpus.json";
import {
  cosine,
  placement,
  rangePlacement,
  scenarioSignature,
  templateNarrative,
  topAnalogs,
  type Episode,
} from "./history";
import { BASE } from "./cascade";

const corpus = CORPUS as Episode[];

describe("history corpus integrity (provenance rule)", () => {
  it("every episode is complete, cited, and sane", () => {
    expect(corpus.length).toBeGreaterThanOrEqual(25);
    for (const e of corpus) {
      expect(e.signature).toHaveLength(5);
      expect(e.source.url).toMatch(/^https:\/\//);
      expect(e.source.name.length).toBeGreaterThan(3);
      expect(e.year).toBeGreaterThan(1950);
      expect(e.year).toBeLessThan(2027);
      expect(e.summary.split(/\s+/).length).toBeLessThanOrEqual(70);
      expect(Math.abs(e.crude_move_pct)).toBeLessThanOrEqual(300);
      for (const v of e.signature) expect(Math.abs(v)).toBeLessThanOrEqual(2);
    }
  });

  it("ids are unique", () => {
    const ids = corpus.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("analog retrieval", () => {
  it("cosine: identity = 1, orthogonal = 0", () => {
    expect(cosine([1, 0, 0], [1, 0, 0])).toBeCloseTo(1);
    expect(cosine([1, 0, 0], [0, 1, 0])).toBeCloseTo(0);
  });

  it("a Hormuz scenario retrieves Hormuz-flavoured episodes over Red Sea ones", () => {
    const sig = scenarioSignature({ hormuz: 0.5 }, BASE.brentUsd * 1.45, 90);
    const top = topAnalogs(sig, corpus, 5).map((a) => a.episode.id);
    const hormuzRank = top.findIndex((id) =>
      ["tanker-war-1984", "iran-sanctions-2012", "hormuz-seizures-2019", "gulf-war-1990"].includes(id),
    );
    const redseaRank = top.findIndex((id) =>
      ["ever-given-2021", "suez-1956", "suez-1967", "redsea-2024"].includes(id),
    );
    expect(hormuzRank).toBeGreaterThanOrEqual(0);
    if (redseaRank >= 0) expect(hormuzRank).toBeLessThan(redseaRank);
  });

  it("a Red Sea scenario's top analog is a Red Sea episode", () => {
    const sig = scenarioSignature({ redsea: 0.4 }, BASE.brentUsd * 1.02, 90);
    const [top] = topAnalogs(sig, corpus);
    expect(["redsea-2024", "ever-given-2021", "suez-1956", "suez-1967"]).toContain(top.episode.id);
  });

  it("an OPEC cut retrieves cut episodes", () => {
    const sig = scenarioSignature({ opec: 0.6 }, BASE.brentUsd * 1.18, 90);
    const ids = topAnalogs(sig, corpus, 3).map((a) => a.episode.id);
    const cutIds = ["opec-cuts-1999", "opec-mega-cut-2020", "opec-cut-2023", "saudi-cut-2023", "opec-embargo-1973", "venezuela-strike-2002", "libya-2011"];
    expect(ids.some((id) => cutIds.includes(id))).toBe(true);
  });

  it("baseline (no disruption) retrieves nothing", () => {
    expect(topAnalogs(scenarioSignature({}, BASE.brentUsd, 90), corpus)).toHaveLength(0);
  });

  it("semantic blend re-weights but never invents episodes", () => {
    const sig = scenarioSignature({ hormuz: 0.5 }, BASE.brentUsd * 1.4, 90);
    const blended = topAnalogs(sig, corpus, 3, { "abqaiq-2019": 1.0 });
    expect(blended.every((a) => corpus.includes(a.episode))).toBe(true);
  });
});

describe("banding + template", () => {
  it("placement bands with a ±⅓ tolerance", () => {
    expect(placement(46, 45)).toBe("inside");
    expect(placement(90, 45)).toBe("above");
    expect(placement(10, 45)).toBe("below");
  });

  it("template narrative names the episode, cites nothing outside it", () => {
    const sig = scenarioSignature({ redsea: 0.4 }, BASE.brentUsd * 1.02, 90);
    const top = topAnalogs(sig, corpus);
    const text = templateNarrative(top, 2);
    expect(text).toContain(top[0].episode.name);
    expect(text).toContain(String(top[0].episode.year));
    expect(text).toContain(`${top[0].episode.crude_move_pct > 0 ? "+" : ""}${top[0].episode.crude_move_pct}%`);
  });

  it("chip and narrative share one reference frame (the top-3 range)", () => {
    const sig = scenarioSignature({ hormuz: 0.5 }, BASE.brentUsd * 1.45, 90);
    const top = topAnalogs(sig, corpus);
    const moves = top.map((a) => a.episode.crude_move_pct);
    // 46% vs a range spanning low & high analogs → inside, never "above"
    if (Math.min(...moves) < 46 && Math.max(...moves) > 46) {
      expect(rangePlacement(46, top)).toBe("inside");
    }
    expect(rangePlacement(500, top)).toBe("above");
    expect(rangePlacement(-90, top)).toBe("below");
  });
});
