"""Settings from .env (repo root or backend/). Secrets never live in code."""

import os
from pathlib import Path

from dotenv import load_dotenv

# repo-root .env wins; backend/.env as fallback for split deploys
_ROOT = Path(__file__).resolve().parents[2]
load_dotenv(_ROOT / ".env")
load_dotenv(_ROOT / "backend" / ".env")

AIS_API_KEY = os.getenv("AIS_API_KEY", "")
NVIDIA_API_KEY = os.getenv("NVIDIA_API_KEY", "")
CUOPT_API_KEY = os.getenv("CUOPT_API_KEY", "")
FUEL_PRICE_API_KEY = os.getenv("FUEL_PRICE_API_KEY", "")
# Google News (RapidAPI, google-news13) — India-positioned PRIMARY news source
# (lr=en-IN). Guardian + baked remain as fallbacks so the feed never breaks.
GOOGLE_NEWS_API_KEY = os.getenv("GOOGLE_NEWS_API_KEY", "")
# real-time news fallback (Guardian Content API): 5,000/day free, no delay.
# https://open-platform.theguardian.com/access
GUARDIAN_API_KEY = os.getenv("GUARDIAN_API_KEY", "")

CORS_ORIGINS = os.getenv("CORS_ORIGINS", "http://localhost:5173").split(",")

NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1"
CHAT_MODEL = "z-ai/glm-5.2"
EMBED_MODEL = "baai/bge-m3"

# War Cabinet: one NVIDIA-hosted model per minister. Each role has its own model id
# and (optionally) its own key — the user supplied separate keys for DM/PM. Any role
# key left blank falls back to NVIDIA_API_KEY. Override model ids in .env if a catalog
# string differs. All share NVIDIA_BASE_URL unless a per-role base is set.
CABINET_MODELS = {
    "fm": os.getenv("FM_MODEL", CHAT_MODEL),  # Foreign Minister — GLM-5.2
    "dm": os.getenv("DM_MODEL", "qwen/qwen3.5-122b-a10b"),  # Defence Minister
    "pm": os.getenv("PM_MODEL", "mistralai/mistral-large-3-675b-instruct-2512"),  # PM
}
CABINET_KEYS = {
    "fm": os.getenv("FM_API_KEY", "") or NVIDIA_API_KEY,
    "dm": os.getenv("DM_API_KEY", "") or NVIDIA_API_KEY,
    "pm": os.getenv("PM_API_KEY", "") or NVIDIA_API_KEY,
}

# baked fallback data lives with the frontend — single source of truth
BAKED_DIR = _ROOT / "frontend" / "public"
