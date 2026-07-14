"""
DebateBot API server
----------------------
Wraps debate_backend.py in a small FastAPI app so a real frontend (the
React app in /frontend) can talk to it over HTTP, instead of the whole
thing running inside a single Streamlit process.

Run with:  uvicorn server:app --reload --port 8000

Why Server-Sent Events (SSE) instead of a single JSON response:
Each turn of the debate takes a few seconds to generate. SSE lets the
server push each turn to the browser the moment it's ready, so the
frontend can start "typing out" turn 1 while the server is still
working on turn 2 — for free, with no manual prefetching/threading
tricks needed on either side (unlike the Streamlit version, where we
had to hand-roll a background-thread prefetch queue to get the same
effect).
"""

import json
import os
from typing import Generator

from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from debate_backend import stream_debate

app = FastAPI(title="DebateBot API")

# The React dev server runs on :5173 by default (Vite). Allow it (and
# the same on 127.0.0.1) to call this API from the browser.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


def _debate_event_stream(topic: str, rounds: int, model: str) -> Generator[str, None, None]:
    if model:
        os.environ["GROQ_MODEL"] = model

    try:
        for update in stream_debate(topic, max_rounds=rounds):
            for node_name, partial_state in update.items():
                if node_name in ("proponent", "opponent") and "transcript" in partial_state:
                    yield _sse("turn", partial_state["transcript"][-1])
                if node_name == "judge" and "verdict" in partial_state:
                    yield _sse("verdict", {"verdict": partial_state["verdict"]})
        yield _sse("done", {})
    except Exception as e:
        yield _sse("error", {"message": str(e)})


@app.get("/api/debate")
def debate(
    topic: str = Query(..., min_length=1),
    rounds: int = Query(3, ge=1, le=6),
    model: str = Query(""),
):
    return StreamingResponse(
        _debate_event_stream(topic, rounds, model),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            # disables buffering on some proxies so events arrive immediately
            "X-Accel-Buffering": "no",
        },
    )


@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "groq_key_configured": bool(os.environ.get("GROQ_API_KEY")),
    }
