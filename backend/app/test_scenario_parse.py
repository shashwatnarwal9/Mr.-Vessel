"""Crisis-parser checks — the speculation gate and geo resolver are load-bearing.

Key-free: exercises the deterministic keyword path (and parse_scenario's fallback
when the LLM is a stub), so it runs in CI without NVIDIA_API_KEY.
"""

import asyncio

from .scenario_parse import _keyword_parse, parse_scenario


def _d(prompt: str) -> dict:
    return _keyword_parse(prompt)["disruptions"]


def test_full_closure_is_max():
    assert _d("Iran closed the Strait of Hormuz")["hormuz"] == 1.0


def test_partial_closure_is_half_not_full():
    # "partially closes" contains "closes" — must not read as 100%
    assert _d("Iran partially closes Hormuz")["hormuz"] == 0.5


def test_speculative_unchanneled_event_is_dropped():
    # "India considers a naval strike" is a deliberation, not an event → not unmapped
    out = _keyword_parse("Iran partially closes Hormuz; India considers a naval strike on Iranian assets")
    assert out["disruptions"]["hormuz"] == 0.5
    assert out["unmapped"] == []


def test_speculation_gate_blocks_threats():
    # a threat is NOT an event — must never set σ (CLAUDE.md rule)
    out = _keyword_parse("Iran threatens to close Hormuz")
    assert out["disruptions"]["hormuz"] == 0.0
    assert out["events"] and out["events"][0]["speculative"] is True


def test_geo_resolver_routes_bab_el_mandeb_to_redsea():
    r = _d("US strikes Houthi sites near Bab-el-Mandeb")
    assert r["redsea"] > 0 and r["hormuz"] == 0.0


def test_opec_magnitude_scales_by_4mbd():
    assert abs(_d("OPEC+ announces a 3 Mb/d cut")["opec"] - 0.75) < 1e-6


def test_unmapped_event_has_no_phantom_channel():
    out = _keyword_parse("A refinery fire in Jamnagar halts output")
    assert all(v == 0.0 for v in out["disruptions"].values())
    assert out["unmapped"]


def test_multi_event_prompt_fills_multiple_channels():
    out = _keyword_parse("Iran mines Hormuz and the US strikes near Bab-el-Mandeb")
    assert out["disruptions"]["hormuz"] == 1.0 and out["disruptions"]["redsea"] > 0


class _Stub:
    mode = "unavailable"


def test_parse_scenario_falls_back_to_keyword_without_llm():
    out = asyncio.run(parse_scenario("Iran closed Hormuz", _Stub()))
    assert out["source"] == "keyword" and out["disruptions"]["hormuz"] == 1.0


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
    print("scenario_parse tests OK")
