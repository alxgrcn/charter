'use client'

import { useEffect, useRef, useState } from 'react'
import ChatMessage from './components/ChatMessage'
import ChatInput from './components/ChatInput'
import BenefitReport from './components/BenefitReport'
import type { VeteranProfile, ReportJSON } from '../types/charter'

const STARTER_QUESTIONS = [
  "What benefits am I missing that I don't even know exist?",
  "What little-known benefits do 100% vets actually get that nobody talks about?",
  "What state benefits am I leaving on the table?",
  "I'm overwhelmed by the paperwork. Am I screwing this up?",
]

function detectChips(msg: Message | undefined): string[] {
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
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  async function handleSend(text: string) {
    const next: Message[] = [...messages, { role: 'user', content: text }]
    setMessages(next)
    setLoading(true)

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: next, profile }),
      })
      const data = await res.json() as ChatResponse
      if (data.profileUpdates) {
        setProfile((prev) => ({ ...prev, ...data.profileUpdates }))
      }
      if (data.report) {
        console.log('[Charter] report generated:', data.report)
        setReport(data.report)
      }
      setMessages((prev) => [...prev, { role: data.role, content: data.content }])
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col h-[100dvh] bg-white">
      <header className="flex-shrink-0 border-b border-zinc-200 px-4 py-3">
        <div className="max-w-2xl mx-auto">
          <h1 className="text-base font-semibold text-zinc-900">Charter</h1>
          <p className="text-xs text-zinc-500">Veteran Benefits Navigator</p>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="flex flex-col gap-3 max-w-2xl mx-auto">
          {messages.length === 0 && !loading && (
            <div className="mt-8 flex flex-col gap-3">
              <p className="text-center text-xs text-zinc-400 uppercase tracking-wide">Common questions</p>
              <div className="grid grid-cols-2 gap-2">
                {STARTER_QUESTIONS.map((q) => (
                  <button
                    key={q}
                    onClick={() => handleSend(q)}
                    disabled={loading}
                    className="rounded-xl border border-zinc-200 bg-white p-3 text-left text-sm text-zinc-700 hover:border-blue-300 hover:bg-blue-50 transition-colors leading-snug"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages.map((msg, i) => (
            <ChatMessage key={i} role={msg.role} content={msg.content} />
          ))}
          {report && <BenefitReport report={report} />}
          {loading && (
            <div className="flex justify-start">
              <div className="bg-zinc-100 rounded-2xl rounded-bl-sm px-4 py-3">
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

      <ChatInput onSend={handleSend} disabled={loading} chips={detectChips(messages[messages.length - 1])} />
    </div>
  )
}
