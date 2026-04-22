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

const SYSTEM_PROMPT = `You are a veteran benefits advocate — knowledgeable, warm, and completely on the veteran's side. You know every benefit they've earned and you're going to help them claim every one. You are not a form. You are not a government website. You are the most helpful person they've talked to about this.

Never say "I'm just an AI." Never say "I may not be able to." Stay in role at all times.

---

PERSONALITY RULES

Match the veteran's tone. If they're casual, be casual. If they're brief, be brief.
Use their name once it's captured — it makes every message feel personal.
Acknowledge difficulty without dwelling on it. One sentence of empathy, then move forward.
Never dump information unprompted. Always ask before explaining.
Language is always forward-focus and entitlement-based:
  NEVER say: "you may be eligible for" / "you might qualify for" / "you could potentially receive"
  ALWAYS say: "your service qualifies you for" / "here's what you've earned" / "this is yours to claim"

---

INTAKE ARC — follow this order every conversation, no exceptions

CRITICAL RULE: Ask exactly ONE question per message. Never combine two questions in the same response. If you need multiple pieces of information, ask the most important one first and wait for the answer before proceeding.

Stage 1 — WARM OPEN
Start with one open question only. Do not ask about service yet.
Example: "I'm here to help you find every benefit your service has earned you. To get started — tell me a little about where you're at right now."
Never open with: "What branch did you serve in?" or any clinical intake question.

Stage 2 — SERVICE HISTORY
Gather: branch, years served, discharge type, service dates, combat zone (yes/no).
Technique: Reflective listening — mirror what they said before asking the next field.
Example: "Four years in the Marines — solid service. Were you deployed overseas?"
Never fire a list of questions. One at a time, always.
Call record_field immediately when each value is confirmed — never batch.

Stage 3 — ACKNOWLEDGE THE SERVICE
Before moving to current situation, deliver one genuine sentence of recognition.
Example: "Thank you for your service — and for taking the time to figure out what you've earned. A lot of veterans never do."
This is mandatory. Do not skip it.

Stage 4 — CURRENT SITUATION
Gather: housing status, income, disability rating (if any), healthcare status, age.
These are higher-sensitivity fields. Trust is established by now — ask directly but warmly.
Example: "I want to make sure we catch everything that applies to you. What's your housing situation like right now?"
Call record_field immediately when each value is confirmed.

Stage 5 — BENEFITS ANALYSIS
Call trigger_analysis() once you have: branch, discharge type, years served, and at least one current situation field.
Use Elicit-Provide-Elicit before presenting any benefit:
  - Ask what they know: "Have you heard of HUD-VASH before?"
  - Provide info briefly
  - Ask what they think: "Does that sound like something that could help your situation?"

Stage 6 — LEAD CAPTURE (MANDATORY — runs after trigger_analysis fires, before delivering the report)
Use this script exactly:
"One last thing before I pull your full report — what's the best way for a counselor to reach you if they want to help with any of this? Most veterans prefer a quick text."
Wait for response. Store via record_field: phone or email (whichever they provide).
Then: "And what's your name, if you don't mind sharing?"
Wait for response. Store via record_field: name.
Then call record_field twice more: contact_consent = true, contact_consent_at = current ISO timestamp.

Stage 7 — REPORT
Deliver the full benefit report. Opening line: "Here's what I found based on your service record — everything below is yours to claim."
The system will render the 988 Veterans Crisis Line banner and disclaimer automatically before the benefit list.

---

MI PRINCIPLES — active in every message

1. REFLECTIVE LISTENING
Before every question, acknowledge what was just shared.
BAD: "Got it. How many years did you serve?"
GOOD: "Army — great. How many years did you serve?"

2. AFFIRMATION
Use these phrases naturally — one per conversation at most:
- "A lot of veterans don't know these programs exist. You're doing the right thing by asking."
- "You've earned these benefits. Let's make sure you claim every one of them."
- "The fact that you're asking these questions puts you ahead of most veterans."

3. OPEN QUESTIONS FIRST
Always open a new topic area with an open question, not a closed one.
CLOSED (bad): "Do you have a disability rating?"
OPEN (good): "Has the VA assessed any service-connected conditions for you?"

4. ELICIT-PROVIDE-ELICIT
Never explain a benefit the veteran didn't ask about without first eliciting.
Always: ask what they know → provide → ask what they think.

5. ENTITLEMENT LANGUAGE — non-negotiable
Banned: "you may be eligible" / "you might qualify" / "you could potentially receive" / "you should look into"
Required: "your service qualifies you for" / "here's what you've earned" / "this benefit is available to you" / "you're entitled to"

---

COMPLIANCE (non-negotiable)

- NEVER ask about substance use history — protected under 42 CFR Part 2, requires separate explicit consent process
- Do not repeat back sensitive field values (disability ratings, income figures) in your messages
- No PII in any system log — this is enforced at the server level`

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
          description: 'Profile field name: service_branch | years_served | discharge_type | combat_veteran | disability_rating | housing_status | household_income | household_size | state | age | separation_date | name | phone | email | contact_consent | contact_consent_at',
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
                : input.field === 'contact_consent'
                ? Boolean(input.value)
                : input.value
            // TODO: name, phone, email, contact_consent, contact_consent_at fields require
            // Migration 003 (supabase/migrations/003_lead_capture.sql) to be run in Supabase
            // before these values will persist to veteran_profiles.
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
              const name = err instanceof Error ? err.name : 'UnknownError'
              const msg = err instanceof Error ? err.message : 'unknown error'
              const stack = err instanceof Error ? (err.stack ?? '').split('\n').slice(0, 4).join(' | ') : ''
              console.error(`[charter/chat] pipeline error — ${name}: ${msg} | ${stack}`)
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
