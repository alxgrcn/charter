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
  unknown: 'Unknown',
}

const complexityLabel: Record<BenefitDetermination['complexity'], string> = {
  easy: '🟢 Easy',
  moderate: '🟡 Moderate',
  complex: '🔴 Complex',
}

type Props = { benefit: BenefitDetermination }

export default function BenefitCard({ benefit }: Props) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm font-semibold text-zinc-900 leading-snug">{benefit.benefit_name}</span>
        <span className={`shrink-0 text-xs font-medium px-2 py-0.5 rounded-full ${qualifiesBadge[benefit.qualifies]}`}>
          {qualifiesLabel[benefit.qualifies]}
        </span>
      </div>

      <span className="text-xs text-zinc-500">{complexityLabel[benefit.complexity]}</span>

      <p className="text-sm text-zinc-700 leading-relaxed">{benefit.reason}</p>

      {benefit.citation && (
        <p className="text-xs text-zinc-400">
          {benefit.citation.source} · {benefit.citation.section}
        </p>
      )}

      {benefit.needs_counselor_review && (
        <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
          ⚠ Counselor review recommended before acting on this determination
        </div>
      )}
    </div>
  )
}
