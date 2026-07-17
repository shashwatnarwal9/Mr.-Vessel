// War Cabinet orchestration: parse the crisis, stream FM+DM in parallel, then
// the PM on its own model, and score every plan with the engine. The backend
// endpoints are POST + SSE, so we read the stream with fetch/ReadableStream
// (EventSource can't POST a body).

import type { McResult } from "./montecarlo";
import type { SimInput, Disruptions, SigmaMode, Trajectory } from "./simulate";
import type { PolicyLevers } from "./runPlans";

const API = import.meta.env.VITE_API_HTTP ?? "http://localhost:8000";

export type CabinetEvent =
  | { delta: string; role: string }
  | { done: true; role: string; pov: string; levers: PolicyLevers; model: string; source: string; error?: string };

/** POST a JSON body and yield each `data: {...}` SSE event object. */
async function* sse(path: string, body: unknown): AsyncGenerator<CabinetEvent> {
  const res = await fetch(API + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.body) throw new Error("no response body");
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const line = chunk.split("\n").find((l) => l.startsWith("data: "));
      if (line) yield JSON.parse(line.slice(6));
    }
  }
}

// ---- parse -------------------------------------------------------------------
export type Parsed = {
  events: { actor?: string; action: string; channel: string; severity: number; speculative: boolean }[];
  disruptions: Disruptions;
  mode: SigmaMode;
  rationale: string;
  unmapped: string[];
  source: "glm" | "keyword";
};

export async function parseCrisis(prompt: string): Promise<Parsed> {
  const res = await fetch(API + "/scenario/parse", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  });
  return res.json();
}

// ---- minister / PM streams ---------------------------------------------------
export type Advice = { pov: string; levers: PolicyLevers; model: string; source: string; error?: string };
export type MinisterRole = "fm" | "dm";

/** Stream one role; onDelta appends visible prose (hidden once the ``` fence
 *  appears — that's the lever block). Resolves with the final advice. */
async function stream(
  gen: AsyncGenerator<CabinetEvent>,
  onDelta: (text: string) => void,
): Promise<Advice> {
  let hiding = false;
  let visible = "";
  for await (const ev of gen) {
    if ("delta" in ev) {
      visible += ev.delta;
      if (!hiding && visible.includes("```")) hiding = true; // lever block starts
      if (!hiding) onDelta(ev.delta);
    } else if ("done" in ev) {
      return { pov: ev.pov, levers: ev.levers, model: ev.model, source: ev.source, error: ev.error };
    }
  }
  return { pov: "", levers: {}, model: "?", source: "error", error: "stream ended" };
}

export function streamMinister(
  role: MinisterRole,
  crisis: string,
  facts: Record<string, unknown>,
  onDelta: (t: string) => void,
): Promise<Advice> {
  return stream(sse(`/cabinet/minister?role=${role}`, { crisis, baseline_facts: facts }), onDelta);
}

export function streamPM(
  crisis: string,
  facts: Record<string, unknown>,
  fm: Advice,
  dm: Advice,
  onDelta: (t: string) => void,
): Promise<Advice> {
  return stream(
    sse("/cabinet/pm", { crisis, baseline_facts: facts, fm, dm }),
    onDelta,
  );
}

// ---- baseline fact sheet for the ministers -----------------------------------
/** Deterministic final-day extrema (context for the LLM — the user sees MC
 *  ranges, but the internal brief can be point estimates). */
export function buildFacts(
  disruptions: Disruptions,
  baseline: Trajectory,
  ref: Trajectory,
): Record<string, unknown> {
  const last = (a: number[]) => a[a.length - 1];
  const freight =
    (disruptions.hormuz ?? 0) * 20 + (disruptions.redsea ?? 0) * 26; // ~reroute days at full
  return {
    horizon: baseline.day.length,
    disruptions,
    pump_low: (last(baseline.fuel_price) - last(ref.fuel_price)).toFixed(1),
    pump_high: (Math.max(...baseline.fuel_price) - last(ref.fuel_price)).toFixed(1),
    gdp: last(baseline.gdp).toFixed(1),
    run_trough: (Math.min(...baseline.run_rate) * 100).toFixed(0),
    residual: (((1 - Math.min(...baseline.run_rate)) * 5500) | 0) / 1000, // ~kb/d proxy
    freight: freight.toFixed(0),
  };
}

// ---- Monte-Carlo fan (PM-final only) ----------------------------------------
export function mcFan(input: SimInput, runs = 10_000): Promise<McResult> {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL("../workers/mc.ts", import.meta.url), { type: "module" });
    w.onmessage = (e: MessageEvent<McResult>) => {
      resolve(e.data);
      w.terminate();
    };
    w.onerror = (e) => {
      reject(e);
      w.terminate();
    };
    w.postMessage({ input, runs });
  });
}
