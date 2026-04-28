import { createServiceClient } from './supabase'
import { auditLog } from './auditLog'

export type CrisisEscalationParams = {
  session_id: string
  trigger_type: 'keyword' | 'flag'
}

/**
 * Full crisis escalation sequence. Steps 1 (988 fast response) already fired
 * before this is called.
 *
 * Step 2: crisis_events write — synchronous and blocking. Throws on failure so
 * the caller can decide how to handle; never silently swallowed.
 * Step 3: OTW counselor notification — best-effort. Logs on failure, never throws.
 * Step 4: audit log — awaited to ensure it completes.
 *
 * No PHI stored at any step.
 */
export async function handleCrisisEscalation(params: CrisisEscalationParams): Promise<void> {
  const { session_id, trigger_type } = params
  const now = new Date().toISOString()

  // Step 2: Write crisis_events — must succeed before anything else continues
  // SERVICE CLIENT: writing crisis event — trusted server op
  const supabase = createServiceClient()
  const { data: eventRow, error: insertError } = await supabase
    .from('crisis_events')
    .insert({
      session_id,
      channel: 'web',
      detected_at: now,
      trigger_type,
      counselor_notified: false,
    })
    .select('id')
    .single()

  if (insertError) {
    console.error('[charter/crisis] crisis_events write FAILED — session_id:', session_id, insertError.message)
    throw insertError
  }

  // Step 3: OTW counselor notification — best-effort, never blocks crisis response
  const otwUrl = process.env.OTW_INTAKE_URL
  if (!otwUrl) {
    console.warn('[charter/crisis] OTW_INTAKE_URL not set — skipping counselor notification for session_id:', session_id)
  } else {
    try {
      const res = await fetch(otwUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-secret': process.env.INTERNAL_WEBHOOK_SECRET ?? '',
        },
        body: JSON.stringify({
          session_id,
          crisis_flag: true,
          urgency_level: 'crisis',
          source: 'charter_web',
          channel: 'web',
          timestamp: now,
        }),
      })
      if (res.ok && eventRow?.id) {
        // Mark counselor notified — best-effort update, do not throw if it fails
        await supabase
          .from('crisis_events')
          .update({ counselor_notified: true })
          .eq('id', eventRow.id)
      } else if (!res.ok) {
        console.error('[charter/crisis] OTW POST non-ok status:', res.status, '— session_id:', session_id)
      }
    } catch (otwErr) {
      console.error(
        '[charter/crisis] OTW POST failed — session_id:', session_id,
        otwErr instanceof Error ? otwErr.message : otwErr,
      )
    }
  }

  // Step 4: Audit log — await to ensure it completes; no PHI in meta
  await auditLog({
    actor_role: 'system',
    action: 'crisis_detected',
    meta: { session_id, channel: 'web', trigger_type },
  })
}
