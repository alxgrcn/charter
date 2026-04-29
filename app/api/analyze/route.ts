import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { runPipeline } from '../../../core/pipeline'
import type { VeteranProfile } from '../../../types/charter'
import { redact } from '../../../lib/redact'
import { auditLog } from '../../../lib/auditLog'
import { classifyIntake } from '../../../lib/fast-analysis'
import type { IntakeFields } from '../../../lib/fast-analysis'
import { handleCrisisEscalation } from '../../../lib/crisis'
import { checkRateLimit } from '../../../lib/rateLimiter'

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

const AnalyzeInput = z.object({
  branch: z.string().min(1),
  dischargeStatus: z.string().min(1),
  mentalHealthConcerns: z.string().optional().default(''),
  currentSupport: z.string().optional().default('none'),
  serviceDates: z.object({
    start: z.string().optional(),
    end: z.string().optional(),
    years: z.number().optional(),
  }).optional(),
  location: z.string().optional().default(''),
  source: z.enum(['web', 'iva', 'sms', 'simulation', 'internal']),
  session_id: z.string().optional(),
  additionalContext: z.record(z.string(), z.unknown()).optional(),
})

type AnalyzeBody = z.infer<typeof AnalyzeInput>

// ---------------------------------------------------------------------------
// Route-level crisis detection — broader keyword list for this internal endpoint.
// Result is passed as crisis_flag into classifyIntake(), which makes the final
// determination. The fast-analysis layer also checks urgency_signal independently.
// ---------------------------------------------------------------------------

const ROUTE_CRISIS_KEYWORDS = [
  'suicide', 'suicidal', 'kill myself', 'end my life', "don't want to live",
  'harm myself', 'self-harm', 'self harm', 'want to die', 'no reason to live',
  "don't see the point", "no point anymore", "can't go on", 'give up on life',
  'hopeless', 'crisis',
]

function detectCrisis(input: AnalyzeBody): boolean {
  const text = [
    input.mentalHealthConcerns,
    JSON.stringify(input.additionalContext ?? {}),
  ].join(' ').toLowerCase()
  return ROUTE_CRISIS_KEYWORDS.some((kw) => text.includes(kw))
}

// ---------------------------------------------------------------------------
// Profile mapping
// ---------------------------------------------------------------------------

function buildProfile(input: AnalyzeBody): VeteranProfile {
  const now = new Date()
  const expires = new Date(now)
  expires.setDate(expires.getDate() + 90)

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
    housing_status: null,
    household_income: null,
    household_size: null,
    state: input.location || null,
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
  // Auth check — before rate limit so unauthenticated requests don't consume quota
  if (!checkAuth(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Rate limiting — per IP, authenticated requests only. Never log the IP.
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    'unknown'
  if (!checkRateLimit(ip)) {
    return NextResponse.json(
      { error: 'Rate limit exceeded. Please wait before trying again.' },
      { status: 429 }
    )
  }

  // Input validation
  const body = await req.json().catch(() => null)
  const parsed = AnalyzeInput.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request', details: parsed.error.flatten() },
      { status: 400 }
    )
  }

  const input = parsed.data
  const now = new Date().toISOString()
  const sessionId = input.session_id ?? crypto.randomUUID()

  // Fast analysis — runs before pipeline, < 100ms
  const crisisPreFlag = detectCrisis(input)
  const intakeFields: IntakeFields = {
    discharge_status: input.dischargeStatus,
    mental_health_concerns: input.mentalHealthConcerns,
    current_care: input.currentSupport,
    urgency_signal: input.mentalHealthConcerns,
    crisis_flag: crisisPreFlag,
  }
  const fastResult = classifyIntake(intakeFields)
  console.log('[analyze] fast analysis — urgency_level:', fastResult.urgency_level, '| crisis_flag:', fastResult.crisis_flag)

  // ---------------------------------------------------------------------------
  // Crisis path — return immediately, no pipeline
  // ---------------------------------------------------------------------------
  if (fastResult.crisis_flag) {
    try {
      await handleCrisisEscalation({
        session_id: sessionId,
        trigger_type: fastResult.trigger_type ?? 'flag',
      })
    } catch (escalateErr) {
      // crisis_events write failed — log and continue; veteran must still receive crisis response
      console.error('[analyze] crisis escalation FAILED — session_id:', sessionId)
    }

    await auditLog({
      actor_role: 'system',
      action: 'crisis_detected',
      meta: { source: input.source, session_id: sessionId },
    })

    return NextResponse.json({
      crisis_flag: true,
      fast_response: null,
      benefits: [],
      synergies: [],
      overall_priority_actions: [],
      discharge_upgrade_applicable: false,
      disclaimers: [
        'Veterans Crisis Line: Call or text 988, press 1. Chat: veteranscrisisline.net',
      ],
      generated_at: now,
      source: input.source,
      crisis_resources:
        'If you or someone you know is in crisis, call or text 988 and press 1 to reach the Veterans Crisis Line. Free, confidential, 24/7.',
    })
  }

  // ---------------------------------------------------------------------------
  // Non-crisis path — run full pipeline synchronously
  // ---------------------------------------------------------------------------
  const profile = buildProfile(input)
  const pipelineStart = Date.now()
  console.log('[analyze] runPipeline start — source:', input.source, '— session_id:', sessionId)

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
    meta: { source: input.source, session_id: sessionId, benefits_count: report.benefits.length },
  })

  const benefits = report.benefits.map((b) => ({
    benefitId: b.benefit_id,
    benefitName: b.benefit_name,
    confidence: b.confidence,
    summary: b.reason,
    priority_actions: b.steps,
    citations: b.citation ? [`${b.citation.source} §${b.citation.section}`] : [],
    needs_counselor_review: b.needs_counselor_review || b.confidence < 0.75,
  }))

  const disclaimers = [
    'This report is educational and designed to help identify possible benefits or next steps. It is not a final eligibility determination.',
    ...(report.disclaimer ? [report.disclaimer] : []),
    'Veterans Crisis Line: Call or text 988, press 1. Chat: veteranscrisisline.net',
  ]

  return NextResponse.json({
    crisis_flag: false,
    fast_response: {
      support_category: fastResult.support_category,
      urgency_level: fastResult.urgency_level,
      top_programs: fastResult.top_programs,
      response_text: fastResult.fast_response_text,
    },
    benefits,
    synergies: report.synergy_notes,
    overall_priority_actions: report.priority_actions,
    discharge_upgrade_applicable: report.discharge_upgrade_flag,
    disclaimers,
    generated_at: report.generated_at,
    source: input.source,
  })
}
