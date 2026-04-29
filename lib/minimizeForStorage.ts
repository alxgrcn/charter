// Data minimization gate: raw user message text must never reach the DB.
// Only structured, schema-defined profile fields are permitted through this gate.
export const STORABLE_FIELDS = new Set([
  'service_branch', 'years_served', 'discharge_type', 'combat_veteran',
  'disability_rating', 'housing_status', 'household_income', 'household_size',
  'state', 'age', 'separation_date',
])

export function minimizeForStorage(updates: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(updates).filter(([k]) => STORABLE_FIELDS.has(k)))
}
