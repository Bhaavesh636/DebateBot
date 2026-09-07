"""
DebateBot: Two Sides and a Judge — Backend
--------------------------------------------------
Multi-agent debate system built with LangGraph.

Architecture
------------
- Two "debater" agents (Proponent, Opponent) are pinned to opposite,
  FIXED sides of a user-chosen topic for the entire debate.
- Each debater, on its turn, generates a short search query, calls a
  real evidence tool (DuckDuckGo web search), and is instructed to
  ground its argument in what it finds (with a source URL) rather
  than asserting unsupported claims.
- After N rounds, a Judge agent reads the full transcript, summarizes
  the strongest point from each side, and returns a reasoned verdict.
- The whole thing is a LangGraph StateGraph so the flow (and looping
  over rounds) is explicit and inspectable, not hidden inside a
  single prompt.

This file has NO UI code in it on purpose — it is imported by both
the notebook (for interactive development / testing) and app.py
(the Streamlit frontend), so backend logic only lives in one place.
"""

import os
from typing import TypedDict, List, Dict, Literal

from dotenv import load_dotenv
load_dotenv()  # reads a local .env file if present — works the same on Windows/Mac/Linux

from langchain_groq import ChatGroq
from langchain_google_genai import ChatGoogleGenerativeAI
from langgraph.graph import StateGraph, END
from ddgs import DDGS

# Provider prefix convention:
#   "gemini/gemini-2.0-flash"  → Google Gemini
#   anything else              → Groq


