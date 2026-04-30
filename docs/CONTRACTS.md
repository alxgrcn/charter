# Charter — Integration Contracts
**Last updated:** 2026-04-30
**Scope:** All systems that call Charter or receive data from Charter.
**Rule:** No change to any contract defined here may be made without updating this
document in the same commit. A contract change without a doc update is a breaking
change, even if the code compiles.

---

## Contract 1: POST /api/analyze

The primary integration point. IVA, SMS, and OTW all use this endpoint to get veteran
benefit analysis without going through the chat UI.

### Authentication

All requests must include:

    Authorization: Bearer <INTERNAL_WEBHOOK_SECRET>

Missing or wrong secret → 401. No exceptions. The secret is shared across Charter,
IVA, and SMS via environment variables. Rotating it requires updating all three
services simultaneously.

### Input Schema

Validated by Zod before any processing. A schema violation returns 400 with a
`details` object showing which fields failed.

| Field | Type | Required | Meaning |
|---|---|---|---|
| `branch` | string | **required** | Military branch (e.g. "Army", "Marines") |
| `dischargeStatus` | string | **required** | Discharge characterization (e.g. "honorable", "oth") |
| `mentalHealthConcerns` | string | optional (default `""`) | Free-text description of presenting concerns |
| `currentSupport` | string | optional (default `"none"`) | Current care or support situation |
| `serviceDates` | object | optional | Service date range and/or duration |
| `serviceDates.start` | string | optional | Service start date (ISO or partial) |
| `serviceDates.end` | string | optional | Service end date; used to derive `separation_date` |
| `serviceDates.years` | number | optional | Years served; used directly if provided, else computed from start/end |
| `location` | string | optional (default `""`) | State or city for geographic routing |
| `source` | enum | **required** | Channel: `"web"` \| `"iva"` \| `"sms"` \| `"simulation"` \| `"internal"` |
| `session_id` | string | optional | External session identifier for audit log correlation |
| `additionalContext` | `Record<string, unknown>` | optional | Freeform extra context; scanned for crisis keywords |

**`source` rule:** Use `"simulation"` for local testing. Never use `"iva"` or `"sms"`
in a test environment — those values trigger production audit logging.

### Output Schema

Two distinct shapes depending on `crisis_flag`.

#### Non-crisis response (`crisis_flag: false`)

| Field | Type | Meaning |
|---|---|---|
| `crisis_flag` | `false` | Always false in this shape |
| `fast_response` | object | Fast-layer classification (< 100ms, deterministic) |
| `fast_response.support_category` | string | Coarse concern classification (e.g. `"ptsd_trauma"`, `"general_mental_health"`) |
| `fast_response.urgency_level` | `"low"` \| `"medium"` \| `"high"` | Triage signal — does not map to crisis |
| `fast_response.top_programs` | string[] | 1–2 program names suggested by the fast layer |
| `fast_response.response_text` | string | Pre-written guide-don't-decide response text |
| `benefits` | object[] | One entry per evaluated mental health program |
| `benefits[].benefitId` | string | Program identifier (e.g. `"va_ptsd"`, `"vet_center"`) |
| `benefits[].benefitName` | string | Human-readable program name |
| `benefits[].confidence` | number | LLM confidence score, 0.0–1.0 |
| `benefits[].summary` | string | Reason for the determination, citing the regulation |
| `benefits[].priority_actions` | string[] | Program-specific next steps |
| `benefits[].citations` | string[] | Regulation citations (e.g. `"38 CFR §17.38"`) |
| `benefits[].needs_counselor_review` | boolean | True if confidence < 0.75 or flagged uncertain |
| `synergies` | string[] | Notes on how qualifying programs interact |
| `overall_priority_actions` | string[] | Cross-program ordered next steps |
| `discharge_upgrade_applicable` | boolean | True if veteran has OTH/general/bad_conduct discharge |
| `disclaimers` | string[] | **Never empty.** Display the first entry before any benefit content |
| `generated_at` | string | ISO timestamp of report generation |
| `source` | string | Echoes the `source` field from the request |

#### Crisis response (`crisis_flag: true`)

| Field | Type | Meaning |
|---|---|---|
| `crisis_flag` | `true` | Always true in this shape |
| `fast_response` | `null` | No classification — pipeline did not run |
| `benefits` | `[]` | Always empty |
| `synergies` | `[]` | Always empty |
| `overall_priority_actions` | `[]` | Always empty |
| `discharge_upgrade_applicable` | `false` | Always false |
| `disclaimers` | string[] | Contains the 988 crisis line string |
| `generated_at` | string | ISO timestamp |
| `source` | string | Echoes the `source` field from the request |
| `crisis_resources` | string | Full 988 crisis resources string — **only present in crisis responses** |

**Hard rules for consumers:**

- `crisis_flag: true` means the consumer **MUST** surface 988 resources immediately
  and prominently. No exceptions. Do not display any benefit content.
