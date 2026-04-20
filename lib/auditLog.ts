import { createServiceClient } from './supabase'
import { redact } from './redact'

export type AuditEntry = {
  org_id?: string
  actor_role: string
  action: string
  resource_type?: string
  resource_id?: string
  meta?: Record<string, unknown>
}

/**
 * Fire-and-forget audit log writer. Never throws — audit failure must not
 * block the main response. Errors are logged with PII redacted.
 */
export async function auditLog(entry: AuditEntry): Promise<void> {
  try {
    // SERVICE CLIENT: writing to append-only audit log — trusted server op
    const supabase = createServiceClient()
    const { error } = await supabase.from('audit_log').insert(entry)
    if (error) throw error
  } catch (err) {
    console.error('auditLog failed:', redact(err))
  }
}
