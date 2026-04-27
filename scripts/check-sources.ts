import { createServiceClient } from '../lib/supabase'

async function main() {
  // SERVICE CLIENT: reading regulation_chunks sources for audit — trusted admin script
  const supabase = createServiceClient()

  const { data, error } = await supabase
    .from('regulation_chunks')
    .select('source')
    .order('source')

  if (error) { console.error(error.message); process.exit(1) }

  const counts: Record<string, number> = {}
  for (const row of data ?? []) {
    counts[row.source] = (counts[row.source] ?? 0) + 1
  }

  for (const [src, n] of Object.entries(counts)) {
    console.log(`${n}\t${src}`)
  }
}

main().catch((err) => { console.error(err); process.exit(1) })
