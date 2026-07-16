"""Historical-analog RAG (M9b).

Corpus: frontend/public/history_corpus.json (shared with the client's
numeric retrieval). This module adds the key-ON enrichments:
  build   — embed each episode summary once with bge-m3, bake to disk
  analogs — embed a scenario description, return semantic scores by id
  narrate — GLM writes a grounded paragraph from retrieved FACTS only,
            enforced by a numeric anti-hallucination guard (IMMUTABLE:
            any number not present in the supplied facts discards the
            whole narration; the client falls back to the template).
"""

import json
import math
import re
from pathlib import Path
from typing import Any

from .config import BAKED_DIR

CORPUS_PATH = BAKED_DIR / "history_corpus.json"
EMB_PATH = Path(__file__).parent / "history_embeddings.json"


def load_corpus() -> list[dict[str, Any]]:
    return json.loads(CORPUS_PATH.read_text(encoding="utf-8"))


def load_embeddings() -> dict[str, list[float]]:
    if not EMB_PATH.exists():
        return {}
    return json.loads(EMB_PATH.read_text(encoding="utf-8"))


def cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(x * x for x in b))
    return 0.0 if na == 0 or nb == 0 else dot / (na * nb)


async def build_embeddings(llm: Any) -> int:
    """Run once at build time: bge-m3 over each episode summary."""
    out: dict[str, list[float]] = {}
    for e in load_corpus():
        text = f"{e['name']} ({e['year']}): {e['cause']}. {e['summary']}"
        out[e["id"]] = await llm.embed(text)
    EMB_PATH.write_text(json.dumps(out), encoding="utf-8")
    return len(out)


async def semantic_scores(llm: Any, description: str) -> dict[str, float]:
    """Scenario description → cosine vs baked episode embeddings (0..1)."""
    baked = load_embeddings()
    if not baked:
        return {}
    q = await llm.embed(description)
    return {eid: round((cosine(q, v) + 1) / 2, 4) for eid, v in baked.items()}


# ---------- anti-hallucination guard (IMMUTABLE) ----------

_NUM_RE = re.compile(r"-?\d+(?:[.,]\d+)?")


def _numbers_in(text: str) -> list[float]:
    return [float(m.replace(",", "")) for m in _NUM_RE.findall(text)]


def allowed_numbers(episodes: list[dict[str, Any]], model: dict[str, float]) -> set[float]:
    allowed: set[float] = set()
    for e in episodes:
        allowed.add(float(e["year"]))
        allowed.add(float(e["crude_move_pct"]))
        allowed.add(abs(float(e["crude_move_pct"])))
        allowed.add(float(e["duration_days"]))
        # numbers quoted inside the episode's own text fields are facts too
        for field in ("disruption", "outcome", "summary", "cause"):
            allowed.update(_numbers_in(str(e.get(field, ""))))
    for v in model.values():
        allowed.add(round(float(v), 1))
        allowed.add(abs(round(float(v), 1)))
        allowed.add(float(round(float(v))))
        allowed.add(abs(float(round(float(v)))))
    return allowed


def guard_narration(text: str, allowed: set[float]) -> str | None:
    """Every number GLM writes must trace to a supplied fact (±5% rel or
    ±0.6 abs). One orphan number discards the whole narration."""
    for n in _numbers_in(text):
        ok = any(
            abs(n - a) <= max(0.6, 0.05 * max(abs(n), abs(a))) for a in allowed
        )
        if not ok:
            return None
    return text


_NARRATE_PROMPT = """You ground a simulation result in real history for a general audience.

MODEL RESULT: {model}

RETRIEVED HISTORICAL EPISODES (the ONLY facts you may use):
{episodes}

Write ONE paragraph (max 80 words, plain language): name the closest episode
and year, state what actually happened to crude then (use its exact figures),
and say whether the model's crude move sits inside, above, or below that
history. RULES: use ONLY facts and numbers from the episodes and model result
above — no outside knowledge, no invented figures. No markdown."""


async def narrate(
    llm: Any, model: dict[str, float], episodes: list[dict[str, Any]]
) -> str | None:
    ep_lines = "\n".join(
        f"- {e['name']} ({e['year']}): {e['disruption']}; crude moved "
        f"{e['crude_move_pct']:+}%; outcome: {e['outcome']}"
        for e in episodes
    )
    text = await llm.chat(
        _NARRATE_PROMPT.format(model=json.dumps(model), episodes=ep_lines)
    )
    return guard_narration(text.strip(), allowed_numbers(episodes, model))


if __name__ == "__main__":
    # self-checks: guard logic (no network)
    eps = [
        {
            "year": 2019, "crude_move_pct": 15, "duration_days": 14,
            "disruption": "5.7 Mb/d, restored in ~2-3 weeks",
            "outcome": "Brent jumped ~15% in a day",
            "summary": "largest instantaneous loss", "cause": "drone strike",
        }
    ]
    allowed = allowed_numbers(eps, {"crude_pct": 44.0, "pump_inr": 14.4})
    ok = guard_narration(
        "Like the 2019 attack, when 5.7 Mb/d vanished and crude rose 15%, "
        "your 44% move is above that band.", allowed)
    assert ok is not None, "grounded narration should pass"
    bad = guard_narration("In 1996 crude rose 87% in 3 days.", allowed)
    assert bad is None, "orphan numbers must discard the narration"
    # 14 matches the model's 14.4 within tolerance
    edge = guard_narration("Crude moved about 14 percent.", allowed)
    assert edge is not None, "near-match within tolerance should pass"
    print("rag guard OK")
