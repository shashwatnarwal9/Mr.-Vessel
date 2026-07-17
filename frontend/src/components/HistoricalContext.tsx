import { useEffect, useState } from "react";
import type { Disruptions, Trajectory } from "../lib/simulate";
import {
  rangePlacement,
  scenarioSignature,
  templateNarrative,
  topAnalogs,
  type Analog,
  type Episode,
} from "../lib/history";
import { BASE } from "../lib/cascade";
import Why from "./Why";

const API = import.meta.env.VITE_API_HTTP ?? "http://localhost:8000";

let CORPUS: Episode[] | null = null;
async function loadCorpus(): Promise<Episode[]> {
  if (CORPUS) return CORPUS;
  CORPUS = (await fetch("/history_corpus.json").then((r) => r.json())) as Episode[];
  return CORPUS;
}

const PLACE_STYLE = {
  inside: "bg-good/20 text-good-text",
  above: "bg-elevated/20 text-elevated",
  below: "bg-bright text-ink-2",
} as const;
const PLACE_LABEL = {
  inside: "inside the historical band",
  above: "above history — severe case",
  below: "below history — upside risk",
} as const;

function describe(d: Disruptions): string {
  const parts = [];
  if (d.hormuz) parts.push(`${Math.round(d.hormuz * 100)}% of the Strait of Hormuz blocked`);
  if (d.redsea) parts.push(`${Math.round(d.redsea * 100)}% of Red Sea traffic suspended`);
  if (d.opec) parts.push(`an OPEC+ cut of ${(d.opec * 4).toFixed(1)} Mb/d`);
  return parts.join(" plus ") || "no disruption";
}

export default function HistoricalContext({
  disruptions,
  traj,
}: {
  disruptions: Disruptions;
  traj: Trajectory;
}) {
  const [analogs, setAnalogs] = useState<Analog[]>([]);
  const [narrative, setNarrative] = useState<string | null>(null);
  const [narrSource, setNarrSource] = useState<"template" | "GLM-5.2">("template");

  const crudePct =
    ((traj.crude[89] - BASE.brentUsd) / BASE.brentUsd) * 100;

  useEffect(() => {
    let alive = true;
    setNarrative(null);
    setNarrSource("template");
    (async () => {
      const corpus = await loadCorpus();
      const sig = scenarioSignature(disruptions, traj.crude[89]);
      let top = topAnalogs(sig, corpus);
      if (!alive || top.length === 0) {
        if (alive) setAnalogs([]);
        return;
      }
      setAnalogs(top);
      setNarrative(templateNarrative(top, crudePct));

      // enrichment 1: semantic blend (backend + key; best-effort)
      try {
        const r = await fetch(
          `${API}/rag/analogs?desc=${encodeURIComponent(describe(disruptions))}`,
        ).then((x) => x.json());
        if (alive && Object.keys(r.scores ?? {}).length > 0) {
          top = topAnalogs(sig, corpus, 3, r.scores);
          setAnalogs(top);
          setNarrative(templateNarrative(top, crudePct));
        }
      } catch {
        /* numeric-only is fine */
      }

      // enrichment 2: grounded GLM narration (slow — upgrades in place)
      try {
        const r = await fetch(`${API}/rag/narrate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: {
              crude_move_pct: Math.round(crudePct * 10) / 10,
              pump_delta_inr: Math.round((traj.fuel_price[89] - BASE.pumpInrPerL) * 10) / 10,
            },
            episodes: top.map((a) => a.episode),
          }),
        }).then((x) => x.json());
        if (alive && r.text) {
          setNarrative(r.text);
          setNarrSource("GLM-5.2");
        }
      } catch {
        /* template stays — still grounded, still cited */
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disruptions, traj]);

  if (analogs.length === 0) return null;
  const place = rangePlacement(crudePct, analogs);

  return (
    <div className="flex flex-1 flex-col rounded-lg border border-hairline bg-panel p-4">
      <header className="mb-4 flex items-center justify-between gap-1">
        <div className="flex items-center gap-1">
          <span className="material-symbols-outlined text-[18px] text-ink-3">
            history
          </span>
          <h2 className="label-caps text-ink-3">
            HISTORICAL ANALOGS
            <Why
              tag="derived"
              formula="top-3 cosine match over normalized [hormuz, redsea, supply-cut, Δcrude, duration] signatures vs 28 real episodes (+ bge-m3 semantic blend when the backend is live); narration uses ONLY retrieved facts — any unsourced number discards it"
              sources={[]}
            />
          </h2>
        </div>
        <span className={`label-caps rounded px-2 py-0.5 text-[9px] ${PLACE_STYLE[place]}`}>
          {PLACE_LABEL[place]}
        </span>
      </header>
      <p className="body-md leading-relaxed text-ink-2">{narrative}</p>
      <p className="micro-mono mt-1 text-ink-3">
        narrative: {narrSource} · every claim traces to a source below
      </p>
      <ul className="mt-2 flex flex-1 flex-col gap-2">
        {analogs.map(({ episode, score }) => (
          <li
            key={episode.id}
            className="rounded border border-hairline bg-navy-deep p-2"
          >
            <div className="mb-1 flex items-center justify-between">
              <a
                href={episode.source.url}
                target="_blank"
                rel="noopener noreferrer"
                className="body-md text-ink underline decoration-secondary/40 hover:text-gold-hover"
              >
                {episode.name} ({episode.year})
              </a>
              <span
                className={`micro-mono tabular-nums ${
                  episode.crude_move_pct >= 25
                    ? "text-critical"
                    : episode.crude_move_pct > 0
                      ? "text-elevated"
                      : "text-good-text"
                }`}
              >
                crude {episode.crude_move_pct > 0 ? "+" : ""}
                {episode.crude_move_pct}%
              </span>
            </div>
            <p className="micro-mono text-ink-3">
              {episode.outcome} ({(score * 100).toFixed(0)}% match ·{" "}
              {episode.source.name})
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
