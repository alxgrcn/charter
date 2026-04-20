import { Annotation, StateGraph, START, END } from '@langchain/langgraph'
import type { VeteranProfile, BenefitDetermination, ReportJSON } from '../types/charter'

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
// Node: analyzeHousing
// ---------------------------------------------------------------------------

function analyzeHousing(state: State): Partial<State> {
  const { profile } = state
  const atRisk =
    profile.housing_status === 'homeless' || profile.housing_status === 'at_risk'
  const eligible = !isDisqualifying(profile.discharge_type)

  const qualifies: BenefitDetermination['qualifies'] =
    atRisk && eligible ? 'yes' : !atRisk ? 'no' : 'possibly'

  return {
    benefits: [
      {
        benefit_id: 'hud_vash',
        benefit_name: 'HUD-VASH Housing Voucher',
        qualifies,
        reason:
          qualifies === 'yes'
            ? 'Veteran meets HUD-VASH criteria: at-risk or homeless housing status with eligible discharge characterization.'
            : qualifies === 'no'
            ? 'Veteran is currently housed and does not meet the homeless or at-risk housing threshold for HUD-VASH.'
            : 'Veteran may qualify pending discharge characterization review.',
        citation: null,
        confidence: 0.9,
        steps: [
          'Contact your local VA Medical Center and request a HUD-VASH referral',
          'Complete the VA homeless eligibility screening with a case manager',
          'Work with assigned VA case manager to apply for voucher through local Public Housing Authority',
          'Attend housing counseling sessions as required by the PHA',
        ],
        documents_needed: ['DD-214', 'Photo ID', 'Social Security Card', 'Proof of income'],
        phone_numbers: ['1-877-4AID-VET (1-877-424-3838)'],
        estimated_timeline: '30–90 days from referral to voucher issuance',
        common_denials: [
          'Ineligible discharge characterization',
          'Household income exceeds program limits',
          'Does not meet HUD definition of homeless or at-risk',
        ],
        complexity: 'moderate',
        needs_counselor_review: false,
      },
    ],
  }
}

// ---------------------------------------------------------------------------
// Node: analyzeHealthcare
// ---------------------------------------------------------------------------

function analyzeHealthcare(state: State): Partial<State> {
  const { profile } = state
  const eligible = !isDisqualifying(profile.discharge_type)
  const hasDisability = (profile.disability_rating ?? 0) > 0
  const combatVet = profile.combat_veteran

  const qualifies: BenefitDetermination['qualifies'] = eligible
    ? 'yes'
    : isHonorableOrEquivalent(profile.discharge_type)
    ? 'yes'
    : 'possibly'

  const priorityGroup =
    (profile.disability_rating ?? 0) >= 50
      ? 'Priority Group 1 (service-connected disability ≥ 50%)'
      : hasDisability
      ? 'Priority Group 2–3 (service-connected disability < 50%)'
      : combatVet
      ? 'Priority Group 6 (combat veteran, free care for 10 years post-separation)'
      : 'Priority Group 7–8 (income-based copays may apply)'

  return {
    benefits: [
      {
        benefit_id: 'va_healthcare',
        benefit_name: 'VA Healthcare Enrollment',
        qualifies,
        reason: `Veteran appears eligible for VA healthcare. Estimated enrollment: ${priorityGroup}.`,
        citation: null,
        confidence: 0.9,
        steps: [
          'Apply online at va.gov/health-care/apply or call 1-877-222-VETS',
          'Complete VA Form 10-10EZ (Application for Health Benefits)',
          'Provide DD-214 and most recent tax return for income-based priority group determination',
          'Schedule initial enrollment appointment at your local VAMC',
        ],
        documents_needed: ['DD-214', 'Photo ID', 'Social Security Number', 'Most recent tax return (for income determination)'],
        phone_numbers: ['1-877-222-VETS (1-877-222-8387)'],
        estimated_timeline: '1–2 weeks for enrollment decision after application',
        common_denials: [
          'Discharge characterization does not meet minimum eligibility',
          'Character of discharge review required',
        ],
        complexity: 'easy',
        needs_counselor_review: false,
      },
    ],
  }
}

// ---------------------------------------------------------------------------
// Node: analyzeEducation
// ---------------------------------------------------------------------------

