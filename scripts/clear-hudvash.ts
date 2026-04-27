import { createServiceClient } from '../lib/supabase'

async function main() {
  // SERVICE CLIENT: deleting regulation_chunks for re-ingestion — trusted admin script
  const supabase = createServiceClient()

  // Delete both HUD-VASH (hyphen) and HUD_VASH (underscore) naming variants
  const { error: del1 } = await supabase
    .from('regulation_chunks')
    .delete()
    .like('source', '%HUD-VASH%')

  if (del1) { console.error('Delete 1 failed:', del1.message); process.exit(1) }

  const { error: del2 } = await supabase
    .from('regulation_chunks')
    .delete()
    .like('source', '%HUD_VASH%')

  if (del2) { console.error('Delete 2 failed:', del2.message); process.exit(1) }

  console.log('Deleted all HUD-VASH / HUD_VASH rows.')

  const { count, error: countError } = await supabase
    .from('regulation_chunks')
    .select('*', { count: 'exact', head: true })

  if (countError) { console.error('Count failed:', countError.message); process.exit(1) }

  console.log(`regulation_chunks total: ${count}`)
}

main().catch((err) => { console.error(err); process.exit(1) })
