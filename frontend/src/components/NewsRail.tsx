import { useEffect, useState } from "react";

type NewsItem = {
  id: number;
  ts: string;
  source: string;
  title: string;
  tag: string;
  severity: number; // 1..5
};

// dataviz status palette (reserved, never series colors)
const SEV: Record<number, string> = {
  1: "#898781",
  2: "#fab219",
  3: "#ec835a",
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
      className="absolute bottom-4 right-4 top-4 z-10 w-72 overflow-y-auto rounded-xl border border-white/15 bg-white/10 p-3 shadow-2xl backdrop-blur-md"
      aria-label="News feed"
    >
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-white">Signals</h2>
        <button
          onClick={() => setItems((cur) => rotateBaked(cur))}
          title="Fetch the latest signals"
          className="rounded border border-white/15 bg-white/5 px-2 py-0.5 text-[11px] text-slate-300 hover:bg-white/10"
        >
          ↻ refresh
        </button>
      </div>
      <ul className="flex flex-col gap-2">
        {items.map((n) => (
          <li
            key={n.id}
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-2"
          >
            <div className="mb-1 flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-slate-400">
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ background: SEV[n.severity] ?? SEV[1] }}
                title={`severity ${n.severity}`}
              />
              {n.tag} · {n.source} ·{" "}
              {new Date(n.ts).toLocaleDateString("en-IN", {
                day: "numeric",
                month: "short",
              })}
            </div>
            <div className="text-xs leading-snug text-slate-200">{n.title}</div>
          </li>
        ))}
      </ul>
    </aside>
  );
}
