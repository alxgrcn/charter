# DEBUGGING.md
## Charter — Expert Debugging Protocol
### Read this file at session start. Follow it every time something breaks.

---

## The Prime Directive

> **Diagnose before you fix. Never change code until you know the root cause.**

A wrong fix applied fast wastes more time than a slow diagnosis. If you are not certain what caused the bug, you are not ready to fix it. State your hypothesis, explain your evidence, and wait for approval before touching any file.

---

## The Two-Terminal Rule

**Always run the dev server in a dedicated terminal that stays visible while testing.**

When the app is running in one terminal and you test in the browser, the terminal is printing a live stream of everything happening on the server — every request, every error, every console.log from every API route. This is called Reading Logs, and it is the fastest diagnostic tool available.

The browser only shows you what the server decided to send back. If the server crashes internally and catches its own error, the browser may receive a perfectly normal-looking 200 response with the wrong content. Without the terminal, you would never know. With it, you see the exact error, the exact file, and often the exact line — in seconds.

### How to keep it

Open two terminal windows or split your terminal panel:
- Terminal 1 — runs `npm run dev`. Keep it visible at all times while testing.
- Terminal 2 — runs all other commands (tests, git, grep, curl, tsc).

Any time something feels wrong in the browser, look at Terminal 1 before doing anything else. The error is almost always there.

### How to restart a stuck dev server

lsof -ti:3003 | xargs kill -9 && npm run dev

Run this before diagnosing any "it worked before and now it doesn't" bug. A stale server process can mask the real state of the code.

---

## The Debugging Stack

Follow this order every time something breaks. Do not skip steps. Do not jump to fixes.

### Step 1 — Read the Server Terminal (Logs)
Open the terminal running `npm run dev`. Read the output from the moment you triggered the error.

What to look for:
- Error: lines — thrown exceptions with a file path and line number
- FAILED — pipeline or route failures with a session ID and message
- [route-name] prefixed logs — intentional debug logs showing request flow
- Stack traces — read top to bottom; the first line in your code (not node_modules) is usually the root cause

If the terminal shows the error clearly — stop here. You have your diagnosis. Do not proceed until you have reported the finding.

---

### Step 2 — Check Response Timing

Rule: Real external API calls (Anthropic, Supabase, Resend, Cal.com) take a minimum of 300–1000ms. If your route responded in under 200ms, it threw before making any external call.

How to check: Browser DevTools → Network tab → find the request → check the Duration column.

If timing is under 200ms, look for:
- Module-level variable initialization that depends on process.env
- Imports that throw on load
- Missing env vars that cause SDK constructors to fail silently

Lesson from Charter (April 29): The Anthropic client was initialized at module level. When the dev server started before .env.local was read, process.env.ANTHROPIC_API_KEY was undefined. The SDK stored null silently. Every request failed in 37ms — fast enough to prove no HTTP was ever made.

Fix pattern: Never initialize external SDK clients at module level. Always initialize inside the handler function.

// WRONG
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
export async function POST(req: Request) { ... }

// CORRECT
export async function POST(req: Request) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  ...
}

---

### Step 3 — Check the Browser DevTools Network Tab

Open DevTools (F12) → Network tab. Find the failing request.

What to look for:
- Status code — 200 with wrong content means the server caught its own error
- Response body — read the actual JSON returned
- Request payload — confirm the browser sent what you think it sent
- Timing — see Step 2

---

### Step 4 — Use curl to Bypass the Browser

# Basic POST test
curl -X POST http://localhost:3003/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "test message", "sessionId": "test-123"}'

# Test an external API key directly
source .env.local && curl https://api.anthropic.com/v1/messages \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "Content-Type: application/json" \
  -d '{"model":"claude-sonnet-4-20250514","max_tokens":10,"messages":[{"role":"user","content":"ping"}]}'

If curl works but the browser doesn't — the bug is in the frontend.
If curl also fails — the bug is in the API route or downstream service.

---

### Step 5 — Run TypeScript Compiler Check

npx tsc --noEmit

Run before any commit. If TSC is not clean, do not commit. Fix type errors first.

---

### Step 6 — Use grep to Find All Usages

grep -rn "functionName\|variableName" app/ lib/ core/ --include="*.ts"
grep -rn "!== null\|!= null" lib/ --include="*.ts"
grep -rn "We ran into an issue" app/ lib/ --include="*.ts"

