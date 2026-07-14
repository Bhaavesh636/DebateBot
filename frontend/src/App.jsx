import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Swords, Play, Loader2, Scale, Bot, History as HistoryIcon, Info, X,
  Github, Linkedin, Link2, Repeat, Zap, Cpu as CpuIcon, ShieldCheck, Trophy, Sparkles, ArrowLeft, Calendar,
} from 'lucide-react'

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000'
const MODELS = [
  'llama-3.3-70b-versatile',
  'llama-3.1-8b-instant',
  'meta-llama/llama-4-scout-17b-16e-instruct',
  'openai/gpt-oss-120b'
]
const HISTORY_KEY = 'debatebot_history'
const QUICK_TOPICS = [
  'Should schools ban smartphones for students under 16?',
  'Should a four-day work week become standard?',
  'Is remote work better than office work for software teams?',
  'Should college education be free for all students?',
  'Should artificial intelligence be allowed to create art and write books?',
  'Will social media do more harm than good to future generations?',
  'Should space exploration be funded by governments or left to private companies?',
  'Is nuclear energy the best alternative to fossil fuels?',
  'Should public transport be completely free for everyone?',
  'Does testing cosmetics and medicines on animals justify the scientific benefits?',
  'Should video games be considered a professional sport?',
  'Should voting in national elections be mandatory for all citizens?',
  'Is online learning as effective as traditional classroom learning?',
  'Should cryptocurrency replace traditional fiat currency?',
  'Should fast food advertising be banned or heavily restricted?',
  'Is exploration of the deep ocean more important than space exploration?',
  'Should genetic editing of human embryos be permitted for disease prevention?',
  'Will automation and robots lead to permanent mass unemployment?',
  'Should homework be banned in primary schools?',
  'Is privacy completely dead in the digital age?',
  'Should public security cameras with facial recognition be banned?',
  'Should animal zoos be banned worldwide?',
  'Is cash obsolete in today\'s digital economy?',
  'Should the minimum voting age be lowered to 16?',
  'Does excessive screen time permanently damage cognitive development?'
]

function TopicRoller({ onSelectTopic }) {
  const [topicIndex, setTopicIndex] = useState(0)
  const [displayedText, setDisplayedText] = useState('')
  const [isDeleting, setIsDeleting] = useState(false)

  useEffect(() => {
    let timer
    const targetText = QUICK_TOPICS[topicIndex]

    if (isDeleting) {
      if (displayedText.length > 0) {
        timer = setTimeout(() => {
          setDisplayedText(prev => prev.slice(0, -1))
        }, 15)
      } else {
        setIsDeleting(false)
        setTopicIndex(prev => {
          let next = prev
          while (next === prev) {
            next = Math.floor(Math.random() * QUICK_TOPICS.length)
          }
          return next
        })
      }
    } else {
      if (displayedText.length < targetText.length) {
        timer = setTimeout(() => {
          setDisplayedText(targetText.slice(0, displayedText.length + 1))
        }, 30)
      }
    }

    return () => clearTimeout(timer)
  }, [displayedText, isDeleting, topicIndex])

  const handleReroll = (e) => {
    e.stopPropagation()
    setIsDeleting(true)
  }

  return (
    <div className="topic-roller-box" onClick={() => onSelectTopic(displayedText)}>
      <div className="topic-roller-content">
        <span className="topic-roller-text">
          {displayedText}
          <span className="cursor-active">&#9612;</span>
        </span>
      </div>
      <button className="topic-reroll-btn" onClick={handleReroll} title="Get another topic">
        <Repeat size={16} />
      </button>
    </div>
  )
}

function friendlySourceName(title, url) {
  const t = (title || '').trim()
  if (t && !/^https?:\/\//i.test(t)) return t
  if (url) {
    try {
      const hostname = new URL(url).hostname
      return hostname.startsWith('www.') ? hostname.slice(4) : hostname
    } catch {
      return 'Source'
    }
  }
  return 'Source'
}

function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]')
  } catch {
    return []
  }
}

function saveHistory(list) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list))
  } catch {
    /* localStorage unavailable (private browsing, etc.) — fail silently */
  }
}

const cardEnter = {
  hidden: { opacity: 0, y: 24, scale: 0.98 },
  visible: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] } },
  exit: { opacity: 0, scale: 0.97, transition: { duration: 0.2 } },
}

