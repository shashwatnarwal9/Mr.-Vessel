"""Live news: GDELT DOC poll → one GLM call tags the whole batch.

Any failure (GDELT down, GLM queued, bad JSON) returns the fallback
source's items — the feed never breaks, and tags are never invented
outside the model: un-taggable batches simply stay baked.
"""

import json
import re
from typing import Any

import httpx

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

    async def _fetch_gdelt(self) -> list[dict[str, Any]]:
        # GDELT throttles hard: identify ourselves, poll no faster than NewsFeed's 60s
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
            r.raise_for_status()
            return r.json().get("articles", [])[:MAX_ITEMS]

    async def latest(self) -> list[dict[str, Any]]:
        try:
            arts = await self._fetch_gdelt()
            if not arts:
                return await self.fallback.latest()
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
            return items or await self.fallback.latest()
        except Exception:
            return await self.fallback.latest()


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