- `disclaimers[]` is never empty. Every consumer must display at least the first
  disclaimer before showing any benefit content.

### Timeout

`maxDuration: 90s` (set in `vercel.json`). Consumers should set their own timeout to
85s to allow graceful handling before Vercel cuts the connection.

### Error Codes

| Code | Meaning | Consumer action |
|---|---|---|
| `400` | Invalid input — `details` field shows which fields failed Zod validation | Fix the request; do not retry |
| `401` | Missing or wrong `INTERNAL_WEBHOOK_SECRET` | Check secret configuration; do not retry |
| `429` | Rate limit exceeded — 10 requests per 60s per IP | Wait 60s before retrying |
| `500` | Pipeline failure | Safe to retry once after 5s |

---

## Contract 2: Crisis Escalation (Charter → OTW)

When `crisis_flag` is true, Charter fires a best-effort POST to OTW. OTW must be able
to receive this at any time without Charter blocking on a response.

### Charter's Obligations

- POST within the same request lifecycle as the crisis detection
- Authenticate with header: `x-internal-secret: <INTERNAL_WEBHOOK_SECRET>`
- Send exactly this payload (no PHI at any field):

      {
        "session_id":    "<string>",
        "crisis_flag":   true,
        "urgency_level": "crisis",
        "source":        "charter_web",
        "channel":       "web",
        "timestamp":     "<ISO string>"
      }

- Fire-and-forget — Charter does not retry and does not block on OTW's response

### OTW's Obligations

- Accept the POST at the endpoint registered in Charter's `OTW_INTAKE_URL` env var
- Return 200 within 5s (Charter's timeout on this call)
- If OTW is down: Charter logs the failure and continues. The veteran's crisis response
  is never delayed waiting for OTW.

### What This Is NOT

This is not a guaranteed delivery system. If OTW is unreachable, the crisis event is
still written to Charter's `crisis_events` table and the veteran still receives 988
resources. OTW should poll `crisis_events` periodically as a fallback recovery
mechanism.

---

## Contract 3: Booking Lead (Charter → OTW)

When a veteran clicks "Book with a Counselor," the frontend calls Charter's
`POST /api/book-counselor`, which proxies the lead to OTW and returns a booking URL.

### Charter → OTW (the outbound leg)

Charter POSTs to `${OTW_API_URL}/api/booking-leads`:

- Authenticate with: `Authorization: Bearer <INTERNAL_WEBHOOK_SECRET>`
- Send payload:

      {
        "profile":     <full VeteranProfile object>,
        "report":      <full ReportJSON object>,
        "session_id":  "<string>",
        "source":      "charter"
      }

- Two audit log entries are written on success: `report_shared_with_org` and
  `appointment_handoff`
- If OTW is unreachable: Charter returns 502 to the frontend. No Cal.com fallback
  exists in this route — the frontend surfaces an error state.

### OTW's Obligations

- Accept at `POST /api/booking-leads`
- Return 200 or 201 with a `booking_url` field in the JSON response body
- If no `booking_url` is returned: Charter returns 502 to the frontend

### Frontend → Charter (the inbound leg)

`POST /api/book-counselor` accepts:

| Field | Type | Required | Meaning |
|---|---|---|---|
| `profile` | object | **required** | Veteran profile from client state |
| `report` | object | **required** | Report including `benefits[]` array |
| `session_id` | string | **required** | Session identifier for audit log |

Returns `{ booking_url: string }` on success, or `{ error: string }` on failure.

---

## Contract 4: Shared Secrets Convention

All inter-service calls in the platform use one shared secret:

    INTERNAL_WEBHOOK_SECRET

Rules:
- Generated with: `openssl rand -base64 32`
- Must be identical across Charter, IVA, and SMS Vercel deployments
- Rotation requires simultaneous update across all three services
- Never logged, never committed to git, never returned in any response body

**Note on header naming:** Charter uses two different header formats depending on the
call direction:
- **Inbound to Charter** (`/api/analyze`): `Authorization: Bearer <secret>`
- **Charter → OTW crisis notification**: `x-internal-secret: <secret>`
- **Charter → OTW booking lead**: `Authorization: Bearer <secret>`

These are inconsistent. Both work. Do not normalize them without updating this document
and the corresponding route handlers.

---

## Contract 5: The Crisis Flag Inheritance Rule

Any system that calls `/api/analyze` MUST implement this behavior when
`crisis_flag: true` is returned:

1. Surface 988 (Veterans Crisis Line) immediately and prominently
2. Do not display any benefit analysis content
3. Do not redirect the veteran away from the crisis resources
4. Log the event locally (IVA: to its own audit log; SMS: to message thread log)

This rule is non-negotiable. It exists at the contract level — not the implementation
level — so that a future IVA or SMS developer cannot miss it by only reading their own
codebase.
