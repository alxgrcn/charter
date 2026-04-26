/**
 * Direct pipeline integration test — no HTTP, no server required.
 * Runs runPipeline() with a realistic Army/transitional-housing profile
 * and asserts minimum confidence thresholds on key benefits.
 *
 * Preflight check: validates ANTHROPIC_API_KEY before running LLM assertions.
 * If the key is invalid, structural assertions still run and the suite exits 0
 * with a clear "LLM_BLOCKED" notice rather than failing on confidence scores.
 */

import Anthropic from '@anthropic-ai/sdk'
import { runPipeline } from '../core/pipeline'
import type { VeteranProfile } from '../types/charter'

const PROFILE: VeteranProfile = {
  id: 'test-pipeline-001',
  org_id: 'test',
  session_id: 'test-session-pipeline-001',
  service_branch: 'Army',
  years_served: 8,
  discharge_type: 'Honorable',
  combat_veteran: true,
  disability_rating: 30,           // back injury
  housing_status: 'transitional',
  household_income: 18000,
  household_size: 1,
  state: 'CA',
  age: 34,
  separation_date: '2021-06-15',
  created_at: new Date().toISOString(),
  expires_at: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
}

type AssertResult = { label: string; pass: boolean; skipped?: boolean; detail: string }

function assert(label: string, condition: boolean, detail: string): AssertResult {
  return { label, pass: condition, detail }
}

function skip(label: string, detail: string): AssertResult {
  return { label, pass: true, skipped: true, detail }
}

async function checkAnthropicKey(): Promise<boolean> {
  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 5,
      messages: [{ role: 'user', content: 'ping' }],
    })
    return true
  } catch {
    return false
  }
}

async function main() {
  console.log('='.repeat(60))
  console.log('Charter Pipeline Test')
  console.log('Profile: Army · Honorable · 8yr · transitional housing · back injury 30%')
  console.log('='.repeat(60))
  console.log()

  process.stdout.write('Preflight: checking ANTHROPIC_API_KEY... ')
  const llmAvailable = await checkAnthropicKey()
  console.log(llmAvailable ? '✓ valid' : '✗ INVALID — LLM assertions will be skipped')
  if (!llmAvailable) {
    console.log()
    console.log('  ACTION REQUIRED: ANTHROPIC_API_KEY in .env.local is expired or revoked.')
    console.log('  Generate a new key at console.anthropic.com and update .env.local.')
    console.log('  Confidence assertions (HUD-VASH > 0.6, VA Healthcare > 0.6) will be')
    console.log('  skipped until a valid key is present.')
  }
  console.log()

  let report
  try {
    report = await runPipeline(PROFILE)
  } catch (err) {
    console.error('FATAL: runPipeline threw:', err instanceof Error ? err.message : err)
    process.exit(1)
  }

  // Print all benefits
  console.log('Benefits returned:\n')
  for (const b of report.benefits) {
    const bar = '█'.repeat(Math.round(b.confidence * 10)).padEnd(10, '░')
    console.log(`  ${b.benefit_name.padEnd(50)} ${b.qualifies.padEnd(10)} conf=${b.confidence.toFixed(3)} ${bar}`)
  }
  console.log()

  const hudVash  = report.benefits.find((b) => b.benefit_id === 'hud_vash')
  const vaHealth = report.benefits.find((b) => b.benefit_id === 'va_healthcare')

  const results: AssertResult[] = [
    assert(
      'benefits array is non-empty',
      Array.isArray(report.benefits) && report.benefits.length > 0,
      `benefits.length = ${report.benefits.length}`
    ),
    assert(
      'HUD-VASH present in benefits array',
      hudVash !== undefined,
      hudVash ? `qualifies=${hudVash.qualifies}` : 'not found'
    ),
    llmAvailable
      ? assert(
          'HUD-VASH confidence > 0.6',
          (hudVash?.confidence ?? 0) > 0.6,
          `confidence = ${(hudVash?.confidence ?? 0).toFixed(3)}`
        )
      : skip('HUD-VASH confidence > 0.6', 'skipped — ANTHROPIC_API_KEY invalid'),
    assert(
      'VA Healthcare present in benefits array',
      vaHealth !== undefined,
      vaHealth ? `qualifies=${vaHealth.qualifies}` : 'not found'
    ),
    llmAvailable
      ? assert(
          'VA Healthcare confidence > 0.6',
          (vaHealth?.confidence ?? 0) > 0.6,
          `confidence = ${(vaHealth?.confidence ?? 0).toFixed(3)}`
        )
      : skip('VA Healthcare confidence > 0.6', 'skipped — ANTHROPIC_API_KEY invalid'),
    assert(
      'discharge_upgrade_flag field exists',
      typeof report.discharge_upgrade_flag === 'boolean',
      `discharge_upgrade_flag = ${report.discharge_upgrade_flag}`
    ),
    assert(
      'crisis_line contains 988',
      typeof report.crisis_line === 'string' && report.crisis_line.includes('988'),
      `crisis_line = "${report.crisis_line?.slice(0, 60)}"`
    ),
    assert(
      'disclaimer present',
      typeof report.disclaimer === 'string' && report.disclaimer.length > 20,
      `disclaimer length = ${report.disclaimer?.length}`
    ),
  ]

  console.log('Assertions:\n')
  let passed = 0
  let skipped = 0
  for (const r of results) {
    const icon = r.skipped ? '⊘' : r.pass ? '✓' : '✗'
    console.log(`  ${icon} ${r.label}`)
    console.log(`      ${r.detail}`)
    if (r.skipped) skipped++
    else if (r.pass) passed++
  }

  const total = results.length - skipped
  console.log()
  console.log('='.repeat(60))
  if (skipped > 0) {
    console.log(`RESULT: ${passed}/${total} assertions passed  (${skipped} skipped — update ANTHROPIC_API_KEY to enable)`)
  } else {
    console.log(`RESULT: ${passed}/${total} assertions passed`)
  }
  console.log('='.repeat(60))

  process.exit(passed === total ? 0 : 1)
}

main().catch((err) => { console.error(err); process.exit(1) })
