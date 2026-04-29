-- Migration 005: Backfill crisis_events columns missing from live DB
-- The table was created before 004 was written, so CREATE TABLE IF NOT EXISTS
-- silently skipped. These three ALTERs bring the live schema in line with 004.

ALTER TABLE crisis_events
  ALTER COLUMN session_id TYPE text,
  ADD COLUMN IF NOT EXISTS detected_at        timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS trigger_type       text,
  ADD COLUMN IF NOT EXISTS counselor_notified boolean NOT NULL DEFAULT false;
