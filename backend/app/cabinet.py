"""War Cabinet: three AI ministers deliberate a crisis, the PM issues the verdict.

Each role runs on its own NVIDIA-hosted model (see config.CABINET_MODELS) via
registry.llm_for(role). A minister reads the GROUNDED baseline facts (computed by
the engine, passed in) and returns:
  * a short prose point-of-view (strategy — never invented outcome numbers), and
  * a structured PolicyLevers block the engine can actually simulate.

Honesty design (CLAUDE.md): GLM does judgment, the engine does arithmetic. The
ministers argue strategy referencing only supplied baseline facts; every number the
user SEES (charts + scorecard) is engine-computed, so no model is the source of a
number on screen. Outcome of each plan is scored by simulate(), not asserted here.
"""

import json
import re
from typing import Any, AsyncIterator

from .clients.registry import llm_for

# ---- PolicyLevers: the only actions the engine models (plan §4) --------------
_UNIT_LEVERS = ("opec_negotiation", "deescalation", "spr_release", "naval_escort")


def validate_levers(obj: Any) -> dict[str, Any]:
    """Clamp/keep only levers the engine understands; drop everything else."""
    out: dict[str, Any] = {}
    if not isinstance(obj, dict):
        return out
    if obj.get("resource_reallocation"):
        out["resource_reallocation"] = True
    for k in _UNIT_LEVERS:
        v = obj.get(k)
        if isinstance(v, (int, float)) and v > 0:
            out[k] = min(1.0, max(0.0, float(v)))
    esc = obj.get("escalation")
    esc_list = esc if isinstance(esc, list) else [esc] if isinstance(esc, dict) else []
    cleaned = [
        {"channel": e["channel"], "delta": min(1.0, max(0.0, float(e.get("delta", 0))))}
        for e in esc_list
        if isinstance(e, dict) and e.get("channel") in ("hormuz", "redsea", "opec")
        and isinstance(e.get("delta"), (int, float)) and e.get("delta", 0) > 0
    ]
    if cleaned:
        out["escalation"] = cleaned
    return out


def _extract_levers(full_text: str) -> dict[str, Any]:
    """Pull the trailing JSON lever block out of the streamed reply."""
    for m in reversed(list(re.finditer(r"\{[^{}]*\}(?:[^{}]*\{[^{}]*\})*\}|\{[^{}]*\}", full_text))):
        try:
            return validate_levers(json.loads(m.group(0)))
        except (ValueError, KeyError):
            continue
    return {}


# ---- prompts -----------------------------------------------------------------
_FACT_LINE = (
    "Baseline (no action, {horizon}-day horizon): petrol +₹{pump_low}–{pump_high}/L, "
    "GDP {gdp} pp, refinery run-rate trough {run_trough}%, unmet supply {residual} kb/d, "
    "added freight {freight} days. Active shocks: {shocks}."
)

_ROLE = {
    "fm": (
        "You are India's FOREIGN MINISTER. Your levers are DIPLOMATIC/ECONOMIC: "
        "resource_reallocation (re-source crude from suppliers with spare capacity, under IEA caps), "
        "opec_negotiation (0..1, talk OPEC+ down), deescalation (0..1, diplomacy to reopen a corridor). "
        "Argue from alliances, markets and negotiability."
    ),
    "dm": (
        "You are India's DEFENCE MINISTER. Your levers are PHYSICAL/SECURITY: "
        "spr_release (0..1, draw the strategic reserve), naval_escort (0..1, convoy Red Sea traffic "
        "to cut reroute losses), and as a LAST resort escalation ({channel, delta} — a strike that "
        "RAISES a channel's severity and can worsen the outcome). Argue from deterrence, chokepoint "
        "control and reserve depth. (The Hormuz bypass is already maxed in the baseline.)"
    ),
    "pm": (
        "You are India's PRIME MINISTER. You have read the Foreign and Defence Ministers' advice. "
        "Weigh both, then issue the FINAL call as a single PolicyLevers set drawn from ALL levers "
        "(resource_reallocation, opec_negotiation, deescalation, spr_release, naval_escort, "
        "escalation). You may adopt, blend, reject, or override with escalation. Your goal is to improve "
        "India's position, but you own the consequences — the engine will score your choice honestly."
    ),
}

