# Charter — Ubiquitous Language Glossary
**Last updated:** 2026-04-30
**Scope:** Charter project only. IVA and OTW maintain separate glossaries.
**Rule:** When a term in this glossary conflicts with general engineering usage, this definition wins.

---

## Core Entities

**VeteranProfile**
The primary intake record for a veteran. Holds all structured fields collected during a
conversation (service history, discharge type, housing, income, contact info). Lives in
client state during a chat; written to `veteran_profiles` only after the deep pipeline
completes. Never fully populated at any single point — guard all nullable fields with
`!= null`, not `!== null`.
`Code location:` `types/charter.ts → VeteranProfile`

**BenefitDetermination**
The structured output for one mental health program evaluation. Contains `qualifies`
(yes/no/possibly/unknown), confidence score, regulation citation, next steps, and
`needs_counselor_review`. Produced by `determineAllBenefits()`. Lives inside `ReportJSON`
— it is not a database row.
`Code location:` `types/charter.ts → BenefitDetermination`

**ReportJSON**
The analysis content generated at the end of the pipeline. Contains the array of
`BenefitDetermination` objects, synergy notes, priority actions, crisis line string, and
disclaimer. This is the content of a report, NOT the database row tracking its status
(see `BenefitReport`). Returned directly by `runPipeline()`.
`Code location:` `types/charter.ts → ReportJSON`

**BenefitReport**
The Supabase row in `benefit_reports` that tracks the lifecycle of a report generation
job. Has a `status` field (pending → processing → complete → failed) and stores the
final `ReportJSON` in a `report_json` column once complete. NOT the analysis content
itself — that is `ReportJSON`. Never use "report" without qualification.
`Code location:` `types/charter.ts → BenefitReport`

**RagChunk**
A single retrieved passage from the regulation knowledge base. Contains text content,
source document name, section identifier, and a cosine similarity score from pgvector.
Multiple chunks are fetched for each benefit and passed to the LLM.
`Code location:` `lib/rag.ts → RagChunk`

**AuditEntry**
A single record written to the append-only `audit_log` table. Contains actor role,
action name, optional resource identifiers, and a free-form metadata map. Field values
are never stored — only field names and event types. Writes are fire-and-forget and must
never block a veteran response.
`Code location:` `lib/auditLog.ts → AuditEntry`

**CrisisEvent**
A database row in `crisis_events` created when a crisis signal is detected. Records the
`session_id`, channel, detection timestamp, `trigger_type`, and whether a counselor was
notified. One row per detected crisis. No PHI stored at any column.
`Code location:` `lib/crisis.ts` (insert inside `handleCrisisEscalation`)

---

## Analysis Layer

**Pipeline**
The LangGraph directed graph that transforms a `VeteranProfile` into a `ReportJSON`.
Runs six nodes in order: `enrichProfile → analyzeBenefits → mapSynergies →
[checkDischargeUpgrade?] → prioritizeBenefits → generateReport`. In the chat path,
runs fire-and-forget after the fast layer responds. In the analyze path, runs
synchronously and its result is returned in the API response.
`Code location:` `core/pipeline.ts → graph` / `runPipeline()`

**Fast Layer**
The deterministic keyword classifier that runs synchronously before any LLM or RAG
call, targeting < 100ms. Produces a `FastAnalysisResult` containing `support_category`,
`urgency_level`, and a pre-written response text. Runs in both the chat and analyze
paths. If it detects a crisis, the pipeline does not run at all.
`Code location:` `lib/fast-analysis.ts → classifyIntake()`

**Deep Layer**
The full LangGraph pipeline. In the chat path it is fire-and-forget — the fast layer's
response is already on the wire before the deep layer finishes, and its result is emailed
if the profile has an email address. In the analyze path it is awaited synchronously. The
word "deep" means "after the fast layer," not depth of analysis.
`Code location:` `core/pipeline.ts` (invoked from `app/api/chat/route.ts` and
`app/api/analyze/route.ts`)

**Enriched Factors**
A set of derived booleans computed by the `enrichProfile` node from the raw
`VeteranProfile`. Examples: `likely_at_risk_housing`, `eligible_for_post911`,
`needs_discharge_review`. Exists only in pipeline state — never persisted.
`Code location:` `core/pipeline.ts → enrichProfile()` / `PipelineState.enriched_factors`

**Benefit Category**
One of the 8 mental health program types the pipeline evaluates, identified by a
`benefit_id` string (e.g., `va_mh_outpatient`, `va_ptsd`, `mst_counseling`). Serves as
the filter key for RAG retrieval and as the primary identifier inside
`BenefitDetermination`. Do not confuse with the pre-April-2026 meaning (any VA benefit
— housing, education, GI Bill, etc.) — see Terms That Changed Meaning.
`Code location:` `core/pipeline.ts → analyzeBenefits()` / `lib/rag.ts → filters.benefit_categories`

