# Charter — CLAUDE.md
## Hank's Operating Instructions (Read Every Session)

**Project:** Charter — Veteran Benefits Engine  
**Stack:** Next.js 14 · TypeScript · Tailwind · Supabase + pgvector · 
LangGraph · Claude Sonnet · OpenAI text-embedding-3-small  
**Repo:** ~/Desktop/charter | github.com/alxgrcn/charter  
**Dev server:** localhost:3003  
**Production URL:** https://charter-rosy.vercel.app  

## Rules (Non-Negotiable)
1. Read CLAUDE.md AND STANDARDS.md only when explicitly instructed to at session start
2. Plan Mode before every feature — propose, get approval, then build
3. LOCAL FIRST — read actual files before assuming structure
4. One task per commit. tsc + tests clean before every commit
5. Never commit .env.local or any secrets
6. str_replace requires 3+ lines of surrounding context
7. If a task is unclear, ask before building the wrong thing
8. Every benefit determination must include a regulation citation
9. Veterans Crisis Line (988) must appear in every generated report
10. No PII in any log file — ever

## Architecture at a Glance
- regulation_chunks → the knowledge base (pgvector)
- veteran_profiles → intake data (encrypted sensitive fields, 90-day retention)
- benefit_reports → generated reports (async, queued)
- audit_log → append-only compliance log (no PII in metadata)
- scripts/ingest.ts → document ingestion pipeline
- core/pipeline.ts → LangGraph benefit analysis pipeline

## Key Rules for This Codebase
- Supabase SERVICE client: server-side only, document every usage with a comment
- Supabase ANON client: public reads only
- RLS: enabled on every table, policies written before data
- LangGraph pipelines: always async, never block a web request
- Sensitive fields: disability_rating, housing_status, mental_health_history —
  encrypted at rest, access-logged on every read
- 42 CFR Part 2: substance_use_history requires explicit consent before 
  collection, never exported without renewed consent
- Confidence < 0.75 on any benefit determination → counselor review flag only,
  not shown to veteran as confirmed
