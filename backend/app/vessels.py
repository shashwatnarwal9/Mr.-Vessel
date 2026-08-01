"""VesselManager: single owner of ship state.

Baked source: fixed 45-ship snapshot, dead-reckoned forever.
Live source (aisstream): fleet dict fed by real AIS fixes; dead
reckoning advances each vessel between fixes. Both broadcast the same
GeoJSON to /ws/ships every tick.
"""

import asyncio
import json
import math
import time
from typing import Any

TICK_S = 2.0
STALE_S = 30 * 60  # drop live vessels not heard from in 30 min
MAX_FLEET = 400  # newest-N cap; spatial index if the fleet outgrows it

# European receivers are dense and update constantly (East Med 231, Black Sea
# 73) while the Gulf sees almost nothing, so oldest-first eviction threw away
# the rare corridor fix. These are evicted last.
CORRIDOR_BOXES = [
    (6, 66, 37, 98),  # India + approaches
    (12, 32, 31, 44),  # Red Sea / Suez / Bab-el-Mandeb
    (22, 46, 31, 60),  # Persian Gulf load ports
]


def in_corridor(lon: float, lat: float) -> bool:
    return any(
        lat0 <= lat <= lat1 and lon0 <= lon <= lon1
        for lat0, lon0, lat1, lon1 in CORRIDOR_BOXES
    )


def dead_reckon(feature: dict[str, Any], dt_s: float) -> None:
    """Advance one GeoJSON ship feature along course at speed (in place)."""
    p = feature["properties"]
    lon, lat = feature["geometry"]["coordinates"]
    dist_nm = p["speed"] * (dt_s / 3600.0)
    rad = math.radians(p["course"])
    dlat = (dist_nm * math.cos(rad)) / 60.0
    coslat = math.cos(math.radians(lat)) or 1e-9
    dlon = (dist_nm * math.sin(rad)) / (60.0 * coslat)
    feature["geometry"]["coordinates"] = [lon + dlon, lat + dlat]


class VesselManager:
    def __init__(self, source: Any) -> None:
        self._source = source
        self.mode = getattr(source, "mode", "baked")
        self._fleet: dict[int, dict[str, Any]] = {}
        self._seen: dict[int, float] = {}
        self._baked_ids: set[int] = set()  # base layer — never evicted
        self._clients: set[Any] = set()  # WebSocket connections

    @property
    def fc(self) -> dict[str, Any]:
        return {"type": "FeatureCollection", "features": list(self._fleet.values())}

    # kept for fusion.py's π_ais reader
    @property
    def _fc(self) -> dict[str, Any]:
        return self.fc

    async def start(self) -> None:
        snap = await self._source.snapshot()
        now = time.time()
        for f in snap["features"]:
            m = f["properties"]["mmsi"]
            self._fleet[m] = f
            self._seen[m] = now
            self._baked_ids.add(m)
        loop = asyncio.get_running_loop()
        loop.create_task(self._tick_loop())
        if hasattr(self._source, "stream"):
            loop.create_task(self._source.stream(self.apply))

    def apply(self, mmsi: int, update: dict[str, Any]) -> None:
        """Merge one AIS fragment (position and/or static) into the fleet."""
        f = self._fleet.get(mmsi)
        if f is None:
            f = {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [0.0, 0.0]},
                "properties": {
                    "mmsi": mmsi,
                    "name": f"MMSI {mmsi}",
                    "type": "Vessel",
                    "course": 0,
                    "speed": 0,
                    "dest": "—",
                },
            }
            self._fleet[mmsi] = f
        coords = update.pop("coordinates", None)
        if coords:
            f["geometry"]["coordinates"] = coords
        f["properties"].update(update)
        self._seen[mmsi] = time.time()

    def _evict(self) -> None:
        if self.mode != "live":
            return
        now = time.time()
        # only stream-fed vessels age out; the baked base layer stays
        stale = [
            m
            for m, t in self._seen.items()
            if now - t > STALE_S and m not in self._baked_ids
        ]
        for m in stale:
            self._fleet.pop(m, None)
            self._seen.pop(m, None)
        if len(self._fleet) > MAX_FLEET:
            evictable = [
                (m, t) for m, t in self._seen.items() if m not in self._baked_ids
            ]
            # corridor vessels last: sort non-corridor first, then oldest-seen
            def rank(kv: tuple[int, float]) -> tuple[bool, float]:
                f = self._fleet.get(kv[0])
                lon, lat = f["geometry"]["coordinates"] if f else (0.0, 0.0)
                return (in_corridor(lon, lat), kv[1])

            for m, _ in sorted(evictable, key=rank)[
                : len(self._fleet) - MAX_FLEET
            ]:
                self._fleet.pop(m, None)
                self._seen.pop(m, None)

    async def _tick_loop(self) -> None:
        while True:
            await asyncio.sleep(TICK_S)
            for f in self._fleet.values():
                dead_reckon(f, TICK_S)
            self._evict()
            await self._broadcast()

    async def _broadcast(self) -> None:
        if not self._clients:
            return
        msg = json.dumps(self.fc)
        dead = set()
        for ws in self._clients:
            try:
                await ws.send_text(msg)
            except Exception:
                dead.add(ws)
        self._clients -= dead

    async def attach(self, ws: Any) -> None:
        self._clients.add(ws)
        await ws.send_text(json.dumps(self.fc))

    def detach(self, ws: Any) -> None:
        self._clients.discard(ws)