_TASK = (
    "Write 2-4 sentences of briefing-room reasoning. Do NOT state any petrol/GDP/barrel numbers of your "
    "own — the simulation computes outcomes; you argue strategy. Then on a NEW line output exactly:\n"
    "```levers\n{ ...PolicyLevers JSON... }\n```\n"
    "Only include levers you actually recommend. Lever values are 0..1. Example: "
    '{"resource_reallocation": true, "spr_release": 0.6}'
)


def _facts_line(facts: dict[str, Any]) -> str:
    shocks = ", ".join(
        f"{k} {int(v * 100)}%" for k, v in (facts.get("disruptions") or {}).items() if v
    ) or "none"
    return _FACT_LINE.format(
        horizon=facts.get("horizon", 90),
        pump_low=facts.get("pump_low", "?"), pump_high=facts.get("pump_high", "?"),
        gdp=facts.get("gdp", "?"), run_trough=facts.get("run_trough", "?"),
        residual=facts.get("residual", "?"), freight=facts.get("freight", "?"),
        shocks=shocks,
    )


def _minister_prompt(role: str, crisis: str, facts: dict[str, Any]) -> str:
    return f"{_ROLE[role]}\n\nCRISIS: {crisis}\n{_facts_line(facts)}\n\n{_TASK}"


def _pm_prompt(crisis: str, facts: dict[str, Any], fm: dict, dm: dict) -> str:
    return (
        f"{_ROLE['pm']}\n\nCRISIS: {crisis}\n{_facts_line(facts)}\n\n"
        f"FOREIGN MINISTER: {fm.get('pov', '').strip()}\n  proposed levers: {json.dumps(fm.get('levers', {}))}\n\n"
        f"DEFENCE MINISTER: {dm.get('pov', '').strip()}\n  proposed levers: {json.dumps(dm.get('levers', {}))}\n\n{_TASK}"
    )


# ---- streaming ---------------------------------------------------------------
def _sse(obj: dict[str, Any]) -> str:
    return f"data: {json.dumps(obj)}\n\n"


async def _run(llm: Any, prompt: str, role: str, buf: list[str]) -> AsyncIterator[str]:
    """Stream one model's deltas into buf; swallow errors (caller decides fallback)."""
    try:
        async for delta in llm.chat_stream(prompt, temperature=0.4):
            buf.append(delta)
            yield _sse({"delta": delta, "role": role})
    except Exception:
        pass


async def _stream(role: str, prompt: str) -> AsyncIterator[str]:
    """Stream prose deltas, then a final event carrying the parsed levers + model.

    The client hides everything from the first ``` fence onward (that's the lever
    block). Resilience: the free/preview minister endpoints can 504 or return an
    empty completion — if the role's own model produces nothing, fall back to the
    proven GLM client (honestly labelled source='glm-fallback')."""
    primary = llm_for(role)
    if getattr(primary, "mode", None) != "live":
        yield _sse({"done": True, "levers": {}, "pov": "", "model": "unavailable",
                    "source": "unavailable", "role": role})
        return
    buf: list[str] = []
    async for ev in _run(primary, prompt, role, buf):
        yield ev
    used, source = primary, "primary"
    if not "".join(buf).strip():  # primary silent (504 / empty) → GLM fallback
        fb = llm_for("fm")
        if getattr(fb, "mode", None) == "live" and fb is not primary:
            used, source, buf = fb, "glm-fallback", []
            async for ev in _run(fb, prompt, role, buf):
                yield ev
    full = "".join(buf)
    pov = full.split("```")[0].strip()
    yield _sse({"done": True, "levers": _extract_levers(full), "pov": pov,
                "model": getattr(used, "model", "?"),
                "source": source if full.strip() else "error", "role": role})


def stream_minister(role: str, crisis: str, facts: dict[str, Any]) -> AsyncIterator[str]:
    return _stream(role, _minister_prompt(role, crisis, facts))


def stream_pm(crisis: str, facts: dict[str, Any], fm: dict, dm: dict) -> AsyncIterator[str]:
    return _stream("pm", _pm_prompt(crisis, facts, fm, dm))
