const WINDOW_MS = 60_000
const MAX_REQUESTS = 10
const requestLog = new Map<string, number[]>()

// Returns true if the request is allowed, false if rate limit exceeded.
// Never logs the IP address — caller is responsible for not leaking it.
export function checkRateLimit(ip: string): boolean {
  const now = Date.now()
  const cutoff = now - WINDOW_MS
  const prev = requestLog.get(ip) ?? []
  const recent = prev.filter((t) => t > cutoff)
  if (recent.length >= MAX_REQUESTS) return false
  recent.push(now)
  requestLog.set(ip, recent)
  return true
}
