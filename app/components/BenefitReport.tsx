'use client'

import { useState } from 'react'
import type { ReportJSON } from '../../types/charter'
import BenefitCard from './BenefitCard'

type Props = { report: ReportJSON; sessionId?: string }

export default function BenefitReport({ report, sessionId = '' }: Props) {
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')

  async function handleSend() {
    if (!email) return
    setStatus('sending')
    try {
      const res = await fetch('/api/send-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, session_id: sessionId, report }),
      })
      setStatus(res.ok ? 'sent' : 'error')
    } catch {
      setStatus('error')
    }
  }

  return (
    <div className="w-full rounded-xl border border-zinc-200 bg-zinc-50 p-4 flex flex-col gap-3">
      {/* Crisis line — CLAUDE.md rule 9: must appear in every report */}
      <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-900">
        {report.crisis_line}
      </div>

      {/* Disclaimer — shown before benefits per compliance */}
      <div className="rounded-lg bg-zinc-100 border border-zinc-200 px-4 py-3 text-xs text-zinc-600 leading-relaxed">
        {report.disclaimer}
      </div>

      <h2 className="text-base font-semibold text-zinc-900 mt-1">Your Benefits Analysis</h2>

      <div className="flex flex-col gap-3">
        {report.benefits.map((b) => (
          <BenefitCard key={b.benefit_id} benefit={b} />
        ))}
      </div>

      {report.synergy_notes.length > 0 && (
        <div className="flex flex-col gap-2 mt-1">
          <h3 className="text-sm font-semibold text-zinc-800">How These Benefits Work Together</h3>
          <ul className="flex flex-col gap-1.5 list-disc list-inside">
            {report.synergy_notes.map((note, i) => (
              <li key={i} className="text-sm text-zinc-700 leading-relaxed">{note}</li>
            ))}
          </ul>
        </div>
      )}

      {report.priority_actions.length > 0 && (
        <div className="flex flex-col gap-2 mt-1">
          <h3 className="text-sm font-semibold text-zinc-800">Recommended Next Steps</h3>
          <ol className="flex flex-col gap-1.5 list-decimal list-inside">
            {report.priority_actions.map((action, i) => (
              <li key={i} className="text-sm text-zinc-700 leading-relaxed">{action}</li>
            ))}
          </ol>
        </div>
      )}

      <p className="text-xs text-zinc-500 leading-relaxed mt-1">
        This report is educational and designed to help identify possible benefits or next steps. It is not a final eligibility determination.
      </p>

      {/* Email capture */}
      <div className="rounded-lg border border-zinc-200 bg-white px-4 py-4 flex flex-col gap-3 mt-1">
        <h3 className="text-sm font-semibold text-zinc-800">Get your full report by email</h3>
        {status === 'sent' ? (
          <p className="text-sm text-green-700">Report sent to {email} — check your inbox.</p>
        ) : (
          <>
            <div className="flex gap-2">
              <input
                type="email"
                placeholder="your@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={status === 'sending'}
                className="flex-1 rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-400 disabled:opacity-50"
              />
              <button
                onClick={handleSend}
                disabled={status === 'sending' || !email}
                className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {status === 'sending' ? 'Sending…' : 'Send Report'}
              </button>
            </div>
            {status === 'error' && (
              <p className="text-sm text-red-600">Something went wrong. Please try again.</p>
            )}
          </>
        )}
      </div>
    </div>
  )
}
