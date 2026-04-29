/**
 * Integration tests for POST /api/analyze
 * Requires dev server running on localhost:3003 (npm run dev)
 *
 * Test 6 (rate limit) runs 11 sequential requests and may take several minutes
 * if non-crisis requests trigger the full pipeline. This is expected behavior.
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

function isValidISO(s: unknown): boolean {
  return typeof s === 'string' && !isNaN(new Date(s).getTime()) && s.includes('T')
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

async function test1(): Promise<TestResult> {
  const name = 'Test 1 — Valid mental health profile (non-crisis) → 200 with full report'
  const notes: string[] = []
  let pass = true

  const res = await post(
    {
      branch: 'Army',
      dischargeStatus: 'Honorable',
      mentalHealthConcerns: 'trouble sleeping and nightmares, feel disconnected from family since returning',
      currentSupport: 'none',
      location: 'California',
      source: 'simulation',
    },
    auth
  )

  if (res.status !== 200) {
    notes.push(`Expected 200, got ${res.status}`)
    pass = false
  }

  const data = await res.json()

  if (data.crisis_flag !== false) {
    notes.push(`Expected crisis_flag false, got ${JSON.stringify(data.crisis_flag)}`)
    pass = false
  }

  if (!Array.isArray(data.benefits) || data.benefits.length < 2) {
    notes.push(`Expected benefits.length >= 2, got ${data.benefits?.length ?? 'undefined'}`)
    pass = false
  }

  // Confidence assertion — skipped if all confidences are 0 (ANTHROPIC_API_KEY invalid)
  const allConfidences: number[] = (data.benefits ?? []).map((b: { confidence: number }) => b.confidence)
  const allZero = allConfidences.length > 0 && allConfidences.every((c) => c === 0)
  if (allZero) {
    notes.push('Confidence assertion skipped — all confidences are 0 (check ANTHROPIC_API_KEY in .env.local)')
  } else {
    const targetBenefit = (data.benefits ?? []).find(
      (b: { benefitId: string; confidence: number }) =>
        (b.benefitId === 'va_ptsd' || b.benefitId === 'va_mh_outpatient') && b.confidence > 0.5
    )
    if (!targetBenefit) {
      notes.push(
        `Expected at least one benefit with benefitId "va_ptsd" or "va_mh_outpatient" and confidence > 0.5` +
        ` — got: ${JSON.stringify((data.benefits ?? []).map((b: { benefitId: string; confidence: number }) => ({ id: b.benefitId, conf: b.confidence })))}`
      )
      pass = false
    } else {
      notes.push(`${targetBenefit.benefitId} confidence=${targetBenefit.confidence.toFixed(3)}`)
    }
  }

  if (!Array.isArray(data.disclaimers) || data.disclaimers.length < 2) {
    notes.push(`Expected disclaimers.length >= 2, got ${data.disclaimers?.length ?? 'undefined'}`)
    pass = false
  }

  if (typeof data.disclaimers?.[0] !== 'string' || !data.disclaimers[0].includes('educational')) {
    notes.push(`Expected disclaimers[0] to contain "educational", got: ${JSON.stringify(data.disclaimers?.[0])}`)
    pass = false
  }

  const has988 = (data.disclaimers ?? []).some((d: unknown) => typeof d === 'string' && d.includes('988'))
  if (!has988) {
    notes.push('Expected at least one disclaimer to contain "988"')
    pass = false
  }

  if (!isValidISO(data.generated_at)) {
    notes.push(`Expected generated_at to be a valid ISO date string, got: ${JSON.stringify(data.generated_at)}`)
    pass = false
  }

  if (pass) {
    notes.push(
      `${data.benefits?.length} benefits, ${data.disclaimers?.length} disclaimers, ` +
      `urgency_level=${data.fast_response?.urgency_level}, generated_at=${data.generated_at}`
    )
  }
  return { name, pass, notes }
}

async function test2(): Promise<TestResult> {
  const name = 'Test 2 — No auth header → 401'
  const notes: string[] = []

  const res = await post({ branch: 'Army', dischargeStatus: 'Honorable', source: 'simulation' })
  const pass = res.status === 401
  notes.push(`Status: ${res.status}`)
  return { name, pass, notes }
}

async function test3(): Promise<TestResult> {
  const name = 'Test 3 — Wrong secret → 401'
  const notes: string[] = []

  const res = await post(
    { branch: 'Army', dischargeStatus: 'Honorable', source: 'simulation' },
    { Authorization: 'Bearer wrong-secret-value' }
  )
  const pass = res.status === 401
  notes.push(`Status: ${res.status}`)
  return { name, pass, notes }
}

async function test4(): Promise<TestResult> {
  const name = 'Test 4 — Missing required fields (no branch, no dischargeStatus) → 400'
  const notes: string[] = []

  const res = await post({ source: 'simulation' }, auth)
  const pass = res.status === 400
  const data = await res.json()
  notes.push(`Status: ${res.status}`)
  if (data.details) notes.push(`Validation errors: ${JSON.stringify(data.details.fieldErrors)}`)
  return { name, pass, notes }
}

async function test5(): Promise<TestResult> {
  const name = 'Test 5 — Crisis language in input → 200 with crisis shape'
  const notes: string[] = []
  let pass = true

  const res = await post(
    {
      branch: 'Marines',
      dischargeStatus: 'Honorable',
      mentalHealthConcerns: "I don't see the point in anything anymore",
      source: 'simulation',
    },
    auth
  )

  if (res.status !== 200) {
    notes.push(`Expected 200, got ${res.status}`)
    pass = false
  }

  const data = await res.json()

  if (data.crisis_flag !== true) {
    notes.push(`Expected crisis_flag true, got ${JSON.stringify(data.crisis_flag)}`)
    notes.push(`FINDING: mentalHealthConcerns "I don't see the point in anything anymore" did not trigger crisis detection`)
    notes.push(`fast_response received: ${JSON.stringify(data.fast_response)}`)
    pass = false
  }

  if (!Array.isArray(data.benefits) || data.benefits.length !== 0) {
    notes.push(`Expected benefits to be an empty array, got: ${JSON.stringify(data.benefits)}`)
    pass = false
  }

  const has988 = (data.disclaimers ?? []).some((d: unknown) => typeof d === 'string' && d.includes('988'))
  if (!has988) {
    notes.push('Expected at least one disclaimer to contain "988"')
    pass = false
  }

  if (!data.crisis_resources) {
    notes.push('Expected crisis_resources field to be present')
    pass = false
  }

  if (pass) {
    notes.push(`crisis_flag=true, benefits=[], crisis_resources present, 988 in disclaimers`)
    notes.push(`crisis_resources: ${data.crisis_resources}`)
  }
  return { name, pass, notes }
}

async function test6(): Promise<TestResult> {
  // NOTE: This test makes 11 sequential requests. Non-crisis requests trigger the full
  // pipeline — this test may take several minutes depending on pipeline speed.
  const name = 'Test 6 — Rate limit: 11 sequential requests → at least one 429'
  const notes: string[] = []

  const body = {
    branch: 'Army',
    dischargeStatus: 'Honorable',
    mentalHealthConcerns: 'sleep issues',
    source: 'simulation',
  }

  const statuses: number[] = []
  for (let i = 0; i < 11; i++) {
    const res = await post(body, auth)
    statuses.push(res.status)
    await res.text() // consume body to avoid connection leaks
    if (res.status === 429) break // stop once rate-limited — avoids unnecessary pipeline runs
  }

  const has429 = statuses.includes(429)
  notes.push(`Statuses: ${statuses.join(', ')}`)
  notes.push(
    has429
      ? 'Rate limiter fired — at least one 429 returned'
      : 'No 429 returned — rate limiter not firing (may need more requests if prior tests consumed window)'
  )
  return { name, pass: has429, notes }
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

async function main() {
  console.log(`Running /api/analyze integration tests against ${BASE}\n`)

  // Preflight: confirm server is reachable
  try {
    await fetch(`${BASE}/api/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
  } catch {
    console.error(`Cannot reach ${BASE} — is the dev server running? (npm run dev)`)
    process.exit(1)
  }

  const tests = [test1, test2, test3, test4, test5, test6]
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

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
