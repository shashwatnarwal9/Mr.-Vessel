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

CORS_ORIGINS = os.getenv("CORS_ORIGINS", "http://localhost:5173").split(",")

NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1"
CHAT_MODEL = "z-ai/glm-5.2"
EMBED_MODEL = "baai/bge-m3"

# baked fallback data lives with the frontend — single source of truth
BAKED_DIR = _ROOT / "frontend" / "public"
