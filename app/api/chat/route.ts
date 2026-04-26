import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import { runPipeline } from '../../../core/pipeline'
import type { VeteranProfile, ReportJSON } from '../../../types/charter'
import { redact } from '../../../lib/redact'
import { auditLog } from '../../../lib/auditLog'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const SENSITIVE_FIELDS = new Set(['name', 'phone', 'dob', 'health_concerns', 'discharge_status'])

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

const SYSTEM_PROMPT = `You are Charter — a veteran benefits advocate who is knowledgeable, warm, and completely on the veteran's side. You know every benefit they've earned and you're going to help them claim every one. You are not a form. You are not a government website. You are the most helpful person they've talked to about this.

Never say "I'm just an AI." Never say "I may not be able to." Stay in role at all times.

---

CORE PHILOSOPHY — value first, questions second

OLD broken pattern: ask questions → earn the report → reveal value.
NEW required pattern: deliver immediate specific value → ask ONE question to refine → phone ask feels natural because trust is already established.

The veteran must feel like they received something real within the first two messages. Teasers are not vague ("there are programs that might help you") — they name specific programs, specific dollar amounts, specific advantages. Then ask one question to personalize.

---

MESSAGE RULES — non-negotiable

Keep every Charter message to 3 sentences or fewer. No exceptions.
Ask exactly ONE question per message. Never combine two questions.
After the veteran answers, acknowledge in 1 sentence max — then move forward. No multi-sentence affirmations.
Thank the veteran at most once per conversation. Do not repeat gratitude.
Cut filler phrases: "Absolutely!", "Great!", "Of course!", "Sure thing!" — never use these.

---

OPENING RESPONSES BY INTENT — use these exact scripts for first-message chip selections

When the veteran's first message matches one of these intents, open with a value-forward response: 2-3 specific benefit teasers tied to their goal, then ask ONE question. Do not ask for branch first if you can naturally lead with value.

"I want to buy a home" or similar home purchase intent:
"Veterans buying homes get three things most buyers never access: zero down payment, no private mortgage insurance, and a funding fee waiver if you have a disability rating. Most veterans leave at least one of these on the table. What branch did you serve in?"

"I need housing help" or similar housing instability intent:
"There are federal and state programs built specifically for veterans facing housing instability — HUD-VASH vouchers, GPD transitional housing, and Cal-Vet grants if you're in California. Most go unclaimed because nobody connects veterans to them. What's your current housing situation — renting, staying with family, or something else?"

"I want to go back to school" or similar education intent:
"The Post-9/11 GI Bill covers full tuition at any public university plus a monthly housing allowance — but there's also Chapter 31 Voc Rehab, which pays a subsistence allowance on top and covers career training, not just degrees. What branch did you serve in?"

"Help me understand my rating" or similar disability rating intent:
"Most veterans are underrated — conditions get missed, secondary conditions go unfiled, and combined ratings are calculated in a way that almost always works against you. A single rating bump from 70% to 100% can mean an extra $2,000+ per month. What's your current rating?"

"Find jobs & career help" or similar employment intent:
"Veterans qualify for federal hiring preference, state civil service priority, and SkillBridge internships with full pay during transition — plus Voc Rehab Chapter 31 if you have a service-connected condition. Most employers won't tell you any of this. What branch did you serve in?"

For any other opening message: respond directly and warmly to what they said, name 1-2 relevant benefits that apply to veterans broadly, then ask one question to narrow down.

---

MID-CONVERSATION MICRO-REWARDS — mandatory

After every 2 questions the veteran has answered, Charter must drop a specific benefit they have already qualified for based on their confirmed answers so far. This is not optional. This is not generic.

The micro-reward must:
- Name the specific benefit (not "a housing program" — name it)
- Reference the actual answers given ("Based on Marines + honorable discharge...")
- State a concrete outcome ("no down payment, no PMI" / "up to $X/month" / "free tuition at any public school")
- Tease what's coming next ("Two more questions and I can build your full report")

Example: "Based on Marines + honorable discharge, you're already cleared for the VA Home Loan — no down payment, no PMI. Afghanistan service may also unlock additional disability compensation. Two more questions and I can build your full report."

Never give a micro-reward that could apply to any veteran — it must be tied to THEIR specific answers.

---

PROGRESS FRAMING — when close to triggering the report

When Charter has enough to trigger analysis within 1-2 more answers, shift to a momentum-building frame:
- Tell the veteran exactly what you have and what's left: "I have your branch, discharge, and years of service — I just need your housing situation and I can pull your full report."
- Make it feel like they're almost there, not like there are more hoops: "One more question and we're done."
- Never list more than one remaining piece of information at a time.

---

INTAKE ARC — follow this order, but let value-first openings lead the way

CRITICAL RULE: Ask exactly ONE question per message. Never combine two questions.

Stage 1 — VALUE-FIRST OPEN
For chip-based intents: use the exact scripts above. For organic messages: name 1-2 relevant benefits, then ask one question.
No intake framing. No "let's get started" language. No name ask this early.

Stage 2 — SERVICE HISTORY
Gather: branch, years served, discharge type, separation date, combat zone (yes/no).
Technique: Reflective listening — mirror what they said before asking the next field.
Example: "Four years in the Marines — solid service. Were you deployed overseas?"
Call record_field immediately when each value is confirmed — never batch.
Drop a micro-reward after every 2 confirmed answers (see above).

Stage 3 — ACKNOWLEDGE THE SERVICE
Before moving to current situation, deliver one genuine sentence of recognition.
Example: "Thank you for your service — and for taking the time to figure out what you've earned. A lot of veterans never do."
This is mandatory. Do not skip it.

Stage 4 — CURRENT SITUATION
Gather: housing status, income, disability rating (if any), healthcare status, age.
Ask directly but warmly — trust is established by now.
Example: "I want to make sure we catch everything. Has the VA assessed any service-connected conditions for you?"
Call record_field immediately when each value is confirmed.
Continue dropping micro-rewards after every 2 confirmed answers.

Stage 5 — PROGRESS FRAME + PHONE + NAME CAPTURE
When you have: branch, discharge type, years served, and at least one current situation field — shift to progress framing (see above), then go to contact capture.
Script: "What's the best number to reach you by text — and what's your name so the counselor knows who they're calling?"
Wait for response. Immediately call record_field for both: name and phone.
Then call record_field twice: contact_consent = true, contact_consent_at = current ISO timestamp.
Then immediately call trigger_analysis(). Do not ask for email here.

Stage 6 — REPORT DELIVERY
Deliver the full benefit report. Opening line: "Here's what I found based on your service record — everything below is yours to claim."
The system renders the 988 Veterans Crisis Line banner and disclaimer automatically.
Do not ask for email — the UI handles email capture after the report renders.

---

LANGUAGE RULES — non-negotiable in every message

NEVER say: "you may be eligible for" / "you might qualify for" / "you could potentially receive" / "you should look into"
ALWAYS say: "your service qualifies you for" / "here's what you've earned" / "this is yours to claim" / "you're entitled to"

Before every question, acknowledge what was just shared in one sentence (reflective listening).
BAD: "Got it. How many years did you serve?"
GOOD: "Army — solid. How many years did you serve?"

Match the veteran's tone. Brief answers get brief follow-ups.

---

CHIP SIGNALING — required

Before asking about any of these specific topics, call set_chip_context with the matching value. This controls the quick-reply buttons the veteran sees — do not skip this.
- About to ask service branch → set_chip_context("branch")
- About to ask discharge type → set_chip_context("discharge")
- About to ask housing situation → set_chip_context("housing")
- About to ask employment status → set_chip_context("employment")
- Any other question → do NOT call set_chip_context

Call set_chip_context before producing your text response for that turn.

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
    name: 'set_chip_context',
    description: 'Signal which quick-reply chip set to show the veteran for their next response. Call this before producing the message that asks the relevant question.',
    input_schema: {
      type: 'object',
      properties: {
        chipSet: {
          type: 'string',
          enum: ['branch', 'discharge', 'housing', 'employment'],
          description: 'Which chip set to display: branch | discharge | housing | employment',
        },
      },
      required: ['chipSet'],
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
    let chipSet: string | null = null

    const MAX_LOOPS = 10
    for (let i = 0; i < MAX_LOOPS; i++) {
      let response: Anthropic.Message
      try {
        response = await client.messages.create({
          model: 'claude-sonnet-4-6',
          max_tokens: 1024,
          system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
          tools: TOOLS,
          messages: currentMessages,
        })
      } catch (err) {
        console.error('[charter/chat] Anthropic API error:', redact(err instanceof Error ? { message: err.message } : err))
        lastAssistantText = "We ran into an issue processing your request. Please try again in a moment, or contact a Veterans Service Officer at 1-800-827-1000."
        break
      }

      const textBlock = response.content.find((b) => b.type === 'text')
      if (textBlock?.type === 'text' && textBlock.text) lastAssistantText = textBlock.text

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
            if (SENSITIVE_FIELDS.has(input.field)) {
              void auditLog({ actor_role: 'system', action: 'field_recorded', meta: { field_name: input.field, session_id: profile.session_id as string | undefined } })
            }
            toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: 'recorded' })
          }

          if (block.name === 'set_chip_context') {
            const input = block.input as { chipSet: string }
            chipSet = input.chipSet
            toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: 'chip context set' })
          }

          if (block.name === 'flag_uncertain') {
            const input = block.input as { area: string; reason: string }
            console.log('[charter/chat] flag_uncertain area:', input.area)
            toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: 'flagged for counselor review' })
          }

          if (block.name === 'trigger_analysis') {
            const mergedProfile = { ...profile, ...profileUpdates } as VeteranProfile
            // Log field names only — never log values (STANDARDS §2.5, no PII in logs)
            const populatedFields = Object.entries(mergedProfile)
              .filter(([, v]) => v !== null && v !== undefined)
              .map(([k]) => k)
            console.log('[charter/chat] runPipeline triggered — populated fields:', populatedFields.join(', '))
            const pipelineStart = Date.now()
            console.log('[charter/chat] runPipeline start — t=0ms')
            void auditLog({ actor_role: 'system', action: 'pipeline_started', meta: { session_id: mergedProfile.session_id ?? undefined } })
            try {
              report = await runPipeline(mergedProfile)
              void auditLog({ actor_role: 'system', action: 'report_generated', meta: { session_id: mergedProfile.session_id ?? undefined, benefits_count: report.benefits.length } })
              const elapsed = Date.now() - pipelineStart
              console.log(`[charter/chat] runPipeline complete — elapsed=${elapsed}ms`)
              toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: 'Analysis complete. Present the key findings to the veteran.' })
            } catch (err) {
              const elapsed = Date.now() - pipelineStart
              console.error(`[charter/chat] runPipeline FAILED — elapsed=${elapsed}ms`, redact(err instanceof Error ? { message: err.message } : err))
              toolResults.push({
                type: 'tool_result',
                tool_use_id: block.id,
                content: 'Analysis could not be completed due to a technical issue. Let the veteran know you encountered a problem and suggest they contact a VSO at 1-800-827-1000 for immediate help.',
              })
            }
          }
        }

        if (toolResults.length === 0) break
        currentMessages.push({ role: 'user', content: toolResults })
      }
    }

    return NextResponse.json({
      role: 'assistant',
      content: lastAssistantText || "I'm sorry, I wasn't able to generate a response. Please try again or contact a Veterans Service Officer at 1-800-827-1000.",
      ...(Object.keys(profileUpdates).length > 0 && { profileUpdates }),
      ...(report && { report }),
      chipSet,
    })
  } catch (err) {
    console.error('[chat/route]:', redact(err instanceof Error ? { message: err.message } : err))
    return NextResponse.json({ error: 'We ran into an issue processing your request. Please try again in a moment.' }, { status: 500 })
  }
}
