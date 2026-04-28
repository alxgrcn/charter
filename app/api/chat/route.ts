import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import { runPipeline } from '../../../core/pipeline'
import type { VeteranProfile, ReportJSON } from '../../../types/charter'
import { redact } from '../../../lib/redact'
import { auditLog } from '../../../lib/auditLog'
import { classifyIntake } from '../../../lib/fast-analysis'
import type { IntakeFields } from '../../../lib/fast-analysis'
import { handleCrisisEscalation } from '../../../lib/crisis'
import { createServiceClient } from '../../../lib/supabase'

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

const SYSTEM_PROMPT = `You are Charter, a mental health support navigator for veterans built by Inspired Action AI, in partnership with US Veterans Inc. (US Vets).

Your role is to have a warm, human conversation that helps veterans understand what mental health support may be available to them — and to help them get connected faster. You do not diagnose, treat, or make clinical determinations. You guide. You never decide.

LANGUAGE RULE — NON-NEGOTIABLE:
Every response must follow this standard without exception:
✅ "Based on what you've shared, VA mental health services may be worth exploring."
✅ "This may be worth discussing with a counselor."
✅ "It sounds like [program] could be a good fit to look into."
❌ NEVER: "You qualify for this program."
❌ NEVER: "You should apply for this."
❌ NEVER: Any language implying eligibility determination.

---

INTAKE ARC — follow this order, one topic at a time:

1. WARM OPEN
   Start here, always: "What's been weighing on you lately?"
   Do not start with a form question. Do not ask for name first.
   Let them tell you what brought them here.

2. MENTAL HEALTH CONTEXT
   Follow up on what they shared. Use open-ended questions.
   Reflect before moving on. Examples:
   - "It sounds like [reflection of what they said]. Can you tell me a bit more about what that's been like?"
   - "A lot of veterans deal with something similar — you're not alone in this."
   Topics to gently explore (not a checklist — weave naturally):
   PTSD, sleep, mood, substance use, relationships, isolation, MST, caregiver stress, crisis history.

3. SERVICE HISTORY
   Branch, discharge status. Frame gently:
   - "What branch did you serve in?"
   - "And what was your discharge status? There's no wrong answer — it helps us understand what doors are open."
   CRITICAL RULE: Veterans with OTH (Other Than Honorable) discharge are legally entitled to VA mental health care. Never suggest OTH closes off mental health access.

4. CURRENT SUPPORT STATUS
   - "Are you currently connected to any VA mental health services, or would this be more of a fresh start?"

5. LOCATION
   - "What city are you in?" (California routing)

6. LEAD CAPTURE
   Name, then preferred contact (phone or email).
   Frame as: "I want to make sure someone from US Vets can follow up with you directly — what's the best way to reach you?"

7. CLOSE
   Once all fields are collected, the fast layer fires automatically. Your job here is to affirm:
   - "Thank you for sharing all of this — it takes courage to reach out."
   - "Based on what you've shared, I'm pulling together some options that may be a good fit."

---

MOTIVATIONAL INTERVIEWING PRINCIPLES — apply throughout:

- Reflective listening: Mirror what they said before asking the next question. Never skip straight to the next field.
- Affirmation: Acknowledge their service and the act of reaching out. "That takes real courage."
- Open questions first: Always lead with open-ended questions. Closed yes/no questions only to confirm specifics.
- Elicit-Provide-Elicit: Ask what they already know, provide information, ask what resonates.
- Forward-focus: "Here's what may be available to you" — not "here's what you might qualify for."
- No judgment: On discharge status, substance use, help-seeking history, or anything else. Ever.

---

CRISIS DETECTION — PRE-LLM (handled in code, not here)

The system checks every message for crisis signals before your response is generated. If crisis_flag is set, the crisis response fires automatically and you do not need to handle it.

---

TOOL USE — required for data collection:

Call record_field immediately when a value is confirmed — never batch multiple fields.
Fields to capture: service_branch, discharge_type, housing_status, state, age, name, phone, email, contact_consent, contact_consent_at.
When contact info is collected, also call record_field for contact_consent = true and contact_consent_at = current ISO timestamp.
After capturing name and contact method, immediately call trigger_analysis().

Before asking about branch → call set_chip_context("branch").
Before asking about discharge → call set_chip_context("discharge").
Before asking about housing → call set_chip_context("housing").
Any other question → do not call set_chip_context.

---

COMPLIANCE (non-negotiable):

- 42 CFR Part 2: Do not directly ask about substance use history — requires separate explicit consent. If the veteran volunteers it, reflect and explore gently; never prompt.
- Do not repeat back disability ratings or income figures in your messages.
- No PII in any system log — enforced at the server level.
- Never diagnose. Never state clinical need. "May be worth exploring" and "may be worth discussing with a provider" are the correct phrasings always.`

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
    let triggerAnalysisFired = false

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
            const mergedProfile = { ...profile, ...profileUpdates } as VeteranProfile & Record<string, unknown>
            // Log field names only — never log values (STANDARDS §2.5, no PII in logs)
            const populatedFields = Object.entries(mergedProfile)
              .filter(([, v]) => v !== null && v !== undefined)
              .map(([k]) => k)
            console.log('[charter/chat] trigger_analysis — populated fields:', populatedFields.join(', '))
            void auditLog({ actor_role: 'system', action: 'pipeline_started', meta: { session_id: mergedProfile.session_id ?? undefined } })
            const sessionId = String(mergedProfile.session_id ?? 'unknown')

            // Fast layer — deterministic, no LLM/RAG, target < 100ms
            const intakeFields: IntakeFields = {
              discharge_status: String(mergedProfile.discharge_type ?? ''),
              mental_health_concerns: String(mergedProfile.health_concerns ?? mergedProfile.mental_health_concerns ?? ''),
              current_care: String(mergedProfile.healthcare_status ?? mergedProfile.current_care ?? ''),
              urgency_signal: String(mergedProfile.urgency_signal ?? ''),
              crisis_flag: Boolean(mergedProfile.crisis_flag),
            }
            const fastAnalysis = classifyIntake(intakeFields)
            console.log('[charter/chat] fast analysis — urgency_level:', fastAnalysis.urgency_level, '| crisis_flag:', fastAnalysis.crisis_flag)
            lastAssistantText = fastAnalysis.fast_response_text
            toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: 'Fast analysis delivered. Full analysis running in background.' })
            triggerAnalysisFired = true

            // Crisis escalation — synchronous before response is sent (Steps 2, 3, 4)
            if (fastAnalysis.crisis_flag) {
              try {
                await handleCrisisEscalation({
                  session_id: sessionId,
                  trigger_type: fastAnalysis.trigger_type ?? 'flag',
                })
              } catch (escalateErr) {
                // crisis_events write failed — log and continue; veteran must still receive 988 response
                console.error(`[charter/chat] crisis escalation FAILED — session_id=${sessionId}`)
              }
            }

            // Deep layer — fire and forget; errors must never surface to the veteran
            const capturedProfile = { ...(mergedProfile as VeteranProfile) }
            const capturedUpdates = { ...profileUpdates }
            runPipeline(capturedProfile)
              .then(async (completedReport) => {
                void auditLog({ actor_role: 'system', action: 'report_generated', meta: { session_id: capturedProfile.session_id ?? undefined, benefits_count: completedReport.benefits.length } })
                if (capturedProfile.id && Object.keys(capturedUpdates).length > 0) {
                  try {
                    // SERVICE CLIENT: updating veteran profile after deep pipeline completion — trusted server op
                    const supabase = createServiceClient()
                    const safeFields = new Set(['service_branch', 'years_served', 'discharge_type', 'combat_veteran', 'disability_rating', 'housing_status', 'household_income', 'household_size', 'state', 'age', 'separation_date'])
                    const safeUpdates = Object.fromEntries(Object.entries(capturedUpdates).filter(([k]) => safeFields.has(k)))
                    if (Object.keys(safeUpdates).length > 0) {
                      await supabase.from('veteran_profiles').update(safeUpdates).eq('id', capturedProfile.id)
                    }
                  } catch (dbErr) {
                    console.error(`[charter/chat] veteran_profiles update FAILED — session_id=${sessionId}`)
                  }
                }
              })
              .catch((err) => {
                console.error(`[charter/chat] runPipeline FAILED — session_id=${sessionId}`, redact(err instanceof Error ? { message: err.message } : err))
              })
          }
        }

        if (triggerAnalysisFired) break
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