function analyzeEducation(state: State): Partial<State> {
  const { profile } = state
  const years = profile.years_served ?? 0
  const honorable = isHonorableOrEquivalent(profile.discharge_type)
  const postSep =
    profile.separation_date !== null &&
    new Date(profile.separation_date) > new Date('2001-09-11')

  const qualifies: BenefitDetermination['qualifies'] =
    honorable && years >= 3 && postSep
      ? 'yes'
      : honorable && years >= 1 && postSep
      ? 'possibly'
      : 'no'

  const benefitPct =
    years >= 36 ? '100%' : years >= 30 ? '90%' : years >= 24 ? '80%' : years >= 18 ? '70%' : years >= 12 ? '60%' : '40%'

  return {
    benefits: [
      {
        benefit_id: 'post_911_gi_bill',
        benefit_name: 'Post-9/11 GI Bill (Chapter 33)',
        qualifies,
        reason:
          qualifies === 'yes'
            ? `Veteran meets Post-9/11 GI Bill eligibility. Estimated benefit: ${benefitPct} based on ${years} years of qualifying service.`
            : qualifies === 'possibly'
            ? `Veteran has ${years} year(s) of post-9/11 service. May qualify for partial benefit at a lower tier.`
            : 'Veteran does not appear to meet minimum service or discharge requirements for Post-9/11 GI Bill.',
        citation: null,
        confidence: 0.9,
        steps: [
          'Apply at va.gov/education/apply-for-education-benefits',
          'Complete VA Form 22-1990',
          'Submit DD-214 and enrollment certification from school',
          'School must be SCO-certified and submit VA enrollment certification',
        ],
        documents_needed: ['DD-214', 'Acceptance letter from school', 'Social Security Number'],
        phone_numbers: ['1-888-GI-BILL-1 (1-888-442-4551)'],
        estimated_timeline: '4–6 weeks for Certificate of Eligibility; payments begin after enrollment',
        common_denials: [
          'Insufficient qualifying active-duty service',
          'Discharge characterization below General Under Honorable Conditions',
          'Benefit previously transferred to dependents',
        ],
        complexity: 'moderate',
        needs_counselor_review: false,
      },
    ],
  }
}

// ---------------------------------------------------------------------------
// Node: analyzeDisability
// ---------------------------------------------------------------------------

function analyzeDisability(state: State): Partial<State> {
  const { profile } = state
  const rating = profile.disability_rating ?? 0
  const eligible = !isDisqualifying(profile.discharge_type)

  const qualifies: BenefitDetermination['qualifies'] =
    rating > 0 && eligible ? 'yes' : eligible ? 'possibly' : 'no'

  return {
    benefits: [
      {
        benefit_id: 'va_disability_comp',
        benefit_name: 'VA Disability Compensation',
        qualifies,
        reason:
          qualifies === 'yes'
            ? `Veteran has an existing ${rating}% disability rating. Monthly compensation applies.`
            : qualifies === 'possibly'
            ? 'Veteran may have unrated service-connected conditions. A disability claim should be evaluated.'
            : 'Veteran does not appear eligible due to discharge characterization.',
        citation: null,
        confidence: 0.9,
        steps: [
          'File a disability claim at va.gov/disability/file-disability-claim-form-21-526ez',
          'Gather service records and medical evidence for each claimed condition',
          'Attend Compensation & Pension (C&P) exam when scheduled by VA',
          'Consider working with a VSO for free claims assistance',
        ],
        documents_needed: [
          'DD-214',
          'Service treatment records',
          'Private medical records for claimed conditions',
          'Buddy statements if available',
        ],
        phone_numbers: ['1-800-827-1000'],
        estimated_timeline: '3–6 months for initial rating decision; appeals may take longer',
        common_denials: [
          'Condition not service-connected',
          'Insufficient medical nexus between service and current condition',
          'Condition considered a normal result of aging',
        ],
        complexity: 'complex',
        needs_counselor_review: false,
      },
    ],
  }
}

// ---------------------------------------------------------------------------
// Node: analyzeEmployment
// ---------------------------------------------------------------------------

function analyzeEmployment(state: State): Partial<State> {
  const { profile } = state
  const rating = profile.disability_rating ?? 0
  const eligible = rating >= 10 && !isDisqualifying(profile.discharge_type)

  const qualifies: BenefitDetermination['qualifies'] =
    rating >= 20 ? 'yes' : rating >= 10 ? 'possibly' : 'no'

  return {
    benefits: [
      {
        benefit_id: 'voc_rehab',
        benefit_name: 'Vocational Rehabilitation & Employment (Chapter 31)',
        qualifies,
        reason:
          qualifies === 'yes'
            ? `Veteran has a ${rating}% disability rating. Chapter 31 VR&E provides job training, resume assistance, and employment support.`
            : qualifies === 'possibly'
            ? `Veteran has a ${rating}% disability rating. May qualify for VR&E with an employment handicap determination.`
            : 'Veteran does not currently meet the minimum 10% disability rating threshold for VR&E.',
        citation: null,
        confidence: 0.9,
        steps: [
          'Apply at va.gov/careers-employment/vocational-rehabilitation',
          'Complete VA Form 28-1900',
          'Meet with a VR&E counselor for an initial evaluation',
          'Develop a rehabilitation plan with your VR&E counselor',
        ],
        documents_needed: ['DD-214', 'VA disability rating decision letter', 'Photo ID'],
        phone_numbers: ['1-800-827-1000'],
        estimated_timeline: '30–60 days for initial counseling appointment; program duration 4 years maximum',
        common_denials: [
          'Disability rating below 10%',
          'No employment handicap found',
          'Benefit entitlement period expired (12 years from separation or rating)',
        ],
        complexity: 'moderate',
        needs_counselor_review: !eligible,
      },
    ],
  }
}

