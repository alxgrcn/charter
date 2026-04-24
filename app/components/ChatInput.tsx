'use client'

import { useRef, useState } from 'react'

type Props = {
  onSend: (text: string) => void
  disabled: boolean
  chips?: string[]
  isLanding?: boolean
}

export default function ChatInput({ onSend, disabled, chips, isLanding }: Props) {
  const [value, setValue] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  function submit() {
    const text = value.trim()
    if (!text || disabled) return
    setValue('')
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
    onSend(text)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  function handleInput(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setValue(e.target.value)
    const el = e.target
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`
  }

  return (
    <div className={isLanding
      ? "w-full"
      : "sticky bottom-0 bg-white border-t border-zinc-200 px-4 py-3"
    }>
      {chips && chips.length > 0 && (
        <div className="flex flex-wrap gap-2 max-w-2xl mx-auto pb-2">
          {chips.map((chip) => (
            <button
              key={chip}
              onClick={() => onSend(chip)}
              disabled={disabled}
              className="rounded-full border border-zinc-300 bg-white px-3 py-1 text-sm text-zinc-700 hover:border-blue-400 hover:bg-blue-50 transition-colors"
            >
              {chip}
            </button>
          ))}
        </div>
      )}
      <div className="flex items-end gap-2 max-w-2xl mx-auto">
        <textarea
          ref={textareaRef}
          rows={1}
          value={value}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          placeholder="Message Charter…"
          className="flex-1 resize-none rounded-2xl border border-zinc-300 bg-zinc-50 px-4 py-2.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 leading-relaxed"
        />
        <button
          onClick={submit}
          disabled={disabled || !value.trim()}
          className="flex-shrink-0 h-10 w-10 flex items-center justify-center rounded-full bg-blue-600 text-white disabled:opacity-40 hover:bg-blue-700 transition-colors"
          aria-label="Send"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
            <path d="M3.105 2.288a.75.75 0 0 0-.826.95l1.254 4.172a.75.75 0 0 0 .61.53L9.5 9.133l-5.357.394a.75.75 0 0 0-.61.53l-1.254 4.172a.75.75 0 0 0 .826.95 28.895 28.895 0 0 0 15.293-7.154.75.75 0 0 0 0-1.115A28.897 28.897 0 0 0 3.105 2.288Z" />
          </svg>
        </button>
      </div>
    </div>
  )
}
