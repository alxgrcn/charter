# Charter — Engineering Roadmap
## Veteran Benefits Engine | Last updated: 2026-04-19

---

## Current Status

| Phase | Stage | Status |
|---|---|---|
| Phase 0 | Foundation + Corpus | 🔄 In Progress |
| Phase 1 | Core Engine (LangGraph) | ⏳ Pending |
| Phase 2 | Chat Interface | ⏳ Pending |
| Phase 3 | OTW Integration | ⏳ Pending |
| Phase 4 | Compliance Hardening | ⏳ Pending |
| Phase 5 | California State Corpus | ⏳ Pending |
| Phase 6 | NerdWallet Layer | ⏳ Future |

---

## Phase 0 — Foundation and Corpus

### Stage 0.1 — Project Scaffold ← YOU ARE HERE
- [x] Next.js app at ~/Desktop/charter
- [x] CLAUDE.md, STANDARDS.md, ROADMAP.md created
- [ ] Supabase schema migration written (Task 2)
- [ ] Ingestion script scaffold created (Task 2)
- [ ] GitHub repo created and pushed
- [ ] tsc clean

### Stage 0.2 — Ingestion Pipeline
- [ ] readDocument() — PDF + HTML
- [ ] chunkText() — 500 tokens, 50-token overlap
- [ ] embedChunk() — OpenAI text-embedding-3-small
- [ ] insertChunk() — Supabase pgvector
- [ ] ingestDocument() — orchestrates above

Priority federal documents to index first:
1. VA Healthcare eligibility + priority groups (benefits.va.gov)
2. GI Bill Chapter 33 program guide (va.gov)
3. HUD-VASH PIH Notice — most recent (hud.gov)
4. SSVF Program Guide (va.gov/homeless/ssvf)
5. VA Home Loan Guaranty (benefits.va.gov)

Retrieval gate: 10 test queries → 8/10 must return relevant chunks.

---

## Phase 1 — Core Engine

- [ ] Veteran profile Zod schema
- [ ] Profile enrichment node
- [ ] 6 parallel benefit analysis nodes (housing, healthcare, education, disability, employment, financial)
- [ ] Synergy mapping node
- [ ] Discharge upgrade check node (conditional edge)
- [ ] Prioritization node (urgency scoring + expiry flags)
- [ ] Report generation node (structured JSON, citation required)
- [ ] PDF export node
- [ ] Universal Layer hardcoded (12 Tier 1 benefits, no RAG needed)

Gate: 8 of 10 test veteran profiles → correct benefits + valid citations.

---

## Phase 2 — Chat Interface

- [ ] Mobile-first chat UI (375px minimum)
- [ ] Claude API + tool calling (record_field, flag_uncertain, trigger_analysis)
- [ ] Profile builds from conversation (invisible to veteran)
- [ ] Crisis keyword detection (keyword match + Haiku classifier)
- [ ] Report renders in chat thread
- [ ] Disclaimer before benefit list
- [ ] Veterans Crisis Line in report header
- [ ] PDF download button
- [ ] Deploy to Vercel

---

## Phase 3 — OTW Integration

- [ ] POST /api/charter/analyze endpoint
- [ ] Fires automatically on OTW intake submission
- [ ] Benefits Report tab in OTW counselor dashboard
- [ ] Counselor annotation layer
- [ ] Generate PDF for Veteran button

---

## Phase 4 — Compliance Hardening

- [ ] Consent disclosure at chat start
- [ ] 42 CFR Part 2 field handling
- [ ] redact() on all logs
- [ ] Field-level encryption on sensitive fields
- [ ] 90-day retention enforcement
- [ ] BAA confirmations: Anthropic, Supabase, OpenAI
- [ ] Full HITRUST Phase 1 checklist complete

---

## Phase 5 — California State Corpus

- [ ] California Military and Veterans Code
- [ ] CalVet program guides
- [ ] College Fee Waiver documentation
- [ ] Property tax exemption docs
- [ ] LA County DVS program documentation
- [ ] State detection by zip code in chat

---

## Phase 6 — NerdWallet Layer (Future)

- [ ] VA Home Loan lender referral integration
- [ ] Disability claims agent referral network
- [ ] GI Bill education partner referrals
- [ ] Discharge upgrade attorney network
- [ ] Employer marketplace

---

## Architectural Principles (Never Negotiate)

1. No benefit claim without a regulation citation
2. Confidence < 0.75 → counselor review flag, never shown to veteran as confirmed
3. Veterans Crisis Line in every report — tested
4. Disclaimer before benefit list — prominent, tested
5. LangGraph pipelines always async — never block a web request
6. No PII in any log — redact() mandatory
7. 42 CFR Part 2: consent before collection, encrypted, access-logged
8. RLS on every Supabase table
9. No secrets committed — ever

---

## Cost Reference

| Item | Cost | Notes |
|---|---|---|
| Supabase | Free → $25/mo | Pro when corpus exceeds free tier |
| OpenAI embeddings | ~$3 one-time | Full federal corpus |
| Monthly refresh | ~$0.50/mo | Changed docs only |
| Per report (no cache) | ~$0.08 | Claude Sonnet + embeddings |
| Per report (cached) | ~$0.02 | Common patterns cached |
| 1M reports/year (cached) | ~$20,000 | Rounding error vs value delivered |
