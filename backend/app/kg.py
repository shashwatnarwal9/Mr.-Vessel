"""Knowledge graph: supplier→chokepoint→port→refinery→product→sector.

One dataset (EDGES below). Neo4j is seeded from it and the cascade
endpoint traverses the real graph; if Neo4j is unreachable the same
EDGES are BFS-traversed in Python — identical answer, demo never breaks.
"""

import os
import time
from collections import deque
from typing import Any

from neo4j import GraphDatabase

NEO4J_URI = os.getenv("NEO4J_URI", "bolt://localhost:7687")
NEO4J_USER = os.getenv("NEO4J_USER", "neo4j")
NEO4J_PASSWORD = os.getenv("NEO4J_PASSWORD", "vesselpass")  # local-dev default

# (src_label, src_name, rel, dst_label, dst_name) — code-owned constants
EDGES: list[tuple[str, str, str, str, str]] = [
    ("Supplier", "Saudi Arabia", "SHIPS_VIA", "Chokepoint", "Hormuz"),
    ("Supplier", "Iraq", "SHIPS_VIA", "Chokepoint", "Hormuz"),
    ("Supplier", "UAE", "SHIPS_VIA", "Chokepoint", "Hormuz"),
    ("Supplier", "Kuwait", "SHIPS_VIA", "Chokepoint", "Hormuz"),
    ("Supplier", "Qatar", "SHIPS_VIA", "Chokepoint", "Hormuz"),
    ("Supplier", "Russia", "SHIPS_VIA", "Chokepoint", "Suez"),
    ("Chokepoint", "Suez", "FEEDS", "Chokepoint", "Red Sea"),  # canal → corridor
    ("Supplier", "Russia", "SHIPS_VIA", "Chokepoint", "Red Sea"),
    ("Chokepoint", "Hormuz", "FEEDS", "Port", "Vadinar"),
    ("Chokepoint", "Hormuz", "FEEDS", "Port", "Sikka"),
    ("Chokepoint", "Hormuz", "FEEDS", "Port", "Mumbai"),
    ("Chokepoint", "Hormuz", "FEEDS", "Port", "New Mangalore"),
    ("Chokepoint", "Red Sea", "FEEDS", "Port", "Vadinar"),
    ("Chokepoint", "Red Sea", "FEEDS", "Port", "Sikka"),
    ("Chokepoint", "Red Sea", "FEEDS", "Port", "Kochi"),
    ("Port", "Vadinar", "SUPPLIES", "Refinery", "Nayara Vadinar"),
    ("Port", "Sikka", "SUPPLIES", "Refinery", "RIL Jamnagar"),
    ("Port", "Mumbai", "SUPPLIES", "Refinery", "BPCL Mumbai"),
    ("Port", "New Mangalore", "SUPPLIES", "Refinery", "MRPL Mangalore"),
    ("Port", "Kochi", "SUPPLIES", "Refinery", "BPCL Kochi"),
    ("Refinery", "RIL Jamnagar", "PRODUCES", "Product", "Petrol"),
    ("Refinery", "RIL Jamnagar", "PRODUCES", "Product", "Diesel"),
    ("Refinery", "RIL Jamnagar", "PRODUCES", "Product", "ATF"),
    ("Refinery", "Nayara Vadinar", "PRODUCES", "Product", "Petrol"),
    ("Refinery", "Nayara Vadinar", "PRODUCES", "Product", "Diesel"),
    ("Refinery", "BPCL Mumbai", "PRODUCES", "Product", "LPG"),
    ("Refinery", "BPCL Mumbai", "PRODUCES", "Product", "Diesel"),
    ("Refinery", "MRPL Mangalore", "PRODUCES", "Product", "Naphtha"),
    ("Refinery", "BPCL Kochi", "PRODUCES", "Product", "LPG"),
    ("Product", "Petrol", "DRIVES", "Sector", "Transport"),
    ("Product", "Diesel", "DRIVES", "Sector", "Transport"),
    ("Product", "Diesel", "DRIVES", "Sector", "Agriculture"),
    ("Product", "Diesel", "DRIVES", "Sector", "Power"),
    ("Product", "ATF", "DRIVES", "Sector", "Aviation"),
    ("Product", "LPG", "DRIVES", "Sector", "Households"),
    ("Product", "Naphtha", "DRIVES", "Sector", "Industry"),
]

