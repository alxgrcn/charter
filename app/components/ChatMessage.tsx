'use client'

import ReactMarkdown from 'react-markdown'

type Props = {
  role: 'user' | 'assistant'
  content: string
}

export default function ChatMessage({ role, content }: Props) {
  const isUser = role === 'user'

  return (
    <div className={`flex w-full ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[75%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
          isUser
            ? 'bg-gray-900 text-white rounded-br-sm'
            : 'bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 shadow-sm text-gray-800 dark:text-gray-100 rounded-bl-sm'
        }`}
      >
        {isUser ? content : (
          <ReactMarkdown
            components={{
              p: ({ children }) => <p className="mb-1 last:mb-0">{children}</p>,
              strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
              ul: ({ children }) => <ul className="list-disc list-inside mb-1">{children}</ul>,
              ol: ({ children }) => <ol className="list-decimal list-inside mb-1">{children}</ol>,
              li: ({ children }) => <li className="ml-2">{children}</li>,
            }}
          >
            {content}
          </ReactMarkdown>
        )}
      </div>
    </div>
  )
}
