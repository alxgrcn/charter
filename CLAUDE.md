# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Charter — CLAUDE.md
## Hank's Operating Instructions (Read Every Session)

**Project:** Charter — Veteran Mental Health Navigator  
**Stack:** Next.js 14 · TypeScript · Tailwind · Supabase + pgvector ·
LangGraph · Claude Sonnet · OpenAI text-embedding-3-small  
**Repo:** ~/Desktop/charter | github.com/alxgrcn/charter  
**Dev server:** localhost:3003  
**Production URL:** https://charter-rosy.vercel.app

> **Note:** This repo runs a non-standard Next.js version with breaking changes. Read `node_modules/next/dist/docs/` before writing new Next.js patterns. Do not assume conventions from training data.

---

## Read at Session Start
- Read `docs/GLOSSARY.md` — shared vocabulary. These definitions win.
- Read `docs/CONTEXT_MAP.md` — what Charter owns and does not own.
- Read `docs/CONTRACTS.md` — interface agreements with IVA, SMS, OTW.

---

## Rules (Non-Negotiable)
1. Read CLAUDE.md AND STANDARDS.md only when explicitly instructed to at session start
2. Plan Mode before every feature — propose, get approval, then build
3. LOCAL FIRST — read actual files before assuming structure
4. One task per commit. `tsc --noEmit` + tests clean before every commit
5. Never commit `.env.local` or any secrets
6. `str_replace` requires 3+ lines of surrounding context
7. If a task is unclear, ask before building the wrong thing
8. Every benefit determination must include a regulation citation
9. Veterans Crisis Line (988) must appear in every generated report
10. No PII in any log file — ever. Log field names only, never values

---

## Commands

```bash
npm run dev              # Start dev server on localhost:3003
npm run build            # Production build
npx tsc --noEmit         # Type check (required before every commit)

# Test suite (all require .env.local)
npm run test:analyze     # API /analyze route — 6 assertions
npm run test:crisis      # Crisis escalation + audit — 16 assertions
npm run test:pipeline    # Full LangGraph pipeline (hits live APIs)
npm run test:retrieval   # RAG retrieval quality
npm run test:audit-events
npm run test:oth-edge-case
npm run test:all         # Run all tests in sequence

# Document ingestion
npm run ingest -- <filePath> <source> [section] '[benefit_categories_json]' '[eligibility_factors_json]'
# Example: npm run ingest -- documents/va-mh.pdf "VA Mental Health" "§17.38" '["va_mh_outpatient"]' '["service"]'
```

---

## Architecture: Request Flow

### Chat path (`POST /api/chat`)
1. Receives `{ messages, profile }` — profile starts as a sparse object, not a full `VeteranProfile`
2. Runs a Claude tool-calling loop (up to 10 iterations) using tools: `record_field`, `flag_uncertain`, `set_chip_context`, `trigger_analysis`
3. `record_field` accumulates `profileUpdates` in memory; fields are **not** written to Supabase until after pipeline completion
4. `trigger_analysis` fires two layers in sequence:
   - **Fast layer** (`lib/fast-analysis.ts`): deterministic keyword classifier, < 100ms, returns immediately to veteran
   - **Deep layer** (`core/pipeline.ts`): LangGraph pipeline, fire-and-forget (`.then()/.catch()`), result is emailed if profile has an email address
5. If `crisis_flag` is set, `handleCrisisEscalation()` runs synchronously before any response is sent

### Analyze path (`POST /api/analyze`)
Internal webhook (requires `INTERNAL_WEBHOOK_SECRET` Bearer token). Builds a `VeteranProfile` from the request body, runs the full pipeline synchronously, and returns structured JSON. Used by IVA and SMS integrations.

### LangGraph pipeline (`core/pipeline.ts`) — node order
```
enrichProfile → analyzeBenefits → mapSynergies → [checkDischargeUpgrade?] → prioritizeBenefits → generateReport
```
- `analyzeBenefits`: parallel RAG fetch for 8 mental health benefit categories, then a single multi-benefit LLM call
- `checkDischargeUpgrade`: conditional edge — only fires for OTH/general/bad_conduct discharges
- The pipeline state uses a LangGraph reducer for `benefits` (array append), so `checkDischargeUpgrade` pushes a new determination onto the existing array

### RAG (`lib/rag.ts`)
Embeds a query with `text-embedding-3-small`, calls `match_documents` RPC on Supabase (pgvector cosine similarity, threshold 0.3), returns top-K chunks. Filters by `benefit_categories` array.

### Profile lifecycle
- Chat: profile lives in client state; server merges `profile + profileUpdates` on each request; written to `veteran_profiles` only after deep pipeline completes
- `VeteranProfile.household_income` and other numeric fields arrive as `undefined` (not `null`) when never collected — guard with `!= null`, not `!== null`

---

## Database Tables

| Table | Purpose |
|---|---|
| `regulation_chunks` | pgvector knowledge base — source documents chunked and embedded |
| `veteran_profiles` | Intake data; sensitive fields encrypted; 90-day retention (`expires_at`) |
| `benefit_reports` | Generated reports (status: pending → processing → complete / failed) |
| `audit_log` | Append-only compliance log; service insert only, no reads |
| `crisis_events` | One row per detected crisis; tracks `counselor_notified` flag |

---

## Key Rules for This Codebase

**Supabase clients:**
- `createServiceClient()` — server-side only, bypasses RLS; every call site must have a comment `// SERVICE CLIENT: <reason>`
- `createBrowserClient()` — public reads only

**Compliance:**
- Confidence < 0.75 → set `needs_counselor_review = true`; never show as confirmed to veteran
- `substance_use_history` requires explicit consent before collection (42 CFR Part 2)
- `disability_rating`, `housing_status`, `mental_health_history` — access-logged on read (field name only)
- 988 Veterans Crisis Line must appear in every generated report and every crisis response

**LLM outputs:**
- `determineAllBenefits()` sends a single multi-benefit LLM call and expects a JSON array; no markdown fences
- If the LLM returns a determination without a matching `benefit_id`, `unknownDetermination()` is used as the fallback

**Environment variables required:**
```
ANTHROPIC_API_KEY
OPENAI_API_KEY
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
INTERNAL_WEBHOOK_SECRET      # Bearer token for /api/analyze
OTW_INTAKE_URL               # Optional: counselor notification webhook
RESEND_API_KEY               # Optional: email report delivery
VERCEL_URL                   # Set automatically on Vercel
```
