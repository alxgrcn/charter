import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { auditLog } from '../../../lib/auditLog'
import { redact } from '../../../lib/redact'

const BodySchema = z.object({
  profile: z.record(z.string(), z.unknown()),
  report: z.object({
    benefits: z.array(z.object({
      benefit_id: z.string(),
      benefit_name: z.string(),
      qualifies: z.string(),
      confidence: z.number(),
    })).min(0),
  }).passthrough(),
  session_id: z.string(),
})

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const parsed = BodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const { profile, report, session_id } = parsed.data

  const otwUrl = process.env.OTW_API_URL
  const secret = process.env.INTERNAL_WEBHOOK_SECRET
  if (!otwUrl || !secret) {
    console.error('[book-counselor] OTW_API_URL or INTERNAL_WEBHOOK_SECRET not set')
    return NextResponse.json({ error: 'Service not configured' }, { status: 500 })
  }

  let res: Response
  try {
    res = await fetch(`${otwUrl}/api/booking-leads`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify({ profile, report, session_id, source: 'charter' }),
    })
  } catch (err) {
    console.error('[book-counselor] fetch to OTW failed:', redact(err instanceof Error ? { message: err.message } : err))
    return NextResponse.json({ error: 'Could not reach booking service' }, { status: 502 })
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    console.error(`[book-counselor] OTW responded ${res.status}:`, text.slice(0, 200))
    return NextResponse.json({ error: 'Booking service error' }, { status: 502 })
  }

  const data = await res.json() as { booking_url?: string }

  void auditLog({
    actor_role: 'system',
    action: 'report_shared_with_org',
    meta: { session_id, org: 'us_vets' },
  })
  void auditLog({
    actor_role: 'system',
    action: 'appointment_handoff',
    meta: { session_id, target: 'otw' },
  })

  return NextResponse.json({ booking_url: data.booking_url })
}
