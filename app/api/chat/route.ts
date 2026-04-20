import { NextRequest, NextResponse } from 'next/server'

export async function POST(_req: NextRequest) {
  return NextResponse.json({
    role: 'assistant',
    content:
      "Hi, I'm Charter. I help veterans discover benefits they've earned. To get started, can you tell me which branch of the military you served in and approximately how long you served?",
  })
}
