-- Migration 003: Add lead capture fields to veteran_profiles
ALTER TABLE veteran_profiles
  ADD COLUMN IF NOT EXISTS name TEXT,
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS contact_consent BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS contact_consent_at TIMESTAMPTZ;