if __name__ == "__main__":
    # self-check: 60 kn due north for 60 s = 1 nm = 1/60 deg lat
    f = {
        "properties": {"speed": 60.0, "course": 0.0},
        "geometry": {"coordinates": [70.0, 20.0]},
    }
    dead_reckon(f, 60.0)
    lon, lat = f["geometry"]["coordinates"]
    assert abs(lat - (20.0 + 1 / 60)) < 1e-9, lat
    assert abs(lon - 70.0) < 1e-9, lon
    f = {
        "properties": {"speed": 60.0, "course": 90.0},
        "geometry": {"coordinates": [70.0, 20.0]},
    }
    dead_reckon(f, 60.0)
    lon, lat = f["geometry"]["coordinates"]
    assert abs(lat - 20.0) < 1e-9, lat
    assert abs(lon - (70.0 + 1 / (60 * math.cos(math.radians(20.0))))) < 1e-9

    # self-check: apply() merges position then static without losing either
    class _S:
        mode = "live"

    vm = VesselManager(_S())
    vm.apply(1, {"coordinates": [56.5, 26.5], "name": "T", "course": 90, "speed": 12})
    vm.apply(1, {"type": "Tanker", "dest": "SIKKA"})
    p = vm._fleet[1]["properties"]
    assert p["type"] == "Tanker" and p["speed"] == 12 and p["dest"] == "SIKKA"
    assert vm._fleet[1]["geometry"]["coordinates"] == [56.5, 26.5]

    # self-check: stale eviction spares the baked base layer
    vm2 = VesselManager(_S())
    vm2.apply(100, {"coordinates": [56.0, 26.0]})  # stream-fed
    vm2._fleet[200] = {"geometry": {"coordinates": [70.0, 20.0]}, "properties": {}}
    vm2._seen[200] = time.time()
    vm2._baked_ids.add(200)  # baked
    old = time.time() - STALE_S - 1
    vm2._seen[100] = old
    vm2._seen[200] = old
    vm2._evict()
    assert 100 not in vm2._fleet, "stale live vessel should evict"
    assert 200 in vm2._fleet, "baked vessel must never evict"
    # corridor vessels survive the cap: dense European traffic must not evict
    # the rare Gulf/India fix this product exists to show
    assert in_corridor(56.5, 26.4)      # Strait of Hormuz
    assert in_corridor(72.0, 20.0)      # Arabian Sea, India approach
    assert in_corridor(43.4, 12.6)      # Bab-el-Mandeb
    assert not in_corridor(33.0, 34.7)  # Limassol, Cyprus (East Med)
    assert not in_corridor(27.9, 43.2)  # Varna, Black Sea
    print("vessels OK")