_driver = None
_neo4j_down_until = 0.0  # after a failure, skip Neo4j for a cooldown window


def driver():
    global _driver
    if _driver is None:
        _driver = GraphDatabase.driver(
            NEO4J_URI,
            auth=(NEO4J_USER, NEO4J_PASSWORD),
            connection_timeout=2.0,  # fail fast — baked fallback is instant
        )
    return _driver


def seed() -> int:
    """Idempotent MERGE of the whole chain. Returns edge count."""
    with driver().session() as s:
        for sl, sn, rel, dl, dn in EDGES:
            s.run(
                f"MERGE (a:{sl} {{name: $sn}}) "
                f"MERGE (b:{dl} {{name: $dn}}) "
                f"MERGE (a)-[:{rel}]->(b)",
                sn=sn,
                dn=dn,
            )
        return len(EDGES)


def _graph_payload(edges: list[tuple[str, str, str, str, str]], mode: str) -> dict[str, Any]:
    nodes: dict[str, dict[str, str]] = {}
    links = []
    for sl, sn, rel, dl, dn in edges:
        nodes[f"{sl}:{sn}"] = {"id": f"{sl}:{sn}", "name": sn, "layer": sl}
        nodes[f"{dl}:{dn}"] = {"id": f"{dl}:{dn}", "name": dn, "layer": dl}
        links.append({"source": f"{sl}:{sn}", "rel": rel, "target": f"{dl}:{dn}"})
    return {"nodes": list(nodes.values()), "links": links, "mode": mode}


def _baked_cascade(chokepoint: str) -> dict[str, Any]:
    """BFS the same EDGES in Python — identical result to the live query."""
    hit = [e for e in EDGES if e[2] == "SHIPS_VIA" and e[4] == chokepoint]
    seen = {("Chokepoint", chokepoint)}
    queue = deque([("Chokepoint", chokepoint)])
    while queue:
        cur = queue.popleft()
        for e in EDGES:
            if (e[0], e[1]) == cur and e[2] != "SHIPS_VIA":
                hit.append(e)
                if (e[3], e[4]) not in seen:
                    seen.add((e[3], e[4]))
                    queue.append((e[3], e[4]))
    # dedupe, preserve order
    uniq = list(dict.fromkeys(hit))
    return _graph_payload(uniq, "baked")


def cascade(chokepoint: str) -> dict[str, Any]:
    """Downstream cascade + feeding suppliers for one chokepoint."""
    global _neo4j_down_until
    if time.monotonic() < _neo4j_down_until:
        return _baked_cascade(chokepoint)
    try:
        with driver().session() as s:
            rows = s.run(
                "MATCH (sup:Supplier)-[r:SHIPS_VIA]->(c:Chokepoint {name: $n}) "
                "RETURN 'Supplier' AS sl, sup.name AS sn, type(r) AS rel, "
                "       'Chokepoint' AS dl, c.name AS dn "
                "UNION "
                "MATCH p = (c:Chokepoint {name: $n})"
                "-[:FEEDS|SUPPLIES|PRODUCES|DRIVES*1..4]->() "
                "UNWIND relationships(p) AS r "
                "WITH DISTINCT r "
                "RETURN labels(startNode(r))[0] AS sl, startNode(r).name AS sn, "
                "       type(r) AS rel, labels(endNode(r))[0] AS dl, "
                "       endNode(r).name AS dn",
                n=chokepoint,
            )
            edges = [(r["sl"], r["sn"], r["rel"], r["dl"], r["dn"]) for r in rows]
        if not edges:
            return _baked_cascade(chokepoint)
        return _graph_payload(edges, "live")
    except Exception:
        # don't re-pay the connection timeout on every call while Neo4j is down
        _neo4j_down_until = time.monotonic() + 300
        return _baked_cascade(chokepoint)


if __name__ == "__main__":
    n = seed()
    print(f"seeded {n} edges")
    live = cascade("Hormuz")
    baked = _baked_cascade("Hormuz")
    assert live["mode"] == "live", "expected live traversal after seed"
    assert {n["id"] for n in live["nodes"]} == {n["id"] for n in baked["nodes"]}, (
        "live and baked cascades disagree"
    )
    print(f"cascade OK: {len(live['nodes'])} nodes, {len(live['links'])} links, live==baked")
