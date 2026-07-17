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
import CardDeck, { type DeckCard } from "./CardDeck";
import Why from "./Why";

const API = import.meta.env.VITE_API_HTTP ?? "http://localhost:8000";

let CORPUS: Episode[] | null = null;
async function loadCorpus(): Promise<Episode[]> {
  if (CORPUS) return CORPUS;
  CORPUS = (await fetch("/history_corpus.json").then((r) => r.json())) as Episode[];
  return CORPUS;
}

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
  const [deckOpen, setDeckOpen] = useState(false);

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

  // M-DECK C: verdict → one card per episode → so-what (same data, stepped)
  const moves = analogs.map((a) => a.episode.crude_move_pct);
  const bandLo = Math.min(...moves);
  const bandHi = Math.max(...moves);
  const deckCards: DeckCard[] = [
    {
      id: "verdict",
      body: (
        <>
          <span className="label-caps text-ink-3">1 · THE VERDICT</span>
          <span className="stat-lg tabular-nums text-ink">
            {crudePct > 0 ? "+" : ""}
            {crudePct.toFixed(0)}%{" "}
            <span className="headline-sm text-ink-2">crude move</span>
          </span>
          {narrative && (
            <p className="body-md leading-relaxed text-ink-2">{narrative}</p>
          )}
          <p className="caption mt-auto text-ink-3">
            history's band:{" "}
            <span className="micro-mono">
              {bandLo > 0 ? "+" : ""}
              {bandLo}% to +{bandHi}%
            </span>{" "}
            · this run:{" "}
            <span
              className={
                place === "above" ? "text-elevated" : place === "inside" ? "text-good-text" : "text-ink-2"
              }
            >
              {PLACE_LABEL[place]}
            </span>
            <Why
              tag="derived"
              formula="top-3 cosine match over normalized [hormuz, redsea, supply-cut, Δcrude, duration] signatures vs 28 real episodes; band = min–max crude move of the retrieved analogs; narration uses ONLY retrieved facts — any unsourced number discards it"
              sources={[]}
            />
          </p>
        </>
      ),
    },
    ...analogs.map(({ episode, score }, i) => ({
      id: episode.id,
      body: (
        <>
          <span className="label-caps text-ink-3">
            {i + 2} · {episode.name.toUpperCase()} ({episode.year})
          </span>
          <span className="stat-lg tabular-nums text-ink">
            {episode.crude_move_pct > 0 ? "+" : ""}
            {episode.crude_move_pct}%{" "}
            <span className="headline-sm text-ink-2">crude</span>
          </span>
          <p className="body-md text-ink-2">{episode.outcome}</p>
          <p className="micro-mono text-ink-3">
            {(score * 100).toFixed(0)}% signature match to this run
          </p>
          <a
            href={episode.source.url}
            target="_blank"
            rel="noopener noreferrer"
            className="body-md mt-auto text-secondary underline decoration-secondary/40 hover:text-gold-hover"
          >
            source: {episode.source.name} ↗
          </a>
        </>
      ),
    })),
    {
      id: "sowhat",
      body: (
        <>
          <span className="label-caps text-ink-3">
            {analogs.length + 2} · SO WHAT
          </span>
          <span className="data-lg text-ink">{PLACE_LABEL[place]}</span>
          <p className="body-md text-ink-2">
            History bounds this estimate — it doesn't prove it. Shocks like
            this produced {bandLo > 0 ? "+" : ""}
            {bandLo}% to +{bandHi}%.
          </p>
          <p className="caption mt-auto text-ink-3">
            narrative: {narrSource} · every claim traces to the episode
            sources in this deck
          </p>
        </>
      ),
    },
  ];

  return (
    <div className="flex flex-1 flex-col justify-between gap-6 rounded-lg border border-hairline bg-panel p-4">
      <h2 className="label-caps flex items-center gap-2 text-ink-3">
        <span className="material-symbols-outlined text-[18px] text-ink-3">
          history
        </span>
        HISTORICAL ANALOGS
      </h2>
      <button
        onClick={() => setDeckOpen(true)}
        className="label-caps flex w-full items-center justify-center gap-1 rounded border border-secondary/50 py-2 text-secondary transition-colors hover:bg-gold-wash"
      >
        Click here
        <span className="material-symbols-outlined text-[14px]">
          arrow_forward
        </span>
      </button>
      {deckOpen && (
        <CardDeck
          title="Historical analogs — one episode at a time"
          cards={deckCards}
          onClose={() => setDeckOpen(false)}
        />
      )}
    </div>
  );
}
