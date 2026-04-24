import Anthropic from '@anthropic-ai/sdk'
import type { VeteranProfile, BenefitDetermination } from '../types/charter'
import type { RagChunk } from './rag'
import { redact } from './redact'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const DETERMINATION_SCHEMA = `{
  "benefit_id": "<string>",
  "benefit_name": "<string>",
  "qualifies": "yes" | "no" | "possibly" | "unknown",
  "reason": "<string — cite the specific regulation excerpt>",
  "citation": { "source": "<string>", "section": "<string>" } | null,
  "confidence": <number 0.0–1.0>,
  "steps": ["<string>"],
  "documents_needed": ["<string>"],
  "phone_numbers": ["<string>"],
  "estimated_timeline": "<string>",
  "common_denials": ["<string>"],
  "complexity": "easy" | "moderate" | "complex",
  "needs_counselor_review": <boolean>
}`

const SYSTEM_PROMPT = `You are a VA benefits eligibility analyst. You reason ONLY from the regulation excerpts provided.
Never claim a veteran qualifies for a benefit unless a provided excerpt supports it.
Always cite the exact source document and section.
If the excerpts are insufficient, say so honestly — do not guess.

Respond with a single JSON object matching this exact schema (no markdown fences, no explanation outside the JSON):
${DETERMINATION_SCHEMA}`

const MULTI_SYSTEM_PROMPT = `You are a VA benefits eligibility analyst. You reason ONLY from the regulation excerpts provided for each benefit.
Never claim a veteran qualifies for a benefit unless a provided excerpt supports it.
Always cite the exact source document and section.
If the excerpts are insufficient, say so honestly — do not guess.

Respond with a single JSON array (no markdown fences, no explanation outside the JSON).
Each element corresponds to one benefit in the order listed. Each element must match this exact schema:
${DETERMINATION_SCHEMA}`

function unknownDetermination(
  benefitId: string,
  benefitName: string,
  reason = 'Insufficient regulation data to make a determination.'
): BenefitDetermination {
  return {
    benefit_id: benefitId,
    benefit_name: benefitName,
    qualifies: 'unknown',
    reason,
    citation: null,
    confidence: 0,
    steps: [],
    documents_needed: [],
    phone_numbers: ['1-800-827-1000'],
    estimated_timeline: 'Unknown — consult a Veterans Service Officer',
    common_denials: [],
    complexity: 'complex',
    needs_counselor_review: true,
  }
}

function buildProfileSummary(profile: VeteranProfile): string {
  return [
    `Service branch: ${profile.service_branch ?? 'unknown'}`,
    `Years served: ${profile.years_served ?? 'unknown'}`,
    `Discharge type: ${profile.discharge_type ?? 'unknown'}`,
    `Combat veteran: ${profile.combat_veteran ? 'yes' : 'no'}`,
    `Disability rating: ${profile.disability_rating !== null ? `${profile.disability_rating}%` : 'none on file'}`,
    `Housing status: ${profile.housing_status ?? 'unknown'}`,
    `Household income: ${profile.household_income !== null ? `$${profile.household_income.toLocaleString()}` : 'unknown'}`,
    `Household size: ${profile.household_size ?? 'unknown'}`,
    `State: ${profile.state ?? 'unknown'}`,
    `Age: ${profile.age ?? 'unknown'}`,
    `Separation year: ${profile.separation_date ? new Date(profile.separation_date).getFullYear() : 'unknown'}`,
  ].join('\n')
}

export type BenefitContext = {
  benefitId: string
  benefitName: string
  chunks: RagChunk[]
}