def _extract_text(content) -> str:
    """Safely extract string text from LLM response content regardless of provider format (str or list of parts)."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(
            item if isinstance(item, str) else item.get("text", "")
            for item in content
            if isinstance(item, (str, dict))
        )
    return str(content)


# ---------------------------------------------------------------------
# 0. Topic validator  (ultra-compact prompt)
# ---------------------------------------------------------------------
def validate_topic(topic: str) -> tuple[bool, str]:
    """Return (is_valid, reason). Fast, token-efficient check."""
    llm = _llm(temperature=0)
    prompt = (
        f"Is this a genuine debate topic? \"{topic}\"\n"
        "Reply EXACTLY in 1 line: VALID or INVALID: <short reason>"
    )
    response = _extract_text(llm.invoke(prompt).content).strip()
    if response.upper().startswith("VALID"):
        return True, ""
    reason = response.partition(":")[2].strip() or "That doesn't look like a debate topic."
    return False, reason


# ---------------------------------------------------------------------
# 1. Evidence tool (trimmed snippets to save tokens)
# ---------------------------------------------------------------------
def evidence_search(query: str, max_results: int = 2) -> List[Dict[str, str]]:
    """Real web search via DuckDuckGo. Returns [{title, snippet, url}, ...]."""
    results = []
    try:
        with DDGS() as ddgs:
            for r in ddgs.text(query, max_results=max_results, timeout=2.0):
                snippet = r.get("body", "")[:120]  # trim to 120 chars for token efficiency
                results.append({
                    "title": r.get("title", ""),
                    "snippet": snippet,
                    "url": r.get("href", ""),
                })
    except Exception as e:
        results = [{"title": "Search unavailable", "snippet": str(e)[:60], "url": ""}]
    return results


# ---------------------------------------------------------------------
# 2. Shared state that flows through the graph
# ---------------------------------------------------------------------
class DebateState(TypedDict):
    topic: str
    max_rounds: int
    current_round: int
    transcript: List[Dict]        # [{round, side, argument, sources}, ...]
    verdict: str


def _llm(model: str = None, temperature: float = 0.7):
    """Return chat model. Defaults to Groq (14,400 RPD quota vs Gemini 20 RPD)."""
    model = model or os.environ.get("GROQ_MODEL", "openai/gpt-oss-120b")
    if model.startswith("gemini/"):
        gemini_model = model[len("gemini/"):]
        return ChatGoogleGenerativeAI(
            model=gemini_model,
            temperature=temperature,
            google_api_key=os.environ.get("GOOGLE_API_KEY"),
            max_retries=1,
        )
    return ChatGroq(model=model, temperature=temperature, max_retries=1)


def _full_transcript(state: DebateState) -> str:
    """Full transcript — used only by the judge."""
    if not state["transcript"]:
        return "(No arguments yet.)"
    return "\n\n".join(
        f"[R{t['round']} {t['side']}]: {t['argument']}" for t in state["transcript"]
    )


def _recent_context(state: DebateState, my_side: str) -> str:
    """Only the last 2 turns — keeps debater prompts compact."""
    recent = state["transcript"][-2:] if state["transcript"] else []
    if not recent:
        return "(Opening round — no prior arguments.)"
    return "\n".join(
        f"[{t['side']}]: {t['argument']}" for t in recent
    )


# ---------------------------------------------------------------------
# 3. Debater node factory (token-optimized)
# ---------------------------------------------------------------------
def _make_debater_node(side: Literal["Proponent", "Opponent"]):
    stance = "FOR" if side == "Proponent" else "AGAINST"

    def node(state: DebateState) -> DebateState:
        llm = _llm()
        topic = state["topic"]
        recent = _recent_context(state, side)

        # Fast direct search query
        query = f"{topic} {side} evidence arguments"
        sources = evidence_search(query)
        sources_block = "\n".join(
            f"- {s['title']}: {s['snippet']} ({s['url']})" for s in sources
        ) or "(No sources found.)"

        argument_prompt = (
            f"You are {side} ({stance}): \"{topic}\".\n"
            f"Context:\n{recent}\n\n"
            f"Evidence:\n{sources_block}\n\n"
            "Write a concise 2-3 sentence argument. Cite 1 source. Be direct."
        )
        argument = _extract_text(llm.invoke(argument_prompt).content).strip()

        new_turn = {
            "round": state["current_round"] + 1,
            "side": side,
            "argument": argument,
            "sources": sources,
        }

        return {"transcript": state["transcript"] + [new_turn]}

    return node


proponent_node = _make_debater_node("Proponent")
opponent_node = _make_debater_node("Opponent")


# ---------------------------------------------------------------------
# 4. Round bookkeeping
# ---------------------------------------------------------------------
def advance_round_node(state: DebateState) -> DebateState:
    return {"current_round": state["current_round"] + 1}


def route_after_round(state: DebateState) -> Literal["continue", "judge"]:
    if state["current_round"] < state["max_rounds"]:
        return "continue"
    return "judge"


# ---------------------------------------------------------------------
# 5. Judge node (token-optimized)
# ---------------------------------------------------------------------
def judge_node(state: DebateState) -> DebateState:
    llm = _llm(temperature=0.5)
    prompt = (
        f"Judge topic: \"{state['topic']}\". Transcript:\n{_full_transcript(state)}\n\n"
        "Declare a CLEAR WINNER in this exact format:\n"
        "1. Proponent key point: <1 sentence>\n"
        "2. Opponent key point: <1 sentence>\n"
        "3. Winner: Proponent (or Opponent/Draw) - <1 sentence justification>"
    )
    verdict = _extract_text(llm.invoke(prompt).content).strip()
    return {"verdict": verdict}


# ---------------------------------------------------------------------
# 6. Assemble the graph
# ---------------------------------------------------------------------
def build_debate_graph():
    graph = StateGraph(DebateState)

    graph.add_node("proponent", proponent_node)
    graph.add_node("opponent", opponent_node)
    graph.add_node("advance_round", advance_round_node)
    graph.add_node("judge", judge_node)

    graph.set_entry_point("proponent")
    graph.add_edge("proponent", "opponent")
    graph.add_edge("opponent", "advance_round")
    graph.add_conditional_edges(
        "advance_round",
        route_after_round,
        {"continue": "proponent", "judge": "judge"},
    )
    graph.add_edge("judge", END)

    return graph.compile()


def run_debate(topic: str, max_rounds: int = 3) -> DebateState:
    """Convenience one-shot runner (used by the notebook)."""
    app = build_debate_graph()
    initial_state: DebateState = {
        "topic": topic,
        "max_rounds": max_rounds,
        "current_round": 0,
        "transcript": [],
        "verdict": "",
    }
    final_state = app.invoke(initial_state)
    return final_state


def stream_debate(topic: str, max_rounds: int = 3):
    """Generator version (used by the Streamlit frontend) — yields the
    state after every node so the UI can render turns as they happen."""
    app = build_debate_graph()
    initial_state: DebateState = {
        "topic": topic,
        "max_rounds": max_rounds,
        "current_round": 0,
        "transcript": [],
        "verdict": "",
    }
    for update in app.stream(initial_state):
        yield update
