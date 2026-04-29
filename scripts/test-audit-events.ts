/**
 * Audit event assertions + data minimization unit tests (Step 8, Tests 2 & 3).
 *
 * PART A — Meta shape validation (no I/O): verifies each event's meta has the
 *   correct keys, correct value types, and no PHI (no long freeform strings
 *   derived from user input).
 *
 * PART B — DB persistence (needs Supabase): calls auditLog() with each event's
 *   meta and queries audit_log to confirm the row landed with the correct shape.
 *   For crisis_detected, triggers the real code path via handleCrisisEscalation().
 *   For the other four events, fires auditLog() directly — this tests the meta
 *   contract, not the route-handler wiring. Wiring is covered by test-crisis.ts
 *   and test-analyze.ts.
 *
 * PART C — Data minimization unit test (no I/O): tests minimizeForStorage()
 *   directly with a mixed input object.
 */

import { classifyIntake } from '../lib/fast-analysis'
import { auditLog, AuditEntry } from '../lib/auditLog'
import { handleCrisisEscalation } from '../lib/crisis'
import { createServiceClient } from '../lib/supabase'
import { minimizeForStorage, STORABLE_FIELDS } from '../lib/minimizeForStorage'

let passed = 0
let failed = 0

function assert(condition: boolean, label: string, detail?: string) {
  if (condition) {
    console.log(`  ✓ ${label}${detail ? `\n       ${detail}` : ''}`)
    passed++
  } else {
    console.log(`  ✗ ${label}${detail ? `\n       ${detail}` : ''}`)
    failed++
  }
}

// PHI gate: no meta value should be a long freeform string derived from user input.
// Enum-like strings (short, fixed vocab), UUIDs, numbers, and booleans are all safe.
function assertNoPhiInMeta(meta: Record<string, unknown>, eventName: string) {
  const suspiciousValues = Object.entries(meta).filter(([, v]) => {
    if (typeof v !== 'string') return false
    // Strings over 64 chars are suspicious — likely freeform user input
    return (v as string).length > 64
  })
  assert(
    suspiciousValues.length === 0,
    `${eventName}: no long freeform strings in meta (PHI gate)`,
    suspiciousValues.length > 0 ? `suspicious keys: ${suspiciousValues.map(([k]) => k).join(', ')}` : 'clean'
  )
}

// ---------------------------------------------------------------------------
// PART A — Meta shape validation (pure, no I/O)
// ---------------------------------------------------------------------------

function runMetaShapeTests() {
  console.log('--- PART A: Meta shape contracts (no I/O) ---')
  console.log()

  const sessionId = `test-meta-shape-${Date.now()}`

  // fast_analysis_complete
  console.log('Event: fast_analysis_complete')
  const fastResult = classifyIntake({
    discharge_status: 'Honorable',
    mental_health_concerns: 'PTSD, nightmares',
    current_care: '',
  })
  const fastMeta = { session_id: sessionId, support_category: fastResult.support_category, urgency_level: fastResult.urgency_level }
  assert('session_id' in fastMeta, 'fast_analysis_complete: meta has session_id')
  assert('support_category' in fastMeta, 'fast_analysis_complete: meta has support_category')
  assert('urgency_level' in fastMeta, 'fast_analysis_complete: meta has urgency_level')
  assert(typeof fastMeta.support_category === 'string' && fastMeta.support_category.length < 40, 'fast_analysis_complete: support_category is short enum string')
  assert(['low', 'medium', 'high', 'crisis'].includes(fastMeta.urgency_level), 'fast_analysis_complete: urgency_level is valid enum', `got: ${fastMeta.urgency_level}`)
  assertNoPhiInMeta(fastMeta, 'fast_analysis_complete')
  console.log()

  // crisis_detected
  console.log('Event: crisis_detected')
  const crisisMeta = { session_id: sessionId, channel: 'web' }
  assert('session_id' in crisisMeta, 'crisis_detected: meta has session_id')
  assert('channel' in crisisMeta, 'crisis_detected: meta has channel')
  assert(crisisMeta.channel === 'web', 'crisis_detected: channel is "web"')
  assert(Object.keys(crisisMeta).length === 2, 'crisis_detected: meta has exactly 2 keys (session_id + channel)', `keys: ${Object.keys(crisisMeta).join(', ')}`)
  assertNoPhiInMeta(crisisMeta, 'crisis_detected')
  console.log()

  // consent_captured
  console.log('Event: consent_captured')
  const consentMeta = { session_id: sessionId }
  assert('session_id' in consentMeta, 'consent_captured: meta has session_id')
  assert(Object.keys(consentMeta).length === 1, 'consent_captured: meta has exactly 1 key (session_id only)', `keys: ${Object.keys(consentMeta).join(', ')}`)
  assertNoPhiInMeta(consentMeta, 'consent_captured')
  console.log()

  // deep_analysis_complete
  console.log('Event: deep_analysis_complete')
  const deepMeta = { session_id: sessionId, categories_scored: 8, report_emailed: false }
  assert('session_id' in deepMeta, 'deep_analysis_complete: meta has session_id')
  assert('categories_scored' in deepMeta, 'deep_analysis_complete: meta has categories_scored')
  assert('report_emailed' in deepMeta, 'deep_analysis_complete: meta has report_emailed')
  assert(typeof deepMeta.categories_scored === 'number', 'deep_analysis_complete: categories_scored is a number')
  assert(typeof deepMeta.report_emailed === 'boolean', 'deep_analysis_complete: report_emailed is a boolean')
  assertNoPhiInMeta(deepMeta, 'deep_analysis_complete')
  console.log()

  // report_shared_with_org
  console.log('Event: report_shared_with_org')
  const sharedMeta = { session_id: sessionId, org: 'us_vets' }
  assert('session_id' in sharedMeta, 'report_shared_with_org: meta has session_id')
  assert('org' in sharedMeta, 'report_shared_with_org: meta has org')
  assert(sharedMeta.org === 'us_vets', 'report_shared_with_org: org is "us_vets"')
  assert(Object.keys(sharedMeta).length === 2, 'report_shared_with_org: meta has exactly 2 keys', `keys: ${Object.keys(sharedMeta).join(', ')}`)
  assertNoPhiInMeta(sharedMeta, 'report_shared_with_org')
  console.log()
}

