"""π fusion: 1-D Kalman filter over three disruption signals.

State x = fused Hormuz disruption severity π. Each tick: predict
(process noise Q), then sequential measurement updates for whichever
signals are available. Confidence = 1 − √P (posterior std).
"""

import asyncio
import json
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
            payload = json.dumps(self.snapshot())
            for q in self._subs:
                q.put_nowait(payload)
            await asyncio.sleep(TICK_S)

    def snapshot(self) -> dict[str, Any]:
        return {
            "pi_fused": round(self.x, 4),
            "confidence": round(clamp01(1 - self.p**0.5), 4),
            "components": self.components,
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
    print("fusion OK")
