'use client'

import { useEffect, useRef, useState } from 'react'
import ChatMessage from './components/ChatMessage'
import ChatInput from './components/ChatInput'

type Message = {
  role: 'user' | 'assistant'
  content: string
}

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(false)
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
        body: JSON.stringify({ messages: next }),
      })
      const data = await res.json() as Message
      setMessages((prev) => [...prev, data])
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
          {messages.length === 0 && (
            <p className="text-center text-sm text-zinc-400 mt-12">
              Ask Charter about your benefits.
            </p>
          )}
          {messages.map((msg, i) => (
            <ChatMessage key={i} role={msg.role} content={msg.content} />
          ))}
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

      <ChatInput onSend={handleSend} disabled={loading} />
    </div>
  )
}
