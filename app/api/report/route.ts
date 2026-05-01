import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '../../../lib/supabase'

export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get('session_id')
  if (!sessionId) {
    return NextResponse.json({ error: 'session_id required' }, { status: 400 })
  }

  try {
    // SERVICE CLIENT: reading benefit_reports by veteran_profile_id for frontend polling
    const supabase = createServiceClient()
    const { data, error } = await supabase
      .from('benefit_reports')
      .select('report_json')
      .eq('veteran_profile_id', sessionId)
      .eq('status', 'complete')
      .order('created_at', { ascending: false })
      .limit(1)

    if (error || !data || data.length === 0) {
      return NextResponse.json({ pending: true })
    }

    return NextResponse.json({ report: data[0].report_json })
  } catch {
    return NextResponse.json({ pending: true })
  }
}
