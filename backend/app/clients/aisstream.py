"""Live AIS: aisstream.io WebSocket → per-vessel GeoJSON fragments.

PositionReport gives fix/course/speed; ShipStaticData fills type and
destination when it arrives. Reconnects forever; a dead feed just means
the fleet stops updating (VesselManager keeps dead-reckoning the last
known fixes, and the frontend can't tell the difference).
"""

import asyncio
import json
from typing import Any, Callable

from ..config import AIS_API_KEY, BAKED_DIR

WS_URL = "wss://stream.aisstream.io/v0/stream"

# theater per spec (M16): India, Red Sea/Bab-el-Mandeb/Suez, East Med
# format verified live: [[lat_min, lon_min], [lat_max, lon_max]]
BBOXES = [
    [[6, 66], [37, 98]],  # India + approaches
    [[12, 32], [31, 44]],  # Red Sea / Suez
    [[31, 32], [37, 36]],  # East Med
    [[22, 46], [31, 60]],  # Persian Gulf load ports (Ras Tanura, Basra, Kharg)
    [[41, 27], [47, 42]],  # Black Sea (Novorossiysk)
    [[2, 4], [8, 10]],  # Gulf of Guinea (Bonny)
]


def _ship_type(code: int) -> str:
    if 80 <= code <= 89:
        return "Tanker"
    if 70 <= code <= 79:
        return "Cargo"
    return "Vessel"


class AisstreamShips:
    mode = "live"

    async def snapshot(self) -> dict[str, Any]:
        # TODO(vessel:) aisstream's volunteer receivers have ~zero Gulf/
        # Arabian Sea coverage (verified: Europe streams, our bbox silent).
        # Baked fleet is the base layer; real AIS fixes merge in over it
        # by MMSI whenever regional coverage exists.
        return json.loads((BAKED_DIR / "ships.json").read_text(encoding="utf-8"))

    async def stream(self, apply: Callable[[int, dict[str, Any]], None]) -> None:
        import websockets  # bundled with uvicorn[standard]

        while True:
            try:
                async with websockets.connect(WS_URL) as ws:
                    await ws.send(
                        json.dumps(
                            {
                                "APIKey": AIS_API_KEY,
                                "BoundingBoxes": BBOXES,
                                "FilterMessageTypes": [
                                    "PositionReport",
                                    "ShipStaticData",
                                ],
                            }
                        )
                    )
                    async for raw in ws:
                        msg = json.loads(raw)
                        meta = msg.get("MetaData", {})
                        mmsi = meta.get("MMSI")
                        if not mmsi:
                            continue
                        if msg.get("MessageType") == "PositionReport":
                            p = msg["Message"]["PositionReport"]
                            apply(
                                mmsi,
                                {
                                    "coordinates": [p["Longitude"], p["Latitude"]],
                                    "name": (meta.get("ShipName") or "").strip()
                                    or f"MMSI {mmsi}",
                                    "course": p.get("Cog") or 0,
                                    "speed": p.get("Sog") or 0,
                                },
                            )
                        elif msg.get("MessageType") == "ShipStaticData":
                            s = msg["Message"]["ShipStaticData"]
                            update = {
                                "type": _ship_type(s.get("Type") or 0),
                                "dest": (s.get("Destination") or "").strip()
                                or "—",
                            }
                            if s.get("ImoNumber"):
                                update["imo"] = s["ImoNumber"]  # sanctions join key
                            apply(mmsi, update)
            except Exception:
                await asyncio.sleep(5)  # reconnect backoff
