import { Annotation, StateGraph, START, END } from '@langchain/langgraph'
import type { VeteranProfile, BenefitDetermination, ReportJSON } from '../types/charter'
import { retrieveChunks } from '../lib/rag'
import { determineAllBenefits } from '../lib/llm'

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const PipelineState = Annotation.Root({
  profile:               Annotation<VeteranProfile>,
  enriched_factors:      Annotation<Record<string, unknown>>,
  benefits:              Annotation<BenefitDetermination[]>({
                           reducer: (left, right) =>
                             Array.isArray(right) ? [...left, ...right] : [...left, right],
                           default: () => [],
                         }),
  synergy_notes:         Annotation<string[]>({
                           reducer: (_left, right) =>
                             Array.isArray(right) ? right : _left,
                           default: () => [],
                         }),
  discharge_upgrade_flag: Annotation<boolean>,
  priority_actions:      Annotation<string[]>({
                           reducer: (_left, right) =>
                             Array.isArray(right) ? right : _left,
                           default: () => [],
                         }),
  report:                Annotation<ReportJSON | null>,
})

type State = typeof PipelineState.State

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const HONORABLE_DISCHARGES = ['honorable', 'general under honorable', 'medical']
const DISQUALIFYING_DISCHARGES = ['dishonorable', 'bad_conduct_felony']
const DISCHARGE_UPGRADE_DISCHARGES = ['oth', 'general', 'bad_conduct']

function isHonorableOrEquivalent(discharge: string | null): boolean {
  return HONORABLE_DISCHARGES.includes((discharge ?? '').toLowerCase())
}

function isDisqualifying(discharge: string | null): boolean {
  return DISQUALIFYING_DISCHARGES.includes((discharge ?? '').toLowerCase())
}

// ---------------------------------------------------------------------------
// Node: enrichProfile
// ---------------------------------------------------------------------------

function enrichProfile(state: State): Partial<State> {
  const { profile } = state
  const discharge = (profile.discharge_type ?? '').toLowerCase()

  return {
    enriched_factors: {
      likely_at_risk_housing:
        profile.housing_status === 'homeless' ||
        profile.housing_status === 'at_risk' ||
        (profile.household_income !== null && profile.household_income < 20000),
      eligible_for_post911:
        (profile.years_served ?? 0) >= 3 && isHonorableOrEquivalent(discharge),
      has_disability:
        (profile.disability_rating ?? 0) > 0,
      needs_discharge_review:
        DISCHARGE_UPGRADE_DISCHARGES.includes(discharge),
      low_income:
        profile.household_income !== null &&
        profile.household_size !== null &&
        profile.household_income < 15000 * profile.household_size,
      post_911_era:
        profile.separation_date !== null &&
        new Date(profile.separation_date) > new Date('2001-09-11'),
    },
  }
}

// ---------------------------------------------------------------------------
// Node: analyzeBenefits — parallel RAG fetch, single LLM call
// ---------------------------------------------------------------------------

async function analyzeBenefits(state: State): Promise<Partial<State>> {
  console.log('[pipeline] analyzeBenefits start — fetching RAG context for 6 benefits in parallel')
  const [housingChunks, healthcareChunks, educationChunks, disabilityChunks, employmentChunks, financialChunks] =
    await Promise.all([
      retrieveChunks('HUD-VASH housing voucher eligibility homeless at-risk transitional housing veteran discharge', { benefit_categories: ['housing'], state: state.profile.state }),
      retrieveChunks('VA healthcare enrollment eligibility priority group discharge', { benefit_categories: ['healthcare'] }),
      retrieveChunks('Post-9/11 GI Bill chapter 33 education eligibility years service discharge', { benefit_categories: ['education'] }),
      retrieveChunks('VA disability compensation service connected rating eligibility', { benefit_categories: [] }),
      retrieveChunks('vocational rehabilitation chapter 31 employment disability rating', { benefit_categories: [] }),
      retrieveChunks('VA pension income wartime service financial benefit eligibility', { benefit_categories: ['financial'] }),
    ])
  console.log('[pipeline] RAG complete — sending single LLM call')

  const determinations = await determineAllBenefits(state.profile, [
    { benefitId: 'hud_vash',          benefitName: 'HUD-VASH Housing Voucher',                       chunks: housingChunks },
    { benefitId: 'va_healthcare',     benefitName: 'VA Healthcare Enrollment',                        chunks: healthcareChunks },
    { benefitId: 'post_911_gi_bill',  benefitName: 'Post-9/11 GI Bill (Chapter 33)',                  chunks: educationChunks },
    { benefitId: 'va_disability_comp',benefitName: 'VA Disability Compensation',                      chunks: disabilityChunks },
    { benefitId: 'voc_rehab',         benefitName: 'Vocational Rehabilitation & Employment (Chapter 31)', chunks: employmentChunks },
    { benefitId: 'va_pension',        benefitName: 'VA Pension (Non-Service-Connected)',               chunks: financialChunks },
  ])

  console.log('[pipeline] analyzeBenefits complete — determinations:', determinations.length)
  return { benefits: determinations }
}

