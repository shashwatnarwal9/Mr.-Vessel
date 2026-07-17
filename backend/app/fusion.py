"""π fusion: 1-D Kalman filter over three disruption signals.

State x = fused Hormuz disruption severity π. Each tick: predict
(process noise Q), then sequential measurement updates for whichever
signals are available. Confidence = 1 − √P (posterior std).
"""

import asyncio
import json
import re
from typing import Any, AsyncIterator

TICK_S = 30
Q = 0.001  # process noise per tick
# measurement variances: market prices are the sharpest signal,
# tagged news is noisier, AIS density is the crudest
R_NEWS = 0.05
R_MARKET = 0.02
R_AIS = 0.15

BRENT_BASE = 80.0
FULL_CLOSURE_SHOCK = 0.8  # mirrors cascade BASE.crudeShockAtFullClosure

HORMUZ_BBOX = (55.5, 58.0, 25.5, 27.2)  # mirrors frontend zones.ts
AIS_BASELINE_COUNT = 9  # ships normally on the Hormuz lane segment


def clamp01(x: float) -> float:
    return min(1.0, max(0.0, x))


def kalman_update(x: float, p: float, z: float, r: float) -> tuple[float, float]:
    """One scalar Kalman measurement update."""
    k = p / (p + r)
    return x + k * (z - x), (1 - k) * p


def pi_from_news(items: list[dict[str, Any]]) -> float | None:
    """Severity-weighted signal from tagged headlines."""
    w = {
        "Hormuz": 1.0,
        "RedSea": 0.5,
        "Suez": 0.5,
        "OPEC": 0.5,
        "fuel": 0.25,
        "stress": 0.25,
    }
    scores = [(i["severity"] / 5) * w[i["tag"]] for i in items if i.get("tag") in w]
    if not scores:
        return None
    scores.sort(reverse=True)
    return clamp01(sum(scores[:3]) / 3)  # top-3 mean: one headline can't max π


# A headline that REPORTS a closure is an observation of severity, not a
# proxy for it — so it is read directly instead of being averaged into the
# signal blend. Deliberately strict: only explicit closure language counts.
# "drills narrow the transit corridor" is pressure, NOT a closure, and must
# not trip this; otherwise the model would invent an event from atmosphere.
CLOSURE_FULL = re.compile(
    r"(complete|full|total|entire)(ly)?\s+(clos\w+|shut\w*|seal\w*|block\w*)"
    r"|(clos\w+|shut\w*|seal\w*|block\w*)\s+(the\s+)?strait"
    r"|strait\s+of\s+hormuz\s+(is\s+|has\s+been\s+)?(clos\w+|shut\w*|seal\w*)",
    re.I,
)
CLOSURE_PARTIAL = re.compile(
    r"partial(ly)?\s+(clos\w+|shut\w*|block\w*|seal\w*)"
    r"|(clos\w+|shut\w*|block\w*)\s+partially",
    re.I,
)
# A threat is not an event. "Iran COULD close Hormuz" / "analysts WARN of a
# closure" are the most common phrasings in this corridor's coverage — if
# these tripped the rule the model would manufacture a shutdown out of
# tension, which is exactly the failure this project refuses to make.
SPECULATION = re.compile(
    r"\b(could|may|might|would|should|if|threat\w*|warn\w*|fear\w*|risk\w*|"
    r"plan\w*|prepar\w*|weigh\w*|consider\w*|vow\w*|urge\w*|mull\w*|"
    r"possib\w*|potential\w*|scenario|simulat\w*|drill\w*|exercise\w*)\b",
    re.I,
)


def closure_from_news(
    items: list[dict[str, Any]],
) -> tuple[float, dict[str, Any]] | None:
    """Read an explicitly reported Hormuz closure straight off the wire.

    Full closure -> 1.0, partial -> 0.5. Newest item wins. Returns the
    headline too, so the UI can show WHICH report drove the number.
    """
    for i in sorted(items, key=lambda x: str(x.get("ts", "")), reverse=True):
        title = str(i.get("title", ""))
        if i.get("tag") != "Hormuz" and "hormuz" not in title.lower():
            continue
        if SPECULATION.search(title):
            continue  # a threat/drill/forecast is not a closure
        if CLOSURE_FULL.search(title):
            return 1.0, i
        if CLOSURE_PARTIAL.search(title):
            return 0.5, i
    return None


def pi_from_brent(brent: float) -> float:
    """Share of the full-closure shock already priced into crude."""
    return clamp01((brent - BRENT_BASE) / (BRENT_BASE * FULL_CLOSURE_SHOCK))


def pi_from_ships(fc: dict[str, Any] | None) -> float | None:
    # ponytail: density anomaly vs fixed baseline; upgrade = per-lane
    # historical transit rates once live AIS accumulates history
    if not fc:
        return None
    lo, hi, la, ha = HORMUZ_BBOX
    n = sum(
        1
        for f in fc["features"]
        if lo <= f["geometry"]["coordinates"][0] <= hi
        and la <= f["geometry"]["coordinates"][1] <= ha
    )
    return clamp01(abs(n - AIS_BASELINE_COUNT) / AIS_BASELINE_COUNT)


