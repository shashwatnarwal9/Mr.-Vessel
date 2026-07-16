"""Every external service sits behind one of these interfaces.

Each has a baked impl (reads frontend/public JSON or static tables) and a
live impl that activates only when its key/endpoint is configured. A dead
API can therefore never break the demo. Live impls land in M10–M16; until
then they are declared but not constructed.
"""

import json
from typing import Any, Protocol

import httpx

from ..config import (
    AIS_API_KEY,
    BAKED_DIR,
    CHAT_MODEL,
    CUOPT_API_KEY,
    EMBED_MODEL,
    FUEL_PRICE_API_KEY,
    NVIDIA_API_KEY,
    NVIDIA_BASE_URL,
)


class LLMClient(Protocol):
    async def chat(self, prompt: str) -> str: ...
    async def embed(self, text: str) -> list[float]: ...


class ShipSource(Protocol):
    async def snapshot(self) -> dict[str, Any]: ...  # GeoJSON FeatureCollection


class NewsSource(Protocol):
    async def latest(self) -> list[dict[str, Any]]: ...


class MarketSource(Protocol):
    async def brent_usd(self) -> float: ...


class FuelPriceSource(Protocol):
    async def pump_inr(self) -> float: ...


class RouteOptimizer(Protocol):
    async def reroute_days(self, chokepoint: str) -> float: ...


def _baked(name: str) -> Any:
    return json.loads((BAKED_DIR / name).read_text(encoding="utf-8"))


class BakedShips:
    mode = "baked"

    async def snapshot(self) -> dict[str, Any]:
        return _baked("ships.json")


class BakedNews:
    mode = "baked"

    async def latest(self) -> list[dict[str, Any]]:
        return _baked("news.json")


class BakedMarket:
    mode = "baked"

    async def brent_usd(self) -> float:
        return 80.0  # cascade BASE.brentUsd


class LiveMarket:
    """yfinance Brent (BZ=F), interval-polled with a TTL cache. No key
    needed. Callers (fusion) treat exceptions as a skipped measurement."""

    mode = "live"
    TTL_S = 300

    def __init__(self) -> None:
        self._cache: tuple[float, float] | None = None  # (ts, price)

    async def brent_usd(self) -> float:
        import asyncio
        import time

        now = time.time()
        if self._cache and now - self._cache[0] < self.TTL_S:
            return self._cache[1]

        def fetch() -> float:
            import yfinance as yf

            return float(yf.Ticker("BZ=F").fast_info["last_price"])

        price = await asyncio.get_running_loop().run_in_executor(None, fetch)
        self._cache = (now, price)
        return price


class BakedFuel:
    mode = "baked"

    async def pump_inr(self) -> float:
        return 105.0  # cascade BASE.pumpInrPerL


class LiveFuel:
    """Indian API fuel prices (Delhi petrol). 100-request quota →
    aggressive 1h TTL cache; callers fall back to baked on failure."""

    mode = "live"
    TTL_S = 3600

    def __init__(self) -> None:
        self._http = httpx.AsyncClient(
            base_url="https://fuel.indianapi.in",
            headers={"x-api-key": FUEL_PRICE_API_KEY},
            timeout=30,
        )
        self._live: tuple[float, float] | None = None  # (ts, price)
        self._hist: tuple[float, list[dict[str, Any]]] | None = None

    async def pump_inr(self) -> float:
        import time

        now = time.time()
        if self._live and now - self._live[0] < self.TTL_S:
            return self._live[1]
        r = await self._http.get(
            "/live_fuel_price",
            params={"fuel_type": "petrol", "location_type": "state"},
        )
        r.raise_for_status()
        price = next(
            float(row["price"]) for row in r.json() if row["city"] == "Delhi"
        )
        self._live = (now, price)
        return price

    async def history(self) -> list[dict[str, Any]]:
        import time

        now = time.time()
        if self._hist and now - self._hist[0] < self.TTL_S:
            return self._hist[1]
        r = await self._http.get(
            "/historical_fuel_price",
            params={
                "fuel_type": "petrol",
                "location_type": "state",
                "location": "delhi",
            },
        )
        r.raise_for_status()
        series = [
            {"date": row["date"], "price": float(row["price"])} for row in r.json()
        ]
        self._hist = (now, series)
        return series


