"""Live news: GDELT DOC poll → one GLM call tags the whole batch.

Any failure (GDELT down, GLM queued, bad JSON) returns the fallback
source's items — the feed never breaks, and tags are never invented
outside the model: un-taggable batches simply stay baked.
"""

import asyncio
import json
import re
import tempfile
import time
from pathlib import Path
from typing import Any

import httpx

# Last good LIVE batch, cached across restarts. Without it every boot shows
# the dated snapshot until a poll completes (GDELT retry + GLM queue ≈ 3 min),
# which is what made a freshly-launched app look two days stale.
CACHE_FILE = Path(tempfile.gettempdir()) / "mrvessel_news_live.json"
CACHE_MAX_AGE_S = 6 * 3600  # older than this and the snapshot is no worse

GDELT_URL = "https://api.gdeltproject.org/api/v2/doc/doc"
QUERY = (
    '(hormuz OR "red sea" OR suez OR opec OR "crude oil india" '
    'OR "israel energy" OR "egypt energy") sourcelang:english'
)
MAX_ITEMS = 10
TAGS = {"Hormuz", "OPEC", "RedSea", "Suez", "fuel", "gdp", "stress"}

_PROMPT = """Classify each numbered headline for an India energy-disruption monitor.
Israel/Egypt items are disruption context (Suez/Red Sea/East Med) — never India economics.
Allowed tags: Hormuz, OPEC, RedSea, Suez, fuel, gdp, stress. Severity: 1 (background) to 5 (critical).
Reply with ONLY a JSON array, one object per headline: [{"i": 0, "tag": "...", "severity": n}, ...]

Headlines:
{headlines}"""


def _read_cache() -> list[dict[str, Any]] | None:
    """Last live batch from a previous run — only if it's still fresher than
    the baked snapshot would be."""
    try:
        age = time.time() - CACHE_FILE.stat().st_mtime
        if age > CACHE_MAX_AGE_S:
            return None
        data = json.loads(CACHE_FILE.read_text(encoding="utf-8"))
        return data if isinstance(data, list) and data else None
    except (OSError, ValueError):
        return None


def _iso(seendate: str) -> str:
    # GDELT "20260715T051000Z" -> "2026-07-15T05:10:00Z"
    m = re.match(r"(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z", seendate)
    return f"{m[1]}-{m[2]}-{m[3]}T{m[4]}:{m[5]}:{m[6]}Z" if m else seendate


def parse_tags(reply: str, n: int) -> dict[int, tuple[str, int]]:
    """Strict-parse the GLM batch reply; invalid entries are dropped."""
    text = re.sub(r"^```(?:json)?|```$", "", reply.strip(), flags=re.MULTILINE).strip()
    out: dict[int, tuple[str, int]] = {}
    for row in json.loads(text):
        i, tag, sev = row.get("i"), row.get("tag"), row.get("severity")
        if isinstance(i, int) and 0 <= i < n and tag in TAGS and isinstance(sev, int):
            out[i] = (tag, min(5, max(1, sev)))
    return out


class GdeltGlmNews:
    mode = "live"

    def __init__(self, llm: Any, fallback: Any) -> None:
        self._llm = llm
        self.fallback = fallback  # public: NewsFeed boots from it instantly
        # last successful LIVE batch: a later 429 must not drag the rail back
        # to the dated snapshot once real headlines have arrived
        self.last_live: list[dict[str, Any]] | None = _read_cache()

    def _remember(self, items: list[dict[str, Any]]) -> None:
        self.last_live = items
        try:
            CACHE_FILE.write_text(json.dumps(items), encoding="utf-8")
        except OSError:
            pass  # cache is an optimisation, never a dependency

    async def _fetch_gdelt(self) -> list[dict[str, Any]]:
        """ONE request per poll. Deliberately no inner retry.

        GDELT throttles by IP over a rolling window, and answers 429 with a
        PLAIN-TEXT scolding (not JSON) — so a bare .json() raises and looks
        like an outage. Measured the hard way: retrying 3x per poll issues
        ~3 req/min and *sustains* the penalty box rather than escaping it,
        and throttling is stochastic (a 7-term query 200s while a 2-term one
        429s seconds later — it is not about query size). The poll loop is
        the retry; asking once and backing off is what actually gets served.
        """
        async with httpx.AsyncClient(
            timeout=20, headers={"User-Agent": "mr-vessel/0.1 (research demo)"}
        ) as http:
            r = await http.get(
                GDELT_URL,
                params={
                    "query": QUERY,
                    "mode": "ArtList",
                    "format": "json",
                    "maxrecords": MAX_ITEMS,
                    "sort": "DateDesc",
                    "timespan": "2d",
                },
            )
            if r.status_code == 429:
                return []
            r.raise_for_status()
            try:
                return r.json().get("articles", [])[:MAX_ITEMS]
            except json.JSONDecodeError:
                return []  # 200 + plain-text scolding = throttled too

    async def _degraded(self) -> list[dict[str, Any]]:
        """Never regress: the last live batch beats the dated snapshot."""
        if self.last_live:
            return self.last_live
        return await self.fallback.latest()

    async def latest(self) -> list[dict[str, Any]]:
        try:
            arts = await self._fetch_gdelt()
            if not arts:
                return await self._degraded()
            headlines = "\n".join(f"{i}. {a['title']}" for i, a in enumerate(arts))
            reply = await self._llm.chat(_PROMPT.format(headlines=headlines))
            tagged = parse_tags(reply, len(arts))
            items = [
                {
                    "id": i + 1,
                    "ts": _iso(a.get("seendate", "")),
                    "source": a.get("domain", "GDELT"),
                    "title": a["title"],
                    "tag": tagged[i][0],
                    "severity": tagged[i][1],
                }
                for i, a in enumerate(arts)
                if i in tagged
            ]
            if items:
                self._remember(items)
                return items
            return await self._degraded()
        except Exception:
            return await self._degraded()


if __name__ == "__main__":
    # self-check: parser handles fences, junk rows, clamping
    reply = """```json
    [{"i":0,"tag":"Hormuz","severity":9},{"i":1,"tag":"weather","severity":2},
     {"i":2,"tag":"fuel","severity":3},{"i":99,"tag":"gdp","severity":1}]
    ```"""
    t = parse_tags(reply, 3)
    assert t == {0: ("Hormuz", 5), 2: ("fuel", 3)}, t
    assert _iso("20260715T051000Z") == "2026-07-15T05:10:00Z"
    print("gdelt parser OK")