class FusionEngine:
    def __init__(self, market: Any, news_feed: Any, vessels: Any) -> None:
        self._market = market
        self._news = news_feed
        self._vessels = vessels
        self.x = 0.0
        self.p = 1.0  # start uninformed
        self._subs: set[asyncio.Queue] = set()
        self.components: dict[str, float | None] = {}
        self.driver: dict[str, Any] | None = None  # the report that set π

    async def start(self) -> None:
        asyncio.get_running_loop().create_task(self._loop())

    async def _measurements(self) -> list[tuple[str, float, float]]:
        out: list[tuple[str, float, float]] = []
        z = pi_from_news(self._news.latest)
        if z is not None:
            out.append(("news", z, R_NEWS))
        try:
            # a slow/dead market feed skips this tick, never stalls it
            brent = await asyncio.wait_for(self._market.brent_usd(), timeout=10)
            out.append(("market", pi_from_brent(brent), R_MARKET))
        except Exception:
            pass
        # TODO(vessel:) live AIS needs its own zone baseline; the fixed
        # baked baseline (9) would rail π_ais at 1.0 on real traffic
        if getattr(self._vessels, "mode", "baked") == "baked":
            z = pi_from_ships(getattr(self._vessels, "_fc", None))
            if z is not None:
                out.append(("ais", z, R_AIS))
        return out

    async def _loop(self) -> None:
        while True:
            self.p += Q  # predict
            comps: dict[str, float | None] = {"news": None, "market": None, "ais": None}
            for name, z, r in await self._measurements():
                self.x, self.p = kalman_update(self.x, self.p, z, r)
                comps[name] = round(z, 4)
            self.x = clamp01(self.x)
            self.components = comps

            # a REPORTED closure overrides the blend: the estimate exists to
            # infer severity from indirect signals, and there is nothing left
            # to infer once a source states the strait is shut.
            self.driver = None
            event = closure_from_news(self._news.latest)
            if event is not None:
                z, item = event
                self.x, self.p = z, 0.02
                self.driver = {
                    "kind": "closure_report",
                    "pi": z,
                    "headline": item.get("title"),
                    "source": item.get("source"),
                    "ts": item.get("ts"),
                }

            payload = json.dumps(self.snapshot())
            for q in self._subs:
                q.put_nowait(payload)
            await asyncio.sleep(TICK_S)

    def snapshot(self) -> dict[str, Any]:
        return {
            "pi_fused": round(self.x, 4),
            "confidence": round(clamp01(1 - self.p**0.5), 4),
            "components": self.components,
            "driver": self.driver,
        }

    async def stream(self) -> AsyncIterator[str]:
        q: asyncio.Queue = asyncio.Queue()
        self._subs.add(q)
        try:
            yield f"data: {json.dumps(self.snapshot())}\n\n"
            while True:
                try:
                    yield f"data: {await asyncio.wait_for(q.get(), timeout=25)}\n\n"
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
        finally:
            self._subs.discard(q)


if __name__ == "__main__":
    # self-check: constant measurement -> convergence, shrinking variance
    x, p = 0.0, 1.0
    for _ in range(50):
        p += Q
        x, p = kalman_update(x, p, 0.6, R_MARKET)
    assert abs(x - 0.6) < 0.01, x
    assert p < 0.01, p
    # news scorer: three severity-5 Hormuz items saturate to 1.0
    items = [{"tag": "Hormuz", "severity": 5}] * 3
    assert pi_from_news(items) == 1.0
    assert pi_from_news([]) is None
    # brent mapping: base -> 0, full shock -> 1
    assert pi_from_brent(80.0) == 0.0
    assert pi_from_brent(144.0) == 1.0

    # reported closures are read straight off the headline
    def _n(title, tag="Hormuz", ts="2026-07-17T10:00:00Z"):
        return {"title": title, "tag": tag, "severity": 5, "ts": ts, "source": "Reuters"}

    full = closure_from_news([_n("IRGC imposes complete closure of Strait of Hormuz")])
    assert full and full[0] == 1.0, full
    assert closure_from_news([_n("Iran closes the Strait of Hormuz")])[0] == 1.0
    assert closure_from_news([_n("Strait of Hormuz shut after strikes")])[0] == 1.0
    part = closure_from_news([_n("IRGC announces partial closure of Strait of Hormuz")])
    assert part and part[0] == 0.5, part
    assert closure_from_news([_n("Hormuz partially blocked by naval escorts")])[0] == 0.5

    # pressure/atmosphere must NOT be read as a closure — the model may not
    # invent an event from tension, drills, threats or commentary
    for benign in [
        "IRGC navy drills narrow tanker transit corridor in Strait of Hormuz",
        "Analysts warn Iran could close the Strait of Hormuz",
        "Iran threatens to close the Strait of Hormuz",
        "Iran may shut the Strait of Hormuz, says commander",
        "What a complete closure of Hormuz would mean for India",
        "Navy exercise simulates closure of the Strait of Hormuz",
    ]:
        assert closure_from_news([_n(benign)]) is None, benign
    assert closure_from_news([_n("Brent jumps on Gulf war-risk premiums", tag="fuel")]) is None
    assert closure_from_news([_n("Suez Canal blocked completely", tag="Suez")]) is None  # wrong corridor
    assert closure_from_news([]) is None

    # newest report wins
    two = closure_from_news([
        _n("IRGC announces partial closure of Strait of Hormuz", ts="2026-07-17T08:00:00Z"),
        _n("IRGC imposes complete closure of Strait of Hormuz", ts="2026-07-17T11:00:00Z"),
    ])
    assert two[0] == 1.0, two
    print("fusion OK")
