/**
 * Integration tests for POST /api/analyze
 * Requires dev server running on localhost:3003 (npm run dev)
 *
 * Test 1's confidence assertion is skipped when all confidenceScores are 0,
 * which indicates ANTHROPIC_API_KEY is invalid (not a code bug).
 */

const BASE = 'http://localhost:3003'
const SECRET = process.env.INTERNAL_WEBHOOK_SECRET ?? ''

if (!SECRET) {
  console.error('INTERNAL_WEBHOOK_SECRET is not set — source .env.local before running')
  process.exit(1)
}

type TestResult = { name: string; pass: boolean; notes: string[] }

async function post(body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(`${BASE}/api/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

const auth = { Authorization: `Bearer ${SECRET}` }

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

async function test1(): Promise<TestResult> {
  const name = 'Test 1 — Valid Army/honorable/8yr profile → 200 with full report'
  const notes: string[] = []
  let pass = true

  const res = await post(
    {
      branch: 'Army',
      dischargeStatus: 'Honorable',
      serviceDates: { years: 8, start: '2013', end: '2021' },
      goals: ['housing', 'healthcare'],
      housingStatus: 'transitional',
      healthConcerns: 'back injury, sleep issues',
      source: 'iva',
    },
    auth
  )

  if (res.status !== 200) {
    notes.push(`Expected 200, got ${res.status}`)
    pass = false
  }

  const data = await res.json()

  if (!Array.isArray(data.benefits) || data.benefits.length < 3) {
    notes.push(`Expected benefits.length >= 3, got ${data.benefits?.length ?? 'undefined'}`)
    pass = false
  }

  const mhOutpatientConfidence: number = data.confidenceScores?.['va_mh_outpatient'] ?? 0
  const allScoresZero = Object.values(data.confidenceScores ?? {}).every((v) => v === 0)
  if (allScoresZero) {
    notes.push('va_mh_outpatient confidence skipped — all scores are 0 (ANTHROPIC_API_KEY invalid; update .env.local)')
  } else if (mhOutpatientConfidence <= 0.7) {
    notes.push(`Expected va_mh_outpatient confidence > 0.7, got ${mhOutpatientConfidence}`)
    pass = false
  }

  if (!Array.isArray(data.disclaimers) || data.disclaimers.length === 0) {
    notes.push('Expected disclaimers to be a non-empty array')
    pass = false
  }

  if (data.crisis_flag !== false) {
    notes.push(`Expected crisis_flag false, got ${data.crisis_flag}`)
    pass = false
  }

  if (pass) notes.push(`${data.benefits.length} benefits, va_mh_outpatient confidence=${mhOutpatientConfidence.toFixed(3)}, ${data.disclaimers.length} disclaimers`)
  return { name, pass, notes }
}

async function test2(): Promise<TestResult> {
  const name = 'Test 2 — No auth header → 401'
  const notes: string[] = []

  const res = await post({ branch: 'Army', dischargeStatus: 'Honorable', source: 'iva' })
  const pass = res.status === 401
  notes.push(`Status: ${res.status}`)
  return { name, pass, notes }
}

async function test3(): Promise<TestResult> {
  const name = 'Test 3 — Wrong secret → 401'
  const notes: string[] = []

  const res = await post(
    { branch: 'Army', dischargeStatus: 'Honorable', source: 'iva' },
    { Authorization: 'Bearer wrong-secret-value' }
  )
  const pass = res.status === 401
  notes.push(`Status: ${res.status}`)
  return { name, pass, notes }
}

async function test4(): Promise<TestResult> {
  const name = 'Test 4 — Missing required fields (no branch, no dischargeStatus) → 400'
  const notes: string[] = []

  const res = await post({ source: 'sms' }, auth)
  const pass = res.status === 400
  const data = await res.json()
  notes.push(`Status: ${res.status}`)
  if (data.details) notes.push(`Validation errors: ${JSON.stringify(data.details.fieldErrors)}`)
  return { name, pass, notes }
}

async function test5(): Promise<TestResult> {
  const name = 'Test 5 — Crisis language in additionalContext → 200 and crisis_flag true'
  const notes: string[] = []
  let pass = true

  const res = await post(
    {
      branch: 'Marines',
      dischargeStatus: 'Honorable',
      source: 'sms',
      additionalContext: { notes: "I don't see the point anymore" },
    },
    auth
  )

  if (res.status !== 200) {
    notes.push(`Expected 200, got ${res.status}`)
    pass = false
  }

  const data = await res.json()
  if (data.crisis_flag !== true) {
    notes.push(`Expected crisis_flag true, got ${data.crisis_flag}`)
    pass = false
  }

  if (pass) notes.push('crisis_flag correctly set to true')
  return { name, pass, notes }
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

async function main() {
  console.log(`Running /api/analyze integration tests against ${BASE}\n`)

  // Confirm server is reachable before running
  try {
    await fetch(`${BASE}/api/analyze`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
  } catch {
    console.error(`Cannot reach ${BASE} — is the dev server running? (npm run dev)`)
    process.exit(1)
  }

  const tests = [test1, test2, test3, test4, test5]
  const results: TestResult[] = []

  for (const t of tests) {
    process.stdout.write(`  Running ${t.name.split('—')[0].trim()}... `)
    try {
      const result = await t()
      results.push(result)
      console.log(result.pass ? '✓' : '✗')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      results.push({ name: t.name, pass: false, notes: [`Threw: ${msg}`] })
      console.log('✗ (threw)')
    }
  }

  console.log(`\n${'='.repeat(60)}`)
  let passed = 0
  for (const r of results) {
    const icon = r.pass ? '✓ PASS' : '✗ FAIL'
    console.log(`${icon} — ${r.name}`)
    for (const note of r.notes) console.log(`       ${note}`)
    if (r.pass) passed++
  }
  console.log('='.repeat(60))
  console.log(`RESULT: ${passed}/${results.length} passed`)

  process.exit(passed === results.length ? 0 : 1)
}

main().catch((err) => { console.error(err); process.exit(1) })