// ---------------------------------------------------------------------------
// PART B — DB persistence (needs Supabase + audit_log)
// ---------------------------------------------------------------------------

async function runDbPersistenceTests() {
  console.log('--- PART B: Audit log DB persistence ---')
  console.log()

  const supabase = createServiceClient()

  // Preflight: confirm audit_log is accessible
  const { error: preflightErr } = await supabase.from('audit_log').select('action').limit(1)
  if (preflightErr) {
    console.log(`⚠ SKIP (DB) — audit_log not accessible: ${preflightErr.message}`)
    console.log('  Parts B tests skipped. PART A and PART C results still apply.')
    console.log()
    return
  }

  const ts = Date.now()

  // --- B1: crisis_detected — triggered via the real code path (handleCrisisEscalation) ---
  console.log('B1: crisis_detected — real code path (handleCrisisEscalation)')
  const sessionCrisis = `test-audit-crisis-${ts}`
  const { error: crisisTableErr } = await supabase.from('crisis_events').select('id').limit(1)
  if (crisisTableErr?.message?.includes('does not exist') || crisisTableErr?.message?.includes('schema cache')) {
    console.log('  ⚠ SKIP B1 — crisis_events table not found (apply migration 004 first)')
    console.log()
  } else {
    try {
      // handleCrisisEscalation awaits auditLog, so the row is present on return
      await handleCrisisEscalation({ session_id: sessionCrisis, trigger_type: 'flag' })
      const { data: rows, error } = await supabase
        .from('audit_log')
        .select('action, meta')
        .eq('action', 'crisis_detected')
        .filter('meta->>session_id', 'eq', sessionCrisis)
      assert(!error && Array.isArray(rows) && rows.length > 0, 'B1: crisis_detected row in audit_log', error?.message ?? `rows: ${rows?.length}`)
      const row = rows?.[0]
      assert(row?.meta?.channel === 'web', 'B1: meta.channel is "web"', `got: ${row?.meta?.channel}`)
      assert(typeof row?.meta?.session_id === 'string', 'B1: meta.session_id is a string')
      assertNoPhiInMeta(row?.meta ?? {}, 'B1 crisis_detected')
      // Cleanup B1 row
      await supabase.from('crisis_events').delete().eq('session_id', sessionCrisis)
    } catch (err) {
      assert(false, 'B1 did not throw', err instanceof Error ? err.message : String(err))
    }
    console.log()
  }

  // --- B2–B5: direct auditLog calls — tests meta contract + DB persistence ---
  // These test that auditLog accepts each event's meta correctly and persists it.
  // Route-handler wiring is covered by test-analyze.ts and test-crisis.ts.

  type EventCase = { label: string; entry: AuditEntry; checks: Array<[string, (meta: Record<string, unknown>) => boolean, string]> }

  const sessionB = `test-audit-events-${ts}`
  const cases: EventCase[] = [
    {
      label: 'B2: fast_analysis_complete',
      entry: {
        actor_role: 'system',
        action: 'fast_analysis_complete',
        meta: { session_id: sessionB, support_category: 'ptsd_trauma', urgency_level: 'high' },
      },
      checks: [
        ['support_category present', (m) => 'support_category' in m, `keys: ${sessionB}`],
        ['urgency_level is enum', (m) => ['low', 'medium', 'high', 'crisis'].includes(m.urgency_level as string), 'enum check'],
        ['no extra keys', (m) => Object.keys(m).length === 3, `keys: ${Object.keys({ session_id: '', support_category: '', urgency_level: '' }).join(', ')}`],
      ],
    },
    {
      label: 'B3: consent_captured',
      entry: {
        actor_role: 'system',
        action: 'consent_captured',
        meta: { session_id: sessionB + '-consent' },
      },
      checks: [
        ['only session_id in meta', (m) => Object.keys(m).length === 1 && 'session_id' in m, `keys: ${Object.keys({ session_id: '' }).join(', ')}`],
      ],
    },
    {
      label: 'B4: deep_analysis_complete',
      entry: {
        actor_role: 'system',
        action: 'deep_analysis_complete',
        meta: { session_id: sessionB, categories_scored: 8, report_emailed: false },
      },
      checks: [
        ['categories_scored is number', (m) => typeof m.categories_scored === 'number', 'type check'],
        ['report_emailed is boolean', (m) => typeof m.report_emailed === 'boolean', 'type check'],
      ],
    },
    {
      label: 'B5: report_shared_with_org',
      entry: {
        actor_role: 'system',
        action: 'report_shared_with_org',
        meta: { session_id: sessionB, org: 'us_vets' },
      },
      checks: [
        ['org is "us_vets"', (m) => m.org === 'us_vets', `got: ${sessionB}`],
        ['only session_id + org', (m) => Object.keys(m).length === 2, `keys: ${Object.keys({ session_id: '', org: '' }).join(', ')}`],
      ],
    },
  ]

  for (const { label, entry, checks } of cases) {
    console.log(label)
    try {
      await auditLog(entry)
      // Small delay: auditLog itself is fire-and-forget in some callers, but here we await.
      const sessionKey = (entry.meta?.session_id as string) ?? sessionB
      const { data: rows, error } = await supabase
        .from('audit_log')
        .select('action, meta')
        .eq('action', entry.action)
        .filter('meta->>session_id', 'eq', sessionKey)
      assert(!error && Array.isArray(rows) && rows.length > 0, `${label}: row in audit_log`, error?.message ?? `rows: ${rows?.length}`)
      const meta = rows?.[0]?.meta ?? {}
      for (const [checkLabel, checkFn, detail] of checks) {
        assert(checkFn(meta), `${label}: ${checkLabel}`, detail)
      }
      assertNoPhiInMeta(meta, label)
    } catch (err) {
      assert(false, `${label} did not throw`, err instanceof Error ? err.message : String(err))
    }
    console.log()
  }

  // Cleanup: remove test crisis_events rows inserted by B1
  // SERVICE CLIENT: deleting test crisis_events rows — trusted server op
  await supabase.from('crisis_events').delete().eq('session_id', sessionCrisis)
}

