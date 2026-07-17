"""cuOpt (NVIDIA managed) reroute solver — Red Sea branch only, per spec.

Cost-matrix payload, NOT chat: nodes are route waypoints, weights are
travel-days from great-circle distance; closing a chokepoint removes its
edge. cuOpt picks the min-cost path; added_days = alternative − normal.
Static table remains the fallback for any failure.
"""

import asyncio
import math
from typing import Any

import httpx

from ..config import CUOPT_API_KEY

CUOPT_URL = "https://optimize.api.nvidia.com/v1/nvidia/cuopt"
STATUS_URL = "https://optimize.api.nvidia.com/v1/status/"

NM_PER_DAY = 13.5 * 24

# [lon, lat] — mirrors frontend reroute.ts
PTS = {
    "NOVO": (37.8, 44.7),
    "SUEZ": (32.55, 29.97),
    "BAB": (43.4, 12.6),
    "GIB": (-5.6, 35.95),
    "MIDATL": (-30.0, -5.0),
    "CAPE": (18.47, -34.83),
    "SIKKA": (69.83, 22.43),
}
NODES = list(PTS)
# sea legs only; BAB→SIKKA and SUEZ→BAB are the Red Sea corridor
EDGES = [
    ("NOVO", "SUEZ"), ("SUEZ", "BAB"), ("BAB", "SIKKA"),
    ("NOVO", "GIB"), ("GIB", "MIDATL"), ("MIDATL", "CAPE"), ("CAPE", "SIKKA"),
]
BLOCKED = 10_000.0  # closed edge


def _days(a: str, b: str) -> float:
    (lon1, lat1), (lon2, lat2) = PTS[a], PTS[b]
    r = math.radians
    h = (
        math.sin(r(lat2 - lat1) / 2) ** 2
        + math.cos(r(lat1)) * math.cos(r(lat2)) * math.sin(r(lon2 - lon1) / 2) ** 2
    )
    return 2 * 3440.065 * math.asin(math.sqrt(h)) / NM_PER_DAY


def cost_matrix(closed: set[tuple[str, str]] = frozenset()) -> list[list[float]]:
    n = len(NODES)
    m = [[BLOCKED] * n for _ in range(n)]
    for i in range(n):
        m[i][i] = 0.0
    for a, b in EDGES:
        w = BLOCKED if (a, b) in closed or (b, a) in closed else _days(a, b)
        i, j = NODES.index(a), NODES.index(b)
        m[i][j] = m[j][i] = w
    return m


def _shortest(m: list[list[float]], src: int, dst: int) -> float:
    # Dijkstra on the tiny graph — the local truth cuOpt must reproduce
    import heapq

    dist = [float("inf")] * len(m)
    dist[src] = 0.0
    pq = [(0.0, src)]
    while pq:
        d, u = heapq.heappop(pq)
        if u == dst:
            return d
        if d > dist[u]:
            continue
        for v, w in enumerate(m[u]):
            if w < BLOCKED and dist[u] + w < dist[v]:
                dist[v] = dist[u] + w
                heapq.heappush(pq, (dist[v], v))
    return dist[dst]


class LiveCuOpt:
    """Red Sea reroute via cuOpt; static/local for everything else."""

    mode = "live"
    _STATIC = {"hormuz": 14.0}

    async def solve_matrix(
        self, matrix: list[list[float]], src: int, dst: int
    ) -> float:
        """Generic one-vehicle route cost over an all-pairs cost matrix.
        Used by the Red Sea branch AND the Ship Simulator (M6d)."""
        payload = {
            "action": "cuOpt_OptimizedRouting",
            "data": {
                "cost_matrix_data": {"data": {"0": matrix}},
                "fleet_data": {"vehicle_locations": [[src, dst]]},
                "task_data": {"task_locations": [dst]},
            },
        }
        async with httpx.AsyncClient(
            timeout=60,
            headers={"Authorization": f"Bearer {CUOPT_API_KEY}"},
        ) as http:
            r = await http.post(CUOPT_URL, json=payload)
            body: dict[str, Any] = r.json() if r.content else {}
            # async pattern: 202 + reqId → poll
            req_id = (r.headers.get("NVCF-REQID") or body.get("reqId") or "").strip()
            while r.status_code == 202 and req_id:
                await asyncio.sleep(1)
                r = await http.get(STATUS_URL + req_id)
                body = r.json() if r.content else {}
            r.raise_for_status()
            return float(body["response"]["solver_response"]["solution_cost"])

    async def reroute_days(self, chokepoint: str) -> float:
        cp = chokepoint.lower()
        if cp != "redsea":
            return self._STATIC.get(cp, 0.0)
        src, dst = NODES.index("NOVO"), NODES.index("SIKKA")
        normal = _shortest(cost_matrix(), src, dst)
        # cuOpt expects direct travel costs between stops (complete graph),
        # so feed it all-pairs shortest-path days under the closure
        closed = cost_matrix({("SUEZ", "BAB")})
        n = len(NODES)
        apsp = [[_shortest(closed, i, j) for j in range(n)] for i in range(n)]
        cost = await self.solve_matrix(apsp, src, dst)
        return max(0.0, cost - normal)


if __name__ == "__main__":
    # local truth: Cape detour minus Suez route from the same matrix
    src, dst = NODES.index("NOVO"), NODES.index("SIKKA")
    normal = _shortest(cost_matrix(), src, dst)
    closed = _shortest(cost_matrix({("SUEZ", "BAB")}), src, dst)
    added = closed - normal
    print(f"local: normal={normal:.1f}d via-Cape={closed:.1f}d added={added:.1f}d")
    assert 10 < added < 35, added
    print("cuopt local graph OK")
