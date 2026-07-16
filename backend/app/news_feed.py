"""NewsFeed: poll the NewsSource, push changes to SSE subscribers.

Baked source never changes → subscribers get the initial batch plus
keepalives. GDELT+GLM live source (M12, needs NVIDIA_API_KEY) drops in
behind the same interface.
"""

import asyncio
import json
from typing import Any, AsyncIterator

POLL_S = 300  # GLM tagging can take minutes; never stack poll calls
KEEPALIVE_S = 25


class NewsFeed:
    def __init__(self, source: Any) -> None:
        self._source = source
        self._subs: set[asyncio.Queue] = set()
        self._latest: list[dict[str, Any]] = []

    async def start(self) -> None:
        # boot instantly from the fallback; the poll loop brings live items
        # (GLM tagging can take minutes — never on the boot path)
        fb = getattr(self._source, "fallback", None)
        self._latest = await (fb or self._source).latest()
        asyncio.get_running_loop().create_task(self._poll_loop())

    async def _poll_loop(self) -> None:
        while True:
            try:
                items = await self._source.latest()
                if items != self._latest:
                    self._latest = items
                    for q in self._subs:
                        q.put_nowait(items)
            except Exception:
                pass  # dead source never kills the feed
            await asyncio.sleep(POLL_S)

    @property
    def latest(self) -> list[dict[str, Any]]:
        return self._latest

    async def stream(self) -> AsyncIterator[str]:
        q: asyncio.Queue = asyncio.Queue()
        self._subs.add(q)
        try:
            yield f"data: {json.dumps(self._latest)}\n\n"
            while True:
                try:
                    items = await asyncio.wait_for(q.get(), timeout=KEEPALIVE_S)
                    yield f"data: {json.dumps(items)}\n\n"
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
        finally:
            self._subs.discard(q)
