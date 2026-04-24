'use client'

import { useEffect, useRef, useState } from 'react'
import ChatMessage from './components/ChatMessage'
import ChatInput from './components/ChatInput'
import BenefitReport from './components/BenefitReport'
import type { VeteranProfile, ReportJSON } from '../types/charter'

const LANDING_CHIPS = [
  '🏠 I need housing help',
  '🎓 I want to go back to school',
  '🏡 I want to buy a home',
  '📋 Help me understand my rating',
  '💼 Find jobs & career help',
]

const ROTATING_QUESTIONS = [
  "What benefits am I missing that I don't even know exist?",
  "What little-known benefits do 100% vets actually get?",
  "Do my dependents get ChampVA at my current rating?",
  "Should I file for secondary conditions now?",
  "What state benefits am I leaving on the table?",
  "At my rating, what healthcare do I actually get?",
  "The claim is moving slow — what's happening behind the scenes?",
  "I'm overwhelmed by the paperwork. Am I screwing this up?",
  "Will DEA still be there for my kids in 10-15 years?",
  "If I'm 80% P&T or TDIU, do I get the same stuff as 100%?",
]

type AssistantMessage = { role: 'assistant'; content: string }

function detectChips(msg: { role: string; content: string } | undefined): string[] {
  if (!msg || msg.role !== 'assistant') return []
  const text = msg.content.toLowerCase()
  if (/branch(\s+of\s+service)?/.test(text)) return ['Army', 'Navy', 'Marines', 'Air Force', 'Coast Guard', 'Space Force']
  if (/discharge/.test(text)) return ['Honorable', 'General (Under Honorable)', 'Other Than Honorable', 'Not Sure']
  if (/housing/.test(text)) return ['Stable housing', 'At risk', 'Currently homeless', 'Living with family/friends']
  return []
}

type Message = {
  role: 'user' | 'assistant'
  content: string
}

type ChatResponse = {
  role: 'assistant'
  content: string
  profileUpdates?: Partial<VeteranProfile>
  report?: ReportJSON
}

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(false)
  const [profile, setProfile] = useState<Partial<VeteranProfile>>(() => ({
    id: crypto.randomUUID(),
    org_id: 'demo',
    session_id: null,
    combat_veteran: false,
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
  }))
  const [report, setReport] = useState<ReportJSON | null>(null)
  const [chips, setChips] = useState<string[]>([])
  const [questionIndex, setQuestionIndex] = useState(0)
  const [questionVisible, setQuestionVisible] = useState(true)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  useEffect(() => {
    if (messages.length > 0 || loading) return
    const timer = setInterval(() => {
      setQuestionVisible(false)
      setTimeout(() => {
        setQuestionIndex((i) => (i + 1) % ROTATING_QUESTIONS.length)
        setQuestionVisible(true)
      }, 700)
    }, 8000)
    return () => clearInterval(timer)
  }, [messages.length, loading])

  async function handleSend(text: string) {
    setChips([])
    const next: Message[] = [...messages, { role: 'user', content: text }]
    setMessages(next)
    setLoading(true)

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: next, profile }),
      })
      if (!res.ok) {
        throw new Error(`Server error ${res.status}`)
      }
      const data = await res.json() as ChatResponse
      if (data.profileUpdates) {
        setProfile((prev) => ({ ...prev, ...data.profileUpdates }))
      }
      if (data.report) {
        console.log('[Charter] report generated:', data.report)
        setReport(data.report)
      }
      const newMsg: AssistantMessage = { role: data.role, content: data.content }
      setMessages((prev) => [...prev, newMsg])
      setChips(detectChips(newMsg))
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Unknown error'
      console.error('[Charter] fetch error:', errMsg)
      setMessages((prev) => [...prev, {
        role: 'assistant',
        content: "I'm having trouble connecting right now. Please try again in a moment, or call 1-800-827-1000 to speak with a Veterans Service Officer.",
      }])
    } finally {
      setLoading(false)
    }
  }

  const isLanding = messages.length === 0 && !loading

  if (isLanding) {
    return (
      <div className="flex flex-col h-[100dvh] items-center justify-center" style={{ background: 'linear-gradient(160deg, #f9f7f4 0%, #f0ede8 100%)' }}>
        <div className="w-full max-w-2xl px-6 flex flex-col items-center gap-5 -mt-[5vh]">
          <button
            onClick={() => handleSend(ROTATING_QUESTIONS[questionIndex])}
            style={{ fontFamily: 'var(--font-playfair, Georgia, serif)' }}
            className={`text-5xl font-light text-zinc-800 text-center leading-snug transition-opacity duration-700 ${
              questionVisible ? 'opacity-100' : 'opacity-0'
            }`}
          >
            {ROTATING_QUESTIONS[questionIndex]}
          </button>
          <p className="text-sm text-gray-400 text-center tracking-wide">Free. Private. Built for veterans.</p>
          <ChatInput onSend={handleSend} disabled={loading} chips={chips} isLanding />
          <div className="flex flex-wrap justify-center gap-2 max-w-2xl mx-auto px-4">
            {LANDING_CHIPS.map((chip) => (
              <button
                key={chip}
                onClick={() => handleSend(chip)}
                disabled={loading}
                className="rounded-full bg-gray-800 border border-gray-700 px-4 py-2 text-sm text-white hover:bg-gray-700 hover:scale-105 transition-all duration-150"
              >
                {chip}
              </button>
            ))}
          </div>
          <p className="text-xs text-gray-400 text-center">Used by veteran counselors at US Vets</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-[100dvh]" style={{ background: 'linear-gradient(160deg, #f9f7f4 0%, #f0ede8 100%)' }}>
      <header className="flex-shrink-0 bg-white/80 backdrop-blur-sm border-b border-gray-100 px-4 py-3">
        <div className="max-w-2xl mx-auto">
          <h1 className="text-base font-semibold text-gray-900">Charter</h1>
          <p className="text-xs text-gray-400">Veteran Benefits Navigator</p>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="flex flex-col gap-3 max-w-2xl mx-auto">
          {messages.map((msg, i) => (
            <ChatMessage key={i} role={msg.role} content={msg.content} />
          ))}
          {report && <BenefitReport report={report} />}
          {loading && (
            <div className="flex justify-start">
              <div className="bg-white border border-gray-100 shadow-sm rounded-2xl rounded-bl-sm px-4 py-3">
                <span className="flex gap-1 items-center">
                  <span className="w-1.5 h-1.5 rounded-full bg-zinc-400 animate-bounce [animation-delay:0ms]" />
                  <span className="w-1.5 h-1.5 rounded-full bg-zinc-400 animate-bounce [animation-delay:150ms]" />
                  <span className="w-1.5 h-1.5 rounded-full bg-zinc-400 animate-bounce [animation-delay:300ms]" />
                </span>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      <ChatInput onSend={handleSend} disabled={loading} chips={chips} />
    </div>
  )
}
