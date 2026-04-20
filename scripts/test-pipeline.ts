import { runPipeline } from '../core/pipeline'
import type { VeteranProfile } from '../types/charter'

const testProfile: VeteranProfile = {
  id: 'test-001',
  org_id: 'test-org',
  session_id: null,
  service_branch: 'Army',
  years_served: 4,
  discharge_type: 'honorable',
  combat_veteran: true,
  disability_rating: 30,
  housing_status: 'housed',
  household_income: 28000,
  household_size: 2,
  state: 'CA',
  age: 32,
  separation_date: '2022-01-15',
  created_at: new Date().toISOString(),
  expires_at: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
}

async function main() {
  console.log('Running pipeline for test profile...\n')

  const report = await runPipeline(testProfile)

  console.log(JSON.stringify(report, null, 2))

  // Gate assertions
  const errors: string[] = []

  if (!report.crisis_line.includes('988')) {
    errors.push('FAIL: crisis_line does not contain "988"')
  } else {
    console.log('\n✓ crisis_line contains "988"')
  }

  if (!report.disclaimer || report.disclaimer.length < 20) {
    errors.push('FAIL: disclaimer is missing or too short')
  } else {
    console.log('✓ disclaimer is present')
  }

  if (!Array.isArray(report.benefits) || report.benefits.length === 0) {
    errors.push('FAIL: benefits array is empty')
  } else {
    console.log(`✓ ${report.benefits.length} benefit determinations generated`)
  }

  if (errors.length > 0) {
    for (const e of errors) console.error(e)
    process.exit(1)
  }

  console.log('\nAll gate checks passed.')
}

main().catch((err) => {
  console.error('Pipeline test failed:', err)
  process.exit(1)
})
