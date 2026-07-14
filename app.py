"""
DebateBot: Two Sides and a Judge — Streamlit Frontend (polished)
------------------------------------------------------------------
Run with:  streamlit run app.py

Requires GROQ_API_KEY set as an environment variable / .env file
(or entered in the sidebar, which sets it for the running process only).
"""

import os
import html
import time
from collections import deque
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urlparse
import streamlit as st
from debate_backend import stream_debate


def prefetch_ahead(iterator, lookahead: int = 2):
    """Wraps a generator so up to `lookahead` items are fetched on a
    background thread while the caller is still busy with the CURRENT
    item (here: animating a turn's typewriter reveal).

    lookahead=1 only covers the very next node. That's enough to hide
    Opponent's generation time behind Proponent's animation — but the
    graph also has an invisible bookkeeping node (`advance_round`)
    between Opponent and the next Proponent that produces no on-screen
    animation. With lookahead=1, that cheap step finishes almost
    instantly and the worker then sits idle for the rest of Opponent's
    animation, so the NEXT Proponent's real generation only starts
    being fetched once Opponent's animation has already ended — fully
    exposing its latency as a visible gap between rounds.

    Bumping lookahead to 2 keeps two items in flight at all times, so
    the free bookkeeping step gets absorbed for free and the next real
    turn still gets a full animation-window's head start, closing that
    gap."""
    executor = ThreadPoolExecutor(max_workers=1)
    sentinel = object()

    def _safe_next():
        try:
            return next(iterator)
        except StopIteration:
            return sentinel

    buffer = deque(executor.submit(_safe_next) for _ in range(lookahead))
    try:
        while buffer:
            item = buffer.popleft().result()
            if item is sentinel:
                return
            buffer.append(executor.submit(_safe_next))
            yield item
    finally:
        executor.shutdown(wait=False)


def _dedent_html(s: str) -> str:
    """Strip leading whitespace from every line before handing HTML to
    st.markdown. Streamlit's Markdown parser treats any line indented
    4+ spaces as a code block even with unsafe_allow_html=True, which
    otherwise makes nested <details>/<div> blocks render as literal
    text instead of actual HTML. Internal blank lines are preserved so
    multi-paragraph text (e.g. the verdict, which uses white-space:
    pre-wrap) still keeps its line breaks."""
    return "\n".join(line.strip() for line in s.strip("\n").splitlines())

st.set_page_config(page_title="DebateBot — Two Sides and a Judge", page_icon="⚖️", layout="centered")

