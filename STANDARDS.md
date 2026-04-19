# Charter — Coding Standards
## Veteran Benefits Engine | ~/Desktop/charter
## Last updated: 2026-04-19

> This document is the source of truth for how code is written in Charter.
> Every Hank session reads this file before writing a single line.
> Every PR, every change, every feature defers to these rules.

---

## 0. Philosophy

**Write code that a stranger could audit.**
Charter handles veteran PII — disability ratings, housing status, military 
discharge history, mental health disclosures, and income. It may also handle 
substance-use history protected by 42 CFR Part 2 (stricter than HIPAA). 
Every decision must be defensible to a veteran, a compliance reviewer, 
a VA adjudicator, or a court.

**No benefit claim without a citation.**
The LLM may not state that a veteran qualifies for a benefit without citing 
the specific regulation retrieved from pgvector. If it cannot cite, it cannot 
claim. This is the core integrity requirement of the system.

**Explicit over implicit. Comment the why, not the what.**

---

## 1. Security Defaults (Non-Negotiable)

### 1.1 Supabase Client Rules
- anon client → public-facing reads only
- service client → trusted server-side ops only
- NEVER use service client in client components
- Document every createServiceClient() with a comment:
  // SERVICE CLIENT: generating report — trusted server op

### 1.2 RLS Is Mandatory
Every table must have Row Level Security enabled.
Write RLS policies before inserting data.

Standard org-scoped policy pattern:
```sql
CREATE POLICY "org_own_rows" ON veteran_profiles
  FOR ALL USING (org_id = current_setting('app.org_id'));
```

Audit log — service insert only, no public reads:
```sql
CREATE POLICY "service_insert" ON audit_log 
  FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "no_reads_default" ON audit_log 
  FOR SELECT USING (false);
```

### 1.3 No Secrets in Code
- .env.local is never committed. Confirm in .gitignore before every commit.
- No API keys, UUIDs, or passwords in source — ever.

### 1.4 Input Validation
All inputs validated server-side with Zod before DB writes.
```ts
const parsed = VeteranProfileSchema.safeParse(body)
if (!parsed.success) return NextResponse.json({ error: 'Invalid' }, { status: 400 })
```

### 1.5 Sensitive Field Tagging
Tag these fields in schema comments and never log their values:
- `disability_rating`
- `housing_status`
- `mental_health_history`
- `substance_use_history` ← 42 CFR Part 2: requires explicit consent before collection

Access to these fields must be logged to `audit_log` (field name only, never value).

---

## 2. Compliance Rules

### 2.1 Benefit Citations Required
The LLM may not state that a veteran qualifies for a benefit without citing
the specific regulation retrieved from pgvector. If it cannot cite, it cannot
claim.

### 2.2 Confidence Threshold
Confidence < 0.75 on any benefit determination → counselor review flag only.
Never display as confirmed to the veteran.

### 2.3 Veterans Crisis Line
988 (Veterans Crisis Line) must appear in every generated report.

### 2.4 42 CFR Part 2
`substance_use_history` requires explicit consent before collection.
Never exported without renewed consent.

### 2.5 PII in Logs
No PII in any log file — ever. Log field names, not values.

---

## 3. Git Hygiene

- One task per commit
- `tsc --noEmit` + tests must pass clean before every commit
- Never commit `.env.local` or any file containing secrets
- Confirm `.gitignore` before every commit