// ---------------------------------------------------------------------------
// Node: mapSynergies
// ---------------------------------------------------------------------------

function mapSynergies(state: State): Partial<State> {
  const { benefits } = state
  const notes: string[] = []
  const actions: string[] = []

  const qualifyingIds = new Set(
    benefits.filter((b) => b.qualifies === 'yes' || b.qualifies === 'possibly').map((b) => b.benefit_id)
  )

  if (qualifyingIds.has('hud_vash') && qualifyingIds.has('va_healthcare')) {
    notes.push(
      'HUD-VASH + VA Healthcare: VA case managers who administer HUD-VASH vouchers can also coordinate VA healthcare enrollment. Request both in a single VA intake appointment.'
    )
  }

  if (qualifyingIds.has('va_disability_comp') && qualifyingIds.has('voc_rehab')) {
    notes.push(
      'Disability Compensation + VR&E: Veterans receiving disability compensation may also use Vocational Rehabilitation simultaneously. VR&E subsistence allowance is separate from disability pay.'
    )
  }

  if (qualifyingIds.has('va_disability_comp') && qualifyingIds.has('va_healthcare')) {
    notes.push(
      'Disability Compensation + VA Healthcare: Veterans with a service-connected disability rating receive Priority Group 1–3 healthcare with reduced or no copays. Apply for both simultaneously.'
    )
  }

  if (qualifyingIds.has('post_911_gi_bill') && qualifyingIds.has('voc_rehab')) {
    notes.push(
      'GI Bill + VR&E: Veterans who qualify for both should consult a VSO. In most cases, VR&E (Chapter 31) provides a higher monthly housing allowance than Post-9/11 GI Bill for veterans with disabilities.'
    )
  }

  // Build priority action list by urgency tier
  const housingBenefit = benefits.find((b) => b.benefit_id === 'hud_vash')
  if (housingBenefit?.qualifies === 'yes' || housingBenefit?.qualifies === 'possibly') {
    actions.push('URGENT: Apply for HUD-VASH — housing instability is the highest-priority need')
  }

  const healthBenefit = benefits.find((b) => b.benefit_id === 'va_healthcare')
  if (healthBenefit?.qualifies === 'yes') {
    actions.push('Apply for VA Healthcare enrollment (form 10-10EZ) — fast, typically 1–2 weeks')
  }

  const disabilityBenefit = benefits.find((b) => b.benefit_id === 'va_disability_comp')
  if (disabilityBenefit?.qualifies === 'yes' || disabilityBenefit?.qualifies === 'possibly') {
    actions.push('File or update VA disability claim — retroactive pay dates from claim filing date')
  }

  const financialBenefit = benefits.find((b) => b.benefit_id === 'va_pension')
  if (financialBenefit?.qualifies === 'yes') {
    actions.push('Apply for VA Pension — income support while other benefits process')
  }

  const educationBenefit = benefits.find((b) => b.benefit_id === 'post_911_gi_bill')
  if (educationBenefit?.qualifies === 'yes') {
    actions.push('Submit GI Bill application (form 22-1990) before next enrollment period')
  }

  const vocBenefit = benefits.find((b) => b.benefit_id === 'voc_rehab')
  if (vocBenefit?.qualifies === 'yes') {
    actions.push('Contact VR&E counselor to open a Chapter 31 case')
  }

  return { synergy_notes: notes, priority_actions: actions }
}

// ---------------------------------------------------------------------------
// Node: checkDischargeUpgrade (conditional)
// ---------------------------------------------------------------------------

function checkDischargeUpgrade(state: State): Partial<State> {
  const { profile } = state

  return {
    discharge_upgrade_flag: true,
    benefits: [
      {
        benefit_id: 'discharge_upgrade',
        benefit_name: 'Discharge Upgrade Review',
        qualifies: 'possibly',
        reason: `Veteran's discharge characterization (${profile.discharge_type}) may be eligible for upgrade via the Discharge Review Board or Board for Correction of Military Records. An upgrade could unlock additional VA benefits.`,
        citation: null,
        confidence: 0.9,
        steps: [
          'Request military records via eVetRecs at archives.gov/veterans/military-service-records',
          'File DD Form 293 (Discharge Review Board) within 15 years of discharge',
          'Or file DD Form 149 (Board for Correction of Military Records) — no time limit',
          'Consider working with a Veterans Service Organization for free legal assistance',
          'Gather supporting evidence: mental health records, deployment records, character statements',
        ],
        documents_needed: [
          'DD-214',
          'Military service records',
          'Medical or mental health records if applicable',
          'Character reference statements',
        ],
        phone_numbers: ['1-800-827-1000', 'Discharge Review Board: (703) 693-5087'],
        estimated_timeline: '6–18 months for Discharge Review Board decision',
        common_denials: [
          'Application filed after 15-year DRB deadline (use BCMR instead)',
          'Insufficient new evidence or arguments presented',
        ],
        complexity: 'complex',
        needs_counselor_review: true,
      },
    ],
  }
}

