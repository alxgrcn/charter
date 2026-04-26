import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { runPipeline } from '../../../core/pipeline'
import type { VeteranProfile } from '../../../types/charter'
import { redact } from '../../../lib/redact'
import { auditLog } from '../../../lib/auditLog'

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

function checkAuth(req: NextRequest): boolean {
  const header = req.headers.get('authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''
  const secret = process.env.INTERNAL_WEBHOOK_SECRET
  return !!secret && token === secret
}

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

const BodySchema = z.object({
  branch: z.string(),
  dischargeStatus: z.string(),
  serviceDates: z.object({
    start: z.string().optional(),
    end: z.string().optional(),
    years: z.number().optional(),
  }).optional(),
  goals: z.array(z.string()).optional(),
  housingStatus: z.string().optional(),
  healthConcerns: z.string().optional(),
  educationInterest: z.boolean().optional(),
  employmentStatus: z.string().optional(),
  source: z.enum(['web', 'iva', 'sms', 'dashboard']),
  session_id: z.string().optional(),
  additionalContext: z.record(z.string(), z.unknown()).optional(),
})

type AnalyzeBody = z.infer<typeof BodySchema>

// ---------------------------------------------------------------------------
// Crisis detection — check free-text fields for crisis-related language
// ---------------------------------------------------------------------------

const CRISIS_KEYWORDS = [
  'suicide', 'suicidal', 'kill myself', 'end my life', "don't want to live",
  'harm myself', 'self-harm', 'self harm', 'want to die', 'no reason to live',
  "don't see the point", "no point anymore", "can't go on", 'give up on life',
  'hopeless', 'crisis',
]

function detectCrisis(input: AnalyzeBody): boolean {
  const text = [
    input.healthConcerns ?? '',
    ...(input.goals ?? []),
    JSON.stringify(input.additionalContext ?? {}),
  ].join(' ').toLowerCase()
  return CRISIS_KEYWORDS.some((kw) => text.includes(kw))
}

// ---------------------------------------------------------------------------
// Profile mapping — build a VeteranProfile the pipeline can consume
// ---------------------------------------------------------------------------

function buildProfile(input: AnalyzeBody): VeteranProfile {
  const now = new Date()
  const expires = new Date(now)
  expires.setDate(expires.getDate() + 90)

  // Derive years_served: prefer explicit value, fall back to date math
  let years_served: number | null = input.serviceDates?.years ?? null
  if (years_served === null && input.serviceDates?.start && input.serviceDates?.end) {
    const start = new Date(input.serviceDates.start)
    const end = new Date(input.serviceDates.end)
    years_served = Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24 * 365))
  }

  return {
    id: crypto.randomUUID(),
    org_id: 'api',
    session_id: input.session_id ?? null,
    service_branch: input.branch,
    years_served,
    discharge_type: input.dischargeStatus,
    combat_veteran: false,
    disability_rating: null,
    housing_status: input.housingStatus ?? null,
    household_income: null,
    household_size: null,
    state: null,
    age: null,
    separation_date: input.serviceDates?.end ?? null,
    created_at: now.toISOString(),
    expires_at: expires.toISOString(),
  }
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  if (!checkAuth(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json().catch(() => null)
  const parsed = BodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
  }

  const input = parsed.data
  const crisis_flag = detectCrisis(input)

  const profile = buildProfile(input)
  const pipelineStart = Date.now()
  console.log('[analyze] runPipeline start — source:', input.source, '— session_id:', input.session_id ?? 'none')

  let report
  try {
    report = await runPipeline(profile)
  } catch (err) {
    const elapsed = Date.now() - pipelineStart
    console.error(
      `[analyze] runPipeline FAILED — elapsed=${elapsed}ms`,
      redact(err instanceof Error ? { message: err.message } : err)
    )
    return NextResponse.json(
      { error: 'We ran into an issue processing your request. Please try again in a moment.' },
      { status: 500 }
    )
  }

  const elapsed = Date.now() - pipelineStart
  console.log(`[analyze] runPipeline complete — elapsed=${elapsed}ms benefits:${report.benefits.length}`)

  void auditLog({
    actor_role: 'system',
    action: 'report_generated',
    meta: { source: input.source, session_id: input.session_id ?? undefined },
  })

  // Build output shape
  const confidenceScores: Record<string, number> = {}
  const benefits = report.benefits.map((b) => {
    confidenceScores[b.benefit_id] = b.confidence
    return {
      name: b.benefit_name,
      confidence: b.confidence,
      summary: b.reason,
      priority_actions: b.steps,
      citations: b.citation ? [b.citation] : [],
    }
  })

  const qualifyingNames = report.benefits
    .filter((b) => b.qualifies === 'yes' || b.qualifies === 'possibly')
    .map((b) => b.benefit_name)

  const summary =
    qualifyingNames.length > 0
      ? `Based on the provided service record, ${qualifyingNames.length} potential benefit${qualifyingNames.length > 1 ? 's were' : ' was'} identified: ${qualifyingNames.join(', ')}.`
      : 'Based on the information provided, no clear benefit matches were identified. A Veterans Service Officer can conduct a full eligibility review.'

  const disclaimers = [
    'This report is educational and designed to help identify possible benefits or next steps. It is not a final eligibility determination.',
    report.disclaimer,
    report.crisis_line,
  ]

  return NextResponse.json({
    summary,
    benefits,
    confidenceScores,
    recommendations: report.synergy_notes,
    nextSteps: report.priority_actions,
    disclaimers,
    crisis_flag,
    generated_at: report.generated_at,
  })
}
