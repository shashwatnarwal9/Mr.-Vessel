"""NewsFeed: poll the NewsSource, push changes to SSE subscribers.

Baked source never changes → subscribers get the initial batch plus
keepalives. GDELT+GLM live source (M12, needs NVIDIA_API_KEY) drops in
behind the same interface.
"""

import asyncio
import json
from typing import Any, AsyncIterator

POLL_S = 300  # GLM tagging can take minutes; never stack poll calls
# A GDELT 429 shouldn't cost a whole poll cycle — but retry gently: its
# throttle is a rolling per-IP window, so hammering keeps you inside it.
RETRY_S = 90
KEEPALIVE_S = 25


class NewsFeed:
    def __init__(self, source: Any) -> None:
        self._source = source
        self._subs: set[asyncio.Queue] = set()
        self._latest: list[dict[str, Any]] = []
        # honesty label: is the rail showing real fetched headlines, or the
        # dated snapshot? "15 JUL" on a 17 JUL demo must explain itself.
        self.mode: str = "snapshot"

    def _payload(self) -> dict[str, Any]:
        return {"items": self._latest, "mode": self.mode}

    async def start(self) -> None:
        # boot instantly (GLM tagging can take minutes — never on the boot
        # path). Prefer the last LIVE batch cached from a previous run: the
        # baked snapshot is dated, so booting on it makes a fresh launch look
        # days stale until the first poll lands.
        cached = getattr(self._source, "last_live", None)
        if cached:
            self._latest, self.mode = cached, "live"
        else:
            fb = getattr(self._source, "fallback", None)
            self._latest, self.mode = await (fb or self._source).latest(), "snapshot"
        asyncio.get_running_loop().create_task(self._poll_loop())

    async def _poll_loop(self) -> None:
        while True:
            got_live = False
            try:
                items = await self._source.latest()
                live = getattr(self._source, "last_live", None)
                got_live = bool(live) and items == live
                if items != self._latest or got_live != (self.mode == "live"):
                    self._latest = items
                    self.mode = "live" if got_live else "snapshot"
                    payload = self._payload()
                    for q in self._subs:
                        q.put_nowait(payload)
            except Exception:
                pass  # dead source never kills the feed
            # throttled/failed poll → come back sooner than the full cycle
            await asyncio.sleep(POLL_S if got_live else RETRY_S)

    @property
    def latest(self) -> list[dict[str, Any]]:
        return self._latest

    async def stream(self) -> AsyncIterator[str]:
        q: asyncio.Queue = asyncio.Queue()
        self._subs.add(q)
        try:
            yield f"data: {json.dumps(self._payload())}\n\n"
            while True:
                try:
                    payload = await asyncio.wait_for(q.get(), timeout=KEEPALIVE_S)
                    yield f"data: {json.dumps(payload)}\n\n"
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
        finally:
            self._subs.discard(q)