# ---------------------------------------------------------------------
# Design tokens
#   Ink background, brass/gold as the single accent (the "seal" metal),
#   amber for the Proponent podium, slate-indigo for the Opponent podium.
#   Fraunces for display type (courtroom-plaque gravity), Source Serif 4
#   for transcript body text (reads like a printed record), JetBrains
#   Mono for small structural labels (round markers, side chips).
# ---------------------------------------------------------------------
CSS = """
<style>
@import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=Source+Serif+4:ital,wght@0,400;0,600;1,400&family=JetBrains+Mono:wght@500;700&display=swap');

:root {
    --ink: #16171b;
    --ink-raised: #1e2025;
    --parchment: #ece7db;
    --brass: #c9a24b;
    --brass-dim: #8a713a;
    --amber: #d98e33;
    --amber-dim: rgba(217, 142, 51, 0.14);
    --slate: #6f8fd6;
    --slate-dim: rgba(111, 143, 214, 0.14);
    --hairline: rgba(236, 231, 219, 0.14);
}

.stApp {
    background: var(--ink);
    color: var(--parchment);
}

/* kill default streamlit padding bloat, keep a tight editorial column */
.block-container {
    max-width: 720px;
    padding-top: 2.5rem;
    padding-bottom: 4rem;
}

/* ---------- Header ---------- */
.eyebrow {
    font-family: 'JetBrains Mono', monospace;
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--brass);
    margin-bottom: 0.4rem;
}
.masthead {
    font-family: 'Fraunces', serif;
    font-weight: 600;
    font-size: 2.4rem;
    line-height: 1.1;
    letter-spacing: -0.01em;
    color: var(--parchment);
    margin: 0 0 0.6rem 0;
}
.masthead em { color: var(--brass); font-style: normal; }
.subhead {
    font-family: 'Source Serif 4', serif;
    font-size: 1.02rem;
    color: rgba(236, 231, 219, 0.72);
    line-height: 1.5;
    margin-bottom: 1.6rem;
}
.masthead-rule {
    border: none;
    border-top: 1px solid var(--hairline);
    margin: 1.4rem 0 1.8rem 0;
}

/* ---------- Sidebar ---------- */
section[data-testid="stSidebar"] {
    background: var(--ink-raised);
    border-right: 1px solid var(--hairline);
}
section[data-testid="stSidebar"] h1,
section[data-testid="stSidebar"] h2,
section[data-testid="stSidebar"] h3 {
    font-family: 'Fraunces', serif;
    color: var(--brass);
}
section[data-testid="stSidebar"] label { color: rgba(236,231,219,0.8) !important; }

/* inputs */
.stTextInput input, .stSelectbox div[data-baseweb="select"] > div {
    background: var(--ink) !important;
    color: var(--parchment) !important;
    border: 1px solid var(--hairline) !important;
    border-radius: 4px !important;
}
.stTextInput input:focus {
    border-color: var(--brass) !important;
    box-shadow: 0 0 0 1px var(--brass) !important;
}
.stSlider [data-baseweb="slider"] div[role="slider"] {
    background-color: var(--brass) !important;
}

/* primary button -> brass plaque */
.stButton > button {
    background: var(--brass) !important;
    color: var(--ink) !important;
    border: none !important;
    border-radius: 4px !important;
    font-family: 'JetBrains Mono', monospace !important;
    font-weight: 700 !important;
    letter-spacing: 0.06em !important;
    text-transform: uppercase !important;
    font-size: 0.78rem !important;
    padding: 0.6rem 1rem !important;
    transition: filter 0.15s ease;
}
.stButton > button:hover { filter: brightness(1.12); }

/* ---------- Turn cards (the debate transcript) ---------- */
.turn-row { display: flex; margin-bottom: 0.85rem; }
.turn-row.side-proponent { justify-content: flex-start; }
.turn-row.side-opponent { justify-content: flex-end; }

.turn-card {
    max-width: 86%;
    border-radius: 10px;
    padding: 1rem 1.15rem;
    border: 1px solid var(--hairline);
    background: var(--ink-raised);
}
.turn-card.proponent { border-left: 3px solid var(--amber); }
.turn-card.opponent { border-right: 3px solid var(--slate); }

.turn-meta {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
}
.side-chip {
    font-family: 'JetBrains Mono', monospace;
    font-size: 0.66rem;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    padding: 0.16rem 0.5rem;
    border-radius: 3px;
}
.side-chip.proponent { background: var(--amber-dim); color: var(--amber); }
.side-chip.opponent { background: var(--slate-dim); color: var(--slate); }
.round-marker {
    font-family: 'JetBrains Mono', monospace;
    font-size: 0.7rem;
    color: rgba(236,231,219,0.4);
}
.turn-argument {
    font-family: 'Source Serif 4', serif;
    font-size: 0.98rem;
    line-height: 1.6;
    color: rgba(236,231,219,0.92);
    margin: 0;
}
.cursor {
    color: var(--brass);
    animation: blink 0.9s steps(1) infinite;
}
@keyframes blink { 50% { opacity: 0; } }

/* sources / evidence footnotes */
details.evidence {
    margin-top: 0.7rem;
    border-top: 1px dashed var(--hairline);
    padding-top: 0.5rem;
}
details.evidence summary {
    font-family: 'JetBrains Mono', monospace;
    font-size: 0.68rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: rgba(236,231,219,0.5);
    cursor: pointer;
}
.evidence-item {
    font-family: 'Source Serif 4', serif;
    font-style: italic;
    font-size: 0.85rem;
    color: rgba(236,231,219,0.65);
    margin: 0.35rem 0 0 0.2rem;
    line-height: 1.4;
}
.evidence-item a { color: var(--brass); text-decoration: underline; text-underline-offset: 2px; }
.evidence-item a:hover { color: var(--amber); }

/* ---------- Verdict seal ---------- */
.verdict-seal {
    margin-top: 2rem;
    border-top: 2px double var(--brass);
    border-bottom: 2px double var(--brass);
    padding: 1.3rem 0.2rem;
}
.verdict-label {
    font-family: 'JetBrains Mono', monospace;
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    color: var(--brass);
    text-align: center;
    margin-bottom: 0.8rem;
}
.verdict-text {
    font-family: 'Source Serif 4', serif;
    font-size: 1rem;
    line-height: 1.65;
    color: var(--parchment);
    white-space: pre-wrap;
}

/* status text override */
.stStatusWidget-content, div[data-testid="stStatusWidget"] {
    font-family: 'JetBrains Mono', monospace !important;
}
</style>
"""

