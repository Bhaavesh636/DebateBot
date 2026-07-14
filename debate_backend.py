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
from langgraph.graph import StateGraph, END
from ddgs import DDGS


# ---------------------------------------------------------------------
# 0. Topic validator  (fast, cheap — always uses the 8B model)
# ---------------------------------------------------------------------
def validate_topic(topic: str) -> tuple[bool, str]:
    """Return (is_valid, reason).

    Uses the smallest/fastest model so this check is nearly free.
    Returns True if the input looks like a debatable proposition, False otherwise.
    """
    llm = ChatGroq(model="llama-3.1-8b-instant", temperature=0)
    prompt = (
        "You are a debate topic validator. Your ONLY job is to decide whether "
        "the user's input is a genuine debate topic — something two people could "
        "meaningfully argue opposing sides of.\n\n"
        "Valid examples: \"Should schools ban smartphones?\", "
        "\"Is nuclear energy the future?\", \"Does social media harm democracy?\"\n\n"
        "Invalid examples: \"hello\", \"write me a poem\", \"2+2\", "
        "\"what time is it\", \"banana\", random gibberish.\n\n"
        f"User input: \"{topic}\"\n\n"
        "Reply with EXACTLY one line:\n"
        "VALID or INVALID: <one short sentence explaining why if INVALID>"
    )
    response = llm.invoke(prompt).content.strip()
    if response.upper().startswith("VALID"):
        return True, ""
    # Extract the reason after "INVALID:"
    reason = response.partition(":")[2].strip() or "That doesn't look like a debate topic."
    return False, reason


# ---------------------------------------------------------------------
# 1. Evidence tool
# ---------------------------------------------------------------------
def evidence_search(query: str, max_results: int = 2) -> List[Dict[str, str]]:
    """Real web search via DuckDuckGo. Returns [{title, snippet, url}, ...]."""
    results = []
    try:
        with DDGS() as ddgs:
            for r in ddgs.text(query, max_results=max_results):
                results.append({
                    "title": r.get("title", ""),
                    "snippet": r.get("body", ""),
                    "url": r.get("href", ""),
                })
    except Exception as e:
        results = [{"title": "Search unavailable", "snippet": str(e), "url": ""}]
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


def _llm(model: str = None, temperature: float = 0.7) -> ChatGroq:
    model = model or os.environ.get("GROQ_MODEL", "llama-3.3-70b-versatile")
    return ChatGroq(model=model, temperature=temperature)


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
# 3. Debater node factory (used for both Proponent and Opponent)
# ---------------------------------------------------------------------
def _make_debater_node(side: Literal["Proponent", "Opponent"]):
    stance = "FOR" if side == "Proponent" else "AGAINST"

    def node(state: DebateState) -> DebateState:
        llm = _llm()
        topic = state["topic"]
        recent = _recent_context(state, side)

        # Single LLM call: produce a search query AND the argument together.
        # The model outputs the query on line 1, then the argument.
        combined_prompt = (
            f"You are the {side}, arguing {stance}: \"{topic}\".\n"
            f"Recent debate context:\n{recent}\n\n"
            "Respond in EXACTLY this format (no extra text):\n"
            "QUERY: <a short web search query, max 8 words, to find evidence>\n"
            "ARGUMENT: <your 3-5 sentence argument citing sources below>\n\n"
            "I will inject search results between your query and argument. "
            "For now, just write the QUERY line."
        )
        query_resp = llm.invoke(combined_prompt).content.strip()
        # Extract query from response
        query = query_resp
        if query.upper().startswith("QUERY:"):
            query = query[6:].strip()
        # Stop at newline (ignore any extra the model wrote)
        query = query.split("\n")[0].strip().strip('"')

        sources = evidence_search(query)
        sources_block = "\n".join(
            f"- {s['title']}: {s['snippet']} ({s['url']})" for s in sources
        ) or "(No sources found.)"

        # Now generate the argument with the real sources
        argument_prompt = (
            f"You are the {side}, arguing {stance}: \"{topic}\".\n"
            f"Recent context:\n{recent}\n\n"
            f"Search results for \"{query}\":\n{sources_block}\n\n"
            "Write 3-5 sentences. Address the opponent's last point if any. "
            "Cite at least one source by name. Don't invent facts."
        )
        argument = llm.invoke(argument_prompt).content.strip()

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
# 4. Round bookkeeping (runs after Opponent speaks, i.e. end of a round)
# ---------------------------------------------------------------------
def advance_round_node(state: DebateState) -> DebateState:
    return {"current_round": state["current_round"] + 1}


def route_after_round(state: DebateState) -> Literal["continue", "judge"]:
    if state["current_round"] < state["max_rounds"]:
        return "continue"
    return "judge"


# ---------------------------------------------------------------------
# 5. Judge node
# ---------------------------------------------------------------------
def judge_node(state: DebateState) -> DebateState:
    llm = _llm(temperature=0.5)
    prompt = (
        f"Judge this debate on: \"{state['topic']}\".\n\n"
        f"Transcript:\n{_full_transcript(state)}\n\n"
        "Declare a CLEAR WINNER. Draw only if truly equal.\n\n"
        "Use this exact structure:\n"
        "1. Proponent's strongest point (1 sentence).\n"
        "2. Opponent's strongest point (1 sentence).\n"
        "3. Round-by-Round analysis:\n"
        "   Round 1: <2-3 sentences analyzing the arguments, evidence, and rebuttals traded in Round 1>\n"
        "   Round 2: <2-3 sentences analyzing Round 2>\n"
        "   (and so on for every round in the debate)\n"
        "4. Start with exactly 'Winner: Proponent' or 'Winner: Opponent' "
        "(or 'Winner: Draw' only if all rounds are equal). Then 2 sentences justification."
    )
    verdict = llm.invoke(prompt).content.strip()
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
