-- Charter Schema — Migration 001
CREATE EXTENSION IF NOT EXISTS vector;

-- regulation_chunks: the knowledge base
CREATE TABLE regulation_chunks (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content             text NOT NULL,
  embedding           vector(1536),
  source              text NOT NULL,
  section             text,
  benefit_categories  text[],
  state               text,
  eligibility_factors text[],
  last_updated        date,
  created_at          timestamptz DEFAULT now()
);
CREATE INDEX ON regulation_chunks
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);
ALTER TABLE regulation_chunks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_manage" ON regulation_chunks
  FOR ALL TO service_role USING (true);

-- veteran_profiles: intake data
CREATE TABLE veteran_profiles (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              text NOT NULL DEFAULT 'direct',
  session_id          text,
  service_branch      text,
  years_served        numeric,
  discharge_type      text,
  combat_veteran      boolean DEFAULT false,
  disability_rating   integer,   -- SENSITIVE: PHI-adjacent
  housing_status      text,      -- SENSITIVE: indicates homelessness
  household_income    numeric,   -- SENSITIVE
  household_size      integer,
  state               text,
  age                 integer,
  separation_date     date,      -- PII
  created_at          timestamptz DEFAULT now(),
  expires_at          timestamptz DEFAULT (now() + interval '90 days')
);
ALTER TABLE veteran_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_manage" ON veteran_profiles
  FOR ALL TO service_role USING (true);

-- benefit_reports: async pipeline output
CREATE TABLE benefit_reports (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  veteran_profile_id  uuid REFERENCES veteran_profiles(id) ON DELETE CASCADE,
  org_id              text NOT NULL DEFAULT 'direct',
  status              text NOT NULL DEFAULT 'pending',
  report_json         jsonb,
  pdf_url             text,
  created_at          timestamptz DEFAULT now(),
  completed_at        timestamptz
);
ALTER TABLE benefit_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_manage" ON benefit_reports
  FOR ALL TO service_role USING (true);

-- audit_log: append-only, no PII, 7-year retention
CREATE TABLE audit_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at    timestamptz DEFAULT now() NOT NULL,
  org_id        text,
  actor_role    text NOT NULL,
  action        text NOT NULL,
  resource_type text,
  resource_id   uuid,
  meta          jsonb
);
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_insert" ON audit_log
  FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "no_reads_default" ON audit_log
  FOR SELECT USING (false);
