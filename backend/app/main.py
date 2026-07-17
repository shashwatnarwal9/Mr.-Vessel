from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from fastapi.responses import StreamingResponse

from .clients.registry import build_clients, key_status
from .config import CORS_ORIGINS
from .fusion import FusionEngine
from .news_feed import NewsFeed
from .vessels import VesselManager

clients = build_clients()
vessels = VesselManager(clients["ships"])
news = NewsFeed(clients["news"])
fusion = FusionEngine(clients["market"], news, vessels)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await vessels.start()
    await news.start()
    await fusion.start()
    yield


app = FastAPI(title="Mr. Vessel API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
async def health():
    return {
        "status": "ok",
        "clients": {name: c.mode for name, c in clients.items()},
        "keys": key_status(),
    }


@app.get("/market/brent")
async def market_brent():
    try:
        return {"brent_usd": await clients["market"].brent_usd(), "mode": "live"}
    except Exception:
        return {"brent_usd": 80.0, "mode": "baked"}


@app.post("/route/solve")
async def route_solve(body: dict):
    """M6d: cuOpt-verify a route cost over the client's waypoint matrix."""
    solve = getattr(clients["router"], "solve_matrix", None)
    if not solve:
        return {"cost": None, "mode": "unavailable"}
    try:
        cost = await solve(body["matrix"], int(body["src"]), int(body["dst"]))
        return {"cost": cost, "mode": "live"}
    except Exception:
        return {"cost": None, "mode": "unavailable"}


@app.get("/rag/analogs")
async def rag_analogs(desc: str):
    from . import rag

    try:
        return {"scores": await rag.semantic_scores(clients["llm"], desc)}
    except Exception:
        return {"scores": {}}  # client keeps its numeric-only ranking


@app.post("/rag/narrate")
async def rag_narrate(body: dict):
    from . import rag

    try:
        text = await rag.narrate(
            clients["llm"], body.get("model", {}), body.get("episodes", [])
        )
        return {"text": text}  # null = guard rejected or unavailable
    except Exception:
        return {"text": None}


@app.post("/scenario/parse")
async def scenario_parse(body: dict):
    """War Cabinet: free-text crisis -> baseline disruption channels (σ), never raises."""
    from . import scenario_parse as sp

    return await sp.parse_scenario(str(body.get("prompt", "")), clients["llm"])


@app.post("/cabinet/minister")
async def cabinet_minister(body: dict, role: str = "fm"):
    """Stream a minister's POV + PolicyLevers (role: fm | dm)."""
    from . import cabinet

    if role not in ("fm", "dm"):
        role = "fm"
    stream = cabinet.stream_minister(role, str(body.get("crisis", "")), body.get("baseline_facts", {}))
    return StreamingResponse(stream, media_type="text/event-stream")


@app.post("/cabinet/pm")
async def cabinet_pm(body: dict):
    """Stream the PM's verdict + final PolicyLevers (runs on its own model/key)."""
    from . import cabinet

    stream = cabinet.stream_pm(
        str(body.get("crisis", "")), body.get("baseline_facts", {}),
        body.get("fm", {}), body.get("dm", {}),
    )
    return StreamingResponse(stream, media_type="text/event-stream")


@app.get("/market/pump")
async def market_pump():
    try:
        return {
            "pump_inr": await clients["fuel"].pump_inr(),
            "mode": clients["fuel"].mode,
        }
    except Exception:
        return {"pump_inr": 105.0, "mode": "baked"}


@app.get("/market/pump/history")
async def market_pump_history():
    hist = getattr(clients["fuel"], "history", None)
    try:
        return {
            "series": await hist() if hist else [],
            "mode": clients["fuel"].mode if hist else "baked",
        }
    except Exception:
        return {"series": [], "mode": "baked"}


@app.get("/kg/cascade")
def kg_cascade(chokepoint: str = "Hormuz"):
    from . import kg

    return kg.cascade(chokepoint)


@app.get("/sse/news")
async def sse_news():
    return StreamingResponse(news.stream(), media_type="text/event-stream")


@app.get("/sse/pi")
async def sse_pi():
    return StreamingResponse(fusion.stream(), media_type="text/event-stream")


@app.websocket("/ws/ships")
async def ws_ships(ws: WebSocket):
    await ws.accept()
    await vessels.attach(ws)
    try:
        while True:
            await ws.receive_text()  # keepalive; we only push
    except WebSocketDisconnect:
        vessels.detach(ws)