st.markdown(CSS, unsafe_allow_html=True)

st.markdown(
    _dedent_html("""
    <div class="eyebrow">LangGraph &middot; Multi-Agent Debate</div>
    <div class="masthead">Debate<em>Bot</em></div>
    <div class="subhead">Two agents argue fixed, opposing sides of your topic — each one
    required to cite real evidence before speaking. A judge agent reviews the full record
    and delivers a reasoned verdict.</div>
    <hr class="masthead-rule" />
    """),
    unsafe_allow_html=True,
)

# --- Sidebar controls -------------------------------------------------
with st.sidebar:
    st.markdown("### Setup")

    try:
        default_key = st.secrets.get("GROQ_API_KEY", os.environ.get("GROQ_API_KEY", ""))
    except Exception:
        default_key = os.environ.get("GROQ_API_KEY", "")
    api_key_input = st.text_input("Groq API key", type="password", value=default_key)
    if api_key_input:
        os.environ["GROQ_API_KEY"] = api_key_input

    model_choice = st.selectbox(
        "Model",
        ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "openai/gpt-oss-120b"],
        index=0,
    )
    os.environ["GROQ_MODEL"] = model_choice

    rounds = st.slider("Number of rounds", min_value=1, max_value=6, value=3)

    st.markdown("---")
    st.markdown(
        "**How it works**\n\n"
        "1. Proponent argues FOR the topic, using a live web search as evidence.\n"
        "2. Opponent argues AGAINST, same rule.\n"
        "3. Repeats for the chosen number of rounds.\n"
        "4. Judge agent reviews everything and declares a winner or draw."
    )

topic = st.text_input("Debate topic", placeholder="e.g. Should schools ban smartphones for students under 16?")
start = st.button("Start Debate", type="primary", use_container_width=True)


def _friendly_source_name(title: str, url: str) -> str:
    """DuckDuckGo sometimes returns an empty title, or a title that's
    really just the raw URL. Fall back to a clean domain name (e.g.
    'pmc.ncbi.nlm.nih.gov' instead of the full https://... link) so the
    citation always reads as a name, never a wall of URL text."""
    title = (title or "").strip()
    if title and not title.lower().startswith(("http://", "https://")):
        return title
    if url:
        domain = urlparse(url).netloc
        if domain.startswith("www."):
            domain = domain[4:]
        return domain or "Source"
    return "Source"


