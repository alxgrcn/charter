import { createServiceClient } from '../lib/supabase'

const MH_SOURCES = [
  'Veterans Crisis Line and Emergency Mental Health',
  'VA Mental Health Outpatient Services',
  'VA Residential Mental Health Programs',
  'Vet Center Counseling',
  'VA PTSD Specialty Care',
  'VA Substance Use Disorder Treatment',
  'Military Sexual Trauma Counseling',
  'VA Caregiver Support Program',
  'Peer Support and Community Programs California',
]

async function main() {
  // SERVICE CLIENT: purging non-mental-health regulation_chunks — trusted admin script
  const supabase = createServiceClient()

  const { error } = await supabase
    .from('regulation_chunks')
    .delete()
    .not('source', 'in', `(${MH_SOURCES.map(s => `"${s}"`).join(',')})`)

  if (error) { console.error('Delete failed:', error.message); process.exit(1) }

  console.log('Deleted non-mental-health rows.')

  const { data, error: selError } = await supabase
    .from('regulation_chunks')
    .select('source')
    .order('source')

  if (selError) { console.error('Select failed:', selError.message); process.exit(1) }

  const counts: Record<string, number> = {}
  for (const row of data ?? []) {
    counts[row.source] = (counts[row.source] ?? 0) + 1
  }

  console.log('\nremaining sources:')
  for (const [src, n] of Object.entries(counts)) {
    console.log(`  ${n}\t${src}`)
  }
  console.log(`\ntotal sources: ${Object.keys(counts).length}`)
}

main().catch((err) => { console.error(err); process.exit(1) })
