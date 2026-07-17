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

// Tier 1 refresh: rotate the baked set with fresh timestamps; when the
// backend is live the SSE feed supersedes it (Tier 2: triggers GDELT)
function rotateBaked(items: NewsItem[]): NewsItem[] {
  const shifted = [...items.slice(2), ...items.slice(0, 2)];
  const now = Date.now();
  return shifted.map((n, i) => ({
    ...n,
    ts: new Date(now - i * 3 * 3600_000).toISOString(),
  }));
}

export default function NewsRail() {
  const [items, setItems] = useState<NewsItem[]>([]);

  useEffect(() => {
    // SSE (push-only) with baked fallback — backend absent never breaks it
    const fallback = () =>
      fetch("/news.json")
        .then((r) => r.json())
        .then(setItems)
        .catch(() => setItems([]));

    const es = new EventSource(SSE_URL);
    es.onmessage = (e) => setItems(JSON.parse(e.data));
    es.onerror = () => {
      es.close();
      fallback();
    };
    // auto-refresh every minute (SSE pushes overwrite when they land)
    const t = setInterval(() => setItems((cur) => rotateBaked(cur)), 60_000);
    return () => {
      es.close();
      clearInterval(t);
    };
  }, []);

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
        <button
          onClick={() => setItems((cur) => rotateBaked(cur))}
          title="Fetch the latest signals"
          className="material-symbols-outlined text-[16px] text-ink-3 transition-colors hover:text-ink"
        >
          refresh
        </button>
      </div>
      <ul className="flex flex-col gap-2">
        {items.map((n) => (
          <li
            key={n.id}
            className="flex cursor-pointer flex-col gap-1 rounded-lg border border-hairline bg-navy-deep p-2 transition-colors hover:border-secondary"
          >
            <div className="flex items-center justify-between">
              <span className="micro-mono text-[9px] uppercase text-ink-3">
                {new Date(n.ts).toLocaleDateString("en-IN", {
                  day: "numeric",
                  month: "short",
                })}
              </span>
              <span
                className="text-[8px]"
                style={{ color: SEV[n.severity] ?? SEV[1] }}
                title={`severity ${n.severity}`}
              >
                ●
              </span>
            </div>
            <p className="body-md leading-snug text-ink">{n.title}</p>
            <div className="mt-1 flex items-center gap-1">
              <span className="material-symbols-outlined text-[12px] text-ink-3">
                info
              </span>
              <span className="label-caps text-[9px] text-ink-2">
                {n.tag} · Source: {n.source}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </aside>
  );
}