class BakedRouter:
    mode = "baked"
    # static added-days table; cuOpt (Red Sea only) upgrades this in M15
    _TABLE = {"hormuz": 14.0, "redsea": 9.5}

    async def reroute_days(self, chokepoint: str) -> float:
        return self._TABLE.get(chokepoint.lower(), 0.0)


class NvidiaLLM:
    """GLM-5.2 chat + bge-m3 embeddings over the OpenAI-compat endpoints."""

    mode = "live"

    def __init__(self) -> None:
        # reasoning model: long think phase before content → generous timeout
        self._http = httpx.AsyncClient(
            base_url=NVIDIA_BASE_URL,
            headers={"Authorization": f"Bearer {NVIDIA_API_KEY}"},
            timeout=httpx.Timeout(420, connect=10),  # GLM queue measured at ~262s
        )

    async def chat(self, prompt: str) -> str:
        # stream=True is required in practice: non-streaming buffers the whole
        # reasoning phase server-side and times out before headers arrive
        content: list[str] = []
        async with self._http.stream(
            "POST",
            "/chat/completions",
            json={
                "model": CHAT_MODEL,
                "messages": [{"role": "user", "content": prompt}],
                "temperature": 0,
                "max_tokens": 8192,
                "stream": True,
            },
        ) as r:
            r.raise_for_status()
            async for line in r.aiter_lines():
                if not line.startswith("data: ") or line == "data: [DONE]":
                    continue
                chunk = json.loads(line[6:])
                choices = chunk.get("choices") or []
                if not choices:
                    continue
                delta = choices[0].get("delta") or {}
                if delta.get("content"):
                    content.append(delta["content"])
        return "".join(content)

    async def embed(self, text: str) -> list[float]:
        r = await self._http.post(
            "/embeddings",
            json={"model": EMBED_MODEL, "input": [text], "input_type": "query"},
        )
        r.raise_for_status()
        return r.json()["data"][0]["embedding"]


class StubLLM:
    """No baked LLM: absent key -> feature reports unavailable, never faked."""

    mode = "unavailable"

    async def chat(self, prompt: str) -> str:
        raise RuntimeError("NVIDIA_API_KEY missing: LLM features disabled")

    async def embed(self, text: str) -> list[float]:
        raise RuntimeError("NVIDIA_API_KEY missing: embeddings disabled")


def build_clients() -> dict[str, Any]:
    """Pick live impl when its key exists, else baked."""
    from .aisstream import AisstreamShips
    from .cuopt import LiveCuOpt
    from .gdelt_news import GdeltGlmNews

    llm = NvidiaLLM() if NVIDIA_API_KEY else StubLLM()
    return {
        "llm": llm,
        "ships": AisstreamShips() if AIS_API_KEY else BakedShips(),
        "news": GdeltGlmNews(llm, BakedNews()) if NVIDIA_API_KEY else BakedNews(),
        "market": LiveMarket(),  # yfinance, no key; fusion skips on failure
        "fuel": LiveFuel() if FUEL_PRICE_API_KEY else BakedFuel(),
        "router": LiveCuOpt() if CUOPT_API_KEY else BakedRouter(),
    }


def key_status() -> dict[str, bool]:
    return {
        "AIS_API_KEY": bool(AIS_API_KEY),
        "NVIDIA_API_KEY": bool(NVIDIA_API_KEY),
        "CUOPT_API_KEY": bool(CUOPT_API_KEY),
        "FUEL_PRICE_API_KEY": bool(FUEL_PRICE_API_KEY),
    }


if __name__ == "__main__":
    # M10 smoke: real completion + real embedding, or fail loudly
    import asyncio

    async def smoke() -> None:
        llm = NvidiaLLM()
        reply = await llm.chat("Reply with exactly: OK")
        vec = await llm.embed("Strait of Hormuz tanker disruption")
        assert reply.strip(), "empty completion"
        assert len(vec) > 100 and isinstance(vec[0], float), "bad embedding"
        print(f"chat: {reply.strip()[:60]!r}")
        print(f"embedding: dim={len(vec)}, first={vec[0]:.5f}")

    asyncio.run(smoke())
    print("NVIDIA smoke OK")
