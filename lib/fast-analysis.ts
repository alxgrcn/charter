export type IntakeFields = {
  discharge_status: string
  mental_health_concerns: string
  current_care: string
  urgency_signal?: string
  crisis_flag?: boolean
}

export type FastAnalysisResult = {
  support_category: string
  urgency_level: 'low' | 'medium' | 'high' | 'crisis'
  top_programs: string[]
  fast_response_text: string
  crisis_flag: boolean
}

const CRISIS_KEYWORDS = [
  'hopeless',
  "can't go on",
  'end my life',
  "don't want to be here",
  'suicidal',
]

// Word-for-word crisis response — do not alter (STANDARDS §2.3, 988 required in every report)
const CRISIS_RESPONSE =
  "I'm really glad you reached out. If you need immediate support, you can call the Veterans Crisis Line at 988 (press 1). They're available 24/7. I can also help connect you to local support — would you like that?"

export function classifyIntake(fields: IntakeFields): FastAnalysisResult {
  // Crisis check runs first — before any other logic
  const signal = (fields.urgency_signal ?? '').toLowerCase()
  const isCrisis =
    fields.crisis_flag === true ||
    CRISIS_KEYWORDS.some((kw) => signal.includes(kw))

  if (isCrisis) {
    return {
      support_category: 'crisis',
      urgency_level: 'crisis',
      top_programs: ['Veterans Crisis Line'],
      fast_response_text: CRISIS_RESPONSE,
      crisis_flag: true,
    }
  }

  // Classify based on mental_health_concerns keywords
  const concerns = fields.mental_health_concerns.toLowerCase()

  let support_category: string
  let top_programs: string[]

  if (/ptsd|trauma|nightmare|hypervigilance/.test(concerns)) {
    support_category = 'ptsd_trauma'
    top_programs = ['VA PTSD Specialty Care', 'Vet Center Counseling']
  } else if (/substance|alcohol|drinking|drugs/.test(concerns)) {
    support_category = 'substance_use'
    top_programs = ['VA Substance Use Disorder Treatment']
  } else if (/mst|military sexual trauma|assault/.test(concerns)) {
    support_category = 'mst'
    top_programs = ['MST Counseling', 'Vet Center Counseling']
  } else if (/caregiver|family member|spouse/.test(concerns)) {
    support_category = 'caregiver'
    top_programs = ['VA Caregiver Support Program']
  } else if (/inpatient|residential|hospitalization/.test(concerns)) {
    support_category = 'residential'
    top_programs = ['VA Residential Mental Health Programs']
  } else if (/peer|community|connection/.test(concerns)) {
    support_category = 'peer_community'
    top_programs = ['Peer Support and Community Programs']
  } else {
    support_category = 'general_mental_health'
    top_programs = ['VA Mental Health Outpatient Services', 'Vet Center Counseling']
  }

  // urgency_level: multiple issues → high; no current care → medium; has care → low
  const concernTokens = concerns
    .split(/[,;]|\band\b|\bor\b/)
    .map((s) => s.trim())
    .filter(Boolean)
  const hasMultipleConcerns = concernTokens.length > 1
  const hasCare = fields.current_care.trim().length > 0

  const urgency_level: 'low' | 'medium' | 'high' = hasMultipleConcerns
    ? 'high'
    : !hasCare
    ? 'medium'
    : 'low'

  // guide-don't-decide language
  const programs = top_programs.slice(0, 2)
  const programText =
    programs.length >= 2 ? `${programs[0]} and ${programs[1]}` : programs[0]
  const fast_response_text = `Based on what you've shared, ${programText} may be worth exploring. Here's how we can help you get connected.`

  return {
    support_category,
    urgency_level,
    top_programs,
    fast_response_text,
    crisis_flag: false,
  }
}
