export type VeteranProfile = {
  id: string
  org_id: string
  session_id: string | null
  service_branch: string | null
  years_served: number | null
  discharge_type: string | null
  combat_veteran: boolean
  disability_rating: number | null
  housing_status: string | null
  household_income: number | null
  household_size: number | null
  state: string | null
  age: number | null
  separation_date: string | null
  created_at: string
  expires_at: string
}

export type BenefitReport = {
  id: string
  veteran_profile_id: string | null
  org_id: string
  status: 'pending' | 'processing' | 'complete' | 'failed'
  report_json: ReportJSON | null
  pdf_url: string | null
  created_at: string
  completed_at: string | null
}

export type BenefitDetermination = {
  benefit_id: string
  benefit_name: string
  qualifies: 'yes' | 'no' | 'possibly' | 'unknown'
  reason: string
  citation: { source: string; section: string } | null
  confidence: number
  steps: string[]
  documents_needed: string[]
  phone_numbers: string[]
  estimated_timeline: string
  common_denials: string[]
  complexity: 'easy' | 'moderate' | 'complex'
  needs_counselor_review: boolean
}

export type ReportJSON = {
  generated_at: string
  veteran_profile_id: string
  crisis_line: string
  disclaimer: string
  benefits: BenefitDetermination[]
  synergy_notes: string[]
  discharge_upgrade_flag: boolean
  priority_actions: string[]
}
