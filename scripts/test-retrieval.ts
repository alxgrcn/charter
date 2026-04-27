/**
 * Retrieval quality test — calls retrieveChunks() directly (no HTTP).
 * Asserts that each query returns at least 1 result from the knowledge base.
 */

import { retrieveChunks } from '../lib/rag'

const QUERIES = [
  'what mental health programs are available for veterans with PTSD',
  'can a veteran with OTH discharge get mental health care',
  'VA substance use treatment for veterans California',
  'military sexual trauma counseling no documentation',
  'veteran in crisis 988 California',
  'Vet Center counseling no enrollment required',
  'caregiver support veteran mental health',
  'peer support veteran community programs Los Angeles',
  'residential mental health treatment veteran inpatient',
]

async function main() {
  console.log('='.repeat(60))
  console.log('Charter Retrieval Test')
  console.log('='.repeat(60))
  console.log()

  let passed = 0

  for (const query of QUERIES) {
    console.log(`Query: "${query}"`)
    const chunks = await retrieveChunks(query, {})

    console.log(`  Results: ${chunks.length}`)
    for (const c of chunks.slice(0, 3)) {
      console.log(`  [${c.source}${c.section ? ` / ${c.section}` : ''}] sim=${c.similarity.toFixed(3)}`)
      console.log(`    ${c.content.slice(0, 160).replace(/\n/g, ' ')}`)
    }

    const pass = chunks.length >= 1
    console.log(`  ${pass ? '✓ PASS' : '✗ FAIL'} — ${pass ? 'at least 1 result returned' : 'no results returned'}`)
    console.log()
    if (pass) passed++
  }

  console.log('='.repeat(60))
  console.log(`RESULT: ${passed}/${QUERIES.length} queries passed`)
  console.log('='.repeat(60))

  process.exit(passed === QUERIES.length ? 0 : 1)
}

main().catch((err) => { console.error(err); process.exit(1) })