**Support Category**
The fast layer's coarse classification of a veteran's primary concern. Maps to one of:
`ptsd_trauma`, `substance_use`, `mst`, `caregiver`, `residential`, `peer_community`,
`general_mental_health`, or `crisis`. Does not map 1:1 to a `benefit_id` — it is a
routing classification, not an eligibility grouping.
`Code location:` `lib/fast-analysis.ts → FastAnalysisResult.support_category`

**Urgency Level**
A four-value enum (`crisis` | `high` | `medium` | `low`) assigned by the fast layer.
`crisis` bypasses the pipeline entirely and triggers crisis escalation. `high` is set
when multiple concerns are present; `medium` when no current care exists; `low`
otherwise. Every API response carries this value for downstream triage.
`Code location:` `lib/fast-analysis.ts → FastAnalysisResult.urgency_level`

**Synergy Notes**
Human-readable strings explaining how two or more benefit categories can be accessed
together (e.g., "MST Counseling + Vet Center: Vet Centers require no enrollment and may
feel more accessible as a first step"). Generated by the `mapSynergies` node based on
which benefits qualified. Not a determination — purely informational guidance.
`Code location:` `core/pipeline.ts → mapSynergies()` / `ReportJSON.synergy_notes`

**Priority Actions**
An ordered list of concrete next steps for the veteran (e.g., "Walk in to a Vet Center
without an appointment"). Written using guide-don't-decide language — never "you
qualify," always "may be worth exploring." Generated by `mapSynergies`, re-sorted by
`prioritizeBenefits` according to clinical priority order.
`Code location:` `core/pipeline.ts → mapSynergies()` / `prioritizeBenefits()`

**IntakeFields**
A narrow, channel-agnostic struct used as input to the fast layer. Extracted from either
a `VeteranProfile` (chat path) or an `AnalyzeBody` (analyze path). Contains only what
the fast classifier needs: `discharge_status`, `mental_health_concerns`, `current_care`,
`urgency_signal`, `crisis_flag`. Distinct from `VeteranProfile` — it is a
projection, not the source of truth.
`Code location:` `lib/fast-analysis.ts → IntakeFields`

**Discharge Upgrade**
A special pseudo-benefit added to the pipeline output when the veteran has an OTH,
general, or bad_conduct discharge. Its content is hardcoded in `checkDischargeUpgrade`
— it is not retrieved from RAG. It signals that the veteran may be eligible to have
their discharge characterization changed via the Discharge Review Board (DD Form 293)
or the Board for Correction of Military Records (DD Form 149), which could unlock
additional VA benefits.
`Code location:` `core/pipeline.ts → checkDischargeUpgrade()`

---

## Compliance & Safety

**OTH**
Other Than Honorable discharge characterization. Veterans with OTH are legally entitled
to VA mental health care — this rule is non-negotiable and must never be violated in
any response or determination. OTH also triggers the `checkDischargeUpgrade` conditional
node because an upgrade could unlock benefits beyond mental health care.
`Code location:` `core/pipeline.ts → DISCHARGE_UPGRADE_DISCHARGES` / system prompt in
`app/api/chat/route.ts`

**Crisis Flag**
A boolean (`crisis_flag: true`) that, when set by the fast layer, halts the normal
pipeline and triggers crisis escalation. Set in one of two ways: keyword match in
`urgency_signal` (`trigger_type: 'keyword'`) or a pre-check upstream (`trigger_type:
'flag'`). Once set, the veteran receives the 988 response and no benefit analysis runs.
`Code location:` `lib/fast-analysis.ts → FastAnalysisResult.crisis_flag`

**Crisis Escalation**
The 4-step response sequence executed when `crisis_flag` is true. Step 1: the 988
response text is returned to the veteran (fires before this function is called). Step 2:
write to `crisis_events` — synchronous, throws on failure. Step 3: POST to OTW
counselor webhook — best-effort, never throws. Step 4: write `audit_log` entry. No PHI
at any step.
`Code location:` `lib/crisis.ts → handleCrisisEscalation()`

**Needs Counselor Review**
A flag (`needs_counselor_review: boolean`) on every `BenefitDetermination`. Automatically
set to `true` when confidence < 0.75. Also set when the LLM calls `flag_uncertain`. A
determination with this flag must never be shown to the veteran as confirmed eligibility.
It is for counselor review only.
`Code location:` `types/charter.ts → BenefitDetermination.needs_counselor_review` /
`lib/llm.ts → determineAllBenefits()`

**Contact Consent**
The veteran's explicit permission to be contacted by US Vets counselors. Two profile
fields: `contact_consent: boolean` (the permission) and `contact_consent_at: string`
(ISO timestamp of when it was given). An audit log entry is written when consent is
captured. Required before any outbound counselor follow-up.
`Code location:` `types/charter.ts → VeteranProfile.contact_consent` /
`app/api/chat/route.ts`

**Data Minimization**
The process of stripping non-schema fields from profile updates before writing to the
database. Enforced by `minimizeForStorage()`, which passes only a hardcoded allowlist
of structured fields (`STORABLE_FIELDS`). Free-text user message content must never
reach the DB — this gate enforces that constraint.
`Code location:` `lib/minimizeForStorage.ts → minimizeForStorage()` / `STORABLE_FIELDS`

**Sensitive Fields**
The fields requiring access-logging on every read: `disability_rating`, `housing_status`,
`mental_health_history`, `substance_use_history`. Access is logged by field name only —
never the value. `substance_use_history` additionally requires explicit 42 CFR Part 2
consent before collection and must never be exported without renewed consent.
`Code location:` `STANDARDS.md §1.5` / `app/api/chat/route.ts → SENSITIVE_FIELDS`

**PHI**
Protected Health Information — any data element that could identify a veteran in
connection with health. Charter treats mental health disclosures, disability ratings, and
substance use history as PHI-adjacent even if not technically covered by HIPAA. No PHI
is stored in `audit_log` or `crisis_events`. All log calls pass through `redact()`.
`Code location:` `STANDARDS.md §0` / `lib/redact.ts`

---

## Integration Terms

**session_id**
A UUID string that identifies one veteran chat conversation end-to-end. Attached to
audit log entries, crisis events, and profile updates so they can be correlated.
**Not** a Supabase auth session. Note: the word "session" in CLAUDE.md refers to a
Claude Code AI assistant conversation — that is a completely different concept.
`Code location:` `types/charter.ts → VeteranProfile.session_id`

**Source**
The channel from which an `/api/analyze` request originated. One of: `web` | `iva` |
`sms` | `simulation` | `internal`. Stored in audit logs for triage. **Not** the same
as `RagChunk.source`, which is the document filename in the knowledge base. Always
qualify: "source channel" vs "chunk source."
`Code location:` `app/api/analyze/route.ts → AnalyzeInput.source`

**Chip Context**
A signal from the LLM to the frontend specifying which set of quick-reply buttons to
show the veteran next. The LLM calls `set_chip_context` before asking a question that
maps to a button set (`branch` | `discharge` | `housing` | `employment`). The chat API
returns the `chipSet` field in the response JSON; the frontend renders the matching
button row.
`Code location:` `app/api/chat/route.ts → TOOLS` (set_chip_context) / response field
`chipSet`

**org_id**
An organizational identifier enabling multi-tenant data isolation. Every
`veteran_profiles` row and `benefit_reports` row carries an `org_id`. RLS policies
scope all queries to a single org. Currently defaults to `'api'` for the analyze
endpoint; future integration will carry per-partner org IDs.
`Code location:` `types/charter.ts → VeteranProfile.org_id`

**OTW**
Outside the Wire — the counselor platform that receives crisis notifications and
coordinates follow-up. Charter POSTs to `OTW_INTAKE_URL` during Step 3 of crisis
escalation. Best-effort only — Charter never blocks a veteran's crisis response waiting
for OTW to acknowledge.
`Code location:` `lib/crisis.ts → handleCrisisEscalation()` (Step 3) /
`process.env.OTW_INTAKE_URL`

**VSO**
Veterans Service Organization — any nonprofit organization (American Legion, VFW, DAV,
etc.) that provides benefits counseling and advocacy to veterans. VSOs are a primary
referral destination when Charter's report recommends in-person support. Accredited VSO
representatives can also file disability claims on a veteran's behalf at no cost.
`Code location:` Referenced in `STANDARDS.md` — not a code type.

---

## Terms That Changed Meaning

**benefit**
`Before 2026-04-28:` Any VA program or entitlement — the pipeline evaluated 6 broad
categories: housing, healthcare, education, disability, employment, and financial
benefits (GI Bill, VA home loans, HUD-VASH, etc.).
`After 2026-04-28:` Specifically one of 8 mental health program types:
`va_mh_outpatient`, `va_mh_residential`, `vet_center`, `va_ptsd`, `va_sud`,
`mst_counseling`, `caregiver_support`, `peer_support`. Use "benefit category" or
"mental health program" for precision.
`Reason:` Charter pivoted from a general VA benefits navigator to a mental health
navigator built in partnership with US Vets, whose intake pipeline targets mental health
access specifically.

**report**
`Before:` Used loosely for any output from the pipeline.
`After:` Two strictly distinct things — `ReportJSON` (the analysis content object,
returned by `runPipeline()`) and `BenefitReport` (the Supabase row in `benefit_reports`
tracking status and storing the JSON after completion). Never use "report" without
qualification in code or prose.
`Reason:` The database row and the analysis content have different shapes, lifecycles,
and access patterns; ambiguity caused confusion about which object was being passed or
persisted.
