"""Live news: GDELT DOC poll → one GLM call tags the whole batch.

Any failure (GDELT down, GLM queued, bad JSON) returns the fallback
source's items — the feed never breaks, and tags are never invented
outside the model: un-taggable batches simply stay baked.
"""

import asyncio
import datetime
import json
import re
import tempfile
import time
from pathlib import Path
from typing import Any

import httpx

from ..config import GOOGLE_NEWS_API_KEY, GUARDIAN_API_KEY

# Last good LIVE batch, cached across restarts. Without it every boot shows
# the dated snapshot until a poll completes (GDELT retry + GLM queue ≈ 3 min),
# which is what made a freshly-launched app look two days stale.
CACHE_FILE = Path(tempfile.gettempdir()) / "mrvessel_news_live.json"
CACHE_MAX_AGE_S = 6 * 3600  # older than this and the snapshot is no worse

GDELT_URL = "https://api.gdeltproject.org/api/v2/doc/doc"
# Google News (RapidAPI) — India-positioned (lr=en-IN). Topic endpoints are not
# keyword-searchable, so we pull India world + business and keep only the
# corridor-relevant headlines; an India cricket story must never feed the
# closure-detection signal.
GN_HOST = "google-news13.p.rapidapi.com"
GN_ENDPOINTS = ("world", "business")
GN_LR = "en-IN"
GN_RELEVANT = re.compile(
    r"hormuz|strait|opec|crude|\boil\b|petrol|diesel|\bfuel\b|\bgas\b|energy|"
    r"iran|red sea|bab[- ]?el|suez|tanker|refiner|brent|\bimport|shipping|gulf|"
    r"pump price|war[- ]risk|houthi|blockad|yemen|chokepoint|closure|sanction|"
    r"opec\+|saudi|\buae\b|kuwait|barrel|freight|tariff",
    re.I,
)
GUARDIAN_URL = "https://content.guardianapis.com/search"
# match HEADLINES only (query-fields=headline) — a bare q searches full body,
# so constantly-updated liveblogs that mention any topic swamp "newest".
# Multi-word terms are quoted so they're phrases, not AND-of-words.
GUARDIAN_QUERY = 'hormuz OR opec OR suez OR tanker OR "red sea" OR "crude oil" OR "oil price"'
QUERY = (
    '(hormuz OR "red sea" OR suez OR opec OR "crude oil india" '
    'OR "israel energy" OR "egypt energy") sourcelang:english'
)
MAX_ITEMS = 10
WINDOW_DAYS = 7  # rail scrolls back a week; each poll only returns latest ~10
MAX_KEEP = 60  # cap the accumulated window (localStorage/DOM friendly)
TAG_BUDGET = 30  # max headlines tagged per poll (one GLM call)
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


def _gn_iso(ms: Any) -> str:
    # Google News timestamp is ms since epoch -> ISO-8601 Z (passes _iso through)
    try:
        return datetime.datetime.fromtimestamp(
            int(ms) / 1000, tz=datetime.timezone.utc
        ).strftime("%Y-%m-%dT%H:%M:%SZ")
    except (TypeError, ValueError):
        return ""


