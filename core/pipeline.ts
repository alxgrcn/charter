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
  console.log('[pipeline] analyzeBenefits start — fetching RAG context for 8 benefits in parallel')
  const [outpatientChunks, residentialChunks, vetCenterChunks, ptsdChunks, sudChunks, mstChunks, caregiverChunks, peerSupportChunks] =
    await Promise.all([
      retrieveChunks('VA mental health outpatient services veterans', { benefit_categories: ['va_mh_outpatient'] }),
      retrieveChunks('VA residential mental health programs RRTP inpatient', { benefit_categories: ['va_mh_residential'] }),
      retrieveChunks('Vet Center counseling no enrollment required combat', { benefit_categories: ['vet_center'] }),
      retrieveChunks('VA PTSD specialty care treatment programs evidence-based', { benefit_categories: ['va_ptsd'] }),
      retrieveChunks('VA substance use disorder treatment veterans SUD', { benefit_categories: ['va_sud'] }),
      retrieveChunks('military sexual trauma counseling MST care no documentation', { benefit_categories: ['mst_counseling'] }),
      retrieveChunks('VA caregiver support program family PCAFC', { benefit_categories: ['caregiver_support'] }),
      retrieveChunks('peer support veteran community programs California US Vets', { benefit_categories: ['peer_support'] }),
    ])
  console.log('[pipeline] RAG complete — sending single LLM call')

  const determinations = await determineAllBenefits(state.profile, [
    { benefitId: 'va_mh_outpatient',  benefitName: 'VA Mental Health Outpatient Services',          chunks: outpatientChunks },
    { benefitId: 'va_mh_residential', benefitName: 'VA Residential Mental Health Programs',          chunks: residentialChunks },
    { benefitId: 'vet_center',        benefitName: 'Vet Center Counseling',                          chunks: vetCenterChunks },
    { benefitId: 'va_ptsd',           benefitName: 'VA PTSD Specialty Care',                         chunks: ptsdChunks },
    { benefitId: 'va_sud',            benefitName: 'VA Substance Use Disorder Treatment',             chunks: sudChunks },
    { benefitId: 'mst_counseling',    benefitName: 'Military Sexual Trauma Counseling',               chunks: mstChunks },
    { benefitId: 'caregiver_support', benefitName: 'VA Caregiver Support Program',                   chunks: caregiverChunks },
    { benefitId: 'peer_support',      benefitName: 'Peer Support and Community Programs',            chunks: peerSupportChunks },
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

  if (qualifyingIds.has('va_ptsd') && qualifyingIds.has('va_mh_outpatient')) {
    notes.push(
      'VA PTSD Specialty Care + Outpatient Mental Health: PTSD Clinical Teams are embedded within VA outpatient mental health. A single VA intake appointment can connect a veteran to both general mental health services and PTSD-specific therapy.'
    )
  }

  if (qualifyingIds.has('va_sud') && qualifyingIds.has('va_ptsd')) {
    notes.push(
      'SUD Treatment + PTSD Care: Co-occurring PTSD and substance use disorder is common in veterans. VA offers integrated dual-diagnosis treatment that addresses both simultaneously — a veteran should not have to choose one over the other.'
    )
  }

  if (qualifyingIds.has('mst_counseling') && qualifyingIds.has('vet_center')) {
    notes.push(
      'MST Counseling + Vet Center: MST-related care is available at both VA Medical Centers and Vet Centers. Vet Centers require no enrollment and may feel more accessible as a first step. An MST Coordinator at any VAMC can provide a warm referral.'
    )
  }

  if (qualifyingIds.has('va_mh_residential') && qualifyingIds.has('va_mh_outpatient')) {
    notes.push(
      'Residential + Outpatient Care: Residential programs (RRTP) typically transition veterans into outpatient mental health care after discharge. Establishing an outpatient mental health relationship before entering residential care can smooth this transition.'
    )
  }

  if (qualifyingIds.has('caregiver_support') && qualifyingIds.has('va_mh_outpatient')) {
    notes.push(
      'Caregiver Support + Mental Health Care: VA Caregiver Support includes mental health counseling for the caregiver. When a veteran begins outpatient mental health care, their caregiver can simultaneously enroll in the Caregiver Support Program.'
    )
  }

  // Build priority action list — guide, don't decide language throughout
  const outpatientBenefit = benefits.find((b) => b.benefit_id === 'va_mh_outpatient')
  if (outpatientBenefit?.qualifies === 'yes' || outpatientBenefit?.qualifies === 'possibly') {
    actions.push('Contact nearest VA Medical Center or CBOC to ask about same-day mental health services — walk-in available at most facilities')
  }

  const ptsdBenefit = benefits.find((b) => b.benefit_id === 'va_ptsd')
  if (ptsdBenefit?.qualifies === 'yes' || ptsdBenefit?.qualifies === 'possibly') {
    actions.push('Ask for a referral to the PTSD Clinical Team at the nearest VAMC — no formal diagnosis required to begin')
  }

  const vetCenterBenefit = benefits.find((b) => b.benefit_id === 'vet_center')
  if (vetCenterBenefit?.qualifies === 'yes' || vetCenterBenefit?.qualifies === 'possibly') {
    actions.push('Walk in to a Vet Center without an appointment — or call 1-877-WAR-VETS (1-877-927-8387), available 24/7')
  }

  const sudBenefit = benefits.find((b) => b.benefit_id === 'va_sud')
  if (sudBenefit?.qualifies === 'yes' || sudBenefit?.qualifies === 'possibly') {
    actions.push('Contact nearest VAMC and ask for the SUD clinic — same-day mental health intake can include substance use concerns')
  }

  const mstBenefit = benefits.find((b) => b.benefit_id === 'mst_counseling')
  if (mstBenefit?.qualifies === 'yes' || mstBenefit?.qualifies === 'possibly') {
    actions.push('Ask to speak with the MST Coordinator at the nearest VA Medical Center — or contact a Vet Center directly, no appointment needed')
  }

  const residentialBenefit = benefits.find((b) => b.benefit_id === 'va_mh_residential')
  if (residentialBenefit?.qualifies === 'yes' || residentialBenefit?.qualifies === 'possibly') {
    actions.push('Ask a VA mental health provider about residential treatment options — a referral can be requested at any VAMC intake')
  }

  const caregiverBenefit = benefits.find((b) => b.benefit_id === 'caregiver_support')
  if (caregiverBenefit?.qualifies === 'yes' || caregiverBenefit?.qualifies === 'possibly') {
    actions.push('Call the VA Caregiver Support Line: 1-855-260-3274 — or contact the Caregiver Support Coordinator at the nearest VAMC')
  }

  const peerBenefit = benefits.find((b) => b.benefit_id === 'peer_support')
  if (peerBenefit?.qualifies === 'yes' || peerBenefit?.qualifies === 'possibly') {
    actions.push('Reach out to US Vets at usvets.org or call 1-877-WAR-VETS to connect with peer support regardless of VA enrollment status')
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
  const PRIORITY_ORDER = ['va_mh_outpatient', 'va_ptsd', 'vet_center', 'mst_counseling', 'va_sud', 'va_mh_residential', 'caregiver_support', 'peer_support', 'discharge_upgrade']

  // Re-sort existing actions by matching benefit_id keywords, then deduplicate
  const idKeywords: Record<string, string> = {
    va_mh_outpatient:  'same-day mental health',
    va_ptsd:           'ptsd clinical team',
    vet_center:        'vet center',
    mst_counseling:    'mst coordinator',
    va_sud:            'sud clinic',
    va_mh_residential: 'residential treatment',
    caregiver_support: 'caregiver support line',
    peer_support:      'us vets',
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
