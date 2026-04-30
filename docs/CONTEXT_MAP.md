# Charter — Context Map
**Last updated:** 2026-04-30
**Scope:** Platform-level. Describes all bounded contexts and their relationships.
**Rule:** Any feature that would put benefits analysis logic outside Charter, or put
appointment/counselor logic inside Charter, violates this map. Stop and ask before
proceeding.

---

## The Core Question

Before writing any code, ask: "Does this belong in the brain, the interface, or the
dashboard?"

- **Brain (Charter):** Any logic that determines what a veteran may qualify for,
  detects crisis, or reasons against regulation
- **Interface (IVA / SMS):** Any logic that collects veteran input and delivers
  Charter's output through a channel
- **Dashboard (OTW):** Any logic that supports counselors — appointments, case
  management, outcomes

---

## Bounded Context: Charter (The Brain)

**Purpose:** The single source of intelligence for veteran mental health benefit
eligibility. Charter reasons. Interfaces deliver.

**Owns:**
- `regulation_chunks` table (the knowledge base)
- `veteran_profiles` table
- `benefit_reports` table
- `crisis_events` table
- `audit_log` table
- All analysis logic: fast layer, LangGraph pipeline, RAG retrieval
- Crisis detection and escalation
- Report generation and email delivery

**Does NOT own:**
- Appointment scheduling or Cal.com integration
- Counselor-facing UI or dashboard
- Voice call management
- SMS routing or Twilio
- Veteran authentication (deferred — currently session-based)

**Entry Points:**
- `POST /api/chat` — web conversation interface
- `POST /api/analyze` — programmatic API for IVA, SMS, and OTW

**Invariants (rules that must never be violated):**
1. `crisis_flag` is always evaluated before any pipeline runs
2. OTH discharge never disqualifies a veteran from mental health care
3. No PHI is ever written to `audit_log` or `crisis_events`
4. The disclaimer "This report is educational..." appears in every report
5. 988 crisis resources appear before any benefit content
6. All data writes go through `minimizeForStorage()` before hitting DB

---

## Bounded Context: IVA (The Voice Interface)

**Purpose:** Collects veteran intake via phone call and delivers Charter's analysis
as speech.

**Owns:** Voice session state, Twilio/LiveKit integration, ElevenLabs TTS,
speech-to-text, Haven persona

**Does NOT own:** Any benefits logic. Zero. Calls `/api/analyze` and reads the
response.

**Depends on Charter via:** `POST /api/analyze` with
`Authorization: Bearer $INTERNAL_WEBHOOK_SECRET`

---

## Bounded Context: SMS (The Text Interface)

**Purpose:** Collects veteran intake via SMS keyword trigger and delivers Charter's
analysis as text.

**Owns:** Twilio SMS session state, message threading, keyword routing

**Does NOT own:** Any benefits logic. Calls `/api/analyze` and reads the response.

**Depends on Charter via:** `POST /api/analyze` (same contract as IVA)

---

## Bounded Context: OTW (The Dashboard)

**Purpose:** Counselor-facing platform. Receives Charter leads, manages appointments,
tracks outcomes.

**Owns:** `booking_leads` table, Cal.com integration, counselor profiles, appointment
history, outcome data

**Does NOT own:** Any benefits analysis. Reads Charter's output — does not regenerate
it.

**Depends on Charter via:**
- Receives crisis events via `POST` to `OTW_INTAKE_URL` (push, not poll)
- Receives booking leads via `POST /api/booking-leads` from Charter's
  refer-to-otw endpoint
- Future: reads `/api/analyze` for inline benefit panel in counselor view

---

## Context Relationships (the contracts at each boundary)

    [Veteran Web Browser]
            ↓ POST /api/chat
    [Charter — The Brain]
            ↓ POST /api/analyze (JSON in, ReportJSON out)
       ┌────┴──────────┐
    [IVA]           [SMS]

    [Charter] → crisis_event → POST OTW_INTAKE_URL → [OTW]
    [Charter] → booking lead → POST /api/booking-leads → [OTW]

---

## What Breaks If Charter Goes Down

All three interfaces (IVA, SMS, OTW dashboard inline panel) lose their intelligence
layer. They can still collect intake but cannot produce any analysis. This is by
design — centralized intelligence means a single place to fix, improve, and audit.