def _dedup_titles(arts: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """First occurrence wins (callers pass the freshest/primary source first)."""
    seen: set[str] = set()
    out: list[dict[str, Any]] = []
    for a in arts:
        t = a.get("title")
        if t and t not in seen:
            seen.add(t)
            out.append(a)
    return out


def _merge_window(
    prev: list[dict[str, Any]] | None, fresh: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """Accumulate freshly-tagged headlines into a rolling WINDOW_DAYS view.

    Each poll returns only the latest ~MAX_ITEMS, so without this the rail can
    never show more than one batch. Dedup by title (newest ts wins), drop
    anything older than the window, sort newest-first, cap, renumber ids.
    ISO-8601 Z timestamps are same-format → lexical compare is chronological.
    """
    by_title: dict[str, dict[str, Any]] = {}
    for it in (prev or []) + fresh:
        title, ts = it.get("title"), it.get("ts", "")
        if not title or not ts:
            continue
        cur = by_title.get(title)
        if cur is None or ts > cur.get("ts", ""):
            by_title[title] = it
    cutoff = (
        datetime.datetime.now(datetime.timezone.utc)
        - datetime.timedelta(days=WINDOW_DAYS)
    ).strftime("%Y-%m-%dT%H:%M:%SZ")
    kept = sorted(
        (it for it in by_title.values() if it.get("ts", "") >= cutoff),
        key=lambda x: x.get("ts", ""),
        reverse=True,
    )[:MAX_KEEP]
    return [{**it, "id": i + 1} for i, it in enumerate(kept)]


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

    async def _fetch_googlenews(self) -> list[dict[str, Any]]:
        """India-positioned PRIMARY source (lr=en-IN). Topic endpoints aren't
        keyword-searchable, so pull India world + business and keep only the
        corridor-relevant headlines (an India cricket story must never reach the
        closure-detection signal). A 403 'not subscribed' just returns [] and
        the chain falls through to Guardian — the feed never breaks."""
        if not GOOGLE_NEWS_API_KEY:
            return []
        seen: set[str] = set()
        arts: list[dict[str, Any]] = []
        try:
            async with httpx.AsyncClient(
                timeout=20,
                headers={
                    "x-rapidapi-host": GN_HOST,
                    "x-rapidapi-key": GOOGLE_NEWS_API_KEY,
                },
            ) as http:
                for ep in GN_ENDPOINTS:
                    r = await http.get(f"https://{GN_HOST}/{ep}", params={"lr": GN_LR})
                    if r.status_code != 200:
                        continue
                    for a in r.json().get("items") or []:
                        title = a.get("title") or ""
                        if title in seen or not GN_RELEVANT.search(title):
                            continue
                        seen.add(title)
                        arts.append(
                            {
                                "title": title,
                                "seendate": _gn_iso(a.get("timestamp")),
                                "domain": a.get("publisher") or "Google News",
                            }
                        )
        except (httpx.HTTPError, json.JSONDecodeError):
            pass  # partial results are fine
        arts.sort(key=lambda a: a["seendate"], reverse=True)  # newest first
        return arts[:MAX_ITEMS]

    async def _fetch_guardian(
        self, days: int | None = None, page_size: int = MAX_ITEMS
    ) -> list[dict[str, Any]]:
        """Guardian corridor headlines. Called two ways: (1) the latest-N
        fallback when GDELT 429s, and (2) a `days`-wide backfill so the rail
        can scroll a full week even right after a restart (Google News only
        ever returns "latest"). Reliable + date-range capable; the free
        5,000/day budget covers polling comfortably. Normalised to GDELT's
        article shape; webPublicationDate is ISO-8601 Z → passes _iso().
        """
        if not GUARDIAN_API_KEY:
            return []
        page_size = min(page_size, 50)  # Guardian hard cap
        params: dict[str, Any] = {
            "api-key": GUARDIAN_API_KEY,
            "q": GUARDIAN_QUERY,
            "query-fields": "headline",
            "order-by": "newest",
            "page-size": page_size,
        }
        if days:
            params["from-date"] = (
                datetime.datetime.now(datetime.timezone.utc)
                - datetime.timedelta(days=days)
            ).strftime("%Y-%m-%d")
        try:
            async with httpx.AsyncClient(timeout=20) as http:
                r = await http.get(GUARDIAN_URL, params=params)
            if r.status_code != 200:
                return []
            results = r.json().get("response", {}).get("results") or []
        except (httpx.HTTPError, json.JSONDecodeError):
            return []
        return [
            {
                "title": a["webTitle"],
                "seendate": a.get("webPublicationDate", ""),
                "domain": "The Guardian",
            }
            for a in results
            if a.get("webTitle")
        ][:page_size]

    async def _degraded(self) -> list[dict[str, Any]]:
        """Never regress: the last live batch beats the dated snapshot."""
        if self.last_live:
            return self.last_live
        return await self.fallback.latest()

    async def latest(self) -> list[dict[str, Any]]:
        try:
            # India-positioned Google News is the freshest source; GDELT is a
            # keyless fallback for "today". On top of that, a Guardian 7-day
            # backfill gives the rail a full week to scroll immediately (Google
            # News only ever returns "latest"). All merged + deduped by title,
            # freshest first so it wins on overlap.
            fresh = await self._fetch_googlenews()
            if not fresh:
                fresh = await self._fetch_gdelt()
            week = await self._fetch_guardian(days=WINDOW_DAYS, page_size=MAX_KEEP)
            pool = _dedup_titles(fresh + week)[:TAG_BUDGET]
            if not pool:
                return await self._degraded()
            headlines = "\n".join(f"{i}. {a['title']}" for i, a in enumerate(pool))
            # .replace, NOT .format: the prompt contains a literal JSON example
            # `[{"i": 0, ...}]` whose braces str.format reads as fields (KeyError).
            reply = await self._llm.chat(_PROMPT.replace("{headlines}", headlines))
            tagged = parse_tags(reply, len(pool))
            items = [
                {
                    "id": i + 1,
                    "ts": _iso(a.get("seendate", "")),
                    "source": a.get("domain", "GDELT"),
                    "title": a["title"],
                    "tag": tagged[i][0],
                    "severity": tagged[i][1],
                }
                for i, a in enumerate(pool)
                if i in tagged
            ]
            if items:
                # accumulate into the rolling 7-day window so the rail keeps a
                # week even as newer batches arrive / a source throttles
                merged = _merge_window(self.last_live, items)
                self._remember(merged)
                return merged
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
    # Guardian webPublicationDate is already ISO-8601 Z → passes through untouched
    assert _iso("2026-07-17T05:10:00Z") == "2026-07-17T05:10:00Z"
    # Google News ms-epoch → ISO Z; the corridor filter keeps only relevant news
    assert _gn_iso(1784645329000) == "2026-07-21T14:48:49Z", _gn_iso(1784645329000)
    assert _gn_iso("bad") == "" and _gn_iso(None) == ""
    assert GN_RELEVANT.search("Saudi Arabia slams Houthi blockade")
    assert GN_RELEVANT.search("Oil prices jump as Hormuz tensions rise")
    assert not GN_RELEVANT.search("India beat Australia in the final over")
    # prompt substitution must NOT choke on the literal JSON braces in the
    # example (str.format did → KeyError → tagging never ran → stale news)
    built = _PROMPT.replace("{headlines}", "0. Test headline")
    assert "0. Test headline" in built and '{"i": 0' in built, "prompt substitution broke"
    # _merge_window: dedup by title (newest ts wins), drop out-of-window,
    # newest-first, renumber ids
    now = datetime.datetime.now(datetime.timezone.utc)
    iso = lambda d: (now - datetime.timedelta(days=d)).strftime("%Y-%m-%dT%H:%M:%SZ")
    prev = [{"ts": iso(2), "title": "A", "severity": 2}]
    fresh = [
        {"ts": iso(0), "title": "B", "severity": 3},
        {"ts": iso(1), "title": "A", "severity": 4},  # newer A → overrides prev
        {"ts": iso(30), "title": "OLD", "severity": 1},  # outside the 7-day window
    ]
    m = _merge_window(prev, fresh)
    assert [x["title"] for x in m] == ["B", "A"], m  # newest-first, OLD dropped
    assert m[1]["severity"] == 4, m  # newer duplicate wins
    assert [x["id"] for x in m] == [1, 2], m  # ids renumbered
    # _dedup_titles keeps first occurrence (freshest/primary source wins)
    dd = _dedup_titles([{"title": "X", "domain": "GN"}, {"title": "X", "domain": "Guardian"}, {"title": "Y"}])
    assert [a["title"] for a in dd] == ["X", "Y"] and dd[0]["domain"] == "GN", dd
    print("gdelt parser OK")
