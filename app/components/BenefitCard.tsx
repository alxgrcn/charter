'use client'

import { useState } from 'react'
import type { BenefitDetermination } from '../../types/charter'

const qualifiesBadge: Record<BenefitDetermination['qualifies'], string> = {
  yes: 'bg-green-100 text-green-800',
  possibly: 'bg-yellow-100 text-yellow-800',
  no: 'bg-zinc-100 text-zinc-600',
  unknown: 'bg-zinc-100 text-zinc-600',
}

const qualifiesLabel: Record<BenefitDetermination['qualifies'], string> = {
  yes: 'Likely Eligible',
  possibly: 'Possibly Eligible',
  no: 'Not Eligible',
  unknown: 'Needs More Info',
}

const effortLabel: Record<BenefitDetermination['complexity'], string> = {
  easy: '🟢 File It Yourself',
  moderate: '🟡 Bring a VSO',
  complex: '🔴 Get Representation',
}

type Props = { benefit: BenefitDetermination }

export default function BenefitCard({ benefit }: Props) {
  const [open, setOpen] = useState(false)

  const sentences = benefit.reason.split(/(?<=[.!?])\s+/)
  const firstSentence = sentences[0] ?? benefit.reason
  const hasMore = sentences.length > 1
  const showAccordion = hasMore || benefit.citation !== null

  return (
    <div className={`rounded-xl border border-zinc-200 bg-white p-4 flex flex-col gap-3${benefit.qualifies === 'yes' ? ' border-l-4 border-l-green-500' : ''}`}>
      {/* Header row */}
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm font-semibold text-zinc-900 leading-snug">{benefit.benefit_name}</span>
        <span className={`shrink-0 text-xs font-medium px-2.5 py-0.5 rounded-full ${qualifiesBadge[benefit.qualifies]}`}>
          {qualifiesLabel[benefit.qualifies]}
        </span>
      </div>

      <span className="text-xs text-zinc-500">{effortLabel[benefit.complexity]}</span>
      {benefit.qualifies === 'unknown' && (
        <p className="text-xs text-zinc-500 leading-relaxed">
          Share more about your situation and I can give you a clearer answer.
        </p>
      )}

      {/* Determination sentence — prominent */}
      <p className="text-base font-medium text-zinc-800 leading-snug">{firstSentence}</p>

      {/* Steps to apply */}
      {benefit.steps.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Steps to apply</span>
          <ol className="list-decimal list-inside flex flex-col gap-1">
            {benefit.steps.map((step, i) => (
              <li key={i} className="text-sm text-zinc-700 leading-relaxed">{step}</li>
            ))}
          </ol>
        </div>
      )}

      {/* Documents needed */}
      {benefit.documents_needed.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wide">Documents needed</span>
          <ul className="list-disc list-inside flex flex-col gap-1">
            {benefit.documents_needed.map((doc, i) => (
              <li key={i} className="text-sm text-zinc-700">{doc}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Collapsible regulation source */}
      {showAccordion && (
        <div className="flex flex-col gap-1">
          <button
            onClick={() => setOpen((o) => !o)}
            className="text-xs text-blue-600 hover:text-blue-800 text-left"
          >
            {open ? 'Hide source ↑' : 'See regulation source ↓'}
          </button>
          {open && (
            <div className="text-xs text-zinc-500 leading-relaxed border-t border-zinc-100 pt-2 mt-1">
              <p>{benefit.reason}</p>
              {benefit.citation && (
                <p className="mt-1 font-medium">{benefit.citation.source} · {benefit.citation.section}</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Counselor review warning */}
      {benefit.needs_counselor_review && (
        <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
          ⚠ Counselor review recommended before acting on this determination
        </div>
      )}
    </div>
  )
}
