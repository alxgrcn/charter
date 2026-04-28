-- Migration 004: Crisis events — append-only record, no PHI
-- session_id is text (consistent with veteran_profiles.session_id)

create table if not exists crisis_events (
  id                  uuid primary key default gen_random_uuid(),
  session_id          text not null,
  channel             text not null default 'web',
  detected_at         timestamptz not null default now(),
  trigger_type        text not null,
  counselor_notified  boolean default false,
  created_at          timestamptz default now()
);

-- Service role only — no direct reads through anon or user roles
alter table crisis_events enable row level security;

create policy "service role only"
  on crisis_events
  for all
  using (false)
  with check (false);
