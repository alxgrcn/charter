ALTER TABLE veteran_profiles
  ADD COLUMN IF NOT EXISTS mental_health_conditions text[] DEFAULT '{}';
