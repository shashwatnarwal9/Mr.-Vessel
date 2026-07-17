# Backend service for Render/Docker (deterministic — no Nixpacks language
# guessing). Build context = repo root so the baked fallback data in
# frontend/public/ ships with the API: config.BAKED_DIR resolves to
# /app/frontend/public, and backend/app/history_embeddings.json arrives via
# COPY backend/. Neo4j is optional — kg.py falls back to Python BFS.
FROM python:3.12-slim

WORKDIR /app

# deps first for layer caching
COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

# backend code + the baked data it reads at runtime
COPY backend/ backend/
COPY frontend/public/ frontend/public/

# Render/host injects $PORT at runtime; app.main:app lives under backend/
CMD ["sh", "-c", "python -m uvicorn app.main:app --app-dir backend --host 0.0.0.0 --port ${PORT:-8000}"]
