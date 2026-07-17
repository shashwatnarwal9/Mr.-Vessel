"""Cabinet lever-validation + extraction checks (key-free, no network)."""

from .cabinet import _extract_levers, validate_levers
from .clients.registry import llm_for


def test_validate_clamps_and_drops_unknown():
    out = validate_levers(
        {"spr_release": 1.7, "bypass_boost": -0.2, "made_up_lever": 5, "resource_reallocation": True}
    )
    assert out["spr_release"] == 1.0  # clamped to 1
    assert "bypass_boost" not in out  # <=0 dropped
    assert "made_up_lever" not in out  # unknown dropped
    assert out["resource_reallocation"] is True


def test_escalation_channel_and_delta():
    out = validate_levers({"escalation": {"channel": "hormuz", "delta": 0.5}})
    assert out["escalation"] == [{"channel": "hormuz", "delta": 0.5}]
    # bad channel is dropped
    assert "escalation" not in validate_levers({"escalation": {"channel": "moon", "delta": 0.5}})


def test_extract_levers_from_streamed_reply():
    text = 'We must act.\n```levers\n{"resource_reallocation": true, "spr_release": 0.6}\n```'
    out = _extract_levers(text)
    assert out["resource_reallocation"] is True and out["spr_release"] == 0.6


def test_llm_for_is_cached_per_role():
    # constructor only (no network); keys present in .env → real client with a model id
    a, b = llm_for("pm"), llm_for("pm")
    assert a is b and hasattr(a, "model")


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
    print("cabinet tests OK")