// ---------------------------------------------------------------------------
// Node: prioritizeBenefits
// ---------------------------------------------------------------------------

function prioritizeBenefits(state: State): Partial<State> {
  const PRIORITY_ORDER = ['hud_vash', 'va_healthcare', 'va_pension', 'va_disability_comp', 'voc_rehab', 'post_911_gi_bill', 'discharge_upgrade']

  // Re-sort existing actions by matching benefit_id keywords, then deduplicate
  const idKeywords: Record<string, string> = {
    hud_vash: 'hud-vash',
    va_healthcare: '10-10ez',
    va_pension: 'pension',
    va_disability_comp: 'disability claim',
    voc_rehab: 'vr&e',
    post_911_gi_bill: 'gi bill',
    discharge_upgrade: 'discharge',
  }

  const reordered = PRIORITY_ORDER
    .map((id) => {
      const b = state.benefits.find((x) => x.benefit_id === id)
      if (!b || (b.qualifies !== 'yes' && b.qualifies !== 'possibly')) return null
      const kw = idKeywords[id] ?? ''
      return state.priority_actions.find((a) => a.toLowerCase().includes(kw)) ?? null
    })
    .filter((a): a is string => a !== null)

  // Deduplicate while preserving order
  const seen = new Set<string>()
  const deduped = [...reordered, ...state.priority_actions].filter((a) => {
    if (seen.has(a)) return false
    seen.add(a)
    return true
  })

  return { priority_actions: deduped }
}

// ---------------------------------------------------------------------------
// Node: generateReport
// ---------------------------------------------------------------------------

function generateReport(state: State): Partial<State> {
  const report: ReportJSON = {
    generated_at: new Date().toISOString(),
    veteran_profile_id: state.profile.id,
    crisis_line: 'Veterans Crisis Line: Call or text 988, press 1. Chat: veteranscrisisline.net',
    disclaimer:
      'This analysis is based on published eligibility criteria and is for informational purposes only. Eligibility is determined by VA adjudicators and program administrators — not this report. Regulations change. Contact a Veterans Service Officer to apply.',
    benefits: state.benefits,
    synergy_notes: state.synergy_notes,
    discharge_upgrade_flag: state.discharge_upgrade_flag ?? false,
    priority_actions: state.priority_actions,
  }

  return { report }
}

// ---------------------------------------------------------------------------
// Conditional routing
// ---------------------------------------------------------------------------

function routeDischargeCheck(state: State): string {
  const dt = (state.profile.discharge_type ?? '').toLowerCase()
  return DISCHARGE_UPGRADE_DISCHARGES.includes(dt) ? 'check' : 'skip'
}

// ---------------------------------------------------------------------------
// Graph assembly
// ---------------------------------------------------------------------------

const graph = new StateGraph(PipelineState)
  .addNode('enrichProfile', enrichProfile)
  .addNode('analyzeBenefits', analyzeBenefits)
  .addNode('mapSynergies', mapSynergies)
  .addNode('checkDischargeUpgrade', checkDischargeUpgrade)
  .addNode('prioritizeBenefits', prioritizeBenefits)
  .addNode('generateReport', generateReport)
  .addEdge(START, 'enrichProfile')
  .addEdge('enrichProfile', 'analyzeBenefits')
  .addEdge('analyzeBenefits', 'mapSynergies')
  .addConditionalEdges('mapSynergies', routeDischargeCheck, {
    check: 'checkDischargeUpgrade',
    skip: 'prioritizeBenefits',
  })
  .addEdge('checkDischargeUpgrade', 'prioritizeBenefits')
  .addEdge('prioritizeBenefits', 'generateReport')
  .addEdge('generateReport', END)
  .compile()

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function runPipeline(profile: VeteranProfile): Promise<ReportJSON> {
  console.log('[pipeline] start — profile id:', profile.id)
  const result = await graph.invoke({ profile })
  if (!result.report) {
    console.error('[pipeline] completed without report — state:', JSON.stringify({ benefitCount: result.benefits?.length }))
    throw new Error('Pipeline completed without generating a report')
  }
  console.log('[pipeline] complete — benefits:', result.report.benefits.length)
  return result.report
}
