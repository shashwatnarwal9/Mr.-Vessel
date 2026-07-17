import { useEffect, useState } from "react";

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

export default function NewsRail() {
  const [items, setItems] = useState<NewsItem[]>([]);
  // "live" = really fetched now; "snapshot" = the dated curated set. The
  // rail must never dress one up as the other.
  const [mode, setMode] = useState<"live" | "snapshot">("snapshot");
  const [reconnect, setReconnect] = useState(0);

  useEffect(() => {
    // SSE (push-only) with baked fallback — backend absent never breaks it
    const apply = (raw: unknown) => {
      // {items, mode} from the live backend; a bare array = baked file
      if (Array.isArray(raw)) {
        setItems(raw as NewsItem[]);
        setMode("snapshot");
      } else {
        const p = raw as { items: NewsItem[]; mode?: string };
        setItems(p.items ?? []);
        setMode(p.mode === "live" ? "live" : "snapshot");
      }
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
                ? "fetched from GDELT and tagged by GLM"
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
        {items.map((n) => (
          <li
            key={n.id}
            className="flex cursor-pointer flex-col gap-1 rounded-lg border border-hairline bg-navy-deep p-2 transition-colors hover:border-secondary"
          >
            <div className="flex items-center justify-between">
              <span className="micro-mono uppercase text-ink-3">
                {new Date(n.ts).toLocaleDateString("en-IN", {
                  day: "numeric",
                  month: "short",
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
              <span className="material-symbols-outlined text-[12px] text-ink-3">
                info
              </span>
              <span className="label-caps text-ink-2">
                {n.tag} · Source: {n.source}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </aside>
  );
}
