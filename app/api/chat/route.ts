import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import { runPipeline } from '../../../core/pipeline'
import type { VeteranProfile, ReportJSON } from '../../../types/charter'
import { redact } from '../../../lib/redact'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

const MessageSchema = z.object({
  role: z.enum(['user', 'assistant'] as const),
  content: z.unknown(),
})

const BodySchema = z.object({
  messages: z.array(MessageSchema).min(1),
  profile: z.record(z.string(), z.unknown()),
})

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are Charter, a veteran benefits intake navigator. Your job is to collect information from veterans conversationally so they can be matched to VA benefits they've earned.

Guidelines:
- Ask one or two questions at a time — never overwhelm
- When a veteran confirms a value, immediately call record_field (never batch)
- Collect at minimum: service_branch, years_served, discharge_type before triggering analysis
- Additional fields improve accuracy: disability_rating, housing_status, household_income, household_size, state, age, combat_veteran, separation_date
- Call trigger_analysis when you have enough information to run a meaningful analysis
- Call flag_uncertain when something is ambiguous or needs counselor review
- NEVER ask about substance use history — this is protected under 42 CFR Part 2 and requires explicit consent from a separate process
- Do not repeat back sensitive values like disability ratings or income figures
- Be warm, direct, and respectful — veterans have already served; your job is to help them access what they've earned`

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'record_field',
    description: 'Record a veteran profile field value confirmed during conversation. Call immediately when a value is confirmed — do not batch.',
    input_schema: {
      type: 'object',
      properties: {
        field: {
          type: 'string',
          description: 'Profile field name: service_branch | years_served | discharge_type | combat_veteran | disability_rating | housing_status | household_income | household_size | state | age | separation_date',
        },
        value: {
          description: 'The confirmed field value',
        },
      },
      required: ['field', 'value'],
    },
  },
  {
    name: 'flag_uncertain',
    description: 'Flag a profile area or benefit as uncertain, requiring counselor review.',
    input_schema: {
      type: 'object',
      properties: {
        area: { type: 'string', description: 'The area of uncertainty (e.g. "discharge_type", "disability_claim")' },
        reason: { type: 'string', description: 'Why this is uncertain or needs review' },
      },
      required: ['area', 'reason'],
    },
  },
  {
    name: 'trigger_analysis',
    description: 'Trigger the full benefits analysis pipeline. Call when you have collected enough profile information (at minimum: service_branch, years_served, discharge_type).',
    input_schema: {
      type: 'object',
      properties: {
        reason: { type: 'string', description: 'Why the profile is ready for analysis' },
      },
      required: ['reason'],
    },
  },
]

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)
    const parsed = BodySchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    }

    const { messages, profile } = parsed.data
    const currentMessages = messages as Anthropic.MessageParam[]

    let profileUpdates: Partial<VeteranProfile> = {}
    let report: ReportJSON | undefined
    let lastAssistantText = ''

    const MAX_LOOPS = 10
    for (let i = 0; i < MAX_LOOPS; i++) {
      const response = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
        tools: TOOLS,
        messages: currentMessages,
      })

      const textBlock = response.content.find((b) => b.type === 'text')
      if (textBlock?.type === 'text') lastAssistantText = textBlock.text

      if (response.stop_reason === 'end_turn') break

      if (response.stop_reason === 'tool_use') {
        currentMessages.push({ role: 'assistant', content: response.content })

        const toolResults: Anthropic.ToolResultBlockParam[] = []

        for (const block of response.content) {
          if (block.type !== 'tool_use') continue

          if (block.name === 'record_field') {
            const input = block.input as { field: string; value: unknown }
            // Log field name only — never log values (STANDARDS §2.5, no PII in logs)
            console.log('[charter/chat] record_field:', input.field)
            const value =
              input.field === 'disability_rating'
                ? parseFloat(String(input.value))
                : input.value
            profileUpdates = { ...profileUpdates, [input.field]: value }
            toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: 'recorded' })
          }

          if (block.name === 'flag_uncertain') {
            const input = block.input as { area: string; reason: string }
            console.log('[charter/chat] flag_uncertain area:', input.area)
            toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: 'flagged for counselor review' })
          }

          if (block.name === 'trigger_analysis') {
            const mergedProfile = { ...profile, ...profileUpdates } as VeteranProfile
            try {
              report = await runPipeline(mergedProfile)
              toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: 'Analysis complete. Present the key findings to the veteran.' })
            } catch (err) {
              // Log error type only — no PII
              const msg = err instanceof Error ? err.message : 'unknown error'
              console.error('[charter/chat] pipeline error:', msg)
              toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: 'Analysis failed. Let the veteran know you encountered an issue and suggest they contact a VSO.' })
            }
          }
        }

        currentMessages.push({ role: 'user', content: toolResults })
      }
    }

    return NextResponse.json({
      role: 'assistant',
      content: lastAssistantText || "I'm sorry, I wasn't able to generate a response. Please try again or contact a Veterans Service Officer at 1-800-827-1000.",
      ...(Object.keys(profileUpdates).length > 0 && { profileUpdates }),
      ...(report && { report }),
    })
  } catch (err) {
    console.error('[chat/route]:', redact(err instanceof Error ? { message: err.message } : err))
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