// ---------------------------------------------------------------------------
// Node: analyzeFinancial
// ---------------------------------------------------------------------------

function analyzeFinancial(state: State): Partial<State> {
  const { profile } = state
  const income = profile.household_income ?? Infinity
  const size = profile.household_size ?? 1
  const incomePerPerson = income / size
  const wartime = profile.combat_veteran || (
    profile.separation_date !== null &&
    new Date(profile.separation_date) > new Date('1990-08-02')
  )

  // Rough VA Pension income threshold (~MAPR for a single veteran with no dependents)
  const MAPR_SINGLE = 16551
  const threshold = MAPR_SINGLE + (size - 1) * 2200
  const underThreshold = income < threshold

  const qualifies: BenefitDetermination['qualifies'] =
    wartime && underThreshold ? 'yes' : wartime ? 'possibly' : 'no'

  return {
    benefits: [
      {
        benefit_id: 'va_pension',
        benefit_name: 'VA Pension (Non-Service-Connected)',
        qualifies,
        reason:
          qualifies === 'yes'
            ? `Veteran appears to meet wartime service and income requirements for VA Pension. Estimated household income $${income.toLocaleString()} is below the MAPR threshold.`
            : qualifies === 'possibly'
            ? 'Veteran meets wartime service requirement but income may be above current MAPR. Medical deductions may bring income below threshold.'
            : 'Veteran does not appear to meet wartime service requirements for VA Pension.',
        citation: null,
        confidence: 0.9,
        steps: [
          'Apply at va.gov/pension/apply-for-veteran-pension-form-21p-527ez',
          'Complete VA Form 21P-527EZ',
          'Gather proof of income, medical expenses, and wartime service documentation',
          'Consider Aid & Attendance supplement if needing assistance with daily activities',
        ],
        documents_needed: [
          'DD-214',
          'Social Security award letter',
          'Income tax returns',
          'Medical expense receipts',
          'Bank statements',
        ],
        phone_numbers: ['1-800-827-1000'],
        estimated_timeline: '3–6 months for pension award decision',
        common_denials: [
          'Income exceeds Maximum Annual Pension Rate (MAPR)',
          'Insufficient wartime service',
          'Net worth exceeds VA limits',
        ],
        complexity: 'complex',
        needs_counselor_review: false,
      },
    ],
  }
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
  .addNode('analyzeHousing', analyzeHousing)
  .addNode('analyzeHealthcare', analyzeHealthcare)
  .addNode('analyzeEducation', analyzeEducation)
  .addNode('analyzeDisability', analyzeDisability)
  .addNode('analyzeEmployment', analyzeEmployment)
  .addNode('analyzeFinancial', analyzeFinancial)
  .addNode('mapSynergies', mapSynergies)
  .addNode('checkDischargeUpgrade', checkDischargeUpgrade)
  .addNode('prioritizeBenefits', prioritizeBenefits)
  .addNode('generateReport', generateReport)
  // enrichProfile -> 6 parallel analysis nodes
  .addEdge(START, 'enrichProfile')
  .addEdge('enrichProfile', 'analyzeHousing')
  .addEdge('enrichProfile', 'analyzeHealthcare')
  .addEdge('enrichProfile', 'analyzeEducation')
  .addEdge('enrichProfile', 'analyzeDisability')
  .addEdge('enrichProfile', 'analyzeEmployment')
  .addEdge('enrichProfile', 'analyzeFinancial')
  // all 6 converge to mapSynergies
  .addEdge('analyzeHousing', 'mapSynergies')
  .addEdge('analyzeHealthcare', 'mapSynergies')
  .addEdge('analyzeEducation', 'mapSynergies')
  .addEdge('analyzeDisability', 'mapSynergies')
  .addEdge('analyzeEmployment', 'mapSynergies')
  .addEdge('analyzeFinancial', 'mapSynergies')
  // conditional discharge upgrade check
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
  const result = await graph.invoke({ profile })
  if (!result.report) throw new Error('Pipeline completed without generating a report')
  return result.report
}
