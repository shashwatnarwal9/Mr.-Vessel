"""Crisis prompt -> baseline disruption scenario the engine already eats.

A free-text war prompt ("Iran mines Hormuz, the US strikes near Bab-el-Mandeb")
is decomposed into discrete events, each resolved to ONE physical crude-flow
channel (hormuz / redsea / opec) with a severity 0..1. GLM-5.2 does it when a
key is present; a deterministic keyword pass is the always-available fallback.

Honesty rails (CLAUDE.md):
  * speculation gate — a THREAT is not an event (reuse fusion.SPECULATION);
    "Iran threatens to close Hormuz" contributes σ=0.
  * geo resolver — Bab-el-Mandeb / Suez / Houthi / Yemen ride the `redsea`
    channel (no separate channel exists); events with no crude-flow channel go
    to `unmapped[]`, never a phantom σ.
  * every result is labelled source: "glm" | "keyword".
"""

import re
from typing import Any

from .fusion import SPECULATION

CHANNELS = ("hormuz", "redsea", "opec")

# keyword → channel. Order matters only for readability; each is tested independently.
_CHANNEL_WORDS: dict[str, str] = {
    r"hormuz|persian gulf|strait of hormuz": "hormuz",
    r"red sea|bab[- ]?el[- ]?mandeb|bab[- ]?al[- ]?mandab|suez|houthi|yemen|aden": "redsea",
    r"opec": "opec",
}
# severity anchors by verb (highest match wins), mirrors fusion.closure_from_news
_FULL = re.compile(r"\b(clos\w+|shut\w*|seal\w*|block\w*|mine[ds]?|mining|blockad\w+|siege)\b", re.I)
_PARTIAL = re.compile(r"\bpartial\w*|half|restrict\w*|disrupt\w*|slow\w*|threaten shipping\b", re.I)
_STRIKE = re.compile(r"\b(strik\w+|struck|attack\w*|hit|bomb\w*|missil\w*|drone\w*|shell\w*)\b", re.I)
# a real disruptive event with no crude-flow channel (→ unmapped, not a channel)
_DISRUPT = re.compile(r"\b(fire|explos\w+|sabotag\w+|cyber\w*|blackout|coup|invad\w*)\b", re.I)
_MODE = [
    ("decay", re.compile(r"\b(de-?escalat\w*|reopen\w*|easing|ceasefire|winding down|temporar\w*)\b", re.I)),
    ("shock", re.compile(r"\b(brief\w*|short\w*|one-?off|for (a few|two|three) (days|weeks)|raid)\b", re.I)),
]
_OPEC_MAX_MBD = 4.0  # coefficients.opec_max_cut_bbl_d = 4 Mb/d ⇒ σ=1.0


def _clauses(text: str) -> list[str]:
    return [c.strip() for c in re.split(r"[,;.]|\band\b|\bwhile\b|\bthen\b", text, flags=re.I) if c.strip()]


def _opec_severity(clause: str) -> float:
    m = re.search(r"(\d+(?:\.\d+)?)\s*(?:mb/?d|million\s*(?:barrel|b/?d|bpd)?)", clause, re.I)
    if m:
        return min(1.0, float(m.group(1)) / _OPEC_MAX_MBD)
    return 0.5  # "OPEC+ cuts" with no figure → half of the max modelled cut


def _severity_for(channel: str, clause: str) -> float:
    if channel == "opec":
        return _opec_severity(clause)
    # PARTIAL is checked before FULL: "partially closes" contains "closes", so a
    # full-closure match first would wrongly read a partial event as 100%.
    if _PARTIAL.search(clause):
        return 0.5
    if _FULL.search(clause):
        return 1.0
    if _STRIKE.search(clause):
        return 0.4  # a strike NEAR a corridor harasses shipping, not a full cut
    return 0.5  # named the chokepoint with a vague action → treat as partial


def _keyword_parse(prompt: str) -> dict[str, Any]:
    events: list[dict[str, Any]] = []
    unmapped: list[str] = []
    disruptions = {c: 0.0 for c in CHANNELS}
    for clause in _clauses(prompt):
        channel = next(
            (ch for pat, ch in _CHANNEL_WORDS.items() if re.search(pat, clause, re.I)),
            None,
        )
        speculative = bool(SPECULATION.search(clause))
        if channel is None:
            # only flag a REAL (non-speculative) disruptive event with no channel;
            # "India considers a naval strike" is a deliberation, not an event.
            if (_DISRUPT.search(clause) or _STRIKE.search(clause)) and not speculative:
                unmapped.append(clause)  # real event, no crude-flow channel
            continue
        sev = 0.0 if speculative else _severity_for(channel, clause)
        events.append(
            {"action": clause, "channel": channel, "severity": round(sev, 3),
             "speculative": speculative, "evidence": clause}
        )
        disruptions[channel] = max(disruptions[channel], sev)  # events don't stack past 1
    mode = next((m for m, pat in _MODE if pat.search(prompt)), "sustained")
    return {
        "events": events,
        "disruptions": disruptions,
        "mode": mode,
        "rationale": "",
        "unmapped": unmapped,
        "source": "keyword",
    }


async def parse_scenario(prompt: str, llm: Any = None) -> dict[str, Any]:
    """Deterministic keyword parse — instant, never raises. Intentionally NOT
    LLM-backed: this is the first interactive step, and an LLM fallback (glm's
    ~minutes queue) would hang the UI when a prompt has no disruption at all
    (e.g. "diversify our crude imports"). The lexicon covers the corridor language;
    a prompt with no chokepoint/closure/cut correctly yields an empty crisis, which
    the UI reports at once instead of spinning."""
    return _keyword_parse(prompt)


if __name__ == "__main__":
    # keyword-path self-check (key-free): the speculation gate and geo resolver
    # are the load-bearing behaviours — assert them directly.
    def _d(p: str) -> dict[str, float]:
        return _keyword_parse(p)["disruptions"]

    assert _d("Iran closed the Strait of Hormuz")["hormuz"] == 1.0
    assert _d("Iran threatens to close Hormuz")["hormuz"] == 0.0  # speculation gate
    r = _d("US strikes Houthi sites near Bab-el-Mandeb")
    assert r["redsea"] > 0 and r["hormuz"] == 0.0  # geo resolver, right channel
    assert abs(_d("OPEC+ announces a 3 Mb/d cut")["opec"] - 0.75) < 1e-6
    fire = _keyword_parse("A refinery fire in Jamnagar halts output")
    assert all(v == 0.0 for v in fire["disruptions"].values()) and fire["unmapped"]
    print("scenario_parse keyword self-check OK")
