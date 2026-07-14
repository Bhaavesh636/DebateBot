# DebateBot: Two Sides and a Judge

Two agents argue opposing, fixed sides of a topic across several rounds, backed by a real web-search evidence tool. A judge agent then reviews the transcript and delivers a reasoned verdict.

## Architecture

| Layer | File(s) | Role |
|---|---|---|
| **Backend logic** | `debate_backend.py` | LangGraph state machine: evidence tool, Proponent/Opponent agents, round looping, Judge agent. No web/UI code. |
| **API server** | `server.py` | FastAPI wrapper that turns the backend into a streaming HTTP API (Server-Sent Events) for the frontend to call. |
| **Frontend** | `frontend/` | Vite + React app. Talks to the API server, types out each turn as it arrives. |
| **Notebook** | `DebateBot_Backend.ipynb` | Imports `debate_backend.py` directly (no server needed) — good for testing/demoing the backend on its own. |
| **Streamlit version** | `app.py` | The original all-in-one Streamlit frontend, kept as an alternative. Needs `pip install streamlit grandalf` separately (not in the default requirements anymore, since React is now the primary frontend). |

The API key lives **only** in the backend's `.env` file — it never touches the browser or the React code at all.

## Setup

```bash
pip install -r requirements.txt
```

Then create your `.env` (copy `.env.example` and fill in a real key):
```
GROQ_API_KEY=gsk_your_real_key_here
GROQ_MODEL=llama-3.3-70b-versatile
```
Get a free Groq key at https://console.groq.com/keys — no credit card required.

Install the frontend's dependencies:
```bash
cd frontend
npm install
cd ..
```

## Running it (two terminals)

**Terminal 1 — API server:**
```bash
uvicorn server:app --reload --port 8000
```

**Terminal 2 — frontend:**
```bash
cd frontend
npm run dev
```

Open the URL Vite prints (usually `http://localhost:5173`). Enter a topic, pick a model and round count, hit **Start Debate**.

## How it satisfies the brief

1. **"Run a structured multi-round debate with a reasoned judge verdict."**
   `build_debate_graph()` (in `debate_backend.py`) wires `proponent -> opponent -> advance_round -> (loop or judge) -> END`. The Judge node is a separate LLM call over the full transcript, prompted to name each side's strongest point before declaring a winner or draw.

2. **"Keep each agent consistently on its assigned side."**
   Each debater node has its stance ("FOR"/"AGAINST") baked into every prompt for the life of the debate — there's no mechanism for it to switch sides.

3. **"Add an evidence tool so arguments cite real sources rather than assertions."**
   `evidence_search()` hits DuckDuckGo for a query the debater itself generates, and the prompt requires the model to name a source inline. The frontend surfaces the raw sources per turn (as clickable, named links) so a reader can verify the citation.

## Why SSE instead of one big response

Each turn takes a few seconds to generate. Server-Sent Events let `server.py` push each turn to the browser the moment it's ready, so the frontend can start "typing out" turn 1 while the server is still generating turn 2 — with no manual prefetching or threading needed on either side, unlike the original Streamlit version (which had to hand-roll a background-thread prefetch queue to get the same overlapping effect, since Streamlit runs as one blocking script per interaction).

## Notes for extending it

- Swap `ddgs` for Tavily/SerpAPI if you want higher-quality evidence (needs an API key).
- Swap `ChatGroq` for any other LangChain chat model — only `_llm()` in `debate_backend.py` needs to change.
- The React app currently points at `http://localhost:8000` (see `API_BASE` in `frontend/src/App.jsx`) — change that if you deploy the API server somewhere else.