/** A single turn card. Types out its own argument text once, on mount. */
function TurnCard({ turn }) {
  const [revealed, setRevealed] = useState('')
  const [done, setDone] = useState(false)

  useEffect(() => {
    let i = 0
    const chunkSize = 3
    const id = setInterval(() => {
      i += chunkSize
      setRevealed(turn.argument.slice(0, i))
      if (i >= turn.argument.length) {
        clearInterval(id)
        setDone(true)
      }
    }, 12)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const isProponent = turn.side === 'Proponent'
  const stance = isProponent ? 'FOR' : 'AGAINST'
  const sideClass = isProponent ? 'proponent' : 'opponent'
  const rowClass = isProponent ? 'side-proponent' : 'side-opponent'

  return (
    <motion.div className={`turn-row ${rowClass}`} variants={cardEnter} initial="hidden" animate="visible" layout>
      <div className={`avatar ${sideClass}`}><Bot size={17} /></div>
      <div className={`turn-card ${sideClass}`}>
        <div className="turn-meta">
          <span className={`side-chip ${sideClass}`}>{turn.side} &middot; {stance}</span>
          <span className="round-marker">Round {turn.round}</span>
        </div>
        <p className="turn-argument">
          {revealed}
          {!done && <span className="cursor">&#9612;</span>}
        </p>
        {done && (
          <details className="evidence">
            <summary>Sources cited</summary>
            {(turn.sources || []).map((s, i) => {
              const name = friendlySourceName(s.title, s.url)
              return (
                <div className="evidence-item" key={i}>
                  {s.url ? <a href={s.url} target="_blank" rel="noopener noreferrer">{name}</a> : name}
                  {' — '}{s.snippet}
                </div>
              )
            })}
          </details>
        )}
      </div>
    </motion.div>
  )
}

/** Static (no typewriter) turn card used in replay view */
function StaticTurnCard({ turn, index }) {
  const isProponent = turn.side === 'Proponent'
  const stance = isProponent ? 'FOR' : 'AGAINST'
  const sideClass = isProponent ? 'proponent' : 'opponent'
  const rowClass = isProponent ? 'side-proponent' : 'side-opponent'
  return (
    <motion.div
      className={`turn-row ${rowClass}`}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.04, duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className={`avatar ${sideClass}`}><Bot size={17} /></div>
      <div className={`turn-card ${sideClass}`}>
        <div className="turn-meta">
          <span className={`side-chip ${sideClass}`}>{turn.side} &middot; {stance}</span>
          <span className="round-marker">Round {turn.round}</span>
        </div>
        <p className="turn-argument">{turn.argument}</p>
        <details className="evidence">
          <summary>Sources cited</summary>
          {(turn.sources || []).map((s, i) => {
            const name = friendlySourceName(s.title, s.url)
            return (
              <div className="evidence-item" key={i}>
                {s.url ? <a href={s.url} target="_blank" rel="noopener noreferrer">{name}</a> : name}
                {' — '}{s.snippet}
              </div>
            )
          })}
        </details>
      </div>
    </motion.div>
  )
}

function ThinkingCard({ side }) {
  const isProponent = side === 'Proponent'
  const sideClass = isProponent ? 'proponent' : 'opponent'
  const rowClass = isProponent ? 'side-proponent' : 'side-opponent'
  return (
    <motion.div
      className={`turn-row ${rowClass}`}
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}
    >
      <div className={`avatar ${sideClass}`}><Bot size={17} /></div>
      <div className={`turn-card ${sideClass} thinking-card`}>
        <span className={`side-chip ${sideClass}`}>{side}</span>
        <div className="thinking-dots"><span /><span /><span /></div>
        <span className="thinking-label">gathering evidence…</span>
      </div>
    </motion.div>
  )
}

/** Extract winner from verdict text. Checks for the structured "Winner: X" line first,
 *  then falls back to heuristic pattern matching. */
function parseWinner(text) {
  // Primary: match the explicit "Winner: Proponent / Opponent / Draw" line from the judge prompt
  const explicitMatch = text.match(/winner\s*:\s*(proponent|opponent|draw)/i)
  if (explicitMatch) {
    const val = explicitMatch[1].toLowerCase()
    if (val === 'draw') return { side: null, stance: null, isDraw: true }
    if (val === 'proponent') return { side: 'Proponent', stance: 'FOR', isDraw: false }
    if (val === 'opponent') return { side: 'Opponent', stance: 'AGAINST', isDraw: false }
  }

  // Fallback heuristics for older / differently-formatted verdicts
  const drawPatterns = [/\bdraw\b/i, /\btie\b/i, /\bno\s+clear\s+winner\b/i, /\bboth.*?equal\b/i]
  const proponentWinPatterns = [
    /\bproponent\b.*?\bwins?\b/i, /\bvictory.*?proponent\b/i,
    /\bproponent\b.*?\bvictory\b/i, /\bproponent\b.*?\bstronger\b/i,
  ]
  const opponentWinPatterns = [
    /\bopponent\b.*?\bwins?\b/i, /\bvictory.*?opponent\b/i,
    /\bopponent\b.*?\bvictory\b/i, /\bopponent\b.*?\bstronger\b/i,
  ]

  // Only call draw if NONE of the win patterns matched at all
  const hasProponent = proponentWinPatterns.some(p => p.test(text))
  const hasOpponent = opponentWinPatterns.some(p => p.test(text))
  if (!hasProponent && !hasOpponent && drawPatterns.some(p => p.test(text))) {
    return { side: null, stance: null, isDraw: true }
  }
  if (hasProponent && !hasOpponent) return { side: 'Proponent', stance: 'FOR', isDraw: false }
  if (hasOpponent && !hasProponent) return { side: 'Opponent', stance: 'AGAINST', isDraw: false }

  // Both matched or neither — use position as tiebreaker
  const proponentIdx = text.toLowerCase().indexOf('proponent')
  const opponentIdx = text.toLowerCase().indexOf('opponent')
  if (proponentIdx !== -1 && (opponentIdx === -1 || proponentIdx < opponentIdx)) {
    return { side: 'Proponent', stance: 'FOR', isDraw: false }
  }
  if (opponentIdx !== -1) return { side: 'Opponent', stance: 'AGAINST', isDraw: false }
  return null
}

/** Parse the judge's verdict text into structured sections. */
function parseVerdict(text) {
  const lines = text.split('\n')
  let proponentPoint = ''
  let opponentPoint = ''
  let scoring = []
  let roundsAnalysis = []
  let finalVerdict = ''

  let currentSection = 0 // 0: none/intro, 1: proponent, 2: opponent, 3: scoring/rounds, 4: final

  for (let line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    if (trimmed.startsWith('1.') || /proponent's\s+strongest/i.test(trimmed)) {
      currentSection = 1
      proponentPoint = trimmed.replace(/^1\.\s*/, '')
      continue
    }
    if (trimmed.startsWith('2.') || /opponent's\s+strongest/i.test(trimmed)) {
      currentSection = 2
      opponentPoint = trimmed.replace(/^2\.\s*/, '')
      continue
    }
    if (trimmed.startsWith('3.') || /round-by-round|scoring|analysis/i.test(trimmed)) {
      currentSection = 3
      const content = trimmed.replace(/^3\.\s*(round-by-round\s+analysis:?|scoring\s+breakdown:?)?\s*/i, '')
      if (content) {
        const roundMatch = content.match(/^round\s*(\d+)\s*:\s*(.*)/i)
        if (roundMatch) {
          roundsAnalysis.push({
            roundNum: parseInt(roundMatch[1], 10),
            critique: roundMatch[2].trim()
          })
        } else {
          scoring.push(content)
        }
      }
      continue
    }
    if (trimmed.startsWith('4.') || /final\s+verdict/i.test(trimmed)) {
      currentSection = 4
      finalVerdict = trimmed.replace(/^4\.\s*(final\s+verdict:?)?\s*/i, '')
      continue
    }

    if (currentSection === 1) {
      proponentPoint += ' ' + trimmed
    } else if (currentSection === 2) {
      opponentPoint += ' ' + trimmed
    } else if (currentSection === 3) {
      const roundMatch = trimmed.match(/^round\s*(\d+)\s*:\s*(.*)/i)
      if (roundMatch) {
        roundsAnalysis.push({
          roundNum: parseInt(roundMatch[1], 10),
          critique: roundMatch[2].trim()
        })
      } else {
        if (roundsAnalysis.length > 0) {
          roundsAnalysis[roundsAnalysis.length - 1].critique += ' ' + trimmed
        } else {
          scoring.push(trimmed)
        }
      }
    } else if (currentSection === 4) {
      finalVerdict += ' ' + trimmed
    }
  }

  return {
    proponentPoint: proponentPoint.trim(),
    opponentPoint: opponentPoint.trim(),
    scoring: scoring.filter(Boolean),
    roundsAnalysis: roundsAnalysis,
    finalVerdict: finalVerdict.trim(),
  }
}

/** Renders the judge's verdict broken down into visual, structured blocks. */
function StructuredVerdict({ text, fullText = text, done = true }) {
  const winner = parseWinner(text)
  const parsed = parseVerdict(text)

  const fullParsed = parseVerdict(fullText)
  const isStructured = !!(fullParsed.proponentPoint || fullParsed.opponentPoint || fullParsed.finalVerdict)

  // Fallback to plain text if the full text does not match the structured format
  if (!isStructured) {
    return <div className="verdict-text">{text}</div>
  }

  // Clean final verdict text if it starts with the winner declaration
  let cleanedFinalVerdict = parsed.finalVerdict
  if (winner) {
    cleanedFinalVerdict = cleanedFinalVerdict.replace(/^winner\s*:\s*(proponent|opponent|draw)\.?,?\s*/i, '')
  }

  // Determine which section is currently active and typing (if not done)
  const activeSection = (() => {
    if (done) return null
    if (parsed.finalVerdict) return 'final'
    if ((parsed.roundsAnalysis && parsed.roundsAnalysis.length > 0) || (parsed.scoring && parsed.scoring.length > 0)) return 'analysis'
    if (parsed.opponentPoint) return 'opponent'
    if (parsed.proponentPoint) return 'proponent'
    return 'proponent'
  })()

  // Winner is only revealed once all typing is complete
  const winnerRevealed = done

  return (
    <div className="structured-verdict">
      {/* 1. Winner Block — at the TOP, but shows "Winner yet to be declared" until typing finishes */}
      <div className={`dedicated-winner-block ${winnerRevealed && winner && winner.side ? (winner.side === 'Proponent' ? 'proponent' : 'opponent') : 'draw'}`}>
        <div className="winner-glow" />
        <div className="winner-block-header">
          {winnerRevealed && winner && winner.isDraw
            ? <Scale size={24} className="winner-trophy" />
            : <Trophy size={24} className="winner-trophy" />}
          <div className="winner-block-title-group">
            <span className="winner-eyebrow">
              {winnerRevealed
                ? (winner && winner.isDraw ? 'Outcome' : 'Winner Declared')
                : 'Evaluating...'}
            </span>
            <h3 className="winner-name">
              {winnerRevealed
                ? (winner ? (winner.isDraw ? "It's a Draw" : winner.side) : 'Weighing Verdict...')
                : 'Winner yet to be declared'}
            </h3>
          </div>
          {winnerRevealed && winner && !winner.isDraw && (
            <div className={`winner-stance-badge ${winner.side === 'Proponent' ? 'proponent' : 'opponent'}`}>
              {winner.stance}
            </div>
          )}
          {winnerRevealed && winner && !winner.isDraw && <Sparkles size={18} className="winner-sparkle" />}
        </div>
        {winnerRevealed && (cleanedFinalVerdict || activeSection === 'final') && (
          <div className="winner-justification">
            <p className="justification-text">
              {cleanedFinalVerdict}
              {activeSection === 'final' && <span className="cursor">&#9612;</span>}
            </p>
          </div>
        )}
      </div>

      {/* 2. Strongest Points Side-by-Side */}
      {(parsed.proponentPoint || parsed.opponentPoint || activeSection === 'proponent' || activeSection === 'opponent') && (
        <div className="verdict-points-grid">
          <div className="verdict-point-card proponent">
            <div className="point-card-header proponent">
              <span className="point-card-dot proponent" />
              Proponent's Core Strength
            </div>
            <p className="point-card-text">
              {parsed.proponentPoint}
              {activeSection === 'proponent' && <span className="cursor">&#9612;</span>}
            </p>
          </div>
          {(parsed.opponentPoint || activeSection === 'opponent') && (
            <div className="verdict-point-card opponent">
              <div className="point-card-header opponent">
                <span className="point-card-dot opponent" />
                Opponent's Core Strength
              </div>
              <p className="point-card-text">
                {parsed.opponentPoint}
                {activeSection === 'opponent' && <span className="cursor">&#9612;</span>}
              </p>
            </div>
          )}
        </div>
      )}

      {/* 3. Round-by-Round Analysis Cards */}
      {((parsed.roundsAnalysis && parsed.roundsAnalysis.length > 0) || activeSection === 'analysis') && (
        <div className="verdict-rounds-section">
          <h4 className="scoring-card-title">Round-by-Round Analysis</h4>
          <div className="verdict-rounds-grid">
            {parsed.roundsAnalysis.map((item, idx) => (
              <div key={idx} className="verdict-round-card">
                <div className="round-card-header">
                  <span className="round-card-badge">Round {item.roundNum}</span>
                </div>
                <p className="round-card-critique">
                  {item.critique}
                  {activeSection === 'analysis' && idx === parsed.roundsAnalysis.length - 1 && <span className="cursor">&#9612;</span>}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 4. Fallback Scoring Breakdown */}
      {parsed.scoring && parsed.scoring.length > 0 && (
        <div className="verdict-scoring-card">
          <h4 className="scoring-card-title">Analysis & Evaluation</h4>
          <ul className="scoring-list">
            {parsed.scoring.map((item, idx) => (
              <li key={idx} className="scoring-item">
                <span className="scoring-bullet">✔</span>
                <span className="scoring-item-text">{item}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function VerdictCard({ text }) {
  const [revealed, setRevealed] = useState('')
  const [done, setDone] = useState(false)

  useEffect(() => {
    let i = 0
    const chunkSize = 3
    const id = setInterval(() => {
      i += chunkSize
      setRevealed(text.slice(0, i))
      if (i >= text.length) {
        clearInterval(id)
        setDone(true)
      }
    }, 12)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text])

  return (
    <motion.div
      className="verdict-card"
      initial={{ opacity: 0, y: 30, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="verdict-label"><Scale size={16} /> Judge's Verdict</div>
      <StructuredVerdict text={revealed} fullText={text} done={done} />
    </motion.div>
  )
}

function HistoryDrawer({ history, onClose, onClear, onSelect }) {
  return (
    <>
      <motion.div className="drawer-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
      <motion.aside
        className="history-drawer"
        initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
        transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="history-header">
          <div>
            <div className="history-eyebrow">Local History</div>
            <div className="history-count">{history.length} saved debate{history.length === 1 ? '' : 's'}</div>
          </div>
          <button className="history-close" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="history-note">
          <ShieldCheck size={15} style={{ marginTop: 2, flexShrink: 0 }} />
          Everything here is stored locally in your browser. Nothing is uploaded.
        </div>

        {history.length === 0 ? (
          <div className="history-empty">Finished debates will appear here.</div>
        ) : (
          <>
            {history.map((h) => (
              <button
                className="history-item history-item-clickable"
                key={h.id}
                onClick={() => { onSelect(h); onClose() }}
              >
                <div className="history-item-open-hint">View debate →</div>
                <div className="history-item-topic">{h.topic}</div>
                <div className="history-item-meta">
                  <Calendar size={11} />
                  <span>{new Date(h.timestamp).toLocaleString()}</span>
                  <span>&middot;</span>
                  <span>{h.rounds} rounds</span>
                  <span>&middot;</span>
                  <CpuIcon size={11} />
                  <span>{h.model}</span>
                </div>
                <div className="history-item-verdict">
                  {h.verdict.length > 160 ? h.verdict.slice(0, 160) + '…' : h.verdict}
                </div>
              </button>
            ))}
            <button className="history-clear-btn" onClick={onClear}>Clear history</button>
          </>
        )}
      </motion.aside>
    </>
  )
}

function ReplayView({ debate, onBack }) {
  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
      {/* Header */}
      <div className="replay-header">
        <button className="about-back replay-back" onClick={onBack}>
          <ArrowLeft size={15} /> Back
        </button>
        <div className="replay-meta">
          <span className="replay-meta-item"><Calendar size={12} />{new Date(debate.timestamp).toLocaleString()}</span>
          <span className="replay-meta-item"><CpuIcon size={12} />{debate.model}</span>
          <span className="replay-meta-item">· {debate.rounds} rounds</span>
        </div>
      </div>

      <div className="replay-topic-block">
        <div className="eyebrow" style={{ justifyContent: 'flex-start', marginBottom: '0.7rem' }}>
          <span className="dot" /> Debate Replay
        </div>
        <h1 className="replay-topic">{debate.topic}</h1>
      </div>

      {/* Transcript */}
      <section className="transcript" style={{ marginBottom: '1.5rem' }}>
        {(debate.turns || []).map((t, i) => (
          <StaticTurnCard key={i} turn={t} index={i} />
        ))}
        {(!debate.turns || debate.turns.length === 0) && (
          <div style={{ color: 'var(--text-faint)', fontSize: '0.88rem', textAlign: 'center', padding: '2rem' }}>
            Transcript not available — this debate was saved before replay was supported.
          </div>
        )}
      </section>

      {/* Verdict */}
      <div className="verdict-card">
        <div className="verdict-label"><Scale size={16} /> Judge's Verdict</div>
        <StructuredVerdict text={debate.verdict} />
      </div>
    </motion.div>
  )
}

function AboutPage({ onBack }) {
  const features = [
    { icon: <Swords size={16} />, title: 'Fixed-side debating', desc: 'Each agent is pinned to FOR or AGAINST for the entire debate — no switching sides.' },
    { icon: <Link2 size={16} />, title: 'Real evidence citations', desc: 'Every argument must cite a live web search result, not just an assertion.' },
    { icon: <Repeat size={16} />, title: 'Multi-round structure', desc: 'Configurable round count, with each side responding directly to the last point.' },
    { icon: <Scale size={16} />, title: 'Reasoned judge verdict', desc: 'An impartial agent reviews the full transcript and explains its reasoning.' },
    { icon: <Zap size={16} />, title: 'Streaming responses', desc: 'Server-Sent Events push each turn the moment it is ready — no long single wait.' },
    { icon: <CpuIcon size={16} />, title: 'LangGraph + Groq', desc: 'Multi-agent orchestration via LangGraph, fast inference via Groq\u2019s Llama models.' },
  ]

  return (
    <div>
      <button className="about-back" onClick={onBack}>&larr; Home</button>
      <h1 className="about-title">About <em>DebateBot</em></h1>
      <p className="about-subhead">
        DebateBot was built to make AI-generated argument actually accountable — every claim
        traceable to a real source, every side held to its position, every verdict explained.
      </p>

      <div className="about-grid-2">
        <div className="about-card">
          <h3>The problem</h3>
          <p>Most AI "debate" demos let a model argue loosely on both sides at once, with no
          requirement to back claims up — making the exchange hard to trust or learn from.</p>
        </div>
        <div className="about-card alt">
          <h3>Why I built this</h3>
          <p>As a computer science student building multi-agent LLM systems, I wanted two
          agents that stay strictly on one side and must ground every point in a real
          search result, judged by a third, impartial agent.</p>
        </div>
      </div>

      <div className="section-eyebrow">Key Features</div>
      <div className="section-title">Everything a structured debate needs</div>
      <div className="feature-grid">
        {features.map((f) => (
          <div className="feature-card" key={f.title}>
            <h4>{f.icon} {f.title}</h4>
            <p>{f.desc}</p>
          </div>
        ))}
      </div>

      <div className="privacy-note">
        <ShieldCheck size={16} />
        <span>
          Debate history is stored only in your browser's local storage — nothing is uploaded
          anywhere. The Groq API key that powers the agents lives only in the backend
          server's environment file and never touches the browser.
        </span>
      </div>

      <div className="creator-card">
        <div className="creator-avatar">JB</div>
        <div>
          <div className="creator-label">Creator</div>
          <div className="creator-name">Janapareddi Bhaavesh Sai Mohan</div>
          <div className="creator-role">Computer Science Engineering Student &middot; AI Engineer Launchpad</div>
          <div className="creator-links">
            <a href="https://github.com/Bhaavesh636" target="_blank" rel="noopener noreferrer"><Github size={14} /> GitHub</a>
            <a href="https://www.linkedin.com/in/bhaavesh-janapareddi/" target="_blank" rel="noopener noreferrer"><Linkedin size={14} /> LinkedIn</a>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function App() {
  const [view, setView] = useState('home') // home | about | replay
  const [replayDebate, setReplayDebate] = useState(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [history, setHistory] = useState(loadHistory)

  const [topic, setTopic] = useState('')
  const [showTooltip, setShowTooltip] = useState(false)
  const [rounds, setRounds] = useState(3)
  const [model, setModel] = useState(MODELS[0])
  const [turns, setTurns] = useState([])
  const [verdict, setVerdict] = useState(null)
  const [verdictVisible, setVerdictVisible] = useState(false)
  const [status, setStatus] = useState('idle') // idle | running | done | error
  const [errorMsg, setErrorMsg] = useState('')
  const esRef = useRef(null)
  const recordedRef = useRef(false)
  const verdictTimerRef = useRef(null)

  useEffect(() => () => { esRef.current?.close(); clearTimeout(verdictTimerRef.current) }, [])

  // Show verdict 2 seconds after it becomes available (i.e. after all turns are displayed)
  useEffect(() => {
    if (verdict && status === 'done') {
      verdictTimerRef.current = setTimeout(() => setVerdictVisible(true), 2000)
      return () => clearTimeout(verdictTimerRef.current)
    } else {
      setVerdictVisible(false)
    }
  }, [verdict, status])

  // Record a finished debate into local history exactly once.
  useEffect(() => {
    if (status === 'done' && verdict && !recordedRef.current) {
      recordedRef.current = true
      const entry = {
        id: Date.now(),
        topic,
        rounds,
        model,
        verdict,
        turns,          // save full transcript for replay
        timestamp: new Date().toISOString(),
      }
      setHistory((prev) => {
        const next = [entry, ...prev].slice(0, 30)
        saveHistory(next)
        return next
      })
    }
  }, [status, verdict, topic, rounds, model, turns])

  function startDebate() {
    if (!topic.trim()) {
      setShowTooltip(true)
      setTimeout(() => setShowTooltip(false), 3000)
      return
    }
    if (status === 'running') return

    setTurns([])
    setVerdict(null)
    setVerdictVisible(false)
    setErrorMsg('')
    setStatus('running')
    recordedRef.current = false
    clearTimeout(verdictTimerRef.current)
    esRef.current?.close()

    const params = new URLSearchParams({ topic, rounds: String(rounds), model })
    const es = new EventSource(`${API_BASE}/api/debate?${params.toString()}`)
    esRef.current = es

    es.addEventListener('turn', (e) => setTurns((prev) => [...prev, JSON.parse(e.data)]))
    es.addEventListener('verdict', (e) => setVerdict(JSON.parse(e.data).verdict))
    es.addEventListener('done', () => { setStatus('done'); es.close() })
    es.addEventListener('error', (e) => {
      let msg = 'Connection error — is the backend server running on :8000?'
      try {
        const data = JSON.parse(e.data)
        if (data.message) msg = data.message
      } catch { /* non-structured drop */ }
      setErrorMsg(msg)
      setStatus('error')
      es.close()
    })
  }

  function clearHistory() {
    setHistory([])
    saveHistory([])
  }

  const totalTurns = rounds * 2
  const nextSide = turns.length % 2 === 0 ? 'Proponent' : 'Opponent'
  const waitingForTurn = status === 'running' && turns.length < totalTurns
  const waitingForJudge = status === 'running' && turns.length >= totalTurns && !verdict
  const progressPct = Math.min(100, Math.round((turns.length / totalTurns) * 100)) || 0

  return (
    <div className="app-shell">
      <div className="aurora" />

      <nav className="navbar">
        <button className="nav-brand" onClick={() => setView('home')}>
          <span className="brand-icon"><Swords size={15} /></span>
          DebateBot
        </button>
        <div className="nav-links">
          <button className="nav-link" onClick={() => setHistoryOpen(true)}><HistoryIcon size={15} /> History</button>
          <button className={`nav-link ${view === 'about' ? 'active' : ''}`} onClick={() => setView('about')}>
            <Info size={15} /> About
          </button>
        </div>
      </nav>

      {view === 'about' ? (
        <AboutPage onBack={() => setView('home')} />
      ) : view === 'replay' && replayDebate ? (
        <ReplayView debate={replayDebate} onBack={() => setView('home')} />
      ) : (
        <>
          <motion.div className="hero" initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
            <div className="eyebrow"><span className="dot" /> LangGraph &middot; Multi-Agent Debate</div>
            <h1 className="masthead">Two sides. <em>One judge.</em></h1>
            <p className="subhead">
              Two agents argue fixed, opposing sides of your topic — each one required to cite
              real evidence before speaking. A judge agent reviews the full record and delivers
              a reasoned verdict.
            </p>
          </motion.div>

          <div className="quick-picks">
            <div className="quick-picks-label">Try this.....</div>
            <TopicRoller onSelectTopic={(t) => {
              setTopic(t)
              setShowTooltip(false)
            }} />
          </div>

          <motion.section
            className="setup-panel"
            initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.1 }}
          >
            <div className="field">
              <label>Debate topic</label>
              <input
                type="text"
                value={topic}
                onChange={(e) => {
                  setTopic(e.target.value)
                  setShowTooltip(false)
                }}
                placeholder=""
              />
            </div>
            <div className="field-row">
              <div className="field">
                <label>Model</label>
                <select value={model} onChange={(e) => setModel(e.target.value)}>
                  <option value="llama-3.3-70b-versatile">Llama 3.3 70B (Thorough & Detailed) — llama-3.3-70b-versatile</option>
                  <option value="llama-3.1-8b-instant">Llama 3.1 8B (Instant & Concise) — llama-3.1-8b-instant</option>
                  <option value="meta-llama/llama-4-scout-17b-16e-instruct">Llama 4 Scout (Quick MoE & Balanced) — meta-llama/llama-4-scout-17b</option>
                  <option value="openai/gpt-oss-120b">GPT OSS 120B (Heavy Reasoning & Deep) — openai/gpt-oss-120b</option>
                </select>
              </div>
            </div>
            <div className="field" style={{ marginTop: '0.6rem' }}>
              <label>Rounds: {rounds}</label>
              <div className="slider-container">
                <input type="range" min="1" max="6" value={rounds} onChange={(e) => setRounds(Number(e.target.value))} />
                <div className="slider-hints">
                  <span>1</span>
                  <span>2</span>
                  <span>3</span>
                  <span>4</span>
                  <span>5</span>
                  <span>6</span>
                </div>
              </div>
            </div>
            <div className="start-btn-wrapper">
              <AnimatePresence>
                {showTooltip && (
                  <motion.div
                    className="validation-tooltip"
                    initial={{ opacity: 0, y: 10, x: '-50%' }}
                    animate={{ opacity: 1, y: 0, x: '-50%' }}
                    exit={{ opacity: 0, y: 10, x: '-50%' }}
                    transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                  >
                    <span className="tooltip-dot" />
                    Enter a topic to get started
                  </motion.div>
                )}
              </AnimatePresence>
              <motion.button
                className={`start-btn ${!topic.trim() ? 'disabled-cursor' : ''}`}
                onClick={startDebate}
                disabled={status === 'running'}
                whileTap={topic.trim() && status !== 'running' ? { scale: 0.98 } : {}}
              >
                {status === 'running'
                  ? <><Loader2 size={17} className="spin" /> Debate in progress…</>
                  : <><Play size={16} /> Start Debate</>}
              </motion.button>
            </div>

            {status === 'running' && (
              <div className="progress-track">
                <motion.div className="progress-fill" animate={{ width: `${progressPct}%` }} transition={{ duration: 0.4 }} />
              </div>
            )}
          </motion.section>

          <AnimatePresence>
            {errorMsg && (
              <motion.div className="error-banner" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                {errorMsg}
              </motion.div>
            )}
          </AnimatePresence>

          {turns.length === 0 && (
            <div className="how-it-works-strip">
              <div className="how-step">
                <span className="step-num">1</span>
                <div className="step-content">
                  <div className="step-title">Enter Topic</div>
                  <div className="step-desc">Type your custom question or roll a random topic above.</div>
                </div>
              </div>
              <div className="step-connector">➔</div>
              <div className="how-step">
                <span className="step-num">2</span>
                <div className="step-content">
                  <div className="step-title">Agents Debate</div>
                  <div className="step-desc">Two AI agents argue fixed sides using real search citations.</div>
                </div>
              </div>
              <div className="step-connector">➔</div>
              <div className="how-step">
                <span className="step-num">3</span>
                <div className="step-content">
                  <div className="step-title">Judge Decides</div>
                  <div className="step-desc">An impartial judge evaluates each round & declares the winner.</div>
                </div>
              </div>
            </div>
          )}

          {turns.length === 0 && status === 'running' && (
            <div className="cold-start-note">
              ℹ The backend server is spinning up... Please wait 30–60 seconds.
            </div>
          )}

          <section className="transcript">
            <AnimatePresence mode="popLayout">
              {turns.map((t, i) => <TurnCard key={i} turn={t} />)}
              {waitingForTurn && <ThinkingCard key="thinking" side={nextSide} />}
            </AnimatePresence>
          </section>

          <AnimatePresence>
            {waitingForJudge && (
              <motion.div
                key="judge-thinking" className="turn-row" style={{ justifyContent: 'center', marginTop: '1rem' }}
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              >
                <div className="turn-card thinking-card" style={{ maxWidth: 'none' }}>
                  <Scale size={16} />
                  <div className="thinking-dots"><span /><span /><span /></div>
                  <span className="thinking-label">weighing the arguments…</span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {verdictVisible && verdict && <VerdictCard key="verdict" text={verdict} />}
          </AnimatePresence>
        </>
      )}

      <footer className="site-footer">
        <div className="credit">
          DebateBot &middot; Built by <a href="https://github.com/Bhaavesh636" target="_blank" rel="noopener noreferrer">Janapareddi Bhaavesh Sai Mohan</a>
        </div>
        <div className="footer-socials">
          <a href="https://github.com/Bhaavesh636" target="_blank" rel="noopener noreferrer"><Github size={16} /></a>
          <a href="https://www.linkedin.com/in/bhaavesh-janapareddi/" target="_blank" rel="noopener noreferrer"><Linkedin size={16} /></a>
        </div>
      </footer>

      <AnimatePresence>
        {historyOpen && (
          <HistoryDrawer
            history={history}
            onClose={() => setHistoryOpen(false)}
            onClear={clearHistory}
            onSelect={(h) => { setReplayDebate(h); setView('replay') }}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