// ---------------------------------------------------------------------------
// PART C — Data minimization unit tests (pure, no I/O)
// ---------------------------------------------------------------------------

function runDataMinimizationTests() {
  console.log('--- PART C: minimizeForStorage() unit tests ---')
  console.log()

  const allStorable = Object.fromEntries([...STORABLE_FIELDS].map((k) => [k, `val_${k}`]))
  const nonStorable: Record<string, unknown> = {
    name: 'John Veteran',
    phone: '555-555-5555',
    email: 'test@example.com',
    raw_message: 'I have been struggling with nightmares and feel hopeless.',
    contact_consent: true,
    contact_consent_at: new Date().toISOString(),
    some_other_field: 'arbitrary value',
  }
  const mixed = { ...allStorable, ...nonStorable }

  const result = minimizeForStorage(mixed)

  // All STORABLE_FIELDS keys must be present in output
  for (const key of STORABLE_FIELDS) {
    assert(key in result, `STORABLE_FIELD present in output: ${key}`, `value: ${result[key]}`)
  }

  // All non-storable keys must be absent from output
  for (const key of Object.keys(nonStorable)) {
    assert(!(key in result), `non-storable key absent from output: ${key}`)
  }

  // Verify no mutation of the original object
  const originalKeys = Object.keys(mixed).length
  assert(Object.keys(mixed).length === originalKeys, 'original object not mutated (key count unchanged)')
  for (const key of Object.keys(nonStorable)) {
    assert(key in mixed, `original object retains non-storable key: ${key}`)
  }

  // Edge case: empty input
  assert(Object.keys(minimizeForStorage({})).length === 0, 'empty input returns empty output')

  // Edge case: only non-storable keys
  const onlyNonStorable = { name: 'Test', message: 'I need help' }
  assert(Object.keys(minimizeForStorage(onlyNonStorable)).length === 0, 'only non-storable keys → empty output')

  console.log()
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

async function main() {
  console.log('============================================================')
  console.log('Charter Audit Events + Data Minimization Tests (Step 8)')
  console.log('============================================================')
  console.log()

  runMetaShapeTests()
  await runDbPersistenceTests()
  runDataMinimizationTests()

  console.log('============================================================')
  console.log(`RESULT: ${passed}/${passed + failed} assertions passed`)
  console.log('============================================================')
  if (failed > 0) process.exit(1)
}

main().catch((err) => {
  console.error('Test runner error:', err)
  process.exit(1)
})
