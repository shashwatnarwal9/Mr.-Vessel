"""Live news: multi-source poll → one LLM call tags the whole batch.

Sources, in fallback order: Google News RSS (keyless, primary), GDELT (keyless
but IP-throttled — unusable from shared datacenter egress such as Render), and
a Guardian 7-day backfill. Tagging runs on config.TAG_MODEL, a fast
classification model, NOT the GLM reasoning model used for RAG narration.

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
import xml.etree.ElementTree as ET
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Any

import httpx

from ..config import GUARDIAN_API_KEY

# Last good LIVE batch, cached across restarts. Without it every boot shows
# the dated snapshot until a poll completes (GDELT retry + GLM queue ≈ 3 min),
# which is what made a freshly-launched app look two days stale.
CACHE_FILE = Path(tempfile.gettempdir()) / "mrvessel_news_live.json"
CACHE_MAX_AGE_S = 6 * 3600  # older than this and the snapshot is no worse

GDELT_URL = "https://api.gdeltproject.org/api/v2/doc/doc"

# Primary source: keyless and keyword-searchable, so it works from a datacenter
# IP where GDELT is permanently rate-limited (why deploys saw no GDELT items).
GNEWS_RSS_URL = "https://news.google.com/rss/search"
GNEWS_QUERY = (
    'hormuz OR opec OR "red sea" OR suez OR tanker OR crude OR "oil price" '
    'OR "strait of hormuz" OR refinery OR "crude imports"'
)
GNEWS_PARAMS = {"hl": "en-IN", "gl": "IN", "ceid": "IN:en"}  # India edition
GNEWS_MAX = 20

# "tanker" near "water" is a truck, not a vessel - the dominant sense in Indian
# news. water misses "waters", so maritime phrasing still passes.
GN_NOISE = re.compile(r"\bwater\b.{0,40}\btanker\b|\btanker\b.{0,40}\bwater\b", re.I)

# Headline relevance: GDELT matches article BODIES, so unrelated local news
# qualifies whenever its text happens to mention a corridor.
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
        if not isinstance(data, list) or not data:
            return None
        # NewsFeed.start() serves this straight to subscribers, bypassing
        # _merge_window - so a pre-filter batch needs gating here too.
        return _english_only(data) or None
    except (OSError, ValueError):
        return None


def _iso(seendate: str) -> str:
    # GDELT "20260715T051000Z" -> "2026-07-15T05:10:00Z"
    m = re.match(r"(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z", seendate)
    return f"{m[1]}-{m[2]}-{m[3]}T{m[4]}:{m[5]}:{m[6]}Z" if m else seendate


def _rss_iso(pubdate: str) -> str:
    """RSS pubDate (RFC-822) -> ISO-8601 Z, the shape `_iso` passes through."""
    try:
        dt = parsedate_to_datetime(pubdate)
    except (TypeError, ValueError):
        return ""
    if dt is None:
        return ""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=datetime.timezone.utc)
    return dt.astimezone(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _rss_title(raw: str, source: str) -> str:
    """Google News suffixes every headline with " - Publisher"; the rail already
    shows the publisher in its own field, so strip the duplicate."""
    suffix = f" - {source}"
    return raw[: -len(suffix)].strip() if source and raw.endswith(suffix) else raw


# English-only gate, applied to every upstream: none filter reliably (GDELT
# ignores sourcelang, Google News returns Hindi/Tamil, the disk cache predates
# any filter). TODO: real language detection if Latin-script noise appears.
def _english_only(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Keep Latin-script headlines; drop Arabic/Cyrillic/CJK/Devanagari.

    Codepoint test, not a regex class: the class needed literal high-plane
    chars in source. U+2000-U+20BF keeps curly quotes, dashes and the rupee.
    """

    def latin(text: str) -> bool:
        return all(ord(c) < 0x250 or 0x2000 <= ord(c) <= 0x20BF for c in text)

    return [i for i in items if latin(i.get("title") or "")]


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
    # gate the merged view too: `prev` is the disk cache, which can hold a
    # batch written before the filter existed.
    for it in _english_only((prev or []) + fresh):
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
                arts = r.json().get("articles", [])
            except json.JSONDecodeError:
                return []  # 200 + plain-text scolding = throttled too
            # body-matched, so screen headlines with the same gate the other
            # sources use - measured 4 of 23 live items were noise.
            return [
                a
                for a in arts
                if GN_RELEVANT.search(a.get("title") or "")
                and not GN_NOISE.search(a.get("title") or "")
            ][:MAX_ITEMS]

    async def _fetch_gnews_rss(self) -> list[dict[str, Any]]:
        """Primary source. Keyless, so it behaves the same locally and
        deployed. Any failure returns [] and the chain falls through to GDELT,
        then Guardian."""
        try:
            async with httpx.AsyncClient(
                timeout=20,
                follow_redirects=True,
                headers={"User-Agent": "mr-vessel/0.1 (research demo)"},
            ) as http:
                r = await http.get(
                    GNEWS_RSS_URL, params={"q": GNEWS_QUERY, **GNEWS_PARAMS}
                )
            if r.status_code != 200:
                return []
            root = ET.fromstring(r.content)
        except (httpx.HTTPError, ET.ParseError):
            return []
        arts: list[dict[str, Any]] = []
        for item in root.findall(".//item"):
            raw = (item.findtext("title") or "").strip()
            node = item.find("{*}source")
            source = (node.text if node is not None else None) or "Google News"
            ts = _rss_iso(item.findtext("pubDate") or "")
            if not raw or not ts:
                continue
            title = _rss_title(raw, source)
            # Google's matching is fuzzy — "tanker" pulled in a story about a
            # water tank, "crude" a reservoir report. Same headline gate the
            # other two sources pass through, applied to the same field.
            if not GN_RELEVANT.search(title) or GN_NOISE.search(title):
                continue
            arts.append({"title": title, "seendate": ts, "domain": source})
        arts.sort(key=lambda a: a["seendate"], reverse=True)  # newest first
        return arts[:GNEWS_MAX]

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
            fresh = await self._fetch_gnews_rss()
            if not fresh:
                fresh = await self._fetch_gdelt()
            week = await self._fetch_guardian(days=WINDOW_DAYS, page_size=MAX_KEEP)
            # gate BEFORE tagging: no point spending GLM tokens on headlines
            # that can never reach the rail (and it can't mis-tag what it
            # never sees)
            pool = _dedup_titles(_english_only(fresh + week))[:TAG_BUDGET]
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
    # Google News RSS: RFC-822 pubDate -> ISO Z, and the " - Publisher" suffix
    # Google appends to every headline is stripped (the rail shows it separately)
    assert _rss_iso("Sun, 26 Jul 2026 15:20:02 GMT") == "2026-07-26T15:20:02Z"
    assert _rss_iso("bad") == "" and _rss_iso("") == ""
    assert _rss_title("Oil prices surge - The Hindu", "The Hindu") == "Oil prices surge"
    assert _rss_title("Oil prices surge", "The Hindu") == "Oil prices surge"
    assert GN_RELEVANT.search("Saudi Arabia slams Houthi blockade")
    assert GN_RELEVANT.search("Oil prices jump as Hormuz tensions rise")
    assert not GN_RELEVANT.search("India beat Australia in the final over")
    # GDELT body-matching noise the rail actually served before the gate was
    # applied to that source too (both real, from the live feed)
    assert not GN_RELEVANT.search("Fire services ask Somerset residents to check their bins")
    assert not GN_RELEVANT.search("As Trump boosts nuclear power, regulators seek to ease rules")
    # water tankers are trucks: both of these reached the live rail via "tanker"
    assert GN_NOISE.search("revoke 15% water cut to end tanker dependence")
    assert GN_NOISE.search("Dad of four electrocuted while drawing water from tanker")
    assert not GN_NOISE.search("Tanker hits mine in the Strait of Hormuz")
    assert not GN_NOISE.search("Oil tanker adrift in Gulf waters")  # "waters" != "water"
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
    # English-only gate. Must drop non-Latin scripts while keeping English that
    # carries accents, curly quotes, dashes or a rupee sign — those are the
    # false-positives a naive [a-zA-Z] filter would cause.
    keep = [
        {"title": "Oil tanker explodes after hitting naval mine in Strait of Hormuz"},
        {"title": "Petrol hits ₹105/L as Brent — the benchmark — spikes"},
        {"title": "Suez transit falls; café owners in Port Said feel the pinch"},
        {"title": "Iran’s navy drills narrow the transit corridor"},
    ]
    drop = [
        {"title": "تعليق الضربات"},  # Arabic (okaz.com.sa)
        {"title": "Нефть растет"},  # Cyrillic
        {"title": "石油价格上涨"},  # Chinese
        {"title": "तेल की कीमत"},  # Devanagari
    ]
    assert _english_only(keep) == keep, "dropped legitimate English"
    assert _english_only(drop) == [], "kept non-English"
    assert _english_only(keep + drop) == keep, "mixed batch not filtered"
    # a missing title is a VALIDITY problem, not a language one: this gate must
    # not crash on it and must not claim it as non-English — _dedup_titles and
    # _merge_window are what drop untitled rows
    assert _english_only([{"title": None}, {}]) == [{"title": None}, {}]
    assert _merge_window(None, [{"title": None, "ts": iso(0)}]) == []
    # the merge gate purges an already-cached non-English batch (the disk cache
    # predates this filter, so restarting must not resurrect it)
    merged = _merge_window(
        [{"ts": iso(1), "title": drop[0]["title"]}], [{"ts": iso(0), "title": "Brent spikes"}]
    )
    assert [x["title"] for x in merged] == ["Brent spikes"], merged

    print("gdelt parser OK")