export async function determineAllBenefits(
  profile: VeteranProfile,
  contexts: BenefitContext[]
): Promise<BenefitDetermination[]> {
  const profileSummary = buildProfileSummary(profile)

  // Pre-fill unknowns for any benefit with no RAG chunks
  const resultsMap = new Map<string, BenefitDetermination>()
  const toAnalyze = contexts.filter((ctx) => {
    if (ctx.chunks.length === 0) {
      resultsMap.set(ctx.benefitId, unknownDetermination(ctx.benefitId, ctx.benefitName))
      return false
    }
    return true
  })

  if (toAnalyze.length === 0) {
    return contexts.map((ctx) => resultsMap.get(ctx.benefitId)!)
  }

  const benefitSections = toAnalyze
    .map((ctx, i) => {
      const excerpts = ctx.chunks
        .map((c, j) => `[${j + 1}] Source: ${c.source}${c.section ? `, Section: ${c.section}` : ''}\n${c.content}`)
        .join('\n\n---\n\n')
      return `## Benefit ${i + 1}: ${ctx.benefitName} (${ctx.benefitId})\n\n${excerpts}`
    })
    .join('\n\n========\n\n')

  const userPrompt = `Veteran Profile:\n${profileSummary}\n\nAnalyze eligibility for the following ${toAnalyze.length} benefits. Each section contains regulation excerpts for that specific benefit. Return a JSON array with exactly ${toAnalyze.length} elements, one per benefit, in order.\n\n${benefitSections}`

  try {
    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      system: [{ type: 'text', text: MULTI_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: userPrompt }],
    })

    const textBlock = message.content.find((b) => b.type === 'text')
    if (!textBlock || textBlock.type !== 'text') {
      return contexts.map((ctx) => unknownDetermination(ctx.benefitId, ctx.benefitName, 'No text response from LLM.'))
    }

    const raw = textBlock.text.trim().replace(/^```json\s*/i, '').replace(/\s*```$/, '')
    const parsed = JSON.parse(raw) as BenefitDetermination[]

    // Enforce confidence threshold per STANDARDS.md §2.2
    for (const det of parsed) {
      if (det.confidence < 0.75) det.needs_counselor_review = true
      resultsMap.set(det.benefit_id, det)
    }

    return contexts.map(
      (ctx) => resultsMap.get(ctx.benefitId) ?? unknownDetermination(ctx.benefitId, ctx.benefitName, 'Missing from LLM response.')
    )
  } catch (err) {
    console.error('[llm] determineAllBenefits error:', redact(err instanceof Error ? { message: err.message } : err))
    return contexts.map((ctx) => unknownDetermination(ctx.benefitId, ctx.benefitName, 'LLM call failed — manual review required.'))
  }
}

export async function determineBenefit(
  profile: VeteranProfile,
  chunks: RagChunk[],
  benefitId: string,
  benefitName: string
): Promise<BenefitDetermination> {
  if (chunks.length === 0) {
    return unknownDetermination(benefitId, benefitName)
  }

  const excerpts = chunks
    .map((c, i) =>
      `[${i + 1}] Source: ${c.source}${c.section ? `, Section: ${c.section}` : ''}\n${c.content}`
    )
    .join('\n\n---\n\n')

  const userPrompt = `Veteran Profile:
${buildProfileSummary(profile)}

Benefit to analyze: ${benefitName} (ID: ${benefitId})

Regulation excerpts:
${excerpts}

Determine eligibility for ${benefitName} based solely on the excerpts above.`

  try {
    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: [
        {
          type: 'text',
          text: SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [{ role: 'user', content: userPrompt }],
    })

    const textBlock = message.content.find((b) => b.type === 'text')
    if (!textBlock || textBlock.type !== 'text') {
      return unknownDetermination(benefitId, benefitName, 'No text response from LLM.')
    }

    // Strip markdown fences if present
    const raw = textBlock.text.trim().replace(/^```json\s*/i, '').replace(/\s*```$/, '')
    const parsed = JSON.parse(raw) as BenefitDetermination

    // Enforce confidence threshold per STANDARDS.md §2.2
    if (parsed.confidence < 0.75) {
      parsed.needs_counselor_review = true
    }

    return parsed
  } catch (err) {
    console.error('[llm] determineBenefit error:', redact(err instanceof Error ? { message: err.message } : err))
    return unknownDetermination(benefitId, benefitName, 'LLM call failed — manual review required.')
  }
}