def _build_turn_card(turn: dict, revealed_text: str, show_evidence: bool, show_cursor: bool) -> str:
    side = turn["side"]
    side_class = "proponent" if side == "Proponent" else "opponent"
    row_class = "side-proponent" if side == "Proponent" else "side-opponent"
    stance = "FOR" if side == "Proponent" else "AGAINST"

    evidence_block = ""
    if show_evidence:
        sources_html = ""
        for s in turn["sources"]:
            url = s.get("url", "")
            display_name = html.escape(_friendly_source_name(s.get("title", ""), url))
            snippet = html.escape(s.get("snippet", ""))
            if url:
                sources_html += f'<div class="evidence-item"><a href="{html.escape(url)}" target="_blank" rel="noopener noreferrer">{display_name}</a> — {snippet}</div>'
            else:
                sources_html += f'<div class="evidence-item">{display_name} — {snippet}</div>'
        evidence_block = f"""
        <details class="evidence">
          <summary>Sources cited</summary>
          {sources_html or '<div class="evidence-item">No sources found.</div>'}
        </details>
        """

    cursor = '<span class="cursor">&#9612;</span>' if show_cursor else ""

    return _dedent_html(f"""
    <div class="turn-row {row_class}">
      <div class="turn-card {side_class}">
        <div class="turn-meta">
          <span class="side-chip {side_class}">{side} &middot; {stance}</span>
          <span class="round-marker">Round {turn['round']}</span>
        </div>
        <p class="turn-argument">{html.escape(revealed_text)}{cursor}</p>
        {evidence_block}
      </div>
    </div>
    """)


def render_turn_typewriter(placeholder, turn: dict, chunk_size: int = 3, delay: float = 0.012):
    """Reveals the argument in small chunks so it types out instead of
    appearing all at once. The evidence footnotes fade in only once the
    full argument has finished 'typing'."""
    full_text = turn["argument"]
    for i in range(chunk_size, len(full_text) + chunk_size, chunk_size):
        revealed = full_text[:i]
        placeholder.markdown(
            _build_turn_card(turn, revealed, show_evidence=False, show_cursor=True),
            unsafe_allow_html=True,
        )
        time.sleep(delay)
    # final frame: full text, no cursor, sources revealed
    placeholder.markdown(
        _build_turn_card(turn, full_text, show_evidence=True, show_cursor=False),
        unsafe_allow_html=True,
    )


def render_verdict_typewriter(placeholder, verdict_text: str, chunk_size: int = 3, delay: float = 0.012):
    for i in range(chunk_size, len(verdict_text) + chunk_size, chunk_size):
        revealed = verdict_text[:i]
        block = _dedent_html(f"""
        <div class="verdict-seal">
          <div class="verdict-label">&#9878; Judge's Verdict</div>
          <div class="verdict-text">{html.escape(revealed)}<span class="cursor">&#9612;</span></div>
        </div>
        """)
        placeholder.markdown(block, unsafe_allow_html=True)
        time.sleep(delay)
    final_block = _dedent_html(f"""
    <div class="verdict-seal">
      <div class="verdict-label">&#9878; Judge's Verdict</div>
      <div class="verdict-text">{html.escape(verdict_text)}</div>
    </div>
    """)
    placeholder.markdown(final_block, unsafe_allow_html=True)


# --- Run + render -------------------------------------------------------
if start:
    if not os.environ.get("GROQ_API_KEY"):
        st.error("Please enter your Groq API key in the sidebar first.")
        st.stop()
    if not topic.strip():
        st.error("Please enter a debate topic.")
        st.stop()

    with st.status("Debate in progress...", expanded=True) as status:
        for update in prefetch_ahead(stream_debate(topic, max_rounds=rounds)):
            for node_name, partial_state in update.items():
                if node_name in ("proponent", "opponent") and "transcript" in partial_state:
                    turn = partial_state["transcript"][-1]
                    placeholder = st.empty()
                    render_turn_typewriter(placeholder, turn)

                if node_name == "judge" and "verdict" in partial_state:
                    status.update(label="Debate finished — verdict is in", state="complete")
                    verdict_placeholder = st.empty()
                    render_verdict_typewriter(verdict_placeholder, partial_state["verdict"])
