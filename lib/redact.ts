const SENSITIVE_KEYS = new Set([
  'name',
  'ssn',
  'date_of_birth',
  'disability_rating',
  'mental_health_history',
  'substance_use_history',
  'income',
  'phone',
  'email',
  'address',
  'separation_date',
  'housing_status',
])

/**
 * Deep-clones obj and replaces values for any sensitive keys with "[REDACTED]".
 * Safe to pass to console.error or audit log meta — no PII will leak.
 */
export function redact(obj: unknown): unknown {
  if (obj === null || typeof obj !== 'object') return obj
  if (Array.isArray(obj)) return obj.map(redact)
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    result[key] = SENSITIVE_KEYS.has(key) ? '[REDACTED]' : redact(value)
  }
  return result
}
