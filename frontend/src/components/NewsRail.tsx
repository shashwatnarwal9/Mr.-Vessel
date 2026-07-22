import { useEffect, useMemo, useState } from "react";
import { useStore } from "../store";

type NewsItem = {
  id: number;
  ts: string;
  source: string;
  title: string;
  tag: string;
  severity: number; // 1..5
};

// dataviz status palette (reserved, never series colors; no yellow —
// never collides with brand gold)
const SEV: Record<number, string> = {
  1: "#8792b8",
  2: "#e8871e",
  3: "#e2603b",
  4: "#d03b3b",
  5: "#d03b3b",
};

const SSE_URL =
  (import.meta.env.VITE_API_HTTP ?? "http://localhost:8000") + "/sse/news";

const dayKey = (ts: string) => new Date(ts).toDateString();
const dayLabel = (ts: string) => {
  const d = new Date(ts);
  const today = new Date();
  const yst = new Date(today);
  yst.setDate(today.getDate() - 1);
  if (dayKey(ts) === dayKey(today.toISOString())) return "Today";
  if (dayKey(ts) === dayKey(yst.toISOString())) return "Yesterday";
  return d.toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
};

export default function NewsRail() {
  const [items, setItems] = useState<NewsItem[]>([]);
  // "live" = really fetched now; "snapshot" = the dated curated set. The
  // rail must never dress one up as the other.
  const [mode, setMode] = useState<"live" | "snapshot">("snapshot");
  const [reconnect, setReconnect] = useState(0);
  // newest-first, defensive (backend already sorts) — drives day grouping
  const sorted = useMemo(
    () => [...items].sort((a, b) => b.ts.localeCompare(a.ts)),
    [items],
  );

  useEffect(() => {
    // SSE (push-only) with baked fallback — backend absent never breaks it
    const apply = (raw: unknown) => {
      // {items, mode} from the live backend; a bare array = baked file
      const next = Array.isArray(raw)
        ? (raw as NewsItem[])
        : ((raw as { items: NewsItem[] }).items ?? []);
      setItems(next);
      setMode(
        !Array.isArray(raw) && (raw as { mode?: string }).mode === "live"
          ? "live"
          : "snapshot",
      );
      // share the feed: corridor risk derives its news signal from these
      useStore.getState().setNewsItems(
        next.map((n) => ({ tag: n.tag, severity: n.severity })),
      );
    };
    const fallback = () =>
      fetch("/news.json")
        .then((r) => r.json())
        .then(apply)
        .catch(() => setItems([]));

    const es = new EventSource(SSE_URL);
    es.onmessage = (e) => apply(JSON.parse(e.data));
    es.onerror = () => {
      es.close();
      fallback();
    };
    return () => es.close();
  }, [reconnect]);

  return (
    <aside
      className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto rounded-xl border border-hairline bg-panel/90 p-4 shadow-2xl backdrop-blur-md"
      aria-label="News feed"
    >
      <div className="flex items-center justify-between border-b border-hairline pb-2">
        <h2 className="label-caps flex items-center gap-1 text-ink">
          <span className="material-symbols-outlined text-[16px] text-secondary">
            rss_feed
          </span>{" "}
          Signals
        </h2>
        <span className="flex items-center gap-2">
          <span
            className={`caption flex items-center gap-1 rounded-full border px-2 py-0.5 ${
              mode === "live"
                ? "border-good/40 bg-good/10 text-good-text"
                : "border-hairline text-ink-3"
            }`}
            title={
              mode === "live"
                ? "fetched live and tagged by GLM — accumulates the last 7 days; scroll to read back through the week"
                : "curated snapshot — the live feed is unavailable (GDELT throttles by IP); dates are the real ones"
            }
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                mode === "live" ? "pulse-dot bg-good" : "bg-ink-3"
              }`}
            />
            {mode === "live" ? "live" : "snapshot"}
          </span>
          <button
            onClick={() => setReconnect((n) => n + 1)}
            title="Re-fetch the signals feed"
            aria-label="Refresh signals"
            className="material-symbols-outlined text-[16px] text-ink-3 transition-colors hover:text-ink"
          >
            refresh
          </button>
        </span>
      </div>
      <ul className="flex flex-col gap-2">
        {sorted.map((n, i) => {
          // day separator: the feed holds up to the last 7 days — label each
          // day once so scrolling back through the week stays legible
          const day = dayKey(n.ts);
          const newDay = i === 0 || day !== dayKey(sorted[i - 1].ts);
          return (
            <li key={n.id} className="contents">
              {newDay && (
                <div className="label-caps sticky top-0 z-10 -mx-1 mb-0.5 mt-1 bg-panel/95 px-1 py-1 text-ink-3 backdrop-blur-sm">
                  {dayLabel(n.ts)}
                </div>
              )}
              <div className="flex cursor-pointer flex-col gap-1 rounded-lg border border-hairline bg-navy-deep p-2 transition-colors hover:border-secondary">
                <div className="flex items-center justify-between">
                  <span className="micro-mono uppercase text-ink-3">
                    {new Date(n.ts).toLocaleTimeString("en-IN", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ background: SEV[n.severity] ?? SEV[1] }}
                    title={`severity ${n.severity}`}
                  />
                </div>
                <p className="body-md leading-snug text-ink">{n.title}</p>
                <div className="mt-1 flex items-center gap-1">
                  <span className="label-caps text-ink-2">
                    {n.tag} · Source: {n.source}
                  </span>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