Use grep before you propose a fix that touches multiple files.

---

### Step 7 — Form a Hypothesis and Report

Write out:
1. What broke — exact symptom
2. What caused it — specific file and line
3. Why it caused it — the mechanism
4. Evidence — logs, timing, curl output, tsc output
5. Proposed fix — the minimal change that resolves the root cause

Do not write code until Alex approves the hypothesis.

---

## Known Footguns — Check These First

### 1. !== null vs != null

null = field exists, no value. undefined = field does not exist at all.
!== null (strict) — only catches null. Crashes if value is undefined.
!= null (loose) — catches both. Use this for any optional field.

Lesson from Charter (April 29): lib/llm.ts:71 used !== null on household_income. The field was undefined (never collected), not null. The strict check passed, .toLocaleString() was called on undefined, pipeline crashed.

// WRONG
profile.household_income !== null ? `$${profile.household_income.toLocaleString()}` : 'unknown'

// CORRECT
profile.household_income != null ? `$${profile.household_income.toLocaleString()}` : 'unknown'

// ALSO CORRECT
profile.household_income?.toLocaleString() ?? 'unknown'

---

### 2. Never Reconstruct a File from Memory

Always read the actual file:
cat supabase/migrations/004_crisis_events.sql
cat .env.local

Lesson from Charter (April 29): A migration SQL reconstructed from memory was missing three columns. Applied via CREATE TABLE IF NOT EXISTS on an existing table — silent no-op. Schema change never happened.

---

### 3. CREATE TABLE IF NOT EXISTS is a Silent No-Op

If the table already exists, the statement is skipped silently. Use ALTER TABLE instead.

-- WRONG
CREATE TABLE IF NOT EXISTS crisis_events ( new_column text );

-- CORRECT
ALTER TABLE crisis_events ADD COLUMN IF NOT EXISTS new_column text;

---

### 4. Module-Level SDK Initialization

All SDK clients must be initialized inside handler functions, not at module level.

---

### 5. VERCEL_URL in Local Dev

VERCEL_URL does not exist in local dev. URLs built with it become https://undefined/api/...

Fix:
const baseUrl = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : 'http://localhost:3003'

---

## Debugging Prompt Contract

GOAL: Diagnose [symptom]. Do not fix until findings are reviewed.

CONSTRAINTS:
- Read CLAUDE.md and DEBUGGING.md before starting
- Diagnose only — no code changes until Alex approves
- Use the Two-Terminal Rule — read server logs first
- Read actual files, never reconstruct from memory
- Run tsc --noEmit before proposing any fix

FORMAT:
- What broke (symptom)
- What caused it (root cause — specific file and line)
- Why it caused it (mechanism)
- Evidence (logs, timing, curl output, tsc output)
- Proposed fix (minimal, targeted)

FAILURE: Do not apply any fix. Do not commit anything. Report findings only.

---

## Diagnostic Checklist — Run in Order

- [ ] Read Terminal 1 logs — what does the server say?
- [ ] Check response timing — under 200ms means API was never called
- [ ] Check browser Network tab — exact request and response bodies
- [ ] curl the route directly — bypass the UI
- [ ] Check .env.local — every required env var present and correct?
- [ ] Check for module-level SDK initialization — move inside handler if found
- [ ] Run npx tsc --noEmit — any type errors?
- [ ] grep for the broken pattern — every usage in the codebase
- [ ] Check for !== null on optional fields — should be != null
- [ ] Check for VERCEL_URL in local dev — needs a fallback
- [ ] Read actual files — never reconstruct from memory
- [ ] State hypothesis — diagnose before fixing
- [ ] Wait for approval — no commits until reviewed

---

## File Reference

| File | Purpose |
| CLAUDE.md | Session-start rules, test commands, env vars, architecture overview |
| DEBUGGING.md | This file — debugging protocol and known footguns |
| docs/GLOSSARY.md | Ubiquitous language — shared vocabulary for all terms |
| docs/CONTEXT_MAP.md | Bounded contexts — what Charter owns and does not own |
| docs/CONTRACTS.md | Integration contracts — interface agreements with IVA, SMS, OTW |

---

Written by Rex (Claude Sonnet 4.6) — April 30, 2026
Based on real debugging sessions on Charter. Every lesson in this file cost real time.
